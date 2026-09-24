import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEB_SERVICE_URL,
  resolveWebService,
  WEB_CUSTOM_URL_INVALID,
  clampInt,
  pageWindow,
  formatFetch,
  formatSearch,
  formatMap,
  formatCrawl,
  SERVICE_UNAVAILABLE_TEXT,
} from "../src/main/webTools";
import { WEB_CAPS } from "../pi-runtime/extensions/hv-web";

describe("webTools — service resolution (§32)", () => {
  it("resolves the default with no key, and a custom one with a decrypted key", () => {
    expect(resolveWebService(undefined, () => "x")).toEqual({ baseUrl: DEFAULT_WEB_SERVICE_URL, service: "default" });
    // mode wins over a leftover URL — switching back to the default must not
    // keep calling the custom box.
    expect(resolveWebService({ mode: "default", baseUrl: "https://ignored.example" }, () => "x")).toEqual({
      baseUrl: DEFAULT_WEB_SERVICE_URL,
      service: "default",
    });
    expect(resolveWebService({ mode: "custom", baseUrl: "https://fc.example.com/", keyEnc: "enc" }, (b) => `dec:${b}`)).toEqual({
      baseUrl: "https://fc.example.com",
      key: "dec:enc",
      service: "custom",
    });
    // …and a custom service with no key sends no bearer header at all.
    expect(resolveWebService({ mode: "custom", baseUrl: "https://fc.example.com" }, () => "x")).toEqual({
      baseUrl: "https://fc.example.com",
      service: "custom",
    });
  });

  // §32 amendment (open-source round, 2026-09-24): a user who chose their OWN
  // service is never sent to ours without a word. The old fallback existed so a
  // half-saved setting could not break every tool; the cost was a silent send
  // to the maintainer's box, which public source turns into a cost leak.
  it.each([undefined, "", "  ", "not-a-url", "ftp://fc.example.com"])(
    "a custom setting with an unusable URL (%j) is an error, never the default box",
    (baseUrl) => {
      const r = resolveWebService({ mode: "custom", ...(baseUrl === undefined ? {} : { baseUrl }) }, () => "x");
      expect(r).toEqual({ error: WEB_CUSTOM_URL_INVALID });
      expect(JSON.stringify(r)).not.toContain(DEFAULT_WEB_SERVICE_URL);
    },
  );

  it("the error names where to fix it", () => {
    expect(WEB_CUSTOM_URL_INVALID).toMatch(/Settings → Built-in tools/);
  });

  it("the default is https — the box answers nginx 404 over http", () => {
    expect(DEFAULT_WEB_SERVICE_URL.startsWith("https://")).toBe(true);
    expect(DEFAULT_WEB_SERVICE_URL.endsWith("/")).toBe(false);
  });
});

describe("webTools — caps and paging (§32)", () => {
  it("clamps a model-supplied number without throwing", () => {
    expect(clampInt(undefined, 5, 10)).toBe(5);
    expect(clampInt(99, 5, 10)).toBe(10);
    expect(clampInt(-3, 5, 10)).toBe(1);
    expect(clampInt("7", 5, 10)).toBe(7);
    expect(clampInt(NaN, 5, 10)).toBe(5);
    expect(clampInt("abc", 5, 10)).toBe(5);
    expect(clampInt(2.7, 5, 10)).toBe(2);
    expect(clampInt(null, 5, 10)).toBe(5);
    // startIndex needs a floor of 0, not 1.
    expect(clampInt(0, 0, 100, 0)).toBe(0);
    expect(clampInt(-5, 0, 100, 0)).toBe(0);
  });

  it("pages a long document with exact boundaries", () => {
    const doc = "a".repeat(41_203);
    expect(pageWindow(doc, 0, 16_000)).toMatchObject({ start: 0, end: 16_000, total: 41_203 });
    expect(pageWindow(doc, 16_000, 16_000)).toMatchObject({ start: 16_000, end: 32_000 });
    // the last page stops at the end rather than reporting a window past it
    expect(pageWindow(doc, 40_000, 16_000)).toMatchObject({ start: 40_000, end: 41_203 });
    expect(pageWindow(doc, 40_000, 16_000).slice.length).toBe(1_203);
    // a startIndex past the end is empty, not an error
    expect(pageWindow(doc, 50_000, 16_000).slice).toBe("");
    expect(pageWindow("short", 0, 16_000)).toMatchObject({ start: 0, end: 5, total: 5 });
    expect(pageWindow("", 0, 16_000)).toMatchObject({ start: 0, end: 0, total: 0 });
  });
});

describe("webTools — result text (§32)", () => {
  it("a fetch opens with the factual header and says how to page", () => {
    const { text, meta } = formatFetch(
      { url: "https://docs.foo.com/guide", title: "Guide", statusCode: 200, markdown: "x".repeat(41_203) },
      0,
      16_000,
    );
    expect(text.startsWith('Read https://docs.foo.com/guide (title: "Guide", status 200, 41,203 chars total, showing 0–16,000).')).toBe(true);
    expect(text).toContain("startIndex=16000");
    expect(meta).toEqual({ host: "docs.foo.com", total: 41_203, start: 0, end: 16_000, status: 200 });
  });

  it("the last page does not offer a next one", () => {
    const { text } = formatFetch({ url: "https://a.b/c", markdown: "hi" }, 0, 16_000);
    expect(text).not.toContain("startIndex=");
    expect(text).toContain("2 chars total, showing 0–2");
  });

  it("a page's own non-2xx status is reported separately from the call succeeding", () => {
    // Measured: a 404 page comes back success:true + metadata.statusCode:404.
    // A model told only "ok" would quote an error page as documentation.
    const { text } = formatFetch({ url: "https://a.b/c", statusCode: 404, markdown: "Not found" }, 0, 100);
    expect(text).toContain("The page answered 404");
    expect(formatFetch({ url: "https://a.b/c", statusCode: 200, markdown: "ok" }, 0, 100).text).not.toContain("may be an error page");
  });

  it("search renders a chooser, with excerpts only when content was asked for", () => {
    const hits = [
      { title: "T1", url: "https://a/1", description: "d1", markdown: "m".repeat(5_000) },
      { url: "https://a/2" },
    ];
    const plain = formatSearch("q", hits, false);
    expect(plain).toContain('Searched the web for "q" — 2 results.');
    expect(plain).toContain("1. T1 — https://a/1\n   d1");
    expect(plain).toContain("2. https://a/2");
    expect(plain).not.toContain("mmmm");

    const rich = formatSearch("q", hits, true);
    expect(rich).toContain("m".repeat(WEB_CAPS.search.contentChars));
    expect(rich).not.toContain("m".repeat(WEB_CAPS.search.contentChars + 1));
  });

  it("search says so when there is nothing, rather than rendering an empty list", () => {
    expect(formatSearch("q", [], false)).toContain("no results");
    expect(formatSearch("q", [{ url: "https://a/1" }], false)).toContain("1 result.");
  });

  it("map lists URLs one per line with a count", () => {
    const t = formatMap("https://docs.foo.com/start", ["https://docs.foo.com/a", "https://docs.foo.com/b"]);
    expect(t).toContain("Listed 2 pages on docs.foo.com");
    expect(t).toContain("https://docs.foo.com/a\nhttps://docs.foo.com/b");
  });

  it("crawl caps per page AND in total, and says what it left out", () => {
    // 40 pages × 3,000 chars would be 120 KB; the per-page clamp takes it to
    // 2,000 and the total cap stops at 60,000 — 30 pages of body, 40 reported.
    const pages = Array.from({ length: 40 }, (_, i) => ({
      url: `https://d.f/${i}`,
      title: `P${i}`,
      markdown: "z".repeat(3_000),
    }));
    const { text, meta } = formatCrawl("https://d.f", pages, 2_000, null);
    expect(meta.pages).toBe(40);
    expect(meta.total).toBeLessThanOrEqual(WEB_CAPS.crawl.totalChars);
    expect(meta.included).toBe(30);
    expect(text).toContain("Read 40 pages from d.f");
    expect(text).toContain("Only the first 30 are included here");
    expect(text).toContain("## P0 — https://d.f/0");
    expect(text).not.toContain("z".repeat(2_001));
  });

  it("a crawl that fits says nothing about leaving pages out", () => {
    const { text, meta } = formatCrawl("https://d.f", [{ url: "https://d.f/a", title: "A", markdown: "body" }], 2_000, null);
    expect(meta).toEqual({ host: "d.f", pages: 1, included: 1, total: 4 });
    expect(text).not.toContain("Only the first");
    expect(text).not.toContain("Stopped at");
  });

  it("a crawl cut short by the deadline says where it stopped", () => {
    const { text } = formatCrawl(
      "https://d.f",
      [{ url: "https://d.f/a", markdown: "a" }, { url: "https://d.f/b", markdown: "b" }],
      2_000,
      { after: 2, of: 60 },
    );
    expect(text).toContain("Stopped at 2 of 60 pages after 120 s");
  });

  it("the unavailable sentence points at the way out and never names the backend", () => {
    expect(SERVICE_UNAVAILABLE_TEXT).toContain("Settings");
    expect(SERVICE_UNAVAILABLE_TEXT).toContain("your own");
    expect(SERVICE_UNAVAILABLE_TEXT.toLowerCase()).not.toContain("firecrawl");
  });
});
