#!/usr/bin/env node
/**
 * §32 — measure a live web service and print the table docs/validation/w1.md
 * records. MANUAL ONLY: this hits a real server, so it is deliberately not a
 * test and never runs in CI.
 *
 *   node scripts/web-service-probe.mjs [baseUrl] [apiKey]
 *
 * Defaults to the service the app ships with. Re-run it after a service
 * upgrade, after enabling SearXNG, or whenever a live test fails in a way that
 * might be the box rather than the code — that last case is the whole reason
 * this exists (docs/validation/d1.md §pi-subagents 0.50: four "shape
 * regressions" that were all one dead account).
 */
const base = (process.argv[2] ?? "https://firecrawl.bzapps.eu").replace(/\/+$/, "");
const key = process.argv[3];
const H = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };

const ms = (t0) => `${Date.now() - t0}ms`;

async function step(label, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`✓ ${label.padEnd(34)} ${ms(t0).padStart(8)}  ${out}`);
  } catch (e) {
    console.log(`✗ ${label.padEnd(34)} ${ms(t0).padStart(8)}  ${e.message}`);
  }
}

const post = (p, body) => fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => r.json());
const get = (p) => fetch(`${base}${p}`, { headers: H }).then((r) => r.json());

console.log(`\nweb service probe — ${base}\n${"".padEnd(78, "-")}`);

await step("GET /", async () => JSON.stringify(await get("/")));

await step("http:// (expect a failure)", async () => {
  const r = await fetch(base.replace("https://", "http://"), { redirect: "manual" });
  return `HTTP ${r.status} — the client is https-only for this reason`;
});

await step("GET /v2/concurrency-check", async () => JSON.stringify(await get("/v2/concurrency-check")));

const scrapeBody = (extra = {}) => ({
  url: "https://example.com",
  formats: ["markdown"],
  onlyMainContent: true,
  timeout: 60_000,
  ...extra,
});
await step("scrape (cached path)", async () => {
  const r = await post("/v2/scrape", scrapeBody());
  return `ok=${r.success} chars=${r.data?.markdown?.length} status=${r.data?.metadata?.statusCode}`;
});
await step("scrape (fresh, maxAge:0)", async () => {
  const r = await post("/v2/scrape", scrapeBody({ maxAge: 0 }));
  return `ok=${r.success} chars=${r.data?.markdown?.length}`;
});
await step("scrape a big page (caps matter)", async () => {
  const r = await post("/v2/scrape", scrapeBody({ url: "https://en.wikipedia.org/wiki/Electron" }));
  return `chars=${r.data?.markdown?.length} (web_fetch returns 16,000 of these by default)`;
});
await step("scrape a 404 page", async () => {
  const r = await post("/v2/scrape", scrapeBody({ url: "https://example.com/definitely-not-here" }));
  return `success=${r.success} metadata.statusCode=${r.data?.metadata?.statusCode} — a page error is NOT a call error`;
});
await step("scrape localhost (expect refusal)", async () => {
  const r = await post("/v2/scrape", scrapeBody({ url: "http://localhost:5173" }));
  return `success=${r.success} code=${r.code ?? "-"} — the bridge refuses this first anyway`;
});

const searchOut = (r) => {
  const web = r.data?.web ?? r.data ?? [];
  const withDesc = web.filter((h) => (h.description ?? "").length > 0).length;
  return `ok=${r.success} n=${web.length} with-snippet=${withDesc} first=${web[0]?.url ?? "-"}`;
};
await step("search (specific technical)", async () => searchOut(await post("/v2/search", { query: "vitest mock fetch injected", limit: 5 })));
await step("search (generic)", async () => searchOut(await post("/v2/search", { query: "electron", limit: 3 })));
await step("search (site: operator)", async () => searchOut(await post("/v2/search", { query: "site:electronjs.org WebContentsView", limit: 3 })));
await step("search (tbs recency — expect ignored)", async () => {
  const r = await post("/v2/search", { query: "electron release notes", limit: 3, tbs: "qdr:w" });
  const web = r.data?.web ?? r.data ?? [];
  return `n=${web.length} — compare by hand with the query above; upstream never maps tbs`;
});

await step("map", async () => {
  // NOT example.com: that page has no links at all, so it reports links=0 and
  // tells you nothing about whether map works.
  const r = await post("/v2/map", { url: "https://docs.firecrawl.dev", limit: 20 });
  const r2 = await post("/v2/map", { url: "https://docs.firecrawl.dev", limit: 20, search: "scrape" });
  return `ok=${r.success} links=${r.links?.length} | with search=${r2.links?.length}`;
});

await step("crawl (start → poll → complete)", async () => {
  const s = await post("/v2/crawl", {
    url: "https://example.com",
    limit: 4,
    maxDiscoveryDepth: 2,
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
  });
  if (!s.id) return `start failed: ${JSON.stringify(s)}`;
  const notes = [`job url says ${s.url?.startsWith("http://") ? "http:// (followed by id instead)" : s.url}`];
  let polls = 0;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1_500));
    const st = await get(`/v2/crawl/${s.id}`);
    polls += 1;
    const urls = (st.data ?? []).map((d) => d.metadata?.sourceURL);
    if (i === 0) notes.push(`first poll: status=${st.status} next=${st.next ? "offered" : "none"} n=${urls.length}`);
    if (st.status === "completed" && !st.next) {
      notes.push(`completed after ${polls} polls, ${urls.length} pages`);
      break;
    }
    if (st.status === "failed") return `failed: ${st.error}`;
  }
  return notes.join(" · ");
});

await step("formats the service cannot do", async () => {
  const shot = await post("/v2/scrape", scrapeBody({ formats: ["markdown", "screenshot"] }));
  const acts = await post("/v2/scrape", scrapeBody({ actions: [{ type: "wait", milliseconds: 100 }] }));
  const json = await post("/v2/scrape", scrapeBody({ formats: ["json"], jsonOptions: { prompt: "the title" } }));
  return `screenshot: ${shot.data?.warning ?? "(none)"} | actions: ${acts.code ?? acts.error ?? "ok?"} | json: ${json.code ?? json.error ?? "ok?"}`;
});

console.log(`${"".padEnd(78, "-")}\nPut anything that changed into docs/validation/w1.md.\n`);
