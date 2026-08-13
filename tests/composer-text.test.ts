import { describe, it, expect } from "vitest";
import { insertAtComposer } from "../src/renderer/src/composerText";

/**
 * §27/§3.4, feedback round 2. Caret insertion with space padding, shared by
 * dictation and the editor's "Send to chat".
 *
 * NOTE FOR ANYONE RESTORING A TEST: there used to be an assertion here pinning
 * `appendToComposer` as byte-identical to the inline expression it replaced.
 * It was DELETED on purpose — it pinned the append-at-the-end behaviour that
 * this round reverses. Do not bring it back.
 */
describe("insertAtComposer — padding", () => {
  it("is the identity on an empty composer", () => {
    expect(insertAtComposer("", "hello", 0, 0)).toEqual({ value: "hello", caret: 5 });
  });

  it("pads a space when a word sits immediately before the caret", () => {
    const r = insertAtComposer("fix the", "session", 7, 7);
    expect(r.value).toBe("fix the session");
  });

  it("does not double up when the inserted text brings its own whitespace", () => {
    // A transcript can plausibly arrive with a leading or trailing space.
    expect(insertAtComposer("fix the", " session", 7, 7).value).toBe("fix the session");
    expect(insertAtComposer("the bug", "session ", 0, 0).value).toBe("session the bug");
    expect(insertAtComposer("ab", " X ", 1, 1).value).toBe("a X b");
  });

  it("pads BOTH sides when the caret sits between two words", () => {
    const prev = "fix the bug";
    const caret = 8; // fix the |bug
    const r = insertAtComposer(prev, "session manager", caret, caret);
    expect(r.value).toBe("fix the session manager bug");
    // Caret lands after the inserted text, not after the trailing pad.
    expect(r.value.slice(0, r.caret)).toBe("fix the session manager");
  });

  it("adds NO padding when whitespace already exists on either side", () => {
    const r = insertAtComposer("fix the  bug", "X", 8, 8);
    expect(r.value).toBe("fix the X bug");
    // Exactly one space each side — never doubled up.
    expect(r.value).not.toContain("  ");
  });

  it("treats a newline as whitespace, so a fresh line gets no leading space", () => {
    const prev = "first line\n";
    const r = insertAtComposer(prev, "second", prev.length, prev.length);
    expect(r.value).toBe("first line\nsecond");
  });

  it("NEVER introduces a newline of its own", () => {
    for (const prev of ["", "a", "a b", "line1\nline2", "trailing   "]) {
      for (const at of [0, Math.floor(prev.length / 2), prev.length]) {
        const r = insertAtComposer(prev, "X", at, at);
        // Any newline in the result must have come from `prev`.
        expect(r.value.split("\n").length).toBe(prev.split("\n").length);
      }
    }
  });
});

describe("insertAtComposer — caret and selection", () => {
  it("inserts at the start without touching what follows", () => {
    const r = insertAtComposer("bug", "fix the", 0, 0);
    expect(r.value).toBe("fix the bug");
    expect(r.caret).toBe(7);
  });

  it("inserts at the end", () => {
    const r = insertAtComposer("fix the", "bug", 7, 7);
    expect(r.value).toBe("fix the bug");
    expect(r.value.slice(0, r.caret)).toBe("fix the bug");
  });

  it("REPLACES a selection rather than inserting beside it", () => {
    // "fix [the] bug" with "the" selected.
    const r = insertAtComposer("fix the bug", "that", 4, 7);
    expect(r.value).toBe("fix that bug");
  });

  it("handles a backwards selection (anchor after focus)", () => {
    // A drag right-to-left gives selectionStart > selectionEnd in some paths.
    expect(insertAtComposer("fix the bug", "that", 7, 4).value).toBe("fix that bug");
  });

  it("clamps a stale caret rather than splicing out of bounds", () => {
    // A caret captured against a longer previous value must not corrupt.
    const r = insertAtComposer("short", "X", 999, 999);
    expect(r.value).toBe("short X");
    expect(r.caret).toBeLessThanOrEqual(r.value.length);
    expect(insertAtComposer("short", "X", -5, -5).value).toBe("X short");
  });

  it("the returned caret is always a valid index into the new value", () => {
    for (const [prev, at] of [["", 0], ["abc", 1], ["a b c", 3], ["x", 1]] as const) {
      const r = insertAtComposer(prev, "YY", at, at);
      expect(r.caret).toBeGreaterThanOrEqual(0);
      expect(r.caret).toBeLessThanOrEqual(r.value.length);
    }
  });

  it("keeps multi-line inserted text intact (the accepted round-2 trade-off)", () => {
    // Send-to-chat with a code selection now splices at the caret. The content
    // must survive verbatim even though it is padded with a space.
    const r = insertAtComposer("look at this", "const x = 1\nconst y = 2", 12, 12);
    expect(r.value).toBe("look at this const x = 1\nconst y = 2");
  });
});
