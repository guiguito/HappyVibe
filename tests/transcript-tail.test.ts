import { describe, expect, it } from "vitest";
import { visibleTail, TAIL_SIZE } from "../src/renderer/src/components/Transcript";
import type { TranscriptItem } from "../src/renderer/src/components/Transcript";

/**
 * Round 15 — a long session renders its tail, not all of it.
 *
 * Deliberately NOT virtualization: no windowing library, no measured rows, no
 * rework of the streaming perf invariants. Just "render the last N behind a
 * disclosure", reusing the affordance §9's compaction boundary already built.
 *
 * The `searching` arm is the load-bearing one. In-conversation search walks the
 * rendered DOM (`document.createTreeWalker` over the scroll container), so an
 * item that is not mounted cannot be found — a tail that stayed collapsed while
 * a query was live would silently make search lie about its match count.
 */

const items = (n: number): TranscriptItem[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "user", text: `m${i}` }) as TranscriptItem);

describe("visibleTail", () => {
  it("shows only the last TAIL_SIZE items and counts the rest", () => {
    const r = visibleTail(items(120), false, false);
    expect(r.shown).toHaveLength(TAIL_SIZE);
    expect(r.hiddenCount).toBe(120 - TAIL_SIZE);
    // The tail is the END of the conversation, not the start.
    expect((r.shown[r.shown.length - 1] as { text: string }).text).toBe("m119");
  });

  it("shows everything once expanded", () => {
    const r = visibleTail(items(120), true, false);
    expect(r.shown).toHaveLength(120);
    expect(r.hiddenCount).toBe(0);
  });

  it("shows everything while a search is live, however long", () => {
    const r = visibleTail(items(500), false, true);
    expect(r.shown).toHaveLength(500);
    expect(r.hiddenCount).toBe(0);
  });

  it("is a no-op for a short conversation", () => {
    const r = visibleTail(items(10), false, false);
    expect(r.shown).toHaveLength(10);
    expect(r.hiddenCount).toBe(0);
  });

  it("is a no-op at exactly the threshold", () => {
    const r = visibleTail(items(TAIL_SIZE), false, false);
    expect(r.shown).toHaveLength(TAIL_SIZE);
    expect(r.hiddenCount).toBe(0);
  });

  it("handles an empty transcript", () => {
    const r = visibleTail([], false, false);
    expect(r.shown).toEqual([]);
    expect(r.hiddenCount).toBe(0);
  });

  it("returns the SAME array instance when nothing is hidden", () => {
    // MessageItem is memoized on identity; slicing a short list every render
    // would hand it a new array each time for no reason.
    const all = items(10);
    expect(visibleTail(all, false, false).shown).toBe(all);
  });
});
