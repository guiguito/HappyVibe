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

// Pages for agents (Task 4).
const llms = read("llms.txt");
for (const p of pages) {
  const id = p === "index.html" ? "index" : p.replace(/\/index\.html$/, "");
  assert.ok(existsSync(join(DIST, `${id}.md`)), `${id}: no Markdown copy`);
  assert.ok(!read(`${id}.md`).includes("TODO(media)"), `${id}.md: media placeholders must not reach agents`);
  assert.ok(id === "index" || llms.includes(`${SITE}${id}.md`), `llms.txt does not list ${id}`);
  assert.ok(read(p).includes('class="hv-copy-md"'), `${p}: no Copy as Markdown button`);
}
assert.ok(llms.startsWith("# HappyVibe\n"), "llms.txt must open with the llmstxt.org title line");
assert.ok(existsSync(join(DIST, "llms-full.txt")), "no llms-full.txt");
assert.ok(read("index.md").startsWith("# HappyVibe docs\n"), "a Markdown copy opens with its page title");

// Embed mode (Task 5).
for (const p of pages) assert.ok(read(p).includes('sessionStorage.setItem("hv-embed"'), `${p}: no embed script`);
assert.match(css, /\[data-embed\][^{]*\.site-title/, "embed mode must hide the site title");

console.log(`docs check: ${pages.length} pages OK`);
