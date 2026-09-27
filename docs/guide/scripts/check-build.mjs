// The built guide, checked against the spec (Notion: Documentation). `npm run build` runs it.
// ponytail: node:assert over dist/, no test framework, because every check is a file read.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const SITE = "https://happyvibe.dev/docs/";
const read = (p) => readFileSync(join(DIST, p), "utf8");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pages = readdirSync(DIST, { recursive: true })
  .map((f) => f.split("\\").join("/"))
  .filter((f) => f.endsWith("index.html"));
const css = readdirSync(join(DIST, "_astro"))
  .filter((f) => f.endsWith(".css"))
  .map((f) => read(join("_astro", f)))
  .join("\n");

assert.ok(pages.includes("index.html"), "the docs home was not built");
for (const p of pages) {
  const html = read(p);
  const url = SITE + p.replace(/index\.html$/, "");
  assert.match(html, new RegExp(`<link[^>]*rel="canonical"[^>]*href="${esc(url)}"`), `${p}: canonical must be ${url}`);
  assert.match(html, /<meta[^>]*name="description"[^>]*content="[^"]+"/, `${p}: needs a description`);
  assert.ok(!html.includes("<starlight-theme-select"), `${p}: the theme switcher must be gone (light only)`);
  assert.ok(html.includes('dataset.theme = "light"'), `${p}: the light theme must be forced`);
}
assert.ok(existsSync(join(DIST, "sitemap-index.xml")), "no sitemap");
assert.ok(existsSync(join(DIST, "pagefind", "pagefind.js")), "no search index");
assert.ok(existsSync(join(DIST, "favicon.svg")), "no favicon");
assert.match(css, /--color-paper:\s*#faf4e8/, "the app's tokens did not reach the CSS");
assert.match(css, /Gabarito Variable/, "the app's text font did not reach the CSS");

console.log(`docs check: ${pages.length} pages OK`);
