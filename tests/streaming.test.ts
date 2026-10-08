import { describe, expect, test } from "vitest";
import { applyDelta, updateToolCard, indexTool, indexTools, mergeIntoLastAssistant } from "../src/renderer/src/streaming";
import type { TranscriptItem } from "../src/renderer/src/components/Transcript";

describe("applyDelta", () => {
  test("starts a fresh bubble when no stream is active", () => {
    expect(applyDelta({}, "s1", "Hello", false)).toBe("Hello");
  });
  test("appends to the existing buffer while active", () => {
    expect(applyDelta({ s1: "Hello" }, "s1", " world", true)).toBe("Hello world");
  });
  test("active but empty buffer → just the delta (no leading undefined)", () => {
    expect(applyDelta({}, "s1", "x", true)).toBe("x");
  });
  test("buffers are per-session", () => {
    const b = { s1: "a", s2: "b" };
    expect(applyDelta(b, "s2", "c", true)).toBe("bc");
    expect(b.s1).toBe("a"); // untouched
  });
});

const toolItem = (id: string): TranscriptItem => ({
  kind: "tool",
  card: { toolCallId: id, toolName: "bash", args: "ls", status: "running" },
});

describe("updateToolCard", () => {
  test("updates the indexed card in place, returns a new array", () => {
    const items: TranscriptItem[] = [{ kind: "user", text: "hi" }, toolItem("t1")];
    const index = new Map<string, number>();
    indexTool(index, "t1", 1);
    const next = updateToolCard(items, index, "t1", (c) => ({ ...c, status: "done" }));
    expect(next).not.toBe(items); // new reference
    expect(next[1]).toMatchObject({ kind: "tool", card: { status: "done" } });
    expect(next[0]).toBe(items[0]); // untouched item kept by reference
  });

  test("unknown toolCallId is a no-op returning the SAME array (no wasted copy)", () => {
    const items: TranscriptItem[] = [toolItem("t1")];
    const index = new Map<string, number>([["t1", 0]]);
    expect(updateToolCard(items, index, "nope", (c) => ({ ...c, status: "done" }))).toBe(items);
  });

  test("stale index pointing at a non-tool item is a no-op", () => {
    const items: TranscriptItem[] = [{ kind: "user", text: "hi" }];
    const index = new Map<string, number>([["t1", 0]]);
    expect(updateToolCard(items, index, "t1", (c) => c)).toBe(items);
  });

  test("finds the right card among many (O(1) via index, not position guessing)", () => {
    const items: TranscriptItem[] = [toolItem("a"), toolItem("b"), toolItem("c")];
    const index = new Map<string, number>([["a", 0], ["b", 1], ["c", 2]]);
    const next = updateToolCard(items, index, "b", (c) => ({ ...c, result: "done-b" }));
    expect(next[1]).toMatchObject({ card: { toolCallId: "b", result: "done-b" } });
    expect(next[0]).toBe(items[0]);
    expect(next[2]).toBe(items[2]);
  });
});

// ── round 11: post-abort deltas must not start a second bubble ────────────────

test("post-abort text merges into the last assistant item, not a new one", () => {
  const items = [
    { id: 1, kind: "user", text: "hi" },
    { id: 2, kind: "assistant", text: "Sure, I'll start by" },
  ] as unknown as TranscriptItem[];
  const out = mergeIntoLastAssistant(items, " reading the file.");
  expect(out).toHaveLength(2);
  expect((out[1] as { text: string }).text).toBe("Sure, I'll start by reading the file.");
});

test("merge appends a fresh bubble when the transcript does not end in one", () => {
  const items = [
    { id: 1, kind: "assistant", text: "done" },
    { id: 2, kind: "tool", card: {} },
  ] as unknown as TranscriptItem[];
  const out = mergeIntoLastAssistant(items, "tail");
  expect(out).toHaveLength(3);
  expect(out[2]).toEqual({ kind: "assistant", text: "tail" });
});

test("empty text never mutates the transcript", () => {
  const items = [{ id: 1, kind: "assistant", text: "a" }] as unknown as TranscriptItem[];
  expect(mergeIntoLastAssistant(items, "")).toBe(items);
});

test("merge on an empty transcript starts the bubble", () => {
  const out = mergeIntoLastAssistant([], "hello");
  expect(out).toEqual([{ kind: "assistant", text: "hello" }]);
});

test("round 27: indexTools maps every tool card to its CURRENT position", () => {
  const items = [
    { kind: "user", text: "a" },
    { kind: "tool", card: { toolCallId: "t1" } },
    { kind: "assistant", text: "b" },
    { kind: "tool", card: { toolCallId: "t2" } },
  ] as never[];
  expect([...indexTools(items)]).toEqual([["t1", 1], ["t2", 3]]);
  expect([...indexTools(items.slice(1))]).toEqual([["t1", 0], ["t2", 2]]); // a removed bubble shifts every card
});

test("round 27 review I1: a STALE index never patches another call's card, and the update still lands", () => {
  const items = [
    { kind: "tool", card: { toolCallId: "t1", status: "running" } },
    { kind: "tool", card: { toolCallId: "t2", status: "running" } },
  ] as never as TranscriptItem[];
  // Index taken before a bubble ahead of them was removed: positions are off by one.
  const stale = new Map([["t1", 1], ["t2", 2]]);
  const next = updateToolCard(items, stale, "t1", (c) => ({ ...c, status: "done" } as never));
  expect((next[0] as never as { card: { status: string } }).card.status).toBe("done");
  expect((next[1] as never as { card: { status: string } }).card.status).toBe("running");
  expect(stale.get("t1")).toBe(0); // repaired
});
