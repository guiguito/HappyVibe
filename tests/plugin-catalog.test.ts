import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PLUGIN_CATALOG,
  CATALOG_GENERATED_AT,
  CATALOG_MARKETPLACE_REF,
} from "../src/main/plugins/catalog.generated";
import { entryArchiveUrl } from "../src/main/plugins/marketplace";

/**
 * §25 — structural guard on the GENERATED store, mirroring tests/mcp-catalog.test.ts.
 *
 * The generator runs against the network on a maintainer's machine; this runs in
 * CI on the committed result. It cannot re-verify a plugin, so it checks the
 * things a bad regeneration would break: that every row is installable, is
 * fetchable, and renders.
 */

/** The slugs the installed simple-icons font actually ships. */
const REAL_SLUGS = new Set(
  [
    ...fs
      .readFileSync(
        path.join(__dirname, "../node_modules/simple-icons-font/font/simple-icons.css"),
        "utf8",
      )
      .matchAll(/\.si-([a-z0-9-]+)/g),
  ].map((m) => m[1]),
);

describe("the generated plugin catalog", () => {
  it("is populated and stamped", () => {
    expect(PLUGIN_CATALOG.length).toBeGreaterThan(100);
    expect(CATALOG_GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CATALOG_MARKETPLACE_REF.length).toBeGreaterThan(0);
  });

  it("has unique names", () => {
    const names = PLUGIN_CATALOG.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries the copy every card needs", () => {
    for (const e of PLUGIN_CATALOG) {
      expect(e.name.length, e.name).toBeGreaterThan(0);
      expect(e.description.length, e.name).toBeGreaterThan(0);
    }
  });

  it("lists nothing that would install zero items", () => {
    // The store's promise is that everything listed installs. A row whose counts
    // are all zero is a card that opens to an empty picker.
    for (const e of PLUGIN_CATALOG) {
      const total = e.counts.skills + e.counts.commands + e.counts.servers;
      expect(total, e.name).toBeGreaterThan(0);
    }
  });

  it("is fetchable without any live marketplace call", () => {
    for (const e of PLUGIN_CATALOG) {
      if (e.source.repoUrl) {
        // An external plugin must resolve to an archive URL pinned to a sha —
        // that pin is what makes "verified" mean anything at install time.
        expect(e.source.sha, e.name).toBeTruthy();
        expect(entryArchiveUrl(e.source), e.name).toContain(String(e.source.sha));
      } else {
        // A marketplace-local plugin needs a subdir to find it inside the repo.
        expect(e.source.subdir.length, e.name).toBeGreaterThan(0);
      }
    }
  });

  it("only uses brand classes that really render", () => {
    // A slug the font does not ship renders as a blank square, which is worse
    // than the monogram BrandMark would otherwise draw.
    for (const e of PLUGIN_CATALOG) {
      if (!e.brand) continue;
      expect(e.brand, e.name).toMatch(/^si-[a-z0-9-]+$/);
      expect(REAL_SLUGS.has(e.brand.slice(3)), `${e.name} → ${e.brand}`).toBe(true);
    }
  });

  it("never lists a plugin whose components we cannot gate", () => {
    // Regression guard on the whole point: these were all verified to reject.
    for (const banned of ["security-guidance", "hookify", "convex", "clangd-lsp", "ralph-loop"]) {
      expect(PLUGIN_CATALOG.find((e) => e.name === banned), banned).toBeUndefined();
    }
  });

  it("never lists a plugin whose MCP server we could never authenticate with", () => {
    // Both carry real skills, so they would pass every other check — they are
    // excluded because mcpOAuth.ts does DCR only and these vendors issue
    // credentials solely to pre-registered clients.
    for (const banned of ["figma", "slack"]) {
      expect(PLUGIN_CATALOG.find((e) => e.name === banned), banned).toBeUndefined();
    }
  });

  it("still lists servers that authenticate with a token", () => {
    // The other half of that rule: GitHub cannot do DCR either, but a bearer PAT
    // works, so excluding it would have cost the most-installed connector.
    expect(PLUGIN_CATALOG.find((e) => e.name === "github")).toBeDefined();
  });

  it("lists the plugins the store exists for", () => {
    // If a regeneration silently drops these, the store is broken even if every
    // other assertion here passes.
    for (const want of ["github", "linear", "context7", "frontend-design", "skill-creator"]) {
      expect(PLUGIN_CATALOG.find((e) => e.name === want), want).toBeDefined();
    }
  });

  it("keeps the brand overrides honest", () => {
    // Every override must name a real slug too, or the file silently ships a
    // blank square for the entry it was written to fix.
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../tools/plugin-catalog/brand-overrides.json"), "utf8"),
    ) as { overrides: Record<string, string | null> };
    for (const [name, slug] of Object.entries(raw.overrides)) {
      if (slug === null) continue;
      expect(slug, name).toMatch(/^si-/);
      expect(REAL_SLUGS.has(slug.slice(3)), `${name} → ${slug}`).toBe(true);
    }
  });
});
