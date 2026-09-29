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
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasRestorable, rewindActions, rewindDialogBody, type RewindPreview } from "../src/renderer/src/rewind";

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

// ── docs round #17: the copy follows the scope, not a V1 that no longer exists ──
describe("rewind copy says what each scope does", () => {
  const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

  test("the body promises a truncated conversation exactly when the scope truncates it", () => {
    for (const scope of ["conversation", "both", "files"] as const) {
      const body = rewindDialogBody(scope);
      expect(/removed from the conversation/.test(body), scope).toBe(rewindActions(scope).truncateChat);
      expect(/moves back into the composer/.test(body), scope).toBe(rewindActions(scope).truncateChat);
    }
    expect(rewindDialogBody("files")).toMatch(/stay exactly as they are/);
  });

  test("the tooltip no longer says files are never rolled back", () => {
    const t = read("src/renderer/src/components/Transcript.tsx");
    expect(t).not.toMatch(/not rolled back/);
    expect(t).toContain('title="Rewind to this message — you choose whether files roll back too"');
  });

  test("the dialog renders the derived body, not a fixed paragraph", () => {
    const c = read("src/renderer/src/components/ChatView.tsx");
    expect(c).toContain("{rewindDialogBody(rewindScope)}");
    expect(c).not.toMatch(/moves back into the composer so you can edit/);
    expect(c).not.toMatch(/files are NOT rolled back/);
  });
});
