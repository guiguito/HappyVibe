import { describe, expect, test } from "vitest";
import { monogram, tintFor } from "../src/renderer/src/components/BrandMark";
import { MCP_CATALOG } from "../src/main/mcpCatalog";

/**
 * Round 8 follow-up: no MCP server should ever render as a blank square. That
 * covers the catalog entries simple-icons has no glyph for (Firecrawl,
 * Composio, Playwright) AND every hand-added server, which is most of them.
 */
describe("monogram", () => {
  test("takes the first alphanumeric character, uppercased", () => {
    expect(monogram("firecrawl")).toBe("F");
    expect(monogram("chrome_devtools")).toBe("C");
    expect(monogram("Composio")).toBe("C");
    expect(monogram("n8n")).toBe("N");
  });

  test("survives names that start with punctuation or are empty", () => {
    expect(monogram("_private")).toBe("P");
    expect(monogram("")).toBe("?");
    expect(monogram("---")).toBe("?");
  });
});

describe("tintFor", () => {
  test("is deterministic — a server keeps the same colour across renders", () => {
    expect(tintFor("firecrawl")).toBe(tintFor("firecrawl"));
  });

  test("returns a real class string for every catalog entry", () => {
    for (const e of MCP_CATALOG) expect(tintFor(e.name).length, e.key).toBeGreaterThan(0);
  });

  test("spreads names across more than one tint", () => {
    const seen = new Set(MCP_CATALOG.map((e) => tintFor(e.name)));
    expect(seen.size).toBeGreaterThan(1);
  });
});
