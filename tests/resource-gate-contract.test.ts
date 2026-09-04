import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { PI_CLI_RELPATH, resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * CONTRACT TEST — part of the Pi pin-bump gate, sibling of skills-contract.test.ts
 * (docs/validation/sk1.md).
 *
 * `<agentDir>` is PI_CODING_AGENT_DIR, app-owned — but the agent's `bash` tool is
 * NOT path-confined, so one approved bash command can write
 * `<agentDir>/extensions/x.ts` and that file then loads with full extension
 * privileges on every future session. A bare .ts is enough: no manifest, no
 * install step (package-manager.js:436). The prompt the user approved said "run a
 * bash command", not "install a permanent extension". So all three auto-discovery
 * tiers are gated at spawn, and this pins both halves of that:
 *
 *   --no-extensions / --no-prompt-templates / --no-themes / --no-skills
 *        → Pi's own discovery from <agentDir> is OFF
 *   -e / --prompt-template / --skill
 *        → what HappyVibe passes explicitly STILL loads (the flags are additive,
 *          resource-loader.js:267/281/294/311)
 *
 * The additive half is the load-bearing one: HappyVibe's three extensions all
 * arrive via `-e`, and the bridge is the sole permission path. If a pin bump made
 * `--no-extensions` absolute, the app would silently lose its entire permission
 * layer at spawn. That must be a red test, not a red app.
 *
 * Key-free — get_commands is a pure RPC query, dispatched locally with no model
 * turn — so this stays in the non-live suite.
 */

const runtime = path.join(process.cwd(), "pi-runtime");
// Built from PI_CLI_RELPATH, never hardcoded: the entry moved to dist/bundle/cli.js
// and the old dist/cli.js is broken at Pi 0.85.0 (tests/pi-cli-entry.test.ts). A
// literal here would spawn a different binary than the app does, and the
// existsSync guard below would skip these tests in SILENCE the day it is deleted.
const CLI = path.join(runtime, PI_CLI_RELPATH);
let client: PiClient;
afterEach(() => client?.stop());

const EXT = (n: string): string =>
  `export default function (pi) { pi.registerCommand("${n}", { description: "${n}", handler: async () => {} }); }\n`;
const SKILL = (n: string): string => `---\nname: ${n}\ndescription: Description for ${n}.\n---\n\n# ${n}\n`;
const PROMPT = (n: string): string => `---\ndescription: ${n}\n---\n\nDo ${n}.\n`;

const write = (file: string, body: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

/**
 * Plants one approved resource of each kind (passed explicitly on the CLI) and one
 * "sneaky" one of each kind (planted where Pi auto-discovers, i.e. <agentDir>),
 * then asks the real pinned CLI which commands it loaded.
 *
 * NOTE: auto-discovered extensions must be `.ts` or `.js` (package-manager.js:436).
 * A `.mjs` there is correctly ignored, which yields a false "no hole here" pass.
 */
async function loadedCommands(gates: string[], promptScope: "dir" | "file" = "dir"): Promise<Record<string, string[]>> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-resgate-"));
  const home = path.join(tmp, "home");
  const agentDir = path.join(home, ".pi", "agent");
  const work = path.join(tmp, "work");
  fs.mkdirSync(work, { recursive: true });

  const approvedExt = path.join(tmp, "approved-ext.ts");
  const approvedSkill = path.join(tmp, "skills", "approved-skill");
  const approvedPrompts = path.join(tmp, "prompts");
  write(approvedExt, EXT("approved-ext"));
  write(path.join(approvedSkill, "SKILL.md"), SKILL("approved-skill"));
  write(path.join(approvedPrompts, "approved-cmd.md"), PROMPT("approved-cmd"));
  // Sibling in the SAME directory as the approved command — never passed on the
  // CLI. It is what the per-file arm below watches for (§24 approval is per file).
  write(path.join(approvedPrompts, "sibling-cmd.md"), PROMPT("sibling-cmd"));

  write(path.join(agentDir, "extensions", "sneaky-ext.ts"), EXT("sneaky-ext"));
  write(path.join(agentDir, "skills", "sneaky-skill", "SKILL.md"), SKILL("sneaky-skill"));
  write(path.join(agentDir, "prompts", "sneaky-cmd.md"), PROMPT("sneaky-cmd"));

  client = new PiClient({
    execPath: process.execPath,
    args: [
      CLI, "--mode", "rpc", "--no-session",
      ...gates,
      "-e", approvedExt,
      "--skill", approvedSkill,
      "--prompt-template", promptScope === "file" ? path.join(approvedPrompts, "approved-cmd.md") : approvedPrompts,
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: "sk-contract-noop",
      HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"),
      PI_CODING_AGENT_DIR: agentDir,
    } as Record<string, string>,
    cwd: work,
  });
  await client.start();

  const res = await client.send({ type: "get_commands" });
  const commands = ((res.data as { commands?: Array<{ name: string; source?: string }> })?.commands ?? [])
    .filter((c) => /approved|sneaky|sibling/.test(c.name));
  const bySource: Record<string, string[]> = { extension: [], skill: [], prompt: [] };
  for (const c of commands) bySource[c.source ?? "?"]?.push(c.name);
  return bySource;
}

// The unit half: every tier is gated on the spawn we actually build. Cheap, and it
// fails loudly if someone drops a flag while the CLI contract below still passes.
test("resolvePiSpawn gates every auto-discovered resource tier", () => {
  const { args } = resolvePiSpawn("/ws", "/sessions", runtime);
  for (const flag of ["--no-extensions", "--no-prompt-templates", "--no-themes", "--no-skills"]) {
    expect(args).toContain(flag);
  }
});

// Guards the negative assertions below from going vacuously green: if a future Pi
// stopped auto-discovering from <agentDir>, or the probe planted its files in the
// wrong place, "sneaky absent" would prove nothing. This arm proves the sneaky
// files ARE discoverable, so suppressing them in the next test means something.
test.skipIf(!fs.existsSync(CLI))(
  "UNGATED: Pi auto-discovers extensions, skills and prompts from <agentDir> — the hole the flags close",
  async () => {
    const loaded = await loadedCommands([]);
    expect(loaded.extension).toEqual(expect.arrayContaining(["approved-ext", "sneaky-ext"]));
    expect(loaded.skill).toEqual(expect.arrayContaining(["skill:approved-skill", "skill:sneaky-skill"]));
    expect(loaded.prompt).toEqual(expect.arrayContaining(["approved-cmd", "sneaky-cmd"]));
  },
  60_000,
);

test.skipIf(!fs.existsSync(CLI))(
  "GATED: the --no-* flags suppress <agentDir> discovery while explicitly passed resources still load",
  async () => {
    const loaded = await loadedCommands(["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"]);

    // Additive — this is the half that keeps the bridge, the MCP adapter and
    // pi-subagents alive under --no-extensions.
    expect(loaded.extension).toContain("approved-ext");
    expect(loaded.skill).toContain("skill:approved-skill");
    expect(loaded.prompt).toContain("approved-cmd");
    // A DIRECTORY arg loads every .md in it — which is exactly why §24 approves
    // per file, and what keeps the per-file arm below from passing vacuously.
    expect(loaded.prompt).toContain("sibling-cmd");

    // Suppressive — a bash-written extension never reaches a future session.
    expect(loaded.extension).not.toContain("sneaky-ext");
    expect(loaded.skill).not.toContain("skill:sneaky-skill");
    expect(loaded.prompt).not.toContain("sneaky-cmd");
  },
  60_000,
);

// PRD §24: command approval is per FILE, never per directory — approving a
// directory would silently approve whatever lands in it later, which breaks
// review-before-active. `--prompt-template` accepts both, so the whole trust
// model rests on Pi NOT widening a file path to its parent directory. If a pin
// bump did, approving one command would approve its neighbours; that must be a
// red test, not a silent widening of what the user trusted.
test.skipIf(!fs.existsSync(CLI))(
  "PER-FILE: --prompt-template <file> loads exactly that command, not its siblings",
  async () => {
    const loaded = await loadedCommands(
      ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"],
      "file",
    );
    expect(loaded.prompt).toContain("approved-cmd");
    expect(loaded.prompt).not.toContain("sibling-cmd");
  },
  60_000,
);
