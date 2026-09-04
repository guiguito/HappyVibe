import { describe, it, expect } from "vitest";
import { scrape, search, mapSite, crawl, probe, WebServiceError, type ServiceOpts } from "../src/main/webService";

/**
 * §32 CONTRACT TEST — the request shapes, with an injected `fetch`.
 *
 * What breaks silently when the web service changes is a body key nobody
 * notices, not a connection error, so this pins the bodies and the response
 * handling rather than reaching the network. The live service is measured by
 * `scripts/web-service-probe.mjs` and recorded in docs/validation/w1.md; CI
 * must never hit it.
 */

interface Call {
  url: string;
  init: RequestInit;
}

function fake(answers: Array<{ status?: number; body: unknown }>): {
  f: typeof fetch;
  calls: Call[];
  body: (k: number) => Record<string, unknown>;
} {
  const calls: Call[] = [];
  let i = 0;
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const a = answers[Math.min(i++, answers.length - 1)];
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), {
      status: a.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { f, calls, body: (k) => JSON.parse(String(calls[k].init.body)) as Record<string, unknown> };
}

const O = (f: typeof fetch, key?: string): ServiceOpts => ({
  baseUrl: "https://svc.example",
  fetchImpl: f,
  ...(key ? { key } : {}),
});
const sig = (): AbortSignal => AbortSignal.timeout(5_000);

describe("webService — scrape (§32)", () => {
  it("posts markdown-only main content, and maxAge:0 ONLY when fresh", async () => {
    const { f, calls, body } = fake([
      { body: { success: true, data: { markdown: "# Hi", metadata: { title: "Hi", statusCode: 200, sourceURL: "https://a.b/c" } } } },
    ]);
    const page = await scrape(O(f), "https://a.b/c", {}, sig());
    expect(calls[0].url).toBe("https://svc.example/v2/scrape");
    expect(body(0)).toMatchObject({ url: "https://a.b/c", formats: ["markdown"], onlyMainContent: true, timeout: 60_000 });
    // The service caches two days, which is what makes a follow-up fetch of a
    // crawled page cheap. Never opt out unless asked.
    expect(body(0)).not.toHaveProperty("maxAge");
    expect(page).toEqual({ url: "https://a.b/c", title: "Hi", statusCode: 200, markdown: "# Hi" });

    await scrape(O(f), "https://a.b/c", { fresh: true }, sig());
    expect(body(1).maxAge).toBe(0);
  });

  it("sends a bearer header only when a key is set", async () => {
    const { f, calls } = fake([{ body: { success: true, data: { markdown: "", metadata: {} } } }]);
    await scrape(O(f), "https://a.b", {}, sig());
    expect(new Headers(calls[0].init.headers).get("authorization")).toBeNull();
    await scrape(O(f, "sk-secret"), "https://a.b", {}, sig());
    expect(new Headers(calls[1].init.headers).get("authorization")).toBe("Bearer sk-secret");
  });

  it("a 404 PAGE is a success — its status is carried, not thrown", async () => {
    const { f } = fake([{ body: { success: true, data: { markdown: "Not found", metadata: { statusCode: 404 } } } }]);
    const page = await scrape(O(f), "https://a.b/missing", {}, sig());
    expect(page.statusCode).toBe(404);
    expect(page.markdown).toBe("Not found");
  });

  it("falls back to the requested URL when the service reports no sourceURL", async () => {
    const { f } = fake([{ body: { success: true, data: { markdown: "x", metadata: {} } } }]);
    const page = await scrape(O(f), "https://a.b/c", {}, sig());
    expect(page).toEqual({ url: "https://a.b/c", markdown: "x" });
  });
});

describe("webService — failure mapping (§32)", () => {
  it("keeps the service's own code and sentence", async () => {
    const { f } = fake([
      { status: 500, body: { success: false, code: "SCRAPE_DNS_RESOLUTION_ERROR", error: "DNS resolution failed for hostname: nope.invalid" } },
    ]);
    await expect(scrape(O(f), "https://nope.invalid", {}, sig())).rejects.toMatchObject({
      code: "SCRAPE_DNS_RESOLUTION_ERROR",
      message: /DNS resolution failed/,
    });
  });

  it("429 and a code-less 5xx are UNAVAILABLE — 'come back later', not 'no such page'", async () => {
    const busy = fake([{ status: 429, body: "rate limited" }]);
    await expect(scrape(O(busy.f), "https://a.b", {}, sig())).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const boom = fake([{ status: 502, body: "<html>bad gateway</html>" }]);
    await expect(scrape(O(boom.f), "https://a.b", {}, sig())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("no answer at all is UNAVAILABLE, not a crash", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(scrape(O(down), "https://a.b", {}, sig())).rejects.toBeInstanceOf(WebServiceError);
    await expect(scrape(O(down), "https://a.b", {}, sig())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("a 4xx with a code keeps it — that is a page problem, not a service problem", async () => {
    const { f } = fake([{ status: 400, body: { success: false, code: "BAD_REQUEST", error: "url is required" } }]);
    await expect(scrape(O(f), "https://a.b", {}, sig())).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses a body over 8 MB", async () => {
    const { f } = fake([{ body: { success: true, data: { markdown: "x".repeat(8 * 1024 * 1024 + 1), metadata: {} } } }]);
    await expect(scrape(O(f), "https://a.b", {}, sig())).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("an abort is CANCELLED, distinct from unavailable", async () => {
    const ac = new AbortController();
    ac.abort();
    const f = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(scrape(O(f), "https://a.b", {}, ac.signal)).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("webService — search (§32)", () => {
  it("posts the query and limit, and adds scrapeOptions only with content", async () => {
    const { f, body } = fake([
      { body: { success: true, data: { web: [{ url: "https://a/1", title: "T", description: "d", markdown: "m" }] } } },
    ]);
    const hits = await search(O(f), "vitest mock fetch", { limit: 5, includeContent: false }, sig());
    expect(body(0)).toEqual({ query: "vitest mock fetch", limit: 5, timeout: 60_000 });
    expect(hits).toEqual([{ url: "https://a/1", title: "T", description: "d", markdown: "m" }]);

    // scrapeOptions makes the service fetch every result — several seconds and
    // the shared worker slots — so it is opt-in.
    await search(O(f), "q", { limit: 3, includeContent: true }, sig());
    expect(body(1)).toMatchObject({ scrapeOptions: { formats: ["markdown"], onlyMainContent: true } });
  });

  it("tolerates a bare array, and drops a hit with no url", async () => {
    const { f } = fake([{ body: { success: true, data: [{ url: "https://a/1" }, { title: "no url" }, null] } }]);
    expect(await search(O(f), "q", { limit: 5, includeContent: false }, sig())).toEqual([{ url: "https://a/1" }]);
  });

  it("an empty result set is empty, not an error", async () => {
    const { f } = fake([{ body: { success: true, data: { web: [] } } }]);
    expect(await search(O(f), "q", { limit: 5, includeContent: false }, sig())).toEqual([]);
  });
});

describe("webService — map (§32)", () => {
  it("posts url/limit(/search) and reads links as strings or objects", async () => {
    const { f, body } = fake([{ body: { success: true, links: [{ url: "https://d/a", title: "A" }, "https://d/b", { title: "no url" }] } }]);
    expect(await mapSite(O(f), "https://d", { limit: 100, search: "guide" }, sig())).toEqual(["https://d/a", "https://d/b"]);
    expect(body(0)).toEqual({ url: "https://d", limit: 100, search: "guide" });
  });

  it("omits `search` when there is none", async () => {
    const { f, body } = fake([{ body: { success: true, links: [] } }]);
    await mapSite(O(f), "https://d", { limit: 50 }, sig());
    expect(body(0)).toEqual({ url: "https://d", limit: 50 });
  });
});

describe("webService — crawl (§32)", () => {
  /**
   * A fake that behaves the way the LIVE service was measured to behave
   * (2026-09-04), because the obvious fixture hides both real bugs:
   *   - `data` is the accumulated slice FROM the requested `skip`, so a poll at
   *     skip=0 re-returns every page it already returned;
   *   - `next` is offered while `status` is still "scraping".
   * `rounds` is what `completed`/`status` look like on successive polls.
   */
  function crawlBox(
    rounds: Array<{ done: number; status: string }>,
    totalPages: number,
    opts: { ignoreSkip?: boolean } = {},
  ): { f: typeof fetch; calls: Call[]; body: (k: number) => Record<string, unknown> } {
    const calls: Call[] = [];
    let round = 0;
    const all = Array.from({ length: totalPages }, (_, i) => ({
      markdown: `p${i}`,
      metadata: { title: `P${i}`, sourceURL: `https://d/${i}` },
    }));
    const f = (async (u: string | URL, init?: RequestInit) => {
      const url = String(u);
      calls.push({ url, init: init ?? {} });
      const json = (b: unknown): Response =>
        new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("/v2/crawl")) return json({ success: true, id: "job-1", url: "http://svc.example/v2/crawl/job-1" });
      if (init?.method === "DELETE") return json({ success: true });
      const skip = opts.ignoreSkip ? 0 : Number(new URL(url).searchParams.get("skip") ?? "0");
      const r = rounds[round];
      const slice = all.slice(skip, r.done);
      const body = {
        status: r.status,
        total: totalPages,
        completed: r.done,
        data: slice,
        // Offered whenever the service believes more may follow — INCLUDING
        // mid-scrape, which is the trap.
        ...(r.done > skip ? { next: `http://svc.example/v2/crawl/job-1?skip=${r.done}` } : {}),
      };
      // The crawl advances once the caller has drained this round. A
      // skip-ignoring service never returns an empty slice, so there it
      // advances per poll instead.
      if (slice.length === 0 || opts.ignoreSkip) round = Math.min(round + 1, rounds.length - 1);
      return json(body);
    }) as unknown as typeof fetch;
    return { f, calls, body: (k) => JSON.parse(String(calls[k].init.body)) as Record<string, unknown> };
  }

  it("posts the v2 body and never uses the service's own http:// job URL", async () => {
    const { f, calls, body } = crawlBox([{ done: 3, status: "completed" }], 3);
    const r = await crawl(O(f), "https://d", { limit: 10, maxDepth: 2, includePaths: ["^/docs"] }, sig(), 10_000, 1);
    expect(calls[0].url).toBe("https://svc.example/v2/crawl");
    expect(body(0)).toMatchObject({
      url: "https://d",
      limit: 10,
      maxDiscoveryDepth: 2,
      includePaths: ["^/docs"],
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    });
    // Every poll is on OUR https base with our own cursor. The returned URL
    // says http://, which is an nginx 404 on that box.
    for (const c of calls.slice(1)) expect(c.url.startsWith("https://svc.example/v2/crawl/job-1")).toBe(true);
    expect(r.pages.map((p) => p.url)).toEqual(["https://d/0", "https://d/1", "https://d/2"]);
    expect(r.stopped).toBeNull();
  });

  it("does not duplicate a page the service re-sends, and still terminates", async () => {
    // THE measured bug: three consecutive polls of a one-page crawl each
    // returned that same page. This fake goes further and ignores `skip`
    // entirely, which is what a service upgrade could plausibly do — with an
    // empty-slice drain condition that combination never terminates at all.
    const { f } = crawlBox(
      [
        { done: 1, status: "scraping" },
        { done: 1, status: "completed" },
      ],
      1,
      { ignoreSkip: true },
    );
    const r = await crawl(O(f), "https://d", { limit: 4, maxDepth: 2 }, sig(), 10_000, 1);
    expect(r.pages.map((p) => p.url)).toEqual(["https://d/0"]);
  });

  it("collects pages that arrive across several rounds, in order, once each", async () => {
    const { f } = crawlBox(
      [
        { done: 1, status: "scraping" },
        { done: 2, status: "scraping" },
        { done: 3, status: "completed" },
      ],
      3,
    );
    const r = await crawl(O(f), "https://d", { limit: 10, maxDepth: 2 }, sig(), 10_000, 1);
    expect(r.pages.map((p) => p.url)).toEqual(["https://d/0", "https://d/1", "https://d/2"]);
    expect(r.pages[0]).toEqual({ url: "https://d/0", title: "P0", markdown: "p0" });
  });

  it("sleeps between rounds rather than chasing `next` on a still-scraping job", async () => {
    // A `next` offered mid-scrape must not become an unsleeping loop: the
    // service has two worker slots for every install combined.
    const { f, calls } = crawlBox([{ done: 1, status: "scraping" }, { done: 1, status: "completed" }], 1);
    const t0 = Date.now();
    await crawl(O(f), "https://d", { limit: 4, maxDepth: 2 }, sig(), 10_000, 40);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    // start + (skip=0, skip=1) per round × 2 rounds
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it("omits empty path filters rather than sending []", async () => {
    const { f, body } = crawlBox([{ done: 0, status: "completed" }], 0);
    await crawl(O(f), "https://d", { limit: 5, maxDepth: 1, includePaths: [], excludePaths: [] }, sig(), 10_000, 1);
    expect(body(0)).not.toHaveProperty("includePaths");
    expect(body(0)).not.toHaveProperty("excludePaths");
  });

  it("on deadline: cancels the job and returns what it has, marked stopped", async () => {
    const { f, calls } = crawlBox([{ done: 2, status: "scraping" }], 30);
    const r = await crawl(O(f), "https://d", { limit: 30, maxDepth: 2 }, sig(), 0, 5);
    expect(r.stopped).toEqual({ after: 2, of: 30 });
    // A partial survey is useful; two held worker slots are not.
    expect(calls.some((c) => c.init.method === "DELETE" && c.url.includes("/v2/crawl/job-1"))).toBe(true);
  });

  it("on abort: cancels the job and throws CANCELLED", async () => {
    const ac = new AbortController();
    const { f, calls } = crawlBox([{ done: 0, status: "scraping" }], 5);
    const p = crawl(O(f), "https://d", { limit: 5, maxDepth: 1 }, ac.signal, 10_000, 30);
    setTimeout(() => ac.abort(), 5);
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    expect(calls.some((c) => c.init.method === "DELETE")).toBe(true);
  });

  it("a failed job surfaces the service's own sentence", async () => {
    const { f } = fake([
      { body: { success: true, id: "job-1" } },
      { body: { status: "failed", error: "Crawl blocked by robots.txt" } },
    ]);
    await expect(crawl(O(f), "https://d", { limit: 5, maxDepth: 1 }, sig(), 10_000, 1)).rejects.toMatchObject({
      code: "CRAWL_FAILED",
      message: /robots/,
    });
  });

  it("a start that fails never begins polling", async () => {
    const { f, calls } = fake([{ status: 400, body: { success: false, code: "BAD_URL", error: "url is invalid" } }]);
    await expect(crawl(O(f), "not-a-url", { limit: 5, maxDepth: 1 }, sig(), 10_000, 1)).rejects.toMatchObject({ code: "BAD_URL" });
    expect(calls.length).toBe(1);
  });
});

describe("webService — probe (§32)", () => {
  it("is GET / and expects the API's own greeting", async () => {
    const ok = fake([{ body: { message: "Firecrawl API" } }]);
    expect(await probe(O(ok.f), sig())).toEqual({ ok: true });
    expect(ok.calls[0].url).toBe("https://svc.example/");
    expect(ok.calls[0].init.method).toBe("GET");
  });

  it("reports a wrong address as a sentence, never a stack trace", async () => {
    const notFound = await probe(O(fake([{ status: 404, body: "<html>nginx</html>" }]).f), sig());
    expect(notFound).toEqual({ ok: false, reason: "That address answered 404 — check the URL." });

    const notTheApi = await probe(O(fake([{ body: { message: "hello" } }]).f), sig());
    expect(notTheApi.ok).toBe(false);
    if (!notTheApi.ok) expect(notTheApi.reason).toMatch(/not as a compatible web service/);

    const html = await probe(O(fake([{ body: "<html>a website</html>" }]).f), sig());
    expect(html.ok).toBe(false);

    const down = await probe(
      O((async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch),
      sig(),
    );
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.reason).toMatch(/did not answer/);
  });
});
