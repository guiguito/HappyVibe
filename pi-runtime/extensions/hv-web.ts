/**
 * §32 web tools — PURE module (the hv-rules.ts contract: no imports beyond
 * sibling pure modules), so the bridge, src/main and vitest all read ONE copy.
 *
 * The bridge DECIDES with these names and main ENFORCES the caps with them —
 * two copies of that is how a gate ends up protecting a name nothing calls
 * (§28's own file records the same reasoning for the browser).
 */
import { browserRuleName, hostOf, isLocalHost } from "./hv-browser";

/**
 * Four tools rather than one with an `action` enum — §26's and §28's locked
 * reasoning applied a third time: §10's tool-layer rules must be able to tell
 * `web_search` (allow by default — a query has no host to approve) from
 * `web_fetch` (gated per host) without the gate learning a new branch.
 */
export const WEB_TOOLS = ["web_search", "web_fetch", "web_map", "web_crawl"] as const;

export type WebToolName = (typeof WEB_TOOLS)[number];

/**
 * The three that carry a URL, and therefore gate under `browser:<host>`.
 * `web_search` is deliberately absent: its argument is a query, not a target.
 */
export const WEB_URL_TOOLS: ReadonlySet<string> = new Set(["web_fetch", "web_map", "web_crawl"]);

/**
 * Bounded by construction. The service caps nothing useful for us (a Wikipedia
 * page came back as 270,131 chars of markdown), so these are the whole defence
 * against a single tool call eating the context window.
 */
export const WEB_CAPS = {
  fetch: { defaultChars: 16_000, maxChars: 40_000 },
  search: { defaultLimit: 5, maxLimit: 10, contentChars: 3_000 },
  map: { defaultLimit: 100, maxLimit: 500 },
  crawl: {
    defaultLimit: 10,
    maxLimit: 30,
    defaultDepth: 2,
    maxDepth: 3,
    defaultCharsPerPage: 2_000,
    maxCharsPerPage: 8_000,
    totalChars: 60_000,
  },
  /** search / fetch / map. The service's own `timeout` is 60 s. */
  deadlineMs: 70_000,
  /** A crawl is a job: poll to here, then cancel it server-side. */
  crawlDeadlineMs: 120_000,
  /** plugins/fetch.ts's existing cap, reused. */
  bodyBytes: 8 * 1024 * 1024,
} as const;

/**
 * The descriptions live here, not inline in the bridge, because the Agent tools
 * page renders them read-only and "read-only" means nothing if the page renders
 * a second copy that can drift from what the model is told
 * (BROWSER_TOOL_DESCRIPTIONS, same reason).
 *
 * They never name the backend — §32's vocabulary rule holds for the model's
 * view of the tools as much as for the UI.
 */
export const WEB_TOOL_DESCRIPTIONS: Record<WebToolName, string> = {
  web_search:
    "Search the web. Returns up to `limit` results (default 5, max 10) as title, URL and snippet; set " +
    "includeContent to also get up to 3,000 chars of each page as markdown. Use it to find WHAT to read, then " +
    "web_fetch to read it properly. There is no recency filter — say so rather than implying a result is fresh.",
  web_fetch:
    "Read a public web page as clean markdown. Returns up to `maxChars` (default 16,000, max 40,000) starting at " +
    "`startIndex`; the header tells you the total, so page through a long document rather than guessing. The first " +
    "page on a new host asks the user once. Cannot reach localhost or a private network — use browser_open for " +
    "your own dev server. PDFs come back as text.",
  web_map:
    "List the URLs of a site (up to `limit`, default 100, max 500), optionally filtered by `search`. Cheap — use " +
    "it to choose which pages to web_fetch instead of crawling blindly.",
  web_crawl:
    "Read several pages of a site in one call: up to `limit` pages (default 10, max 30), `maxDepth` (default 2, " +
    "max 3), `maxCharsPerPage` (default 2,000, max 8,000), optional includePaths/excludePaths regexes. This is a " +
    "bounded SURVEY, so pages are excerpted — web_fetch any one of them afterwards for its full text (it will be " +
    "fast, the service caches). Can take up to two minutes.",
};

/**
 * Appended to the system prompt ONLY while `builtins.web` is on — §26's rule:
 * a prompt must never name a tool the model does not have.
 *
 * No `curl` blocking to go with it. §26 blocks `npm run dev &` because
 * `terminal_run` is strictly better, and that reasoning does not carry here:
 * `curl -X POST` has legitimate uses `web_fetch` cannot serve, and a `bash`
 * rule already exists for anyone who wants one.
 */
export const WEB_STEER_LINE =
  "To read a web page or documentation, use `web_fetch`; to find something on the web, use `web_search`; " +
  "to read your own dev server or a page you need to click, use the browser tools. Prefer these over `curl` " +
  "in bash — they return clean text and show the user which site you reached.";

/** Suffixes that name a network the service cannot reach on the user's behalf. */
const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal"];

function isPrivateV4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return false;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateV6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  // fc00::/7 (unique local) and fe80::/10 (link local).
  return /^f[cd]/.test(h) || h.startsWith("fe80");
}

/**
 * Hosts the web service must never be asked to reach.
 *
 * EXACT hostname semantics, like `isLocalHost`: `localhost.evil.com` resolves
 * to a real remote host and must NOT inherit the refusal (which would be a
 * denial-of-service on a legitimate domain), and `10.example.com` is a normal
 * name that merely starts with digits.
 *
 * The service refuses these too (measured), but a refusal with no reason is the
 * thing this product exists to avoid, so we refuse first and say why.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (isLocalHost(h) || isLocalHost(host)) return true;
  if (isPrivateV4(h) || isPrivateV6(h)) return true;
  return PRIVATE_SUFFIXES.some((s) => h.endsWith(s));
}

/**
 * Why this URL must not be sent to the service, as a sentence the model can act
 * on — or null when it may. Every branch names the alternative, because the
 * whole point of refusing before the gate is that the model learns what to do
 * instead rather than retrying the same call.
 */
export function webRefusal(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return "That call needs a url.";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `"${url.slice(0, 80)}" is not a valid URL — give a full http(s) address.`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return (
      `Only http(s) pages can be read by the web service (this was ${u.protocol}). ` +
      "For a file on disk use read; for a page you need to see, use browser_open."
    );
  }
  const host = hostOf(url);
  if (!host) return `"${url.slice(0, 80)}" has no host — give a full http(s) address.`;
  if (isPrivateHost(host)) {
    return (
      `${host} is not reachable from the web service, which runs outside your network — ` +
      "use browser_open, which runs on your machine."
    );
  }
  return null;
}

/**
 * The SAME virtual rule name the embedded browser gates under. Re-exported
 * rather than re-derived so a grep for the intent finds this line: one fact
 * ("the agent may reach docs.foo.com"), one allow-list, both surfaces.
 */
export const webRuleName = browserRuleName;
