import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

/**
 * §14 CONTRACT TEST — the enforcement primitive, part of the Pi pin-bump gate
 * (docs/validation/sk1.md). Proves the pinned Pi honors, at startup (no turn):
 *   --no-skills   → Pi's own discovery is OFF (a skill in ~/.agents/skills is absent)
 *   --skill <dir> → the passed skill still loads (additive to --no-skills)
 * get_commands is a pure RPC query listing loaded skills as `skill:<name>`, so no
 * API key is needed. If a pin bump breaks this, HappyVibe's whole trust gate is
 * void (unapproved skills would reach the model), so this MUST stay green.
 */

const runtime = path.join(process.cwd(), "pi-runtime");
const CLI = path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
let client: PiClient;
afterEach(() => client?.stop());

function writeSkill(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Description for ${name}.\n---\n\n# ${name}\n`);
}

test.skipIf(!fs.existsSync(CLI))(
  "--no-skills + --skill loads only the passed skill, suppressing discovery",
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-skcontract-"));
    const home = path.join(tmp, "home");
    const work = path.join(tmp, "work");
    fs.mkdirSync(work, { recursive: true });
    const approved = path.join(tmp, "approved", "pdf-tools");
    writeSkill(approved, "pdf-tools");
    // A skill Pi WOULD discover from ~/.agents/skills — must be suppressed by --no-skills.
    writeSkill(path.join(home, ".agents", "skills", "sneaky"), "sneaky-skill");

    client = new PiClient({
      execPath: process.execPath,
      args: [
        CLI, "--mode", "rpc", "--no-session",
        "--no-skills", "--skill", approved,
        "--provider", "deepseek", "--model", "deepseek-v4-flash",
      ],
      env: {
        ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: "sk-contract-noop",
        HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"),
      } as Record<string, string>,
      cwd: work,
    });
    await client.start();

    const res = await client.send({ type: "get_commands" });
    const skills = ((res.data as { commands?: Array<{ name: string }> })?.commands ?? [])
      .filter((c) => c.name.startsWith("skill:"))
      .map((c) => c.name);

    expect(skills).toContain("skill:pdf-tools"); // --skill is additive to --no-skills
    expect(skills).not.toContain("skill:sneaky-skill"); // --no-skills suppressed discovery
  },
  60_000,
);
