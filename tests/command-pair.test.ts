import { describe, it, expect } from "vitest";
import { applyCommandPair } from "../src/renderer/src/commandPair";
import type { TranscriptItem } from "../src/renderer/src/components/Transcript";

/**
 * §24: the notify has to repair two different optimistic renderings (typed when
 * idle, expanded when steered) into one identical card. These tests are the
 * proof that both paths converge — the divergence is the bug being fixed.
 */
const user = (text: string): TranscriptItem => ({ kind: "user", text });
const PAIR = { typed: "/review src/foo.ts", expanded: "Review src/foo.ts for bugs." };

describe("applyCommandPair", () => {
  it("upgrades the idle path, where the bubble holds the TYPED text", () => {
    const out = applyCommandPair([user("hi"), user(PAIR.typed)], PAIR);
    expect(out[1]).toEqual({ kind: "user", text: PAIR.expanded, command: { typed: PAIR.typed } });
  });

  it("upgrades the steered path, where the bubble holds the EXPANDED text", () => {
    const out = applyCommandPair([user("hi"), user(PAIR.expanded)], PAIR);
    expect(out[1]).toEqual({ kind: "user", text: PAIR.expanded, command: { typed: PAIR.typed } });
  });

  it("both paths produce byte-identical items — the divergence this fixes", () => {
    const idle = applyCommandPair([user(PAIR.typed)], PAIR);
    const steered = applyCommandPair([user(PAIR.expanded)], PAIR);
    expect(idle).toEqual(steered);
  });

  it("decorates the most recent invocation, not the first", () => {
    const out = applyCommandPair([user(PAIR.typed), user("something else"), user(PAIR.typed)], PAIR);
    const cmd = (i: TranscriptItem): unknown => (i as { command?: unknown }).command;
    expect(cmd(out[0])).toBeUndefined();
    expect(cmd(out[2])).toEqual({ typed: PAIR.typed });
  });

  it("never re-decorates an item that already carries a command", () => {
    const already: TranscriptItem = { kind: "user", text: PAIR.expanded, command: { typed: PAIR.typed } };
    const items = [already];
    // A duplicate notify must be a no-op — same array back, nothing re-wrapped.
    expect(applyCommandPair(items, PAIR)).toBe(items);
  });

  it("returns the ORIGINAL array when nothing matches, so the caller can skip the re-render", () => {
    const items = [user("unrelated")];
    expect(applyCommandPair(items, PAIR)).toBe(items);
  });

  it("ignores assistant messages that happen to hold the same text", () => {
    const items: TranscriptItem[] = [{ kind: "assistant", text: PAIR.expanded }];
    expect(applyCommandPair(items, PAIR)).toBe(items);
  });
});

/**
 * The @file composition. Main appends `<file path="…">…</file>` blocks to the
 * OUTGOING message, so the bridge's input hook reports a `typed` that the user
 * never wrote — while the optimistic bubble holds the clean composer text. That
 * mismatch meant no card at all live, and after a reload a card titled with the
 * whole file. Both were seen in the app before these tests existed.
 */
describe("applyCommandPair with @file mentions injected", () => {
  const TYPED_CLEAN = "/explain @Game.ts";
  const INJECTED = `${TYPED_CLEAN} \n\n<file path="src/Game.ts">\nimport * as THREE from "three";\n</file>`;
  const PAIR2 = { typed: INJECTED, expanded: "Explain `@Game.ts`.\n\nFind it…" };

  it("matches the optimistic bubble, which holds only what was typed", () => {
    const out = applyCommandPair([user(TYPED_CLEAN)], PAIR2);
    expect((out[0] as { command?: { typed: string } }).command).toEqual({ typed: TYPED_CLEAN });
  });

  it("titles the card with the typed command, never the injected file", () => {
    const out = applyCommandPair([user(TYPED_CLEAN)], PAIR2);
    const typed = (out[0] as { command?: { typed: string } }).command!.typed;
    expect(typed).toBe(TYPED_CLEAN);
    expect(typed).not.toContain("<file path=");
    expect(typed).not.toContain("THREE");
  });

  it("still matches when the bubble holds main's injected form", () => {
    const out = applyCommandPair([user(INJECTED)], PAIR2);
    expect((out[0] as { command?: { typed: string } }).command).toEqual({ typed: TYPED_CLEAN });
  });
});

/**
 * Main rewrites a command's @mentions to workspace-relative paths before Pi
 * sees them (commandMentions.ts), so the bubble on screen and the bridge's
 * `typed` are different strings for the SAME invocation. Matching on exact text
 * silently produced no card at all — observed in the app as a plain bubble with
 * a mention chip and no disclosure.
 */
describe("applyCommandPair when main rewrote the message", () => {
  const COMPOSER = "/explain @Sfx.ts";
  const REWRITTEN = "/explain src/audio/Sfx.ts";
  const PAIR3 = { typed: REWRITTEN, expanded: "Explain `src/audio/Sfx.ts`.\n\nFind it…" };

  it("still pairs when only the command name is common to both forms", () => {
    const out = applyCommandPair([user(COMPOSER)], PAIR3);
    expect((out[0] as { command?: unknown }).command).toBeDefined();
  });

  it("does not pair a different command that happens to be nearby", () => {
    const items = [user("/review something")];
    expect(applyCommandPair(items, PAIR3)).toBe(items);
  });

  it("does not pair a prefix collision (/explainer is not /explain)", () => {
    const items = [user("/explainer @Sfx.ts")];
    expect(applyCommandPair(items, PAIR3)).toBe(items);
  });
});
