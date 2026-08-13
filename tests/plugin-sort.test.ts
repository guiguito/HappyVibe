/**
 * §25 round 12 — the store sorts and paginates.
 *
 * 179 cards rendered at once, in whatever order the marketplace happened to
 * list them. "Recognised" is deliberately mechanical — the generator resolved a
 * brand icon — rather than a hand-picked featured list, which would re-import
 * the per-release curation tax the generated catalog exists to remove.
 */
import { describe, expect, test } from "vitest";
import { PAGE, sortCards } from "../src/renderer/src/components/PluginsSection";

const card = (name: string, brand?: string): { name: string; brand?: string } => ({ name, ...(brand ? { brand } : {}) });

describe("sortCards", () => {
  test("branded first, then alphabetical inside each group", () => {
    const out = sortCards([
      card("zulu"),
      card("alpha"),
      card("notion", "si-notion"),
      card("github", "si-github"),
    ]);
    expect(out.map((c) => c.name)).toEqual(["github", "notion", "alpha", "zulu"]);
  });

  test("does not mutate its input — the catalog is module state", () => {
    const input = [card("zulu"), card("github", "si-github")];
    const before = input.map((c) => c.name);
    sortCards(input);
    expect(input.map((c) => c.name)).toEqual(before);
  });

  test("is stable under filtering — searching must not reshuffle what stays", () => {
    const all = sortCards([
      card("alpha"),
      card("asana", "si-asana"),
      card("beta"),
      card("github", "si-github"),
    ]);
    const filtered = sortCards(all.filter((c) => c.name.includes("a")));
    expect(filtered).toEqual(all.filter((c) => c.name.includes("a")));
  });

  test("an all-branded or all-plain list is simply alphabetical", () => {
    expect(sortCards([card("b", "si-b"), card("a", "si-a")]).map((c) => c.name)).toEqual(["a", "b"]);
    expect(sortCards([card("b"), card("a")]).map((c) => c.name)).toEqual(["a", "b"]);
  });

  test("empty is empty", () => {
    expect(sortCards([])).toEqual([]);
  });
});

describe("paging", () => {
  test("a page is a real bound, not the whole catalog", () => {
    expect(PAGE).toBeGreaterThan(0);
    expect(PAGE).toBeLessThan(179); // the catalog size this exists for
  });
});
