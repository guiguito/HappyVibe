import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { decode, encode } from "../src/main/web/codec";
import { startWebServer, TOKEN_HEADER, WS_PROTOCOL, type WebHost, type WebServer } from "../src/main/web/server";
import type { WebWindow } from "../src/main/web/webWindow";

/**
 * Web mode's server, over real sockets. Key-free, platform-free.
 *
 * Its security is the part that must not regress quietly: it is a door into an
 * agent that runs commands, so no hello, no sync and no socket without the
 * token — presented as a header or a subprotocol, never a cookie (which every
 * port of the host would receive) — and nothing that acts from another origin
 * or under another Host.
 */

const TOKEN = "test-token-0123456789abcdefgh";

let dir: string;
let server: WebServer;
let port: number;
let opened: WebWindow[];
let changed: number;
let calls: Array<[string, number, string, unknown[]]>;
let invokeGate: Promise<void> | null;

function host(): WebHost {
  return {
    open: (w) => void opened.push(w),
    changed: () => void changed++,
    sync: (w, ch, a) => {
      calls.push(["sync", w.id, ch, a]);
      return { windowId: w.id, bytes: new Uint8Array([1, 2, 3]) };
    },
    invoke: async (w, ch, a) => {
      calls.push(["invoke", w.id, ch, a]);
      if (ch === "hv:slow" && invokeGate) await invokeGate;
      if (ch === "hv:fail") throw new Error("nope");
      if (ch === "hv:unsendable") return { big: 10n };
      return { echo: a };
    },
    send: (w, ch, a) => void calls.push(["send", w.id, ch, a]),
  };
}

async function start(heartbeatMs?: number): Promise<void> {
  server = await startWebServer({ host: "127.0.0.1", port: 0, token: TOKEN, rendererDir: dir, platform: "linux", heartbeatMs }, host());
  port = Number(new URL(server.url).port);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hv-web-"));
  writeFileSync(path.join(dir, "web.html"), "<!doctype html><title>web</title>");
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>desktop</title>");
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "assets", "app-abc.js"), "console.log(1)");
  writeFileSync(path.join(dir, ".secret"), "no");
  writeFileSync(path.join(path.dirname(dir), `${path.basename(dir)}-outside.txt`), "outside");
  opened = [];
  changed = 0;
  calls = [];
  invokeGate = null;
});

afterEach(async () => {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(path.join(path.dirname(dir), `${path.basename(dir)}-outside.txt`), { force: true });
});

function http(
  pathname: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: pathname, method: opts.method ?? "GET", headers: { Host: `127.0.0.1:${port}`, ...opts.headers } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

const post = (pathname: string, body: Record<string, unknown>, headers: Record<string, string> = { [TOKEN_HEADER]: TOKEN }) =>
  http(pathname, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: encode(body) });

async function hello(key: string | null = null): Promise<string> {
  const r = await post("/hv/hello", { key });
  expect(r.status).toBe(200);
  const v = (decode(r.body) as { v: { key: string; platform: string } }).v;
  expect(v.platform).toBe("linux");
  return v.key;
}

function socket(key: string, protocols: string[] = [WS_PROTOCOL, TOKEN], origin = `http://127.0.0.1:${port}`): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/hv/ws?key=${encodeURIComponent(key)}`, protocols, { origin });
}

const opened$ = (ws: WebSocket) => new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
const closed$ = (ws: WebSocket) => new Promise<number>((res) => ws.once("close", (code) => res(code)));
const message$ = (ws: WebSocket) => new Promise<Record<string, unknown>>((res) => ws.once("message", (d) => res(decode(String(d)) as Record<string, unknown>)));
const refused$ = (ws: WebSocket) =>
  new Promise<number>((res) => {
    ws.on("error", () => {});
    ws.once("unexpected-response", (req, r) => {
      res(r.statusCode ?? 0);
      req.destroy();
    });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("web server — the door", () => {
  it("serves the page and its assets to anyone (they are the public app bundle), uncached and never framed", async () => {
    await start();
    const r = await http("/");
    expect(r.status).toBe(200);
    expect(r.body).toContain("<title>web</title>");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(r.headers["set-cookie"]).toBeUndefined();
    const js = await http("/assets/app-abc.js");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/^text\/javascript/);
  });

  it("hello and sync need the token in the header — not a cookie, not a query string", async () => {
    await start();
    expect((await post("/hv/hello", {}, {})).status).toBe(401);
    expect((await post("/hv/hello", {}, { [TOKEN_HEADER]: "wrong-token-0123456789abcd" })).status).toBe(401);
    expect((await post("/hv/hello", {}, { Cookie: `hv_serve=${TOKEN}` })).status).toBe(401);
    expect((await http(`/hv/hello?token=${TOKEN}`, { method: "POST", body: "{}" })).status).toBe(401);
    expect(opened).toHaveLength(0);
  });

  it("a request that acts must come from this page: another origin is refused even with the token", async () => {
    await start();
    expect((await post("/hv/hello", {}, { [TOKEN_HEADER]: TOKEN, Origin: "http://localhost:8080" })).status).toBe(403);
    expect((await post("/hv/hello", {}, { [TOKEN_HEADER]: TOKEN, "Sec-Fetch-Site": "same-site" })).status).toBe(403);
    expect((await post("/hv/hello", {}, { [TOKEN_HEADER]: TOKEN, Origin: `http://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" })).status).toBe(200);
  });

  it("refuses a Host that is not this server (DNS rebinding)", async () => {
    await start();
    expect((await http("/", { headers: { Host: `evil.example:${port}` } })).status).toBe(403);
    expect((await http("/", { headers: { Host: "127.0.0.1:1" } })).status).toBe(403);
    expect((await http("/", { headers: { Host: `localhost:${port}` } })).status).toBe(200);
  });

  it("serves only the renderer build: no way out, no dotfile", async () => {
    await start();
    const out = `${path.basename(dir)}-outside.txt`;
    for (const p of [`/../${out}`, `/%2e%2e/${out}`, `/assets/..%2f..%2f${out}`, "/.secret"]) {
      expect((await http(p)).status, p).toBe(404);
    }
  });

  it("the printed link carries the token in its fragment, which never reaches a server", async () => {
    await start();
    expect(server.loginUrl).toBe(`http://127.0.0.1:${port}/#token=${TOKEN}`);
    expect(server.url).toBe(`http://127.0.0.1:${port}/`);
  });
});

describe("web server — windows and IPC", () => {
  it("a hello opens a window; the same key comes back to it; an unknown key opens another", async () => {
    await start();
    const k1 = await hello();
    expect(opened).toHaveLength(1);
    expect(await hello(k1)).toBe(k1);
    expect(opened).toHaveLength(1);
    const k2 = await hello("not-a-key");
    expect(k2).not.toBe(k1);
    expect(opened).toHaveLength(2);
  });

  it("sendSync reaches the host as that window and returns its value, bytes intact", async () => {
    await start();
    const key = await hello();
    const r = await post("/hv/sync", { key, ch: "hv:window-boot", a: [] });
    const v = (decode(r.body) as { v: { windowId: number; bytes: Uint8Array } }).v;
    expect(v.windowId).toBe(opened[0].id);
    expect([...v.bytes]).toEqual([1, 2, 3]);
    expect((await post("/hv/sync", { key: "nope", ch: "x", a: [] })).status).toBe(404);
  });

  it("refuses a socket without the token, with the token as a cookie, or from another origin", async () => {
    await start();
    const key = await hello();
    expect(await refused$(socket(key, [WS_PROTOCOL]))).toBe(401);
    expect(await refused$(socket(key, [WS_PROTOCOL, "wrong-token-0123456789abcd"]))).toBe(401);
    expect(await refused$(socket(key, [WS_PROTOCOL, TOKEN], "http://evil.example"))).toBe(403);
    expect(await refused$(socket(key, [WS_PROTOCOL, TOKEN], `http://localhost:${port + 1}`))).toBe(403);
  });

  it("answers with the hv subprotocol only — the token is never echoed back", async () => {
    await start();
    const ws = socket(await hello());
    await opened$(ws);
    expect(ws.protocol).toBe(WS_PROTOCOL);
    ws.close();
  });

  it("invoke answers in Electron's shapes; send and push both get through", async () => {
    await start();
    const key = await hello();
    const ws = socket(key);
    await opened$(ws);
    let m = message$(ws);
    ws.send(encode({ t: "invoke", id: 1, ch: "hv:echo", a: [1, new Uint8Array([9])] }));
    const ok = await m;
    expect(ok).toMatchObject({ t: "reply", id: 1, ok: true });
    expect((ok.v as { echo: unknown[] }).echo[0]).toBe(1);
    m = message$(ws);
    ws.send(encode({ t: "invoke", id: 2, ch: "hv:fail", a: [] }));
    expect(await m).toEqual({ t: "reply", id: 2, ok: false, e: "Error: nope" });
    ws.send(encode({ t: "send", ch: "hv:touch", a: ["s1"] }));
    await sleep(30);
    expect(calls.find((c) => c[0] === "send")).toEqual(["send", opened[0].id, "hv:touch", ["s1"]]);
    m = message$(ws);
    opened[0].webContents.send("hv:pushed", { n: 1 });
    expect(await m).toEqual({ t: "push", ch: "hv:pushed", a: [{ n: 1 }] });
    ws.close();
  });

  it("an answer the wire cannot carry still answers — as an error, never a silence", async () => {
    await start();
    const ws = socket(await hello());
    await opened$(ws);
    const m = message$(ws);
    ws.send(encode({ t: "invoke", id: 5, ch: "hv:unsendable", a: [] }));
    expect(await m).toMatchObject({ t: "reply", id: 5, ok: false });
    ws.close();
  });

  it("a late answer goes to the socket that asked, never to the page that replaced it", async () => {
    await start();
    const key = await hello();
    const a = socket(key);
    await opened$(a);
    let release: () => void = () => {};
    invokeGate = new Promise((r) => (release = r));
    a.send(encode({ t: "invoke", id: 1, ch: "hv:slow", a: [] }));
    await sleep(30);
    // The reload: a new page on the same window, whose own invoke ids restart at 1.
    const aClosed = closed$(a);
    const b = socket(key);
    await opened$(b);
    expect(await aClosed).toBe(4001);
    const got: unknown[] = [];
    b.on("message", (d) => got.push(decode(String(d))));
    release();
    await sleep(60);
    expect(got).toEqual([]);
    b.close();
  });

  it("the same window in a second tab: the newest wins, the old one is told why", async () => {
    await start();
    const key = await hello();
    const a = socket(key);
    await opened$(a);
    const aClosed = closed$(a);
    const b = socket(key);
    await opened$(b);
    expect(await aClosed).toBe(4001);
    b.close();
  });

  it("a key the server does not know is closed with 4004, so the tab reloads and says hello again", async () => {
    await start();
    expect(await closed$(socket("unknown"))).toBe(4004);
  });

  it("stopping the server tells each tab so (4010) — not 4004, on which a tab reloads at once into a server that is gone", async () => {
    await start();
    const ws = socket(await hello());
    await opened$(ws);
    const code = closed$(ws);
    await server!.close();
    expect(await code).toBe(4010);
  });

  it("a tab going away never closes its window: it goes dormant, and the next new tab picks it back up", async () => {
    await start();
    const key = await hello();
    const win = opened[0];
    let closed = 0;
    win.on("closed", () => closed++);
    const a = socket(key);
    await opened$(a);
    expect(win.isDormant()).toBe(false);
    a.close();
    await sleep(60);
    expect(win.isDormant()).toBe(true);
    expect(win.isDestroyed()).toBe(false);
    expect(closed).toBe(0);
    expect(changed).toBe(2); // attached, then went dormant
    // A brand-new tab (no key, or a key from a restarted server) gets that window back.
    expect(await hello(null)).toBe(key);
    expect(opened).toHaveLength(1);
    // Claimed: the next new tab gets a window of its own.
    expect(await hello(null)).not.toBe(key);
    expect(opened).toHaveLength(2);
  });

  it("a window that never had a tab is not up for grabs", async () => {
    await start();
    const k1 = await hello();
    const k2 = await hello();
    expect(k2).not.toBe(k1);
  });

  it("a socket that stops answering pings is dropped, and its window goes dormant", async () => {
    await start(50);
    const key = await hello();
    const ws = socket(key);
    await opened$(ws);
    // A half-open connection: the client stops answering pings.
    (ws as unknown as { pong: () => void }).pong = () => {};
    // ws answers pings itself; mute that by pausing the underlying socket.
    (ws as unknown as { _socket: { pause(): void } })._socket.pause();
    await sleep(250);
    expect(opened[0].isDormant()).toBe(true);
    ws.terminate();
  });
});
