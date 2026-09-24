/**
 * §32 — caps, paging, result text and service resolution. PURE and
 * electron-free (the pi/spawn.ts discipline), so the interesting decisions are
 * unit-testable without a window: `ipc.ts` owns the wire, `webService.ts` owns
 * the HTTP, and this owns what the model actually reads.
 */
import { WEB_CAPS } from "../../pi-runtime/extensions/hv-web";
import { hostOf } from "../../pi-runtime/extensions/hv-browser";

/**
 * ONE constant. The UI never renders it — the settings sub-block says
 * "HappyVibe's service" — but every call resolves through here, so a change of
 * default is a one-line change rather than a grep.
 */
export const DEFAULT_WEB_SERVICE_URL = "https://firecrawl.bzapps.eu";

export interface WebServiceConfig {
  mode?: "default" | "custom";
  baseUrl?: string;
  /** safeStorage-encrypted, base64 — exactly like `customKeys`. */
  keyEnc?: string;
}

export const WEB_CUSTOM_URL_INVALID =
  "Your custom web service URL isn't valid — fix it in Settings → Built-in tools, or switch back to the default service.";

export type ResolvedWebService =
  | { baseUrl: string; key?: string; service: "default" | "custom" }
  | { error: string };

/**
 * Which service this call goes to, with the key decrypted only here.
 *
 * "custom" with no usable URL is an ERROR, never the default (§32 amendment,
 * 2026-09-24). It used to fall back so a half-saved setting could not break
 * every tool — but that sent a user who had deliberately chosen their own
 * service to ours without a word, which public source turns into a cost leak
 * and which quietly breaks "nothing leaves that you did not send".
 */
export function resolveWebService(
  cfg: WebServiceConfig | undefined,
  decrypt: (b64: string) => string,
): ResolvedWebService {
  if (cfg?.mode !== "custom") return { baseUrl: DEFAULT_WEB_SERVICE_URL, service: "default" };
  const base = cfg.baseUrl?.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\/./.test(base)) return { error: WEB_CUSTOM_URL_INVALID };
  const key = cfg.keyEnc ? decrypt(cfg.keyEnc) : undefined;
  return key ? { baseUrl: base, key, service: "custom" } : { baseUrl: base, service: "custom" };
}

/**
 * Clamp a model-supplied number into a cap without ever throwing. The model
 * writes these, so a string, a NaN or a negative is an ordinary input, not an
 * error worth failing a turn over.
 */
export function clampInt(v: unknown, def: number, max: number, min = 1): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * The paging window. Paging beats truncation-with-no-recourse (the `fetch` MCP
 * server's idiom): a 270 KB page is unreadable at once but perfectly readable
 * 16 KB at a time, and the header tells the model the total so it can decide.
 */
export function pageWindow(
  text: string,
  startIndex: number,
  maxChars: number,
): { slice: string; start: number; end: number; total: number } {
  const total = text.length;
  const start = Math.min(Math.max(0, startIndex), total);
  const end = Math.min(total, start + maxChars);
  return { slice: text.slice(start, end), start, end, total };
}

const n = (x: number): string => x.toLocaleString("en-US");

export interface FetchedPage {
  url: string;
  title?: string;
  statusCode?: number;
  markdown: string;
}

/**
 * A factual header the model can reason about BEFORE the content, then the
 * content. The page's own status is reported separately from the call's success
 * because they are different facts: a 404 page fetched successfully is
 * `success: true` with `statusCode: 404` (measured), and a model told only
 * "ok" would quote an error page as if it were documentation.
 */
export function formatFetch(
  p: FetchedPage,
  startIndex: number,
  maxChars: number,
): { text: string; meta: { host: string; total: number; start: number; end: number; status?: number } } {
  const w = pageWindow(p.markdown, startIndex, maxChars);
  const title = p.title ? `title: "${p.title}", ` : "";
  const status = typeof p.statusCode === "number" ? `status ${p.statusCode}, ` : "";
  const lines = [`Read ${p.url} (${title}${status}${n(w.total)} chars total, showing ${n(w.start)}–${n(w.end)}).`];
  if (w.end < w.total) lines.push(`Call web_fetch again with startIndex=${w.end} for more.`);
  if (typeof p.statusCode === "number" && (p.statusCode < 200 || p.statusCode >= 300)) {
    lines.push(`The page answered ${p.statusCode} — the text below may be an error page.`);
  }
  return {
    text: `${lines.join("\n")}\n\n${w.slice}`,
    meta: {
      host: hostOf(p.url) ?? "",
      total: w.total,
      start: w.start,
      end: w.end,
      ...(typeof p.statusCode === "number" ? { status: p.statusCode } : {}),
    },
  };
}

export interface SearchHit {
  title?: string;
  url: string;
  description?: string;
  markdown?: string;
}

/** Search is for choosing what to read next, so the default is a chooser: title,
 * URL, snippet. Content only when it was asked for, and capped when it was. */
export function formatSearch(query: string, hits: SearchHit[], includeContent: boolean): string {
  if (hits.length === 0) return `Searched the web for "${query}" — no results.`;
  const rows = hits.map((h, i) => {
    const parts = [h.title ? `${i + 1}. ${h.title} — ${h.url}` : `${i + 1}. ${h.url}`];
    if (h.description) parts.push(`   ${h.description}`);
    if (includeContent && h.markdown) parts.push(`   ---\n${h.markdown.slice(0, WEB_CAPS.search.contentChars)}`);
    return parts.join("\n");
  });
  return `Searched the web for "${query}" — ${hits.length} result${hits.length === 1 ? "" : "s"}.\n\n${rows.join("\n")}`;
}

export function formatMap(url: string, links: string[]): string {
  return `Listed ${n(links.length)} pages on ${hostOf(url) ?? url}.\n\n${links.join("\n")}`;
}

export interface CrawledPage {
  url: string;
  title?: string;
  markdown: string;
}

/**
 * A crawl is a SURVEY, and the total cap is what keeps it one. Two limits
 * apply: `maxCharsPerPage` (the model's own, clamped) and `WEB_CAPS.crawl
 * .totalChars` (ours, absolute) — so 30 pages of 8,000 chars cannot become
 * 240 KB of context. Pages beyond the budget are dropped rather than truncated
 * to nothing, and the header says how many pages there were either way, so the
 * model can web_fetch what it still needs.
 */
export function formatCrawl(
  url: string,
  pages: CrawledPage[],
  maxCharsPerPage: number,
  stopped: { after: number; of: number } | null,
): { text: string; meta: { host: string; pages: number; included: number; total: number } } {
  const host = hostOf(url) ?? url;
  let budget = WEB_CAPS.crawl.totalChars;
  const blocks: string[] = [];
  let total = 0;
  for (const p of pages) {
    if (budget <= 0) break;
    const body = p.markdown.slice(0, Math.min(maxCharsPerPage, budget));
    budget -= body.length;
    total += body.length;
    blocks.push(`## ${p.title ?? p.url} — ${p.url}\n${body}`);
  }
  const head = [`Read ${n(pages.length)} pages from ${host} (${n(total)} chars of text).`];
  if (blocks.length < pages.length) {
    head.push(`Only the first ${blocks.length} are included here — web_fetch any other page for its text.`);
  }
  if (stopped) {
    head.push(
      `Stopped at ${stopped.after} of ${stopped.of} pages after ${WEB_CAPS.crawlDeadlineMs / 1000} s — ` +
        "web_fetch a specific page if you need more.",
    );
  }
  return {
    text: `${head.join("\n")}\n\n${blocks.join("\n\n")}`,
    meta: { host, pages: pages.length, included: blocks.length, total },
  };
}

/**
 * The default service is shared by every HappyVibe install and holds two worker
 * slots for all of them, so "busy" is a normal outcome and gets a normal
 * sentence. No retry loop (it would queue behind the same two slots) and no
 * remote kill switch — the rate limit lives on the server; the app explains it
 * and names the way out.
 */
export const SERVICE_UNAVAILABLE_TEXT =
  "HappyVibe's web service is busy or unreachable right now. Try again in a moment, or point the app at your own " +
  "service in Settings → Built-in tools.";
