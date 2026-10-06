/**
 * A subscription sign-in ends on a page the Pi child serves on localhost, and Pi hardcodes its own
 * logo there. scripts/patch-pi-oauth-page.mjs (an owned patch, applied at install) swaps in our icon
 * and points the success line back to the app. This pins that it landed in EVERY bundle chunk that
 * inlines the page — the ChatGPT sign-in above all — and that none still serves Pi's mark.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — plain .mjs, no types
import { CHUNKS, PI_LOGO, PI_SUCCESS, hunks, logoSvg } from "../scripts/patch-pi-oauth-page.mjs";

const DIR = path.join("pi-runtime", CHUNKS);
const ICON = fs.readFileSync("build/icon.svg", "utf8");
const chunks = fs.readdirSync(DIR).map((f) => [f, fs.readFileSync(path.join(DIR, f), "utf8")] as const);
const STALE = "stale install — run `cd pi-runtime && npm ci`";

describe("Pi's sign-in page is HappyVibe's", () => {
  it("is applied at install", () => {
    const pkg = JSON.parse(fs.readFileSync("pi-runtime/package.json", "utf8"));
    expect(pkg.scripts.postinstall).toMatch(/node \.\.\/scripts\/patch-pi-oauth-page\.mjs/);
  });

  it("the mark is build/icon.svg, sized by the page's logo box rather than its own 1024px", () => {
    const logo = logoSvg(ICON);
    expect(logo).toMatch(/^<svg aria-hidden="true" viewBox="0 0 1024 1024"/);
    expect(logo).not.toMatch(/<!--|\n| width="1024"/);
    expect(logo).toContain('fill="#ee5a24"');
  });

  it("a Pi that no longer inlines the page fails the install", () => {
    expect(() => hunks(fs.mkdtempSync(path.join(os.tmpdir(), "hv-oauthpage-")), ICON)).toThrow(/re-derive/);
  });

  it("covers the ChatGPT sign-in and every other chunk that inlines the page", () => {
    const patched = chunks.filter(([, s]) => s.includes("hv-patch:oauth-logo")).map(([f]) => f);
    for (const f of ["openai-chatgpt.js", "openai-codex.js", "anthropic.js"]) expect(patched, STALE).toContain(f);
  });

  it("no chunk still serves Pi's mark or Pi's success line", () => {
    expect(chunks.filter(([, s]) => s.includes(PI_LOGO)).map(([f]) => f), STALE).toEqual([]);
    expect(chunks.filter(([, s]) => s.includes(PI_SUCCESS)).map(([f]) => f), STALE).toEqual([]);
  });

  it("OpenAI's consent screen names HappyVibe, not Pi", () => {
    const s = fs.readFileSync(path.join(DIR, "openai-chatgpt.js"), "utf8");
    expect(s, STALE).toContain('AGENT_NAME_HINT=/*hv-patch:oauth-agent-name*/"HappyVibe"');
    expect(s).not.toContain('AGENT_NAME_HINT="Pi"');
  });

  it("an MCP server's consent screen names HappyVibe, unless the server sets its own oauth.clientName", () => {
    const hits = chunks.filter(([, s]) => s.includes("client_name:settings.clientName??"));
    expect(hits.map(([f]) => f), STALE).not.toEqual([]);
    for (const [f, s] of hits) {
      expect(s, `${f}: ${STALE}`).toContain('client_name:settings.clientName??/*hv-patch:oauth-mcp-name*/"HappyVibe"');
      expect(s, f).not.toContain("client_name:settings.clientName??APP_NAME");
    }
  });

  it("every patched chunk carries today's icon and the way back to the app", () => {
    for (const [f, s] of chunks.filter(([, s]) => s.includes("var LOGO_SVG="))) {
      expect(s, `${f}: ${STALE}`).toContain(JSON.stringify(logoSvg(ICON)));
      expect(s, f).toContain("and return to HappyVibe.");
    }
  });
});
