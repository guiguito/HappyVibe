/**
 * §28 round 1 — what a failed navigation SAYS, and what it offers next.
 *
 * The first version printed Chromium's raw string ("ERR_SSL_PROTOCOL_ERROR
 * (-107)") as the headline and offered "Try again", which reloaded the identical
 * URL and failed identically. Two separate failures of the same kind: the copy
 * did not say what went wrong in words, and the only button could not fix it.
 *
 * The common case by a mile is a dev server: the URL bar prepends a scheme, and
 * a plain-HTTP server on localhost dies under `https://`. That case has an
 * obvious fix, so it gets a button that performs it rather than a description.
 *
 * PURE — no imports, no window. The raw code stays visible in the UI underneath;
 * this only decides the sentence and the action.
 */

/** Chromium net error codes we say something specific about. */
export const ERR_ABORTED = -3;
export const ERR_CONNECTION_REFUSED = -102;
export const ERR_NAME_NOT_RESOLVED = -105;
export const ERR_CONNECTION_CLOSED = -100;
export const ERR_CONNECTION_RESET = -101;
export const ERR_SSL_PROTOCOL_ERROR = -107;
export const ERR_EMPTY_RESPONSE = -324;
export const ERR_BLOCKED_BY_CLIENT = -20;

/**
 * A TLS handshake that got something which is not TLS. All four are what a
 * plain-HTTP server does when a browser opens `https://` at it — which one you
 * get depends on whether it closes, resets, or answers in cleartext.
 */
const TLS_MISMATCH = new Set([
  ERR_SSL_PROTOCOL_ERROR,
  ERR_EMPTY_RESPONSE,
  ERR_CONNECTION_CLOSED,
  ERR_CONNECTION_RESET,
]);

export interface BrowserErrorCopy {
  title: string;
  body: string;
  /** When set, the pane offers a button that navigates here instead of reloading. */
  retryAs?: string;
  retryLabel?: string;
}

/** Swap https:// for http:// on a URL. Returns null when there is nothing to swap. */
export function toHttp(url: string): string | null {
  return url.startsWith("https://") ? `http://${url.slice("https://".length)}` : null;
}

export function describeBrowserError(url: string, code: number | undefined, raw: string | undefined): BrowserErrorCopy {
  const http = toHttp(url);

  if (code !== undefined && TLS_MISMATCH.has(code) && http) {
    return {
      title: "This site answered, but not over HTTPS",
      body: "That usually means it is a plain HTTP server — dev servers normally are.",
      retryAs: http,
      retryLabel: "Try http:// instead",
    };
  }

  if (code === ERR_CONNECTION_REFUSED) {
    return {
      title: "Nothing is listening there",
      body: "The address is reachable but refused the connection. Check the server is running and on that port.",
      // A refused https:// on a dev host is just as likely to be the scheme.
      ...(http ? { retryAs: http, retryLabel: "Try http:// instead" } : {}),
    };
  }

  if (code === ERR_NAME_NOT_RESOLVED) {
    return { title: "That address doesn't exist", body: "The host could not be resolved — check the spelling." };
  }

  return {
    title: "The page did not load",
    body: raw ?? "Chromium gave no reason.",
  };
}

/**
 * Which scheme a typed address should get.
 *
 * Local hosts get `http://`: a dev server is the case this feature exists for,
 * and almost none of them speak TLS. Everything else gets `https://`, which is
 * the right default for the public web. A scheme the user typed is respected.
 *
 * Returns null for a scheme we deliberately do not open (`file:`, `about:`,
 * `chrome:`) so the caller can say so instead of silently prefixing it into
 * nonsense — `https://file:///etc/passwd` was the old behaviour.
 */
export function resolveTypedUrl(raw: string): { url: string } | { unsupported: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return { url: text };
  // A bare `localhost:5173` parses as scheme "localhost" — treat a scheme with
  // no `//` and an all-digit remainder as host:port, not as a protocol.
  const looksHostPort = scheme && /^[^/]+:\d+(\/|$)/.test(text);
  if (scheme && !looksHostPort) return { unsupported: scheme };
  return { url: `${isLocalAddress(text) ? "http" : "https"}://${text}` };
}

/** Host (or host:port) that lives on this machine. */
function isLocalAddress(text: string): boolean {
  const host = text.split("/")[0].split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[" || host.endsWith(".local");
}
