/**
 * §20 round 12 — the brand mark.
 *
 * There is no jsdom in this repo (deliberately: every renderer test here is a
 * pure-function test), so the assertions that matter are made against the
 * SOURCE: the mark is drawn inline, it is used everywhere the `hv` wordmark
 * used to be, and no wordmark survives. The last one is the real regression
 * guard — a placeholder that comes back somewhere new is exactly the failure
 * this round existed to fix, and it cannot be caught by rendering one component.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const raw = (rel: string): string => readFileSync(join(__dirname, "..", rel), "utf8");

/** Comments explain the traps ("an <img> would be blank"), so asserting over
 *  them makes a file fail for describing the thing it avoids. Assert on code. */
const src = (rel: string): string =>
  raw(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LOGO = "src/renderer/src/components/BrandLogo.tsx";
const SITES = [
  "src/renderer/src/components/Sidebar.tsx", // header AND collapsed rail
  "src/renderer/src/components/ModelsView.tsx", // first run
];

describe("brand mark", () => {
  test("is drawn inline — the CSP is `img-src 'self' data:`, so an asset import would be blank", () => {
    const s = src(LOGO);
    expect(s).toContain("<svg");
    expect(s).not.toMatch(/<img\b/);
    // No bundler asset import either (`?asset`, `?url`, or a direct .svg import):
    // both would resolve to a URL the CSP refuses in the packaged app.
    expect(s).not.toMatch(/from\s+["'][^"']*\.svg/);
    expect(s).not.toMatch(/\?asset|\?url/);
  });

  test("carries the face — it is what makes it the brand rather than a square", () => {
    const s = src(LOGO);
    expect((s.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(2); // eyes
    expect(s).toMatch(/<path/); // smile
  });

  test("keeps the tilt — §20 asks for a sticker, not a badge", () => {
    expect(src(LOGO)).toMatch(/rotate-3/);
  });

  test("is used at every site that showed the placeholder", () => {
    for (const site of SITES) {
      expect(src(site), `${site} should render <BrandLogo>`).toMatch(/<BrandLogo\b/);
      expect(src(site), `${site} should import it`).toMatch(/from ["']\.\/BrandLogo["']/);
    }
  });

  test("no `hv` wordmark survives anywhere in the renderer", () => {
    // The collapsed rail is the one people forget — it needs ⌘B to even see.
    const offenders: string[] = [];
    for (const site of SITES) {
      if (/>\s*hv\s*</i.test(src(site))) offenders.push(site);
    }
    expect(offenders).toEqual([]);
  });
});
