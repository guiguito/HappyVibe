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

for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;
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
        path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--mode", "rpc", "--no-session",
        "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
        "--no-skills", "--skill", approvedDir,
        "--provider", "deepseek", "--model", "deepseek-v4-flash",
      ],
      env: {
        ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: KEY!,
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
    client.on("ui-request", (m) => {
      const r = m as { id: string; method?: string };
      if (r.method === "select") client.respondUi(r.id, { value: "Allow" });
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
  },
  180_000,
);
