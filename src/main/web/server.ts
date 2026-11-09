/**
 * Web mode — the app served to a browser tab instead of (or beside) its own
 * windows. `HV_SERVE=<port>` starts it; see serveConfig.ts.
 *
 * The whole design is ONE substitution: a browser tab is a window. Main already
 * pushes to windows through a structural `WinLike` (windows.ts), and the
 * renderer already talks to main through one preload object whose every method
 * is an `invoke`, a `send`, an `on` or the boot `sendSync`. So a tab gets a
 * `WebWindow` in the same registry as the BrowserWindows, the preload is
 * compiled a second time against a browser `electron` shim (src/renderer/web),
 * and this file carries those four calls over HTTP and one WebSocket. Not one
 * of the ~300 handlers behind them changes.
 *
 * Electron-free on purpose (the windows.ts precedent): the suite drives the
 * server over real sockets with a fake host, and index.ts hands it the real one.
 *
 * Security: this is a door into an agent that runs commands.
 *   - The page and its assets are the public app bundle and are served to
 *     anyone who can reach the port. Everything that DOES something — hello,
 *     sync, the socket — needs the token printed at start.
 *   - The token travels in the link's FRAGMENT (`/#token=…`, never sent to a
 *     server), is kept in the page's localStorage — scoped to this exact
 *     origin, port included, unlike a cookie, which every port of the host
 *     would receive — and is presented as a request header (a page elsewhere
 *     cannot set one without a CORS preflight nobody answers) or as a
 *     WebSocket subprotocol.
 *   - Requests that act must come from this origin (Origin, Sec-Fetch-Site),
 *     and on loopback the Host header must name this server (DNS rebinding).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { decode, encode, type WireMessage } from "./codec";
import { isLoopback } from "./serveConfig";
import { WebWindow } from "./webWindow";

/** What main supplies: the registry entry for a new tab and the four IPC verbs. */
export interface WebHost {
  /** A tab arrived with no window to come back to: register one (with a record). */
  open(win: WebWindow): void;
  /** A window's tab came back or went away — the window list changes either way. */
  changed(win: WebWindow): void;
  /** `ipcRenderer.sendSync` — only the boot uses it. */
  sync(win: WebWindow, channel: string, args: unknown[]): unknown;
  /** `ipcRenderer.invoke`. */
  invoke(win: WebWindow, channel: string, args: unknown[]): Promise<unknown>;
  /** `ipcRenderer.send`. */
  send(win: WebWindow, channel: string, args: unknown[]): void;
}

export interface WebServerOptions {
  host: string;
  port: number;
  /** The access token; generated when omitted. */
  token?: string;
  /** The built renderer (out/renderer), whose web.html is the page. */
  rendererDir: string;
  /** The SERVER's platform: the renderer's path rules follow the machine the files are on. */
  platform: string;
  /** How often a socket must answer a ping, or it is taken for gone (a sleeping laptop, a NAT that forgot it). */
  heartbeatMs?: number;
}

/** The header a tab presents its token in; a custom header is what keeps other origins out. */
export const TOKEN_HEADER = "x-hv-token";
/** The WebSocket subprotocol the server answers with; the token rides as the second offer. */
export const WS_PROTOCOL = "hv";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface WebServer {
  readonly url: string;
  /** The link to open once: the token rides in its fragment. */
  readonly loginUrl: string;
  readonly token: string;
  windows(): WebWindow[];
  close(): Promise<void>;
}

export async function startWebServer(opts: WebServerOptions, host: WebHost): Promise<WebServer> {
  const token = opts.token ?? randomBytes(24).toString("base64url");
  const heartbeatMs = opts.heartbeatMs ?? 20_000;
  const rendererDir = path.resolve(opts.rendererDir);
  const byKey = new Map<string, WebWindow>();
  let port = opts.port;

  /**
   * The Host header must name THIS server. On loopback that is one of the
   * loopback names at our port; bound wider, the machine has names we cannot
   * list, and the token alone carries the check.
   */
  const hostOk = (req: IncomingMessage): boolean => {
    if (!isLoopback(opts.host)) return true;
    const h = (req.headers.host ?? "").toLowerCase();
    const i = h.lastIndexOf(":");
    if (i < 0 || h.slice(i + 1) !== String(port)) return false;
    return isLoopback(h.slice(0, i));
  };

  /** A request that acts must come from this server's own page — when the browser says where it came from at all. */
  const sameOrigin = (req: IncomingMessage): boolean => {
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") return false;
    const origin = req.headers.origin;
    return origin === undefined || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
  };

  const headerToken = (req: IncomingMessage): boolean => {
    const t = req.headers[TOKEN_HEADER];
    return typeof t === "string" && sameSecret(t, token);
  };

  /** `Sec-WebSocket-Protocol: hv, <token>` — the browser API's one way to send a socket a secret. */
  const protocolToken = (req: IncomingMessage): boolean => {
    const offered = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
    return offered[0] === WS_PROTOCOL && offered.length === 2 && sameSecret(offered[1], token);
  };

  const headers = (res: ServerResponse, type: string, cache: string): void => {
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", cache);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    // The app never belongs in someone else's frame.
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  };

  const fail = (res: ServerResponse, code: number, text: string): void => {
    headers(res, "text/plain; charset=utf-8", "no-store");
    res.statusCode = code;
    res.end(text);
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 1 << 20) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  /**
   * A tab with no window to come back to (a new tab, or one whose key the server
   * no longer knows) gets the window a closed tab left behind, if there is one —
   * the most recent — with its tabs, terminals and running work intact. Only
   * with none dormant is a new window opened.
   */
  const windowFor = (key: unknown): WebWindow => {
    const known = typeof key === "string" ? byKey.get(key) : undefined;
    if (known && !known.isDestroyed()) return known;
    // `dormantSince > 0`: a window that had a tab and lost it. A brand-new one
    // waiting for its own tab's socket is not up for grabs, and a claimed one
    // stops being so at once.
    const dormant = [...byKey.values()]
      .filter((w) => w.isDormant() && w.dormantSince > 0)
      .sort((a, b) => b.dormantSince - a.dormantSince)[0];
    if (dormant) {
      dormant.dormantSince = 0;
      return dormant;
    }
    const win = new WebWindow();
    byKey.set(win.key, win);
    win.on("closed", () => byKey.delete(win.key));
    host.open(win);
    return win;
  };

  const json = (res: ServerResponse, value: unknown): void => {
    headers(res, "application/json", "no-store");
    res.end(encode({ v: value }));
  };

  const serveFile = async (res: ServerResponse, rel: string, cache: string, head: boolean): Promise<void> => {
    const abs = path.resolve(rendererDir, rel);
    // Confined to the renderer build, and never a dotfile.
    if (!abs.startsWith(rendererDir + path.sep) || rel.split("/").some((s) => s.startsWith("."))) {
      return fail(res, 404, "Not found");
    }
    try {
      const body = await readFile(abs);
      headers(res, TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream", cache);
      res.end(head ? undefined : body);
    } catch {
      fail(res, 404, "Not found");
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!hostOk(req)) return fail(res, 403, "Wrong host.");
    const url = new URL(req.url ?? "/", "http://x");

    if (req.method === "POST" && (url.pathname === "/hv/hello" || url.pathname === "/hv/sync")) {
      if (!sameOrigin(req)) return fail(res, 403, "Not from this page.");
      if (!headerToken(req)) return fail(res, 401, "Open the link HappyVibe printed when it started — it carries the access token.");
      let body: { key?: unknown; ch?: unknown; a?: unknown };
      try {
        body = decode(await readBody(req)) as typeof body;
      } catch {
        return fail(res, 400, "Bad request");
      }
      if (url.pathname === "/hv/hello") {
        const win = windowFor(body.key);
        return json(res, { key: win.key, platform: opts.platform });
      }
      const known = typeof body.key === "string" ? byKey.get(body.key) : undefined;
      if (!known || known.isDestroyed() || typeof body.ch !== "string") return fail(res, 404, "Unknown window");
      return json(res, host.sync(known, body.ch, Array.isArray(body.a) ? body.a : []));
    }

    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Method not allowed");
    const head = req.method === "HEAD";
    if (url.pathname === "/" || url.pathname === "/index.html") return serveFile(res, "web.html", "no-store", head);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    // Hashed names: safe to keep for good.
    const cache = rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return serveFile(res, rel, cache, head);
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) fail(res, 500, "Internal error");
      else res.end();
    });
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 << 20,
    // The token was the second offer; never echo it back.
    handleProtocols: (offered) => (offered.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });

  /** Send on THIS socket — the one the question came on — or not at all. */
  const replyOn = (ws: WebSocket, m: WireMessage): void => {
    if (ws.readyState !== ws.OPEN) return;
    let text: string;
    try {
      text = encode(m);
    } catch (err) {
      // A value the wire cannot carry still answers, so the caller is not left waiting.
      if (m.t !== "reply") return;
      text = encode({ t: "reply", id: m.id, ok: false, e: `Error: the answer could not be sent to the page (${String(err)})` });
    }
    ws.send(text);
  };

  server.on("upgrade", (req: IncomingMessage, sock: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://x");
    const refuse = (code: number): void => {
      sock.write(`HTTP/1.1 ${code} ${code === 401 ? "Unauthorized" : "Forbidden"}\r\nConnection: close\r\n\r\n`);
      sock.destroy();
    };
    if (url.pathname !== "/hv/ws") return refuse(403);
    if (!hostOk(req)) return refuse(403);
    // Cross-site socket hijacking: a page elsewhere can open a socket here, and
    // the browser names it in Origin. Only this server's own page may connect.
    const origin = req.headers.origin;
    if (origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return refuse(403);
    if (!protocolToken(req)) return refuse(401);
    wss.handleUpgrade(req, sock, head, (ws) => {
      const win = byKey.get(url.searchParams.get("key") ?? "");
      if (!win || win.isDestroyed()) {
        // A restarted server: the shim reloads and says hello again.
        ws.close(4004, "Unknown window");
        return;
      }
      win.attach(ws);
      host.changed(win);
      let alive = true;
      ws.on("pong", () => (alive = true));
      const beat = setInterval(() => {
        // No answer to the last ping: a half-open socket (a laptop that slept, a
        // NAT that forgot the connection). Drop it, so the window goes dormant
        // and stops collecting pushes nobody will read.
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, heartbeatMs);
      beat.unref();
      ws.on("message", (data) => {
        let m: WireMessage;
        try {
          m = decode(String(data)) as WireMessage;
        } catch {
          return;
        }
        if (m.t === "send") {
          try {
            host.send(win, m.ch, m.a);
          } catch {
            /* a throwing listener is main's to log; the socket stays up */
          }
        } else if (m.t === "invoke") {
          // Electron's own shapes, so the renderer's error handling cannot tell the difference.
          Promise.resolve()
            .then(() => host.invoke(win, m.ch, m.a))
            .then(
              (v) => replyOn(ws, { t: "reply", id: m.id, ok: true, v }),
              (err: unknown) => replyOn(ws, { t: "reply", id: m.id, ok: false, e: String(err) }),
            );
        }
      });
      ws.on("close", () => {
        clearInterval(beat);
        if (win.detach(ws)) host.changed(win);
      });
      ws.on("error", () => ws.terminate());
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const addr = server.address();
  if (addr && typeof addr === "object") port = addr.port;
  const shown = opts.host === "0.0.0.0" || opts.host === "::" ? "127.0.0.1" : opts.host.includes(":") ? `[${opts.host}]` : opts.host;
  const base = `http://${shown}:${port}`;

  return {
    url: `${base}/`,
    loginUrl: `${base}/#token=${token}`,
    token,
    windows: () => [...byKey.values()],
    close: async () => {
      // Each close deletes its own entry; a Map iterates safely past that.
      for (const w of byKey.values()) w.close();
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
