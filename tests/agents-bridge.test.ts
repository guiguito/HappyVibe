import { afterAll, beforeAll, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { resolvePiSpawn } from "../src/main/pi/spawn";

/**
 * B6 contract test — pi-subagents loads in RPC mode alongside the bridge (with
 * PI_SUBAGENT_PI_BINARY set), and the bridge's /hv-agents & /hv-tools commands
 * emit their notifies (docs/validation/d1.md §hv.agents / §hv.tools).
 *
 * Listing agents + the tools shape need no model. The real parent→subagent
 * delegation trace needs a live child Pi process (real key), so it is
 * DEEPSEEK-gated like bridge.test.ts. Every await is bounded; the client is
 * killed in a finally, and beforeAll/afterAll guard against orphans.
 */

import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";

const runtime = path.join(process.cwd(), "pi-runtime");
// App-owned agent dir (PI_CODING_AGENT_DIR): install the two bundled builtins.
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agents-dir-"));
fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
for (const name of fs.readdirSync(path.join(runtime, "agents"))) {
  fs.copyFileSync(path.join(runtime, "agents", name), path.join(agentDir, "agents", name));
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agents-cwd-"));
// Something for a delegated child to READ, so the trace-projection test can assert
// `toolCalls` for real instead of hoping the model chose to call a tool.
fs.writeFileSync(path.join(workDir, "greeting.txt"), "HELLO\n");
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agents-sess-"));
// The subagent tool is a normal tool_call → the bridge gates it (asks by
// default). Allow it up front so the delegation test never stalls on an
// unanswered permission prompt (the gate itself is covered by rules-bridge).
const rulesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-agents-rules-")), "permission-rules.json");
fs.writeFileSync(rulesFile, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent*", action: "allow" }], workspaces: {} }));

type UiReq = { id: string; method?: string; title?: string; message?: string; options?: string[] };
type PiEvent = { type?: string; [k: string]: unknown };
const requests: UiReq[] = [];
const events: PiEvent[] = [];
const waiters: { match: (r: UiReq) => boolean; resolve: (r: UiReq) => void }[] = [];

function nextRequest(match: (r: UiReq) => boolean, timeoutMs = 30_000): Promise<UiReq> {
  return new Promise((resolve, reject) => {
    const hit = requests.find(match);
    if (hit) return resolve(hit);
    const t = setTimeout(() => reject(new Error(`timeout; saw: ${JSON.stringify(requests)}`)), timeoutMs);
    waiters.push({ match, resolve: (r) => { clearTimeout(t); resolve(r); } });
  });
}
const payload = (r: UiReq): Record<string, unknown> => {
  try { return JSON.parse((r.method === "notify" ? r.message : r.title) ?? "{}") as Record<string, unknown>; } catch { return {}; }
};
const isKind = (r: UiReq, kind: string) => payload(r).kind === kind;

// Use the REAL spawn spec builder so the test proves the actual wiring
// (both -e extensions + PI_SUBAGENT_PI_BINARY + agentDir).
function makeClient(env: Record<string, string>): PiClient {
  const spec = resolvePiSpawn(workDir, sessionDir, runtime, {
    agentDir,
    providerEnv: env,
    rulesFile,
    model: MODEL,
  });
  const client = new PiClient(spec);
  client.on("ui-request", (m) => {
    const r = m as UiReq;
    requests.push(r);
    const i = waiters.findIndex((w) => w.match(r));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(r);
  });
  client.on("event", (e) => events.push(e as PiEvent));
  return client;
}

let client: PiClient;

beforeAll(async () => {
  // Sanity: the spawn spec must carry the pi-subagents extension + child bin.
  const spec = resolvePiSpawn(workDir, sessionDir, runtime, { agentDir });
  // Deliberately not a COUNT of -e flags: this file cares that pi-subagents is
  // loaded, not how many extensions exist. The exact list (and the load order the
  // permission gate depends on) is owned by tests/mcp-spawn.test.ts, so adding an
  // extension updates one place instead of failing an unrelated suite's beforeAll.
  expect(spec.args.some((a) => a.includes("pi-subagents"))).toBe(true);
  expect(spec.env.PI_SUBAGENT_PI_BINARY).toBe(path.join(runtime, "bin/pi-node.sh"));
  expect(fs.existsSync(spec.env.PI_SUBAGENT_PI_BINARY)).toBe(true);

  client = makeClient({});
  await client.start();
}, 60_000);

afterAll(() => client?.stop());

test("/hv-agents lists every agent that exists, not just our own dir", async () => {
  await client.send({ type: "prompt", message: "/hv-agents" });
  const req = await nextRequest((r) => isKind(r, "hv.agents"));
  expect(req.method).toBe("notify");
  const agents = payload(req).agents as Array<{ name: string; source: string; description: string; path: string; tools?: string[] }>;
  const names = agents.map((a) => a.name).sort();

  // Ours, from the app-owned agent dir. Source is "bundled" from 2026-08-29:
  // it used to be "builtin", which collided with UPSTREAM's builtin roster and
  // is a large part of why nobody noticed that roster was missing entirely.
  expect(names).toContain("code-explorer");
  expect(names).toContain("agents-md-maker"); // v5: summarizer removed — compaction is Pi-native
  expect(names).toContain("worker"); // §12 2026-08-29: the write-capable one
  const explorer = agents.find((a) => a.name === "code-explorer")!;
  expect(explorer.source).toBe("bundled");
  expect(explorer.description.length).toBeGreaterThan(0);
  expect(explorer.path.endsWith("code-explorer.md")).toBe(true);
  expect(explorer.tools).toContain("read"); // read-only frontmatter honored

  // Upstream's NATIVE builtins, delegatable all along and invisible until now.
  for (const native of ["reviewer", "scout", "researcher", "oracle", "delegate"]) {
    expect(names).toContain(native);
  }
  expect(agents.find((a) => a.name === "reviewer")!.source).toBe("builtin");

  // ABSENCE, and the whole reason the disabled filter exists: discoverAgentsAll
  // applies our overrides but does NOT drop what they disable. Without the
  // filter these six would be listed as available agents the bridge refuses at
  // delegation time — worse than not listing them at all (PRD §12, 2026-08-28).
  // ABSENCE: another tool's slash commands are not our sub-agents. ~/.agents is
  // shared with Claude Code / Superset, upstream scans it recursively, and these
  // four were being listed AND injected into the model's roster every turn.
  for (const slashCommand of ["10x", "doctor", "feedback", "setup"]) {
    expect(names).not.toContain(slashCommand);
  }

  for (const external of [
    "claude-code", "claude-code-writer", "codex-exec",
    "codex-exec-writer", "cursor-agent", "cursor-agent-writer",
  ]) {
    expect(names).not.toContain(external);
  }
});

test("/hv-tools emits a tool inventory with name/description/source", async () => {
  await client.send({ type: "prompt", message: "/hv-tools" });
  const req = await nextRequest((r) => isKind(r, "hv.tools"));
  expect(req.method).toBe("notify");
  const tools = payload(req).tools as Array<{ name: string; description: string; source: string }>;
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBeGreaterThan(0);
  // The subagent tool pi-subagents registered must be present (it's a real tool).
  expect(tools.some((t) => t.name === "subagent")).toBe(true);
  for (const t of tools) {
    expect(typeof t.name).toBe("string");
    expect(typeof t.description).toBe("string");
    expect(typeof t.source).toBe("string");
  }
});

test.skipIf(!KEY)(
  "a real subagent delegation STREAMS its trace again (0.58) and ends with toolCalls",
  async () => {
    const c = makeClient(PROVIDER_ENV);
    const localEvents: PiEvent[] = [];
    c.on("event", (e) => localEvents.push(e as PiEvent));
    try {
      await c.start();
      const done = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no agent_end")), 150_000);
        c.on("event", (e) => { if ((e as PiEvent).type === "agent_end") { clearTimeout(t); resolve(); } });
      });
      await c.send({
        type: "prompt",
        message:
          // async:false ON PURPOSE. This test pins the trace PROJECTION the renderer
          // maps, and at 0.50 an async dispatch returns before any child has run, so
          // its details.results is empty by definition (measured: length 0). The
          // populated projection only exists on a blocking delegation — asserting it
          // on an async one would pin "nothing yet", which is not the contract.
          "Use the subagent tool right now with async: false to delegate to the agent named 'code-explorer' " +
          "with the task 'use the read tool on greeting.txt, then reply with exactly the word it contains and " +
          "nothing else'. Do not do anything else.",
      });
      await done;

      const starts = localEvents.filter((e) => e.type === "tool_execution_start" && (e as { toolName?: string }).toolName === "subagent");
      expect(starts.length, "expected a subagent tool_execution_start").toBeGreaterThan(0);
      const updates = localEvents.filter((e) => e.type === "tool_execution_update" && (e as { toolName?: string }).toolName === "subagent");
      const ends = localEvents.filter((e) => e.type === "tool_execution_end" && (e as { toolName?: string }).toolName === "subagent");
      expect(ends.length, "expected a subagent tool_execution_end").toBeGreaterThan(0);

      // THE LIVE VIEW IS BACK AT 0.58, and that is the headline of this bump.
      //
      // History, because it is the reason this assertion is worded as a presence
      // rather than a count: the live child transcript streams on
      // tool_execution_update.partialResult.details.results[]. At 0.50-0.53
      // `tool_execution_update` was not emitted AT ALL for a subagent call
      // (measured 2026-08-17, zero on both a blocking and an async delegation), so
      // expanding a run card showed nothing until the run finished and
      // `traceFromUpdate` in the renderer was dead weight. The assertion then was
      // `toBe(0)` with a comment saying it should fail loudly the day upstream
      // restored streaming. It did exactly that: 38 updates on the first 0.58 live
      // run, 53 on the probe (docs/validation/d1.md §pi-subagents 0.58).
      //
      // Deliberately NOT an exact count — the number tracks how chatty the child
      // is, which is the model's business. What matters is that updates arrive and
      // carry the projection the renderer maps.
      expect(updates.length, "0.58 streams the child transcript again").toBeGreaterThan(0);

      // …and the payload is the shape `traceFromUpdate` -> `toResults` reads, so
      // "updates arrive" cannot pass while the card stays empty. Measured at 0.58:
      // `messages` is still absent and `toolCalls` is still the transcript source,
      // exactly as at 0.40-0.53 — only the DELIVERY was restored, not the shape.
      const live = updates[updates.length - 1] as {
        partialResult?: { details?: { results?: Array<{ agent?: string; messages?: unknown; toolCalls?: unknown[] }> } };
      };
      const liveResults = live.partialResult?.details?.results ?? [];
      expect(liveResults.length, "an update carries a results[] projection").toBeGreaterThan(0);
      expect(liveResults[0].agent).toBe("code-explorer");
      expect(liveResults[0].messages, "still not in `messages`, even live").toBeUndefined();
      expect(Array.isArray(liveResults[0].toolCalls), "`toolCalls` is still the transcript source").toBe(true);

      // The FINAL projection is where everything the card renders now comes from.
      // `toolCalls` (not `messages`) is the transcript source — 0.40 substituted it
      // and 0.50 keeps it. `messages` stays absent; asserting that pins the swap.
      const end = ends[ends.length - 1] as { result?: { details?: { results?: Array<{ agent?: string; finalOutput?: string; messages?: unknown[]; toolCalls?: unknown[]; modelAttempts?: Array<{ model?: string }> }> } } };
      const results = end.result?.details?.results ?? [];
      expect(results.length, "a blocking delegation carries its child's result").toBeGreaterThan(0);
      expect(results[0].agent).toBe("code-explorer");
      expect(typeof results[0].finalOutput).toBe("string");
      expect(typeof results[0].modelAttempts?.[0]?.model).toBe("string");
      expect(results[0].messages, "the transcript is still not in `messages`").toBeUndefined();
      // The child was told to read a file, so it makes at least one tool call and
      // this is a real assertion rather than one that depends on the model's mood.
      expect(Array.isArray(results[0].toolCalls), "`toolCalls` is the transcript source").toBe(true);
    } finally {
      c.stop();
    }
  },
  240_000,
);
