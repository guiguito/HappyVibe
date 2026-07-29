import { describe, it, expect, test } from "vitest";
import {
  acceptableMarks, completedMarkKeys, entryMarkKey, filterMessages, messageMarkKeys,
  serializeEntries, type AgentMessage, type MarkKey, type SessionEntry,
} from "../pi-runtime/extensions/hv-context";

// ── Fixtures ────────────────────────────────────────────────────────────────
// A two-turn session: user → assistant(bash toolCall) → toolResult → assistant
// text → user(turn 2) → assistant(bash toolCall) → toolResult (in flight).

const asst = (ts: number, callId?: string, text = ""): AgentMessage => ({
  role: "assistant",
  timestamp: ts,
  usage: { input: 100, output: 20, totalTokens: 120 },
  content: [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...(callId ? [{ type: "toolCall" as const, id: callId, name: "bash", arguments: { command: "ls" } }] : []),
  ],
});
const user = (ts: number, text: string): AgentMessage => ({ role: "user", timestamp: ts, content: text });
const result = (ts: number, callId: string, text = "ok"): AgentMessage => ({
  role: "toolResult", timestamp: ts, toolCallId: callId, toolName: "bash", content: [{ type: "text", text }],
});

const entry = (id: string, message: AgentMessage): SessionEntry => ({ type: "message", id, parentId: null, timestamp: "t", message });

const session: SessionEntry[] = [
  entry("e1", user(1, "turn one")),
  entry("e2", asst(2, "call-A", "running ls")),
  entry("e3", result(3, "call-A")),
  entry("e4", asst(4, undefined, "done")),
  entry("e5", user(5, "turn two")),        // last user = start of in-flight turn
  entry("e6", asst(6, "call-B", "running ls again")),
  entry("e7", result(7, "call-B")),
];

const messages: AgentMessage[] = session.map((e) => e.message!);

// ── mark keys ─────────────────────────────────────────────────────────────

test("messageMarkKeys: toolResult keys on toolCallId, assistant-with-calls keys on call id, plain msg keys on timestamp", () => {
  expect(messageMarkKeys(result(3, "call-A"))).toEqual(["tool:call-A"]);
  expect(messageMarkKeys(asst(2, "call-A", "x"))).toEqual(["tool:call-A"]);
  expect(messageMarkKeys(user(1, "hi"))).toEqual(["msg:1"]);
  expect(messageMarkKeys(asst(4, undefined, "done"))).toEqual(["msg:4"]);
});

test("entryMarkKey mirrors messageMarkKeys for message entries, null otherwise", () => {
  expect(entryMarkKey(session[2])).toBe("tool:call-A");
  expect(entryMarkKey({ type: "compaction", id: "c1", summary: "s" })).toBeNull();
});

// ── completed-turn gate (s0.3 HARD RULE) ─────────────────────────────────────

test("completedMarkKeys excludes everything at/after the last user message (in-flight turn)", () => {
  const ok = completedMarkKeys(session);
  // turn 1 completed:
  expect(ok.has("msg:1")).toBe(true);
  expect(ok.has("tool:call-A")).toBe(true);
  expect(ok.has("msg:4")).toBe(true);
  // in-flight turn 2 refused:
  expect(ok.has("msg:5")).toBe(false);
  expect(ok.has("tool:call-B")).toBe(false);
});

test("acceptableMarks refuses in-flight keys, accepts completed ones", () => {
  const { accepted, refused } = acceptableMarks(["tool:call-A", "tool:call-B", "msg:5"], session);
  expect(accepted).toEqual(["tool:call-A"]);
  expect(refused.sort()).toEqual(["msg:5", "tool:call-B"]);
});

// ── pairing atomicity ─────────────────────────────────────────────────────

test("filter drops BOTH halves of a tool pair from a single tool: mark (either half selected)", () => {
  const marks = new Set<MarkKey>(["tool:call-A"]);
  const out = filterMessages(messages, marks);
  // toolResult e3 gone AND the toolCall block stripped from assistant e2.
  expect(out.find((m) => m.role === "toolResult" && m.toolCallId === "call-A")).toBeUndefined();
  const a2 = out.find((m) => m.role === "assistant" && m.timestamp === 2)!;
  expect(Array.isArray(a2.content) && a2.content.some((b) => b.type === "toolCall")).toBe(false);
  // its text survives — only the call/result pair was removed.
  expect(Array.isArray(a2.content) && a2.content.some((b) => b.type === "text")).toBe(true);
});

test("filter drops a tool-only assistant message entirely when all its calls are removed", () => {
  const toolOnly: AgentMessage[] = [asst(2, "call-A")]; // no text
  const out = filterMessages(toolOnly, new Set<MarkKey>(["tool:call-A"]));
  expect(out).toEqual([]);
});

test("filter is a no-op with an empty mark set (identity)", () => {
  expect(filterMessages(messages, new Set())).toBe(messages);
});

test("filter drops a plain user message by timestamp mark, leaves others", () => {
  const out = filterMessages(messages, new Set<MarkKey>(["msg:1"]));
  expect(out.find((m) => m.role === "user" && m.timestamp === 1)).toBeUndefined();
  expect(out.find((m) => m.role === "user" && m.timestamp === 5)).toBeDefined();
});

// ── round-trip: what the model sees shrinks (s0.3 verification) ──────────────

test("mark → filter round-trip: the message count the model sees drops", () => {
  const before = messages.length;
  const { accepted } = acceptableMarks(["tool:call-A"], session);
  const out = filterMessages(messages, new Set(accepted));
  expect(out.length).toBe(before - 1); // toolResult removed; assistant kept (had text)
});

// ── serialization ───────────────────────────────────────────────────────────

test("serializeEntries groups, previews, sizes, and gates removability", () => {
  const items = serializeEntries(session);
  const byKey = Object.fromEntries(items.filter((i) => i.markKey).map((i) => [i.markKey, i]));
  expect(byKey["msg:1"].group).toBe("conversation");
  expect(byKey["tool:call-A"].group).toBe("tool");
  expect(byKey["tool:call-A"].removable).toBe(true);   // completed
  expect(byKey["tool:call-B"].removable).toBe(false);  // in-flight
  expect(byKey["msg:5"].removable).toBe(false);
  // assistant usage surfaces (measured); estTokens is char-based (estimate).
  // Both the assistant (with the call) and its toolResult share tool:call-A;
  // usage lives on the assistant entry.
  const asstItem = items.find((i) => i.entryId === "e2")!;
  expect(asstItem.usage?.total).toBe(120);
  expect(byKey["msg:1"].estTokens).toBeGreaterThan(0);
});

test("serializeEntries includes compaction summaries as their own group", () => {
  const withCompaction: SessionEntry[] = [
    { type: "compaction", id: "c1", summary: "compacted earlier work", parentId: null },
    ...session,
  ];
  const items = serializeEntries(withCompaction);
  const comp = items.find((i) => i.group === "compaction")!;
  expect(comp.preview).toContain("compacted");
  expect(comp.markKey).toBeNull(); // summaries aren't manually removable
});

// ── bookkeeping entries ────────────────────────────────────────────────────

describe("serializeEntries — bookkeeping entries", () => {
  it("drops zero-cost Pi session bookkeeping instead of rendering unnamed 'item' rows", () => {
    const items = serializeEntries([
      { id: "1", type: "session" },
      { id: "2", type: "model_change" },
      { id: "3", type: "thinking_level_change" },
      { id: "4", type: "session_info" },
      { id: "5", type: "message", message: { role: "user", content: "hi" } },
    ] as never);
    expect(items.map((i) => i.entryId)).toEqual(["5"]);
  });
});
