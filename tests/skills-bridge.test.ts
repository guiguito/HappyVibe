import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

/**
 * §14 LIVE bridge test (real DeepSeek; batched — see CLAUDE.md). Verifies the
 * use_skill path end to end: an approved skill loads, the model calls use_skill
 * with a model-authored intent, and the tool returns the SKILL.md body. Also
 * asserts an unapproved skill never reaches the model (get_commands).
 */

import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { HV_SKILLS_SENTENCE, PI_SKILLS_SENTENCE } from "../pi-runtime/extensions/hv-skills";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";
const runtime = path.join(process.cwd(), "pi-runtime");
let client: PiClient;
afterEach(() => client?.stop());

function writeSkill(dir: string, name: string, description: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nHAPPYVIBE_SKILL_BODY_MARKER: follow these steps.\n`,
  );
  return dir;
}

test.skipIf(!KEY)(
  "approved skill loads; use_skill returns its body with a model-authored intent; unapproved skill absent",
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-skbridge-"));
    const home = path.join(tmp, "home");
    const work = path.join(tmp, "work");
    fs.mkdirSync(work, { recursive: true });
    const approvedDir = writeSkill(path.join(tmp, "managed", "pdf-tools"), "pdf-tools", "Extract text and tables from PDF files. Use for any PDF task.");
    writeSkill(path.join(home, ".agents", "skills", "sneaky"), "sneaky-skill", "Unapproved: must not load.");

    // The per-session manifest main writes to HV_SKILLS_FILE (buildManifest shape).
    const manifestFile = path.join(tmp, "skills.json");
    fs.writeFileSync(manifestFile, JSON.stringify({
      skills: [{
        name: "pdf-tools",
        dir: approvedDir,
        skillMdPath: path.join(approvedDir, "SKILL.md"),
        scope: "global",
        estTokens: { card: 20, body: 40 },
      }],
    }));

    client = new PiClient({
      execPath: process.execPath,
      args: [
        path.join(runtime, PI_CLI_RELPATH),
        "--mode", "rpc", "--no-session",
        "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
        "--no-skills", "--skill", approvedDir,
        "--provider", MODEL.provider, "--model", MODEL.modelId,
      ],
      env: {
        ...process.env, ELECTRON_RUN_AS_NODE: "1", ...PROVIDER_ENV,
        HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"),
        HV_SKILLS_FILE: manifestFile,
      } as Record<string, string>,
      cwd: work,
    });
    await client.start();

    // Only the approved skill is visible to Pi.
    const cmds = ((await client.send({ type: "get_commands" })).data as { commands?: Array<{ name: string }> })?.commands ?? [];
    const skillCmds = cmds.filter((c) => c.name.startsWith("skill:")).map((c) => c.name);
    expect(skillCmds).toContain("skill:pdf-tools");
    expect(skillCmds).not.toContain("skill:sneaky-skill");

    // Auto-allow any permission prompt (shouldn't be one — use_skill is a SAFE_TOOL).
    // A notify carries its payload in `message`; /hv-sysprompt rides one.
    const notifies: string[] = [];
    client.on("ui-request", (m) => {
      const r = m as { id: string; method?: string; message?: string; title?: string };
      if (r.method === "select") client.respondUi(r.id, { value: "Allow" });
      for (const v of [r.message, r.title]) if (typeof v === "string") notifies.push(v);
    });
    const toolStarts: Array<Record<string, unknown>> = [];
    const done = new Promise<void>((resolve) =>
      client.on("event", (e) => {
        if (e.type === "tool_execution_start") toolStarts.push(e as unknown as Record<string, unknown>);
        if (e.type === "agent_end") resolve();
      }));

    await client.send({
      type: "prompt",
      message:
        "Load the 'pdf-tools' skill using the use_skill tool (pass name:'pdf-tools' and a short intent). " +
        "Then reply with the word DONE. Do not do anything else.",
    });
    await done;

    const call = toolStarts.find((t) => t.toolName === "use_skill");
    expect(call, "expected a use_skill tool_execution_start").toBeDefined();
    const args = call!.args as { name?: unknown; intent?: unknown };
    expect(args.name).toBe("pdf-tools");
    expect(typeof args.intent).toBe("string");
    expect((args.intent as string).trim().length).toBeGreaterThan(0);

    // A4 / F3 (2026-09-10): the prompt the model actually received must carry
    // OUR skills instruction and NOT Pi's, which said the opposite. The
    // absence is the half that matters and the half a unit test cannot reach:
    // replaceSkillsSentence runs on Pi's real prompt, in before_agent_start.
    await client.send({ type: "prompt", message: "/hv-sysprompt" });
    const deadline = Date.now() + 30_000;
    let sys: string | undefined;
    while (Date.now() < deadline && !sys) {
      sys = notifies.find((n) => n.includes('"kind":"hv.sysprompt"'));
      if (!sys) await new Promise((r) => setTimeout(r, 200));
    }
    expect(sys, "no hv.sysprompt notify arrived").toBeDefined();
    const text = (JSON.parse(sys as string) as { text: string }).text;
    expect(text, "a skill is loaded, so Pi's skills block must be present").toContain("<available_skills>");
    expect(text).toContain(HV_SKILLS_SENTENCE);
    expect(text, "Pi's contradicting sentence survived the replacement").not.toContain(PI_SKILLS_SENTENCE);
    expect(text, "the old separate block should be gone").not.toContain("<happyvibe-skills>");
  },
  180_000,
);
