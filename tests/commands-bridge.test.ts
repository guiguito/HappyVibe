import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

/**
 * §24 LIVE bridge test (real DeepSeek; batched — see CLAUDE.md).
 *
 * Three assertions, in deliberate order of importance:
 *  1. FAIL-OPEN. An ordinary non-slash prompt still reaches the model and
 *     completes a turn. The `input` hook sits in front of EVERY user prompt, so
 *     this is the assertion that matters — if it is red, revert the hook. The
 *     card is worth less than the composer.
 *  2. An approved command expands, and the bridge emits exactly one hv.command
 *     notify carrying BOTH the typed and the expanded text (the pairing Pi
 *     itself does not preserve).
 *  3. An unapproved .md in <agentDir>/prompts is absent from get_commands —
 *     the gate, from the bridge's side.
 */

for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;
const runtime = path.join(process.cwd(), "pi-runtime");
let client: PiClient;
afterEach(() => client?.stop());

/** The marker the expansion carries — proves the EXPANDED body, not the typed text. */
const MARKER = "HAPPYVIBE_COMMAND_BODY_MARKER";

test.skipIf(!KEY)(
  "plain prompts still land (fail-open); an approved command pairs typed↔expanded; an unapproved one is absent",
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmdbridge-"));
    const home = path.join(tmp, "home");
    const work = path.join(tmp, "work");
    fs.mkdirSync(work, { recursive: true });

    // Approved: passed explicitly as a FILE (PRD §24 — approval is per file).
    const approvedDir = path.join(tmp, "managed");
    fs.mkdirSync(approvedDir, { recursive: true });
    const approved = path.join(approvedDir, "greet.md");
    fs.writeFileSync(
      approved,
      `---\ndescription: Greet with a marker\nargument-hint: "[name]"\n---\n${MARKER}: reply with exactly the word HELLO-$1 and nothing else.\n`,
    );

    // Unapproved: auto-discoverable in <agentDir>/prompts, must never load.
    const agentDir = path.join(home, ".pi", "agent");
    fs.mkdirSync(path.join(agentDir, "prompts"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "prompts", "sneaky-cmd.md"), "---\ndescription: must not load\n---\nnope\n");

    client = new PiClient({
      execPath: process.execPath,
      args: [
        path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--mode", "rpc", "--no-session",
        "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
        "--no-prompt-templates", "--prompt-template", approved,
        "--provider", "deepseek", "--model", "deepseek-v4-flash",
      ],
      env: {
        ...process.env, ELECTRON_RUN_AS_NODE: "1", DEEPSEEK_API_KEY: KEY!,
        HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"),
        PI_CODING_AGENT_DIR: agentDir,
      } as Record<string, string>,
      cwd: work,
    });
    await client.start();

    // (3) The gate: approved is visible, auto-discovered is not.
    const cmds = ((await client.send({ type: "get_commands" })).data as {
      commands?: Array<{ name: string; source: string }>;
    })?.commands ?? [];
    const prompts = cmds.filter((c) => c.source === "prompt").map((c) => c.name);
    expect(prompts).toContain("greet");
    expect(prompts).not.toContain("sneaky-cmd");

    // hv.* notifies ride the ui-request channel as method:"notify" (d1.md), not
    // the agent event stream — same capture shape as context-bridge.test.ts.
    const notifies: Array<Record<string, unknown>> = [];
    client.on("ui-request", (m) => {
      const r = m as { id: string; method?: string; message?: string };
      if (r.method === "select") {
        client.respondUi(r.id, { value: "Allow" });
        return;
      }
      if (r.method !== "notify" || !r.message?.includes('"hv.command"')) return;
      try {
        notifies.push(JSON.parse(r.message));
      } catch {
        /* not ours */
      }
    });

    // (1) FAIL-OPEN — the assertion that matters. A plain prompt must complete.
    let turnDone = new Promise<void>((resolve) =>
      client.on("event", (e) => {
        if (e.type === "agent_end") resolve();
      }));
    await client.send({ type: "prompt", message: "Reply with exactly the word PONG and nothing else." });
    await turnDone;
    expect(notifies, "a plain prompt must not produce an hv.command pairing").toHaveLength(0);

    // (2) The command: expands, and pairs.
    turnDone = new Promise<void>((resolve) =>
      client.on("event", (e) => {
        if (e.type === "agent_end") resolve();
      }));
    await client.send({ type: "prompt", message: "/greet World" });
    await turnDone;

    expect(notifies, "expected exactly one hv.command notify").toHaveLength(1);
    const pair = notifies[0] as { name?: string; typed?: string; expanded?: string };
    expect(pair.name).toBe("greet");
    expect(pair.typed).toBe("/greet World");
    // The expansion is the FILE BODY with $1 substituted — not the typed text.
    expect(pair.expanded).toContain(MARKER);
    expect(pair.expanded).toContain("HELLO-World");
    expect(pair.expanded).not.toBe(pair.typed);
  },
  240_000,
);
