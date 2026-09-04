/**
 * §32 — the web service client (Firecrawl-compatible v2 API).
 *
 * Electron-free, and `fetchImpl` is injected so the contract test pins the
 * REQUEST SHAPES without a network: what breaks silently on a service upgrade
 * is a body key nobody notices, not a connection error.
 *
 * Everything encoded here was MEASURED against the live service (2026-09-03,
 * search re-measured 2026-09-04 after SearXNG landed; see
 * docs/validation/w1.md), not read off documentation:
 *   - https only — http is an nginx 404 on every path
 *   - a 404 PAGE is `success: true` with `metadata.statusCode: 404`
 *   - crawl job URLs come back as `http://`, so we follow them BY ID
 *   - `maxConcurrency: 2` server-wide, for every HappyVibe install combined
 */
import { WEB_CAPS } from "../../pi-runtime/extensions/hv-web";
import type { CrawledPage, FetchedPage, SearchHit } from "./webTools";

export interface ServiceOpts {
  baseUrl: string;
  key?: string;
  /** Injected in tests. Production passes nothing and gets Node's own fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * `code` is either the service's own (`SCRAPE_DNS_RESOLUTION_ERROR`, …) or one
 * of ours: UNAVAILABLE (429, a bare 5xx, or no answer at all — the one the
 * busy-service sentence keys off), CANCELLED, TOO_LARGE, BAD_RESPONSE,
 * CRAWL_FAILED, HTTP_<n>.
 */
export class WebServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WebServiceError";
  }
}

/** The service's own per-request budget; main's deadline sits above it. */
const SERVER_TIMEOUT_MS = 60_000;

async function request(
  o: ServiceOpts,
  path: string,
  init: { method?: string; body?: unknown },
  signal: AbortSignal,
): Promise<unknown> {
  const f = o.fetchImpl ?? fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  // Only when a key is set: the default service takes none, and sending an
  // empty bearer is how you turn "no auth" into a 401 on some proxies.
  if (o.key) headers.authorization = `Bearer ${o.key}`;

  let res: Response;
  try {
    res = await f(`${o.baseUrl}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw new WebServiceError("CANCELLED", "The request was cancelled.");
    throw new WebServiceError("UNAVAILABLE", e instanceof Error ? e.message : String(e));
  }

  const text = await res.text();
  if (text.length > WEB_CAPS.bodyBytes) {
    throw new WebServiceError("TOO_LARGE", "The web service answered with more than 8 MB.");
  }
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* handled below — a non-JSON body is only meaningful for a bad base URL */
  }
  if (!res.ok) {
    const j = (json ?? {}) as { code?: string; error?: string };
    // 429 and a code-less 5xx are "come back later", which is a different
    // sentence from "that page does not exist".
    if (res.status === 429 || (res.status >= 500 && !j.code)) {
      throw new WebServiceError("UNAVAILABLE", j.error ?? `The web service answered ${res.status}.`);
    }
    throw new WebServiceError(j.code ?? `HTTP_${res.status}`, j.error ?? `The web service answered ${res.status}.`);
  }
  if (json === null) throw new WebServiceError("BAD_RESPONSE", "That address did not answer with JSON.");
  return json;
}

type ScrapeBody = {
  success?: boolean;
  data?: { markdown?: string; metadata?: { title?: string; statusCode?: number; sourceURL?: string } };
  error?: string;
  code?: string;
};

export async function scrape(
  o: ServiceOpts,
  url: string,
  opts: { fresh?: boolean },
  signal: AbortSignal,
): Promise<FetchedPage> {
  const body: Record<string, unknown> = {
    url,
    formats: ["markdown"],
    onlyMainContent: true,
    timeout: SERVER_TIMEOUT_MS,
  };
  // The service caches two days by default, which is why a follow-up fetch of a
  // crawled page costs ~150 ms. `fresh` opts out for this one call only; we add
  // no second cache of our own, which would drift and hide staleness.
  if (opts.fresh) body.maxAge = 0;
  const j = (await request(o, "/v2/scrape", { body }, signal)) as ScrapeBody;
  if (j.success === false) throw new WebServiceError(j.code ?? "SCRAPE_FAILED", j.error ?? "That page could not be read.");
  const md = j.data?.metadata ?? {};
  return {
    url: md.sourceURL ?? url,
    ...(md.title ? { title: md.title } : {}),
    ...(typeof md.statusCode === "number" ? { statusCode: md.statusCode } : {}),
    markdown: j.data?.markdown ?? "",
  };
}

type SearchBody = { success?: boolean; data?: { web?: unknown[] } | unknown[]; error?: string; code?: string };

export async function search(
  o: ServiceOpts,
  query: string,
  opts: { limit: number; includeContent: boolean },
  signal: AbortSignal,
): Promise<SearchHit[]> {
  const body: Record<string, unknown> = { query, limit: opts.limit, timeout: SERVER_TIMEOUT_MS };
  // Only when asked: scrapeOptions makes the service fetch every result, which
  // turns a ~1 s search into several and costs the shared worker slots.
  if (opts.includeContent) body.scrapeOptions = { formats: ["markdown"], onlyMainContent: true };
  const j = (await request(o, "/v2/search", { body }, signal)) as SearchBody;
  if (j.success === false) throw new WebServiceError(j.code ?? "SEARCH_FAILED", j.error ?? "That search failed.");
  // v2 nests web results under data.web; tolerate a bare array too, because the
  // shape is the service's and a hard assumption here fails the whole tool.
  const raw = Array.isArray(j.data) ? j.data : (j.data?.web ?? []);
  return raw
    .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null && typeof (h as { url?: unknown }).url === "string")
    .map((h) => {
      const hit: SearchHit = { url: h.url as string };
      if (typeof h.title === "string") hit.title = h.title;
      if (typeof h.description === "string") hit.description = h.description;
      if (typeof h.markdown === "string") hit.markdown = h.markdown;
      return hit;
    });
}

type MapBody = { success?: boolean; links?: Array<string | { url?: string }>; error?: string; code?: string };

export async function mapSite(
  o: ServiceOpts,
  url: string,
  opts: { search?: string; limit: number },
  signal: AbortSignal,
): Promise<string[]> {
  const body: Record<string, unknown> = { url, limit: opts.limit };
  if (opts.search) body.search = opts.search;
  const j = (await request(o, "/v2/map", { body }, signal)) as MapBody;
  if (j.success === false) throw new WebServiceError(j.code ?? "MAP_FAILED", j.error ?? "That site could not be listed.");
  return (j.links ?? []).map((l) => (typeof l === "string" ? l : (l.url ?? ""))).filter(Boolean);
}

type CrawlStart = { success?: boolean; id?: string; error?: string; code?: string };
type CrawlStatus = {
  status?: string;
  total?: number;
  completed?: number;
  data?: Array<{ markdown?: string; metadata?: { title?: string; sourceURL?: string } }>;
  next?: string;
  error?: string;
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new WebServiceError("CANCELLED", "The request was cancelled."));
      },
      { once: true },
    );
  });

/** Best-effort: a failed DELETE must never mask the result we already have.
 * The job also expires on its own after 24 h, so the worst case is two slots
 * held for the rest of this crawl rather than leaked forever. */
async function cancelCrawl(o: ServiceOpts, id: string): Promise<void> {
  try {
    await request(o, `/v2/crawl/${encodeURIComponent(id)}`, { method: "DELETE" }, AbortSignal.timeout(5_000));
  } catch {
    /* nothing useful to do — see above */
  }
}

/**
 * Start → poll → complete, or give up at the deadline and cancel the job so it
 * stops burning the service's two slots. Returns whatever pages arrived either
 * way: a partial survey plus "stopped at N of M" is useful, an error is not.
 *
 * THE POLL SEMANTICS ARE MEASURED, and the obvious implementation is wrong in
 * two ways that a fixture written from the docs would never show
 * (both observed on the live service, 2026-09-04):
 *
 *  1. `data` is the ACCUMULATED slice from the requested offset, not the pages
 *     completed since the last poll. Three consecutive polls of a one-page
 *     crawl each returned that same page, so appending what arrives duplicates
 *     every page once per poll.
 *  2. `next` is present WHILE STILL SCRAPING (`status: "scraping"`, one page
 *     done, `?skip=1` offered), so treating it as "there is more, fetch it
 *     immediately" is an unsleeping loop against a service with two worker
 *     slots for every HappyVibe install combined.
 *
 * So: `skip` is OUR count of records consumed — which is exactly what `next`
 * encodes — and the returned URL is never used at all, which also disposes of
 * its `http://` scheme (an nginx 404 on that box). Each round drains until a
 * slice comes back empty, then sleeps. `seen` is belt for both the re-sent
 * slice and a site that serves one URL under two links.
 */
export async function crawl(
  o: ServiceOpts,
  url: string,
  opts: { limit: number; maxDepth: number; includePaths?: string[]; excludePaths?: string[] },
  signal: AbortSignal,
  deadlineMs: number,
  pollMs = 1_500,
): Promise<{ pages: CrawledPage[]; stopped: { after: number; of: number } | null }> {
  const body: Record<string, unknown> = {
    url,
    limit: opts.limit,
    maxDiscoveryDepth: opts.maxDepth,
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
  };
  if (opts.includePaths?.length) body.includePaths = opts.includePaths;
  if (opts.excludePaths?.length) body.excludePaths = opts.excludePaths;

  const s = (await request(o, "/v2/crawl", { body }, signal)) as CrawlStart;
  if (s.success === false || !s.id) {
    throw new WebServiceError(s.code ?? "CRAWL_FAILED", s.error ?? "That crawl could not start.");
  }
  const id = s.id;
  const job = `/v2/crawl/${encodeURIComponent(id)}`;
  const t0 = Date.now();
  const pages: CrawledPage[] = [];
  const seen = new Set<string>();
  let skip = 0;
  let total = 0;

  try {
    for (;;) {
      let status = "";
      // Drain everything available right now, advancing our own cursor.
      for (;;) {
        const st = (await request(o, skip ? `${job}?skip=${skip}` : job, { method: "GET" }, signal)) as CrawlStatus;
        total = st.total ?? total;
        status = st.status ?? status;
        if (status === "failed" || status === "cancelled") {
          throw new WebServiceError("CRAWL_FAILED", st.error ?? `That crawl ${status}.`);
        }
        const rows = st.data ?? [];
        let added = 0;
        for (const d of rows) {
          const u = d.metadata?.sourceURL;
          if (!u || seen.has(u)) continue;
          seen.add(u);
          added += 1;
          pages.push({ url: u, ...(d.metadata?.title ? { title: d.metadata.title } : {}), markdown: d.markdown ?? "" });
        }
        skip += rows.length;
        // Break on NEW PAGES, not on an empty slice. A service that ignored
        // `skip` and re-sent the whole set every time would satisfy
        // `rows.length > 0` forever, so an empty-slice condition is an infinite
        // loop waiting for a service upgrade. Nothing is lost by stopping
        // early: the next round re-polls from the same cursor.
        if (added === 0) break;
      }
      if (status === "completed") return { pages, stopped: null };
      if (Date.now() - t0 > deadlineMs) {
        await cancelCrawl(o, id);
        return { pages, stopped: { after: pages.length, of: Math.max(total, pages.length) } };
      }
      await sleep(pollMs, signal);
    }
  } catch (e) {
    if (e instanceof WebServiceError && e.code === "CANCELLED") await cancelCrawl(o, id);
    throw e;
  }
}

/**
 * The settings row's Test button, and the ONLY call main makes that no tool
 * asked for — which is why it is a button and not a boot probe.
 */
export async function probe(o: ServiceOpts, signal: AbortSignal): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const j = (await request(o, "/", { method: "GET" }, signal)) as { message?: string };
    if (typeof j.message === "string" && /firecrawl api/i.test(j.message)) return { ok: true };
    return { ok: false, reason: "That address answered, but not as a compatible web service." };
  } catch (e) {
    const code = e instanceof WebServiceError ? e.code : "UNAVAILABLE";
    const msg = e instanceof Error ? e.message : String(e);
    if (code.startsWith("HTTP_")) return { ok: false, reason: `That address answered ${code.slice(5)} — check the URL.` };
    if (code === "BAD_RESPONSE") return { ok: false, reason: "That address answered, but not as a compatible web service." };
    return { ok: false, reason: `That address did not answer: ${msg}` };
  }
}
