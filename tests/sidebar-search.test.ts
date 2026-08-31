import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §7 round 18 — the filter input hides, the affordance does not.
 *
 * Source-scanned: this suite has no DOM, and the load-bearing half is an
 * ABSENCE (no input is rendered at rest) plus a behaviour a render test would
 * not fail on either — that Esc CLEARS, which is what makes "a collapsed
 * search can never mean a filtered list" true by construction rather than by
 * the filter-active dot the first draft of the proposal specified.
 */
const SRC = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "renderer", "src", "components", "Sidebar.tsx"),
  "utf8",
);

describe("the input is conditional, the icon is not", () => {
  it("the field renders only while searching", () => {
    expect(SRC).toContain("{searching && (");
  });

  it("the affordance carries its shortcut in the tooltip, like the collapse control", () => {
    expect(SRC).toContain('title="Find a session (⌘K)"');
  });

  it("the placeholder is unchanged — this hides the input, not the capability", () => {
    expect(SRC).toContain('placeholder="Filter sessions…"');
  });
});

describe("Esc clears as well as collapses", () => {
  it("the Escape branch resets the filter, not just the field", () => {
    // Anchored on the search input itself: the session-row rename editor has
    // its own Escape handler earlier in the file, and matching that one would
    // pass while this feature was broken.
    const at = SRC.indexOf("ref={searchRef}");
    expect(at).toBeGreaterThan(-1);
    const field = SRC.slice(at, at + 600);
    expect(field).toContain('=== "Escape"');
    expect(field).toContain('setFilter("")');
    expect(field).toContain("setSearching(false)");
  });

  it("blur only closes when the filter is empty", () => {
    // Losing an active filter because you clicked a result would be hostile.
    expect(SRC).toContain("if (!filter) setSearching(false)");
  });
});

describe("ABSENCE — the rejected alternatives", () => {
  it("there is no filter-active dot on the icon", () => {
    expect(SRC).not.toContain("FilterActiveDot");
  });

  it("nothing in the sidebar claims ⌘F", () => {
    expect(SRC).not.toContain("⌘F");
  });
});
