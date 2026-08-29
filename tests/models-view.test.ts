import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { filterCatalog } from "../src/renderer/src/components/ModelsView";

/**
 * §Providers round (2026-08-29): the long tail of the generated catalog sits
 * behind one search box. Renderer suite has no DOM, so the contract is pinned
 * as the pure helper plus source scans for the things that must NOT render.
 */
const rows = [
  { id: "groq", label: "Groq", source: null, featured: false, modelCount: 6 },
  { id: "zai-coding-cn", label: "Z.AI Coding CN", source: null, featured: false, modelCount: 5 },
  { id: "deepseek", label: "DeepSeek", source: null, featured: true, modelCount: 2 },
  { id: "mistral", label: "Mistral", source: "stored" as const, featured: false, modelCount: 31 },
];

describe("filterCatalog", () => {
  test("an empty query lists nothing — the long tail stays behind the search", () => {
    expect(filterCatalog(rows, "")).toEqual([]);
    expect(filterCatalog(rows, "   ")).toEqual([]);
  });

  test("matches label and id, case-insensitively", () => {
    expect(filterCatalog(rows, "gro").map((r) => r.id)).toEqual(["groq"]);
    expect(filterCatalog(rows, "GROQ").map((r) => r.id)).toEqual(["groq"]);
    // Regional variants are plain rows found by name — no region picker.
    expect(filterCatalog(rows, "cn").map((r) => r.id)).toEqual(["zai-coding-cn"]);
    expect(filterCatalog(rows, "z.ai").map((r) => r.id)).toEqual(["zai-coding-cn"]);
  });

  test("never lists a provider that already has a card above the search", () => {
    // Featured providers and ones with a key configured render as cards, so
    // surfacing them again in the search would offer the same key input twice.
    expect(filterCatalog(rows, "deep")).toEqual([]);
    expect(filterCatalog(rows, "mistral")).toEqual([]);
  });
});

describe("ModelsView surface (source scans)", () => {
  const src = readFileSync("src/renderer/src/components/ModelsView.tsx", "utf8");

  test("no region picker — regional variants are plain catalog rows", () => {
    expect(src).not.toMatch(/RegionPicker|regionPicker|<.*region/i);
  });

  test("the provider list is never hardcoded in the renderer", () => {
    for (const id of ["groq", "mistral", "vercel-ai-gateway", "huggingface"]) {
      expect(src, `"${id}" must come from the catalog over IPC`).not.toMatch(new RegExp(`"${id}"`));
    }
  });
});
