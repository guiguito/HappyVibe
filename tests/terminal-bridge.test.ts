import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";

// Tiny .env loader — keeps tests dependency-free
for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;
let client: PiClient;
afterEach(() => client?.stop());

interface Harness {
  notifies: Record<string, unknown>[];
  /** Every hv.terminal-* blocking input the bridge sent, in order. */
  requests: Record<string, unknown>[];
  /** Tool names the gate raised a permission prompt for. */
  prompted: string[];
  /** Permission-prompt summaries, so we can assert WHAT was shown. */
  promptSummaries: string[];
  starts: Array<{ tool: string; args: Record<string, unknown> }>;
}

/**
 * One Pi with the bridge, and a fake "main" answering the hv.terminal-*
 * envelopes. Real PTYs are covered by tests/agent-terminals.test.ts — what is
 * under test here is the WIRE: that the tools exist, carry intent, gate the way
 * §26 says, and that main's reply becomes the tool result.
 */
function start(opts: { builtins?: Record<string, unknown>; allow?: boolean } = {}): Harness {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-term-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: KEY!,
      ...(opts.builtins ? { HV_BUILTINS: JSON.stringify(opts.builtins) } : {}),
    } as Record<string, string>,
    cwd: tmp,
  });

  const h: Harness = { notifies: [], requests: [], prompted: [], promptSummaries: [], starts: [] };
  let seq = 0;
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string; message?: string };
    if (r.method === "notify") {
      try { h.notifies.push(JSON.parse(r.message ?? "")); } catch { /* not JSON */ }
      return;
    }
    if (r.method === "input") {
      let t: Record<string, unknown> | null = null;
      try { t = JSON.parse(r.title ?? "") as Record<string, unknown>; } catch { /* not ours */ }
      if (typeof t?.kind === "string" && (t.kind as string).startsWith("hv.terminal-")) {
        h.requests.push(t);
        // Stand in for main. The shapes are exactly what src/main/ipc.ts replies.
        if (t.kind === "hv.terminal-run") {
          client.respondUi(r.id, { value: JSON.stringify({ ok: true, terminalId: `t${++seq}`, title: "zsh" }) });
        } else if (t.kind === "hv.terminal-read") {
          client.respondUi(r.id, {
            value: JSON.stringify({ ok: true, text: "ready on :5173", running: true, exitCode: null, userTyped: false }),
          });
        } else {
          client.respondUi(r.id, { value: JSON.stringify({ ok: true }) });
        }
        return;
      }
      client.respondUi(r.id, { cancelled: true });
      return;
    }
    if (r.method === "select") {
      try {
        const p = JSON.parse(r.title ?? "") as { kind?: string; tool?: string; summary?: string };
        if (p?.kind === "hv.permission") {
          h.prompted.push(String(p.tool));
          h.promptSummaries.push(String(p.summary ?? ""));
        }
      } catch { /* not a permission prompt */ }
      client.respondUi(r.id, { value: opts.allow === false ? "Deny" : "Allow" });
    }
  });
  // PiClient emits non-ui RPC frames as "event", with toolName/args at the TOP
  // level (not nested under .data) — see src/main/pi/PiClient.ts.
  client.on("event", (m) => {
    const e = m as { type?: string; toolName?: string; args?: Record<string, unknown> };
    if (e.type === "tool_execution_start" && e.toolName) {
      h.starts.push({ tool: e.toolName, args: e.args ?? {} });
    }
  });
  return h;
}

const has = (h: Harness, tool: string): boolean => h.starts.some((s) => s.tool === tool);

/** §26: the three tools exist, gate as specced, and round-trip through main. */
test.skipIf(!KEY)("terminal_run opens, terminal_read polls, terminal_kill stops", async () => {
  const h = start();
  await client.start();

  // askUntil, not a single ask: a prose turn with no tool call is this suite's
  // known failure mode, and a longer timeout does not fix a model that already
  // finished its turn.
  // Wait for the ENVELOPE, not for tool_execution_start.
  //
  // start fires BEFORE the tool_call handlers and before execute, and the
  // envelope only appears inside execute — on the far side of a permission
  // prompt round-trip. Waiting on the start and then asserting the envelope on
  // the next line is a race, and it is the race that made this file red in a
  // full 15-file batch while passing in a 4-file one on the identical tree.
  // Same reason CLAUDE.md says a start can never prove a call was blocked.
  const ranIt = await askUntil(
    () => client.send({ type: "prompt", message: "Start `sleep 20` with the terminal_run tool. Do it now, then stop." }),
    () => h.requests.some((r) => r.kind === "hv.terminal-run"),
  );
  expect(has(h, "terminal_run"), "the model never called terminal_run").toBe(true);
  expect(ranIt, "terminal_run was called but never reached main").toBe(true);

  const run = h.requests.find((r) => r.kind === "hv.terminal-run")!;
  expect(run.command).toBe("sleep 20");
  // §26: intent is REQUIRED on terminal_run — the card leads with it.
  const runStart = h.starts.find((s) => s.tool === "terminal_run")!;
  expect(typeof runStart.args.intent).toBe("string");
  expect(String(runStart.args.intent).length).toBeGreaterThan(0);

  // The permission prompt shows the FACTUAL command, never the model's intent
  // (§13's MCP rule). This is the assertion that stops a benign-sounding intent
  // dressing up a risky call at approval time.
  expect(h.prompted).toContain("terminal_run");
  expect(h.promptSummaries.some((s) => s === "sleep 20")).toBe(true);
  expect(h.promptSummaries.some((s) => s === runStart.args.intent)).toBe(false);

  const readIt = await askUntil(
    () => client.send({ type: "prompt", message: "Now read terminal t1 with terminal_read and tell me what it shows." }),
    () => h.requests.some((r) => r.kind === "hv.terminal-read"),
  );
  expect(has(h, "terminal_read"), "the model never called terminal_read").toBe(true);
  expect(readIt, "terminal_read was called but never reached main").toBe(true);
  // §26: terminal_read is in SAFE_TOOLS — polling a log must never prompt.
  expect(h.prompted).not.toContain("terminal_read");

  const killIt = await askUntil(
    () => client.send({ type: "prompt", message: "Now stop terminal t1 with terminal_kill." }),
    () => h.requests.some((r) => r.kind === "hv.terminal-kill"),
  );
  // Two distinct failures, kept distinguishable: no start at all is the known
  // prose-turn class (re-ask), a start with no envelope means the tool_call
  // handler blocked it — a real bug worth chasing.
  expect(has(h, "terminal_kill"), "the model never called terminal_kill").toBe(true);
  expect(killIt, "terminal_kill was called but never reached main").toBe(true);
}, 300_000);

/*
 * NOT TESTED HERE: "a multi-line terminal_run is refused before any permission
 * prompt". It was, and the test was deleted rather than weakened, because it
 * could only ever measure the model's willingness to emit a literal newline
 * inside a string argument — which it reliably will not do, however the prompt
 * is worded. A version that skipped its assertions when no newline arrived
 * would have been green without proving anything.
 *
 * The property is covered, in two halves that between them cover all of it:
 *   - WHAT is refused — checkCommand, exhaustively, in terminal-tools.test.ts.
 *   - WHEN it is refused (before the permission prompt) — by the `&` test
 *     below, which asserts `h.prompted` never sees the call. That is the SAME
 *     handler at the SAME position, both guards sitting ahead of the gate, so
 *     the ordering it proves is the ordering the newline guard relies on.
 */

/**
 * The `&` block, BOTH directions — and observed through the audit envelope
 * rather than through tool_execution_start, which fires BEFORE tool_call
 * handlers run and therefore cannot tell a blocked call from an allowed one.
 */
const blockedForTerminal = (h: Harness): boolean =>
  h.notifies.some((n) => n.kind === "hv.audit" && n.source === "terminal" && n.decision === "deny");

test.skipIf(!KEY)("a backgrounded bash command is blocked while the group is on", async () => {
  const h = start();
  await client.start();

  const tried = await askUntil(
    () => client.send({ type: "prompt", message: "Run exactly this with the bash tool: `sleep 20 &`" }),
    () => has(h, "bash") && blockedForTerminal(h),
  );
  expect(tried, "bash was never called, or was not blocked for backgrounding").toBe(true);
  // The block is what redirects; it must never have reached a permission prompt
  // and must never have run.
  expect(h.prompted).not.toContain("bash");
}, 300_000);

/**
 * §26: with the group OFF the tools are not registered — and the `&` block must
 * go with them, or a context-saving setting silently becomes a capability
 * removal it never advertised.
 */
test.skipIf(!KEY)("with the group disabled the tools are gone and bash keeps its &", async () => {
  const h = start({ builtins: { terminal: false } });
  await client.start();

  const ranBash = await askUntil(
    () => client.send({ type: "prompt", message: "Run exactly this with the bash tool: `sleep 20 &`" }),
    () => has(h, "bash"),
  );
  expect(ranBash, "the model never called bash").toBe(true);
  // The whole point: NOT blocked, because there is nowhere to redirect to.
  expect(blockedForTerminal(h)).toBe(false);
  expect(has(h, "terminal_run")).toBe(false);
  expect(h.requests).toHaveLength(0);
}, 300_000);
