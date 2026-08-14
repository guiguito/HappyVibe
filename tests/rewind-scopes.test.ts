/**
 * §9 round 12 — the file-restore scopes appear only when there are files.
 *
 * Before: all three radios always rendered and *Files only* was merely disabled
 * when there was no snapshot. That still asks the user to read, consider and
 * reject a control that cannot do anything — and it said nothing at all about
 * the second empty case, a snapshot whose diff is empty because the turn only
 * read files.
 */
import { describe, expect, test } from "vitest";
import { hasRestorable, rewindActions, type RewindPreview } from "../src/renderer/src/rewind";

const preview = (p: Partial<RewindPreview>): RewindPreview => ({
  willRestore: [],
  willDelete: [],
  stale: [],
  ...p,
});

describe("hasRestorable", () => {
  test("still loading is NOT restorable — the options must not flash in and out", () => {
    // undefined is the pre-answer state. Showing the scopes now and hiding them
    // when the answer arrives is the one behaviour the decision forbids.
    expect(hasRestorable(undefined)).toBe(false);
  });

  test("no snapshot at this message (a steer, or a failed capture)", () => {
    expect(hasRestorable(null)).toBe(false);
  });

  test("a snapshot whose diff is empty — the turn only READ files", () => {
    expect(hasRestorable(preview({}))).toBe(false);
  });

  test("something to restore", () => {
    expect(hasRestorable(preview({ willRestore: ["src/a.ts"] }))).toBe(true);
  });

  test("something to delete counts too — a created file is a change to undo", () => {
    expect(hasRestorable(preview({ willDelete: ["src/new.ts"] }))).toBe(true);
  });

  test("stale alone is not restorable — every candidate was skipped", () => {
    // Stale files are named and LEFT ALONE, so a preview that is only stale
    // would restore nothing: offering the scope would promise a no-op.
    expect(hasRestorable(preview({ stale: ["src/a.ts"] }))).toBe(false);
  });
});

describe("rewindActions is unchanged by the gating", () => {
  test("each scope still maps to the same two switches", () => {
    expect(rewindActions("conversation")).toEqual({ truncateChat: true, restoreFiles: false });
    expect(rewindActions("both")).toEqual({ truncateChat: true, restoreFiles: true });
    expect(rewindActions("files")).toEqual({ truncateChat: false, restoreFiles: true });
  });
});
