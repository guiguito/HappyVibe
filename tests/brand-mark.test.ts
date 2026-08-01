import { describe, expect, test } from "vitest";
import { monogram } from "../src/renderer/src/components/BrandMark";
import { INLINE_GLYPHS, glyphKey } from "../src/renderer/src/components/BrandGlyphs";
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

describe("inline glyphs", () => {
  test("cover the brands simple-icons does not ship", () => {
    // Vendor-published logos, reduced to currentColor. Playwright is absent on
    // purpose — simple-icons pulled it for lack of permission and Microsoft
    // publishes no official SVG, so it takes the monogram.
    expect(INLINE_GLYPHS.firecrawl).toBeDefined();
    expect(INLINE_GLYPHS.composio).toBeDefined();
    expect(INLINE_GLYPHS.playwright).toBeUndefined();
  });

  test("glyphKey normalises a display name or a server key to the map key", () => {
    expect(glyphKey("Firecrawl")).toBe("firecrawl");
    expect(glyphKey("Composio")).toBe("composio");
    expect(glyphKey("chrome_devtools")).toBe("chromedevtools");
  });

  test("every glyph declares a viewBox", () => {
    for (const [k, g] of Object.entries(INLINE_GLYPHS)) {
      expect(g.viewBox, k).toMatch(/^0 0 \d+ \d+$/);
    }
  });
});
