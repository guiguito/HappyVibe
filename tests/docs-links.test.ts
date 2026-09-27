import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NAV } from "../src/renderer/src/components/Sidebar";
import { DOC_SLUG, docUrl } from "../src/renderer/src/docsLinks";

/**
 * Docs round (2026-09-28): every sidebar screen has a user-guide page at a flat
 * URL named after its label, so the app can regroup its sidebar without
 * breaking a link. tests/docs-structure.test.ts pins each slug to a real page.
 */
const APP = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "renderer", "src", "App.tsx"), "utf8");
const kebab = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

describe("help links (Docs round, 2026-09-28)", () => {
  it("every sidebar screen has a page, named after its label", () => {
    for (const n of NAV) expect(DOC_SLUG[n.view], n.view).toBe(kebab(n.label));
  });

  it("no two screens share a page", () => {
    const slugs = NAV.map((n) => DOC_SLUG[n.view]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("links open the embedded page on the canonical host", () => {
    expect(docUrl("mcp")).toBe("https://happyvibe.dev/docs/mcp/?embed=1");
  });

  it("the link renders once, in the settings-page wrapper", () => {
    expect(APP.match(/<DocsLink /g)).toHaveLength(1);
  });

  it("with no workspace, the link falls back to the system browser", () => {
    const at = APP.indexOf("const openDocs");
    expect(at).toBeGreaterThan(-1);
    expect(APP.slice(at, at + 500)).toContain("window.hv.openExternal(url)");
  });
});
