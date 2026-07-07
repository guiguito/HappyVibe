import { describe, expect, test } from "vitest";
import { applyDelta, updateToolCard, indexTool } from "../src/renderer/src/streaming";
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
