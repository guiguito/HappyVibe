import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Round 15 — the session row: one trash, a two-outcome dialog, an age at rest.
 *
 * Source-scanned rather than rendered: this suite has no DOM (vitest include is
 * `tests/**\/*.test.ts`, no jsdom), and the assertions that matter here are
 * about what is NOT in the row any more — an absence no render test would fail
 * on either, since the archive shortcut disappearing looks like a passing test
 * for everything else.
 */
const SRC = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "Sidebar.tsx"),
  "utf8",
);

describe("the row has one destructive affordance, not two", () => {
  it("the one-click archive button is gone", () => {
    // Two icons meant two one-click destinations for one decision.
    expect(SRC).not.toContain("<ArchiveIcon");
    expect(SRC).not.toContain("function ArchiveIcon");
  });

  it("the trash is still there and opens the chooser", () => {
    expect(SRC).toContain("<TrashIcon />");
    expect(SRC).toContain("Archive or delete this session");
  });

  it("the dialog offers BOTH outcomes plus cancel", () => {
    expect(SRC).toContain("Delete permanently");
    expect(SRC).toMatch(/Unarchive.*:.*Archive|confirmDelete\.archived \? "Unarchive" : "Archive"/s);
    // A5 (2026-09-10) re-indented this subtree by two spaces when the two
    // asides merged into one. What is pinned is that Cancel is its own button
    // LABEL — not the indentation it happens to sit at.
    expect(SRC).toMatch(/>\s*Cancel\s*</);
  });

  it("archiving still routes through the existing handler, not a new one", () => {
    // The dialog reuses onArchiveSession — no second archive path to drift.
    expect(SRC).toContain("onArchiveSession(confirmDelete.id, !confirmDelete.archived)");
  });
});

describe("the resting row shows an age", () => {
  it("renders timeago from LAST USED — the same fact the list sorts by", () => {
    // It used to read `updatedAt`, which is "metadata last changed": bumped by
    // a rename, a model swap, and — worst — by auto-hibernation, which picks
    // the LEAST recently used session, so the stalest row showed the freshest
    // age. Now the age and the order come from one function, which is what
    // makes "top of the list shows 10d" structurally impossible.
    expect(SRC).toContain("timeago(Date.parse(lastUsed(session)))");
    expect(SRC).toContain("new Date(lastUsed(session)).toLocaleString()");
    expect(SRC).not.toContain("Date.parse(session.updatedAt)");
  });

  it("hides the age while the session is working — the pulsing dot already says so", () => {
    // A second moving thing in one row is noise, not information.
    expect(SRC).toMatch(/\{!status && \(/);
  });

  it("the age hides on hover and the trash appears — one slot, never both", () => {
    expect(SRC).toContain("group-hover:hidden");
    expect(SRC).toContain("hidden group-hover:block");
  });
});
