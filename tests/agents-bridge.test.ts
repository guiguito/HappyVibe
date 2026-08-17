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
const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agents-sess-"));
// The subagent tool is a normal tool_call → the bridge gates it (asks by
// default). Allow it up front so the delegation test never stalls on an
// unanswered permission prompt (the gate itself is covered by rules-bridge).
const rulesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-agents-rules-")), "permission-rules.json");
fs.writeFileSync(rulesFile, JSON.stringify({ global: [{ layer: "tool", pattern: "subagent", action: "allow" }], workspaces: {} }));

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
  expect(spec.args.filter((a) => a === "-e")).toHaveLength(3); // bridge + pi-subagents + pi-mcp-adapter
  expect(spec.args.some((a) => a.includes("pi-subagents"))).toBe(true);
  expect(spec.env.PI_SUBAGENT_PI_BINARY).toBe(path.join(runtime, "bin/pi-node.sh"));
  expect(fs.existsSync(spec.env.PI_SUBAGENT_PI_BINARY)).toBe(true);

  client = makeClient({});
  await client.start();
}, 60_000);

afterAll(() => client?.stop());

test("/hv-agents lists the two bundled built-in agents", async () => {
  await client.send({ type: "prompt", message: "/hv-agents" });
  const req = await nextRequest((r) => isKind(r, "hv.agents"));
  expect(req.method).toBe("notify");
  const agents = payload(req).agents as Array<{ name: string; source: string; description: string; path: string; tools?: string[] }>;
  const names = agents.map((a) => a.name).sort();
  expect(names).toContain("code-explorer");
  expect(names).toContain("agents-md-maker"); // v5: summarizer removed — compaction is Pi-native
  const explorer = agents.find((a) => a.name === "code-explorer")!;
  expect(explorer.source).toBe("builtin");
  expect(explorer.description.length).toBeGreaterThan(0);
  expect(explorer.path.endsWith("code-explorer.md")).toBe(true);
  expect(explorer.tools).toContain("read"); // read-only frontmatter honored
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
  "a real subagent delegation emits the tool_execution_* trace with results[].messages",
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
          "Use the subagent tool right now (mode: single) to delegate to the agent named 'code-explorer' " +
          "with the task 'reply with exactly the word HELLO and nothing else'. Do not do anything else.",
      });
      await done;

      const starts = localEvents.filter((e) => e.type === "tool_execution_start" && (e as { toolName?: string }).toolName === "subagent");
      expect(starts.length, "expected a subagent tool_execution_start").toBeGreaterThan(0);
      const updates = localEvents.filter((e) => e.type === "tool_execution_update" && (e as { toolName?: string }).toolName === "subagent");
      const ends = localEvents.filter((e) => e.type === "tool_execution_end" && (e as { toolName?: string }).toolName === "subagent");
      expect(ends.length, "expected a subagent tool_execution_end").toBeGreaterThan(0);

      // LIVE view rides tool_execution_update.partialResult.details.results[].
      //
      // pi-subagents 0.40.0 REMOVED `messages` from this projection on purpose
      // (`snapshotStreamResult` sets it undefined and substitutes compact
      // `toolCalls`, so one update line stays under the child-stdout protocol cap
      // — execution.ts:259-270). Asserting its ABSENCE pins that change: if a
      // future pin restores the transcript we want to know, because it carries the
      // child's prose and toolCalls does not. The toolCalls→transcript-row mapping
      // is unit-tested in tests/agents-renderer.test.ts — deliberately NOT here,
      // since this child ("reply with exactly HELLO") may make zero tool calls and
      // a live assertion on toolCalls would depend on the model choosing to.
      const upd = updates[updates.length - 1] as { partialResult?: { details?: { results?: Array<{ agent?: string; messages?: unknown[] }> } } };
      const updResults = upd?.partialResult?.details?.results ?? [];
      expect(updResults.length, "update carries results[]").toBeGreaterThan(0);
      expect(updResults[0].agent).toBe("code-explorer");
      expect(updResults[0].messages, "0.40 drops the transcript from streamed updates").toBeUndefined();

      // FINAL outcome rides tool_execution_end.result.details.results[] (per-agent
      // model/usage/finalOutput; the end does NOT re-carry the transcript).
      const end = ends[ends.length - 1] as { result?: { details?: { results?: Array<{ agent?: string; finalOutput?: string; modelAttempts?: Array<{ model?: string }> }> } } };
      const results = end.result?.details?.results ?? [];
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].agent).toBe("code-explorer");
      expect(typeof results[0].finalOutput).toBe("string");
      expect(typeof results[0].modelAttempts?.[0]?.model).toBe("string");
    } finally {
      c.stop();
    }
  },
  240_000,
);
