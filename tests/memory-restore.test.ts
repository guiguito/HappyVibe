/**
 * PRD §33 — a REOPENED memory card.
 *
 * This is the path where §12's delegation card lost its id: a live card reads the tool result
 * it still holds, while a restored one has only what restore.ts NAMED and restoreMap.ts carried
 * through. Every unit test of a live card kept passing while the reopened one rendered empty.
 */
import { describe, expect, it } from "vitest";
import { restoreItems } from "../src/main/restore";
import { toTranscriptItems } from "../src/renderer/src/restoreMap";
import { memoryCardState, memoryFromResult } from "../src/renderer/src/components/ToolCard";
import fs from "node:fs";
import path from "node:path";

const save = (details: Record<string, unknown>) => [
  { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "memory_save", arguments: { scope: "global", name: "x" } }] },
  { role: "toolResult", toolCallId: "t1", toolName: "memory_save", content: [{ type: "text", text: 'Remembered "talk-like-a-young-engineer" (global).' }], details },
];

describe("restore carries a memory card's fields STRUCTURALLY", () => {
  it("lifts scope, type, name and description off details", () => {
    const items = restoreItems(save({ scope: "global", type: "user", name: "talk-like-a-young-engineer", description: "straight, explain jargon", replaced: false }) as never);
    const tool = items.find((m) => m.kind === "tool")!;
    expect(tool.memory).toEqual({
      scope: "global",
      type: "user",
      name: "talk-like-a-young-engineer",
      description: "straight, explain jargon",
      replaced: false,
    });
  });

  it("…and restoreMap NAMES it, or it is dropped in silence", () => {
    const items = restoreItems(save({ scope: "workspace", type: "project", name: "n", description: "d" }) as never);
    const card = toTranscriptItems(items as never, { sessionId: "s", workspaceId: "/ws" }, (() => { let i = 0; return () => ++i; })())
      .map((t) => (t as { card?: { memory?: unknown } }).card)
      .find((c) => c?.memory);
    // The whole point: the Forget button needs the SCOPE and the SLUG, and neither survives a
    // flatten-to-text. If this is undefined, a reopened card renders with no way back.
    expect(card!.memory).toMatchObject({ scope: "workspace", name: "n" });
  });

  it("defaults an odd scope to global rather than inventing a third one", () => {
    const items = restoreItems(save({ scope: "elsewhere", name: "n" }) as never);
    expect((items.find((m) => m.kind === "tool") as { memory?: { scope?: string } }).memory!.scope).toBe("global");
  });
});

describe("the lift is gated on the TOOL NAME, not on the fields", () => {
  it("another tool whose details happen to carry name/type never becomes a memory card", () => {
    // `name` and `type` are common words. Gating on the fields would turn some future tool's
    // result into a memory card with a Forget button that deletes nothing.
    const items = restoreItems([
      { role: "assistant", content: [{ type: "toolCall", id: "t9", name: "write", arguments: { path: "a.txt" } }] },
      { role: "toolResult", toolCallId: "t9", toolName: "write", content: [{ type: "text", text: "ok" }], details: { name: "a.txt", type: "file", scope: "global" } },
    ] as never);
    expect((items.find((m) => m.kind === "tool") as { memory?: unknown }).memory).toBeUndefined();
  });

  it("a memory result with no name in details carries nothing rather than half a card", () => {
    const items = restoreItems(save({ scope: "global", type: "user" }) as never);
    expect((items.find((m) => m.kind === "tool") as { memory?: unknown }).memory).toBeUndefined();
  });
});

/**
 * §33 — the LIVE card, which is a different source from the restored one and was the second
 * GUI-only bug of this round.
 *
 * A live card never goes through restore: it carries the tool RESULT, whose `details` sibling
 * holds the same fields. Reading only `card.memory` meant the card you see the instant you
 * approve a save rendered its headline and nothing else — no body, no Forget — while every
 * test here fed a restored card and passed.
 */
describe("a LIVE memory card reads the tool result's details", () => {
  it("lifts the same fields the restored path names", () => {
    const live = memoryFromResult({
      content: [{ type: "text", text: 'Remembered "x" (global).' }],
      details: { scope: "global", type: "user", name: "test-output-in-french", description: "d", replaced: false },
    });
    expect(live).toEqual({ scope: "global", type: "user", name: "test-output-in-french", description: "d", replaced: false });
  });

  it("agrees with the RESTORED path field for field — one card, two sources", () => {
    const details = { scope: "workspace", type: "project", name: "n", description: "d", replaced: true };
    const live = memoryFromResult({ details });
    const restored = restoreItems([
      { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "memory_save", arguments: {} }] },
      { role: "toolResult", toolCallId: "t1", toolName: "memory_save", content: [{ type: "text", text: "ok" }], details },
    ] as never).find((m) => m.kind === "tool") as { memory?: unknown };
    expect(live).toEqual(restored.memory);
  });

  it("is undefined for a result with no details, or none carrying a name", () => {
    expect(memoryFromResult(undefined)).toBeUndefined();
    expect(memoryFromResult({ content: [] })).toBeUndefined();
    expect(memoryFromResult({ details: { scope: "global" } })).toBeUndefined();
  });
});

/**
 * §33 — a REOPENED card must not offer Forget for a memory that is already gone.
 *
 * Reported 2026-09-06: a transcript still showed "Forget this" for a memory forgotten in a
 * later session. Keeping the CARD is right — a save did happen, and the transcript records what
 * happened — but the affordance has to tell the truth about now.
 */
describe("memoryCardState", () => {
  it("present ⇒ the button; absent ⇒ Forgotten", () => {
    expect(memoryCardState("yes", false)).toBe("present");
    expect(memoryCardState("no", false)).toBe("gone");
  });

  it("makes NO claim before the answer arrives", () => {
    // Not a spinner: the card simply says nothing rather than guessing either way.
    expect(memoryCardState(null, false)).toBe("checking");
  });

  it("makes no claim when memory is switched OFF — the file is still there", () => {
    // The trap this state exists for. `hv:memory-read` answers null both for "no such memory"
    // and for "scope unavailable"; collapsing them would print "Forgotten." about a memory
    // sitting on disk, which is exactly the class of lie this feature is built to avoid.
    expect(memoryCardState("unavailable", false)).toBe("checking");
  });

  it("a Forget clicked on THIS card wins over any earlier answer", () => {
    expect(memoryCardState("yes", true)).toBe("gone");
    expect(memoryCardState(null, true)).toBe("gone");
    expect(memoryCardState("unavailable", true)).toBe("gone");
  });

  it("only these three states exist, so no branch renders both", () => {
    const all = (["yes", "no", "unavailable", null] as const).flatMap((p) =>
      [true, false].map((f) => memoryCardState(p, f)),
    );
    expect(new Set(all)).toEqual(new Set(["checking", "present", "gone"]));
  });
});

describe("the card asks, and asks the right question", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/renderer/src/components/ToolCard.tsx"), "utf8");

  it("uses the three-valued memoryExists, never the ambiguous memoryRead", () => {
    expect(src).toContain("window.hv\n      .memoryExists(");
    // memoryRead cannot distinguish "gone" from "memory is off", so the card must not use it.
    expect(src).not.toMatch(/memoryRead\(/);
  });

  it("only a SAVE card asks — recall and forget cards have no button to guard", () => {
    expect(src).toContain("if (!isSaveCard || !scope || !name) return;");
  });

  it("the Forget button is rendered ONLY in the present state", () => {
    const block = src.slice(src.indexOf('state === "gone"'), src.indexOf("Forget this"));
    expect(block).toContain('state === "present"');
  });
});
