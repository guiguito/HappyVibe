/**
 * Web mode — the `electron` module, as the preload sees it in a browser tab.
 *
 * The web build compiles src/preload/index.ts a SECOND time with `electron`
 * resolved here (electron.vite.config.ts, `webPreload`), so the browser gets
 * the very same `window.hv` the desktop renderer has — no second copy of its
 * ~300 methods to drift. Everything below is the four calls that preload makes
 * (`invoke`, `send`, `on`, the boot `sendSync`), carried to main by
 * src/main/web/server.ts:
 *
 *   - `sendSync` is a synchronous XHR. Only the boot uses it, and the boot is
 *     synchronous on purpose (see the preload) — a deprecated API, used for
 *     exactly the one thing it is still the only way to do.
 *   - everything else rides ONE WebSocket, so a terminal's keystrokes arrive in
 *     the order they were typed (separate HTTP requests would not promise that).
 *
 * The access token arrives once in the link's fragment and is kept in this
 * origin's localStorage (port included — a cookie would go to every port of
 * the host). The tab keeps its window across a reload through a key in
 * sessionStorage.
 */

import { decode, encode, type WireMessage } from "../../main/web/codec";

type Listener = (event: unknown, ...args: unknown[]) => void;

const KEY = "hv-web-key";
const TOKEN = "hv-web-token";
/** server.ts's TOKEN_HEADER and WS_PROTOCOL — not imported: that module is Node's. */
const TOKEN_HEADER = "X-HV-Token";
const WS_PROTOCOL = "hv";

/** Set when the page is leaving on purpose, so the close guard does not ask. */
let leaving = false;

function reload(): void {
  leaving = true;
  location.reload();
}

function store(area: "local" | "session", key: string, value?: string | null): string | null {
  try {
    const s = area === "local" ? localStorage : sessionStorage;
    if (value === undefined) return s.getItem(key);
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* no storage (a locked-down browser): the link has to be opened again */
  }
  return null;
}

const INK = "#33251a";
const SOFT = "#8d7a63";
const CARD = "#fffcf5";
const PAPER = "#faf4e8";
const TANGERINE = "#ee5a24";

/** The whole page, when there is no app to show: what happened and what to do. */
function stop(title: string, message: string): never {
  document.title = "HappyVibe";
  const root = document.getElementById("root") ?? document.body;
  const box = document.createElement("div");
  box.style.cssText = `max-width:34rem;margin:18vh auto;padding:0 1rem;font:500 16px/1.5 system-ui,sans-serif;color:${INK};text-align:center`;
  const h = document.createElement("h1");
  h.textContent = title;
  h.style.cssText = "font:800 22px/1.3 system-ui,sans-serif;margin:0 0 .5rem";
  const p = document.createElement("p");
  p.textContent = message;
  p.style.cssText = `margin:0;color:${SOFT}`;
  box.append(h, p);
  root.replaceChildren(box);
  document.body.style.background = PAPER;
  // The link pasted into THIS tab changes only the fragment, which reloads nothing.
  window.addEventListener("hashchange", () => location.reload());
  // Stops the module graph: the app must not start without a server to talk to.
  throw new Error(`${title} ${message}`);
}

const NEED_LINK: [string, string] = [
  "Open HappyVibe with its link",
  "HappyVibe printed a link in its terminal when it started — it carries the access token. Open that link in this browser.",
];
/** The token this page kept was refused: the server has started again since, with a new one. */
const RESTARTED: [string, string] = [
  "HappyVibe started again, with a new link",
  "It printed the new link in its terminal. Open that one — this page will pick up your windows and sessions where they are.",
];

// The token, from the link the server printed: read once, then out of the address bar and the history.
const fromLink = /(?:^|&)token=([A-Za-z0-9_-]+)/.exec(location.hash.slice(1))?.[1];
if (fromLink) {
  store("local", TOKEN, fromLink);
  history.replaceState(null, "", location.pathname + location.search);
}
const token = store("local", TOKEN) ?? fromLink ?? stop(...NEED_LINK);

/** A synchronous POST to the server; its JSON answer's `v`. */
function post(path: string, body: Record<string, unknown>): unknown {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", path, false);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader(TOKEN_HEADER, token);
  xhr.send(encode(body));
  if (xhr.status === 401) {
    // A server started since with another token: this one opens nothing.
    store("local", TOKEN, null);
    stop(...(fromLink ? NEED_LINK : RESTARTED));
  }
  if (xhr.status !== 200) throw new Error(`HappyVibe server: ${xhr.status} ${xhr.responseText}`);
  return (decode(xhr.responseText) as { v: unknown }).v;
}

// ---- the status line ------------------------------------------------------

let veil: { root: HTMLDivElement; title: HTMLElement; body: HTMLElement; detail: HTMLElement; button: HTMLButtonElement } | null = null;

/**
 * The page can't reach HappyVibe: a card over the app, which is greyed out
 * behind it — anything typed or clicked now would go nowhere. It says what is
 * wrong, since when, and the last thing the browser reported, and offers to try
 * at once. `null` takes it away.
 */
function notice(n: { title: string; body: string; detail?: string; action: string; onAction: () => void } | null): void {
  if (n === null) {
    veil?.root.remove();
    veil = null;
    return;
  }
  if (!veil) {
    const root = document.createElement("div");
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-live", "polite");
    root.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(51,37,26,.28);padding:1rem";
    const card = document.createElement("div");
    card.style.cssText = `max-width:30rem;background:${CARD};color:${INK};border:2px solid #cbb693;border-radius:16px;box-shadow:4px 4px 0 #cbb693;padding:20px 22px;font:500 14px/1.5 system-ui,sans-serif`;
    const title = document.createElement("div");
    title.style.cssText = "font-weight:800;font-size:17px;margin-bottom:6px";
    const body = document.createElement("div");
    const detail = document.createElement("div");
    detail.style.cssText = `margin-top:8px;font:12px/1.4 ui-monospace,monospace;color:${SOFT};word-break:break-word`;
    const button = document.createElement("button");
    button.type = "button";
    button.style.cssText = `margin-top:14px;padding:6px 14px;border-radius:10px;border:2px solid ${INK};background:${TANGERINE};color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer`;
    card.append(title, body, detail, button);
    root.append(card);
    document.body.appendChild(root);
    veil = { root, title, body, detail, button };
  }
  veil.title.textContent = n.title;
  veil.body.textContent = n.body;
  veil.detail.textContent = n.detail ?? "";
  veil.button.textContent = n.action;
  veil.button.onclick = n.onAction;
}

// ---- the socket -----------------------------------------------------------

const listeners = new Map<string, Set<Listener>>();
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; ch: string }>();
const queue: string[] = [];
let socket: WebSocket | null = null;
let nextId = 1;

function transmit(m: WireMessage): void {
  const text = encode(m);
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(text);
  else queue.push(text);
}

function deliver(m: WireMessage): void {
  if (m.t === "reply") {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    // Electron's own wording, so a caller matching on it sees no difference.
    if (m.ok) p.resolve(m.v);
    else p.reject(new Error(`Error invoking remote method '${p.ch}': ${m.e}`));
  } else if (m.t === "push") {
    // oxlint-disable-next-line unicorn/no-useless-spread -- a snapshot, as EventEmitter takes: a listener added during this push waits for the next one
    for (const l of [...(listeners.get(m.ch) ?? [])]) {
      try {
        l({ sender: ipcRenderer }, ...m.a);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

/**
 * The server is out of reach. Pushes sent meanwhile are gone — a stream's end,
 * a tool card, a permission prompt — so this page never carries on as if
 * nothing happened: once the server answers again, it RELOADS, and the new
 * renderer reads its state (pending prompts included) the way a reload of the
 * desktop window does. The window waited, dormant, with its work intact.
 */
const LOST = "hv-web-lost";

/**
 * Since when this tab has been cut off, the next wait's step, what the browser
 * last said, and whether the server answered meanwhile. Kept in the tab's
 * sessionStorage, because reconnecting IS a reload: the count goes on across
 * it, and a server that answers while its socket keeps failing shows as that —
 * with a growing pause — instead of a reload every quarter of a second.
 */
type Lost = { since: number; step: number; problem: string; answered: boolean };
let lost: Lost | null = null;
let nextTry: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

function keepLost(): void {
  store("session", LOST, lost && JSON.stringify(lost));
}

function since(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** The card, from where things stand. Redrawn every second, for the time. */
function showLost(): void {
  if (!lost) return;
  const elapsed = Date.now() - lost.since;
  const retry = { action: "Retry now", onAction: probe, detail: lost.problem };
  if (lost.answered) {
    notice({
      ...retry,
      title: `HappyVibe answers, but this page can't stay connected (${since(elapsed)})`,
      body: `The server at ${location.host} is up, yet the live connection to it keeps closing. Something between the two may be blocking WebSockets — a proxy, a VPN, or a browser extension. This page keeps trying.`,
    });
  } else if (elapsed < 8000) {
    notice({
      ...retry,
      title: "Reconnecting to HappyVibe…",
      body: "The connection dropped. Your sessions keep running in HappyVibe; this page picks them up again by itself as soon as it can reach it.",
    });
  } else {
    notice({
      ...retry,
      title: `HappyVibe isn't answering (${since(elapsed)})`,
      body: `Nothing answers at ${location.host}. Is HappyVibe still running in its terminal? If it stopped, start it again: this page reconnects by itself, and asks for the new link if it printed one.`,
    });
  }
}

/** Is the server there? Then reload — the reload's hello sorts out the rest. */
function probe(): void {
  if (!lost) return;
  if (nextTry) clearTimeout(nextTry);
  nextTry = null;
  const current = lost;
  // The page and its assets need no token, so a server that restarted with a NEW
  // one answers too: the reload's hello finds the kept token refused and says so
  // (RESTARTED) instead of waiting here.
  fetch("/", { method: "HEAD", cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      current.answered = true;
      current.step++;
      keepLost();
      reload();
    })
    .catch((err: unknown) => {
      current.answered = false;
      current.problem = `The browser says: ${err instanceof Error ? err.message : String(err)}.`;
      current.step++;
      keepLost();
      waitThenTry();
    });
}

function waitThenTry(): void {
  if (!lost) return;
  showLost();
  ticker ??= setInterval(showLost, 1000);
  nextTry = setTimeout(probe, Math.min(5000, 250 * 2 ** lost.step));
}

// Back from sleep, or the network is back: no need to wait for the next try.
window.addEventListener("online", probe);

let lostBefore: Lost | null = null;
try {
  lostBefore = JSON.parse(store("session", LOST) ?? "null") as Lost | null;
} catch {
  /* unreadable: start the count again */
}

/** Cut off: the card, and the count from where a previous reload left it. */
function cutOff(problem: string): void {
  lost = lostBefore ?? { since: Date.now(), step: 0, problem, answered: false };
  lostBefore = null;
  lost.problem = problem;
  keepLost();
  waitThenTry();
}

let hello: { key: string; platform: string };
try {
  hello = post("/hv/hello", { key: store("session", KEY) }) as typeof hello;
} catch (err) {
  // The reload found no server (it stopped again, or between two tries): an
  // empty page with the card, which keeps trying, rather than a crash screen.
  if (!(err instanceof DOMException)) throw err;
  (document.getElementById("root") ?? document.body).replaceChildren();
  document.body.style.background = PAPER;
  document.title = "HappyVibe";
  if (lostBefore) lostBefore.answered = false;
  cutOff(`The browser says: ${err.message}`);
  throw err;
}
const key = hello.key;
store("session", KEY, key);
// The preload reads `process.platform`; the web build points it here. It is the
// SERVER's platform, because the paths the renderer splits and joins are its.
(globalThis as { __hvPlatform?: string }).__hvPlatform = hello.platform;

function connect(): void {
  const s = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/hv/ws?key=${encodeURIComponent(key)}`,
    [WS_PROTOCOL, token],
  );
  socket = s;
  s.onopen = () => {
    lost = null;
    lostBefore = null;
    keepLost();
    for (const text of queue.splice(0)) s.send(text);
  };
  s.onmessage = (ev) => {
    try {
      deliver(decode(String(ev.data)) as WireMessage);
    } catch (err) {
      console.error(err);
    }
  };
  s.onclose = (ev) => {
    if (socket === s) socket = null;
    // What was in flight died with the socket; the reload re-asks what it needs.
    for (const p of pending.values()) {
      p.reject(new Error(`Error invoking remote method '${p.ch}': this page lost its connection to HappyVibe and reconnects by itself`));
    }
    pending.clear();
    if (leaving) return;
    if (ev.code === 4001) {
      notice({
        title: "This window is open in another tab",
        body: "A newer tab of this browser took this HappyVibe window. Nothing is lost: use it there, or bring it back here.",
        action: "Use it here",
        onAction: reload,
      });
      return;
    }
    // The server no longer knows this window (it restarted): a reload says hello again.
    if (ev.code === 4004) return reload();
    // HappyVibe was stopped: it said so on the way out. Wait for it to be back.
    if (ev.code === 4010) {
      if (lostBefore) lostBefore.answered = false;
      return cutOff("HappyVibe was stopped in its terminal.");
    }
    // A reload that came back to the same failure carries on from where it was.
    cutOff(
      ev.code === 1006
        ? "The connection dropped without a closing word (code 1006): HappyVibe stopped, or the network went."
        : `The connection closed (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ""}).`,
    );
  };
}

connect();

// ---- the module ------------------------------------------------------------

export const ipcRenderer = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, ch: channel });
      transmit({ t: "invoke", id, ch: channel, a: args });
    });
  },
  send(channel: string, ...args: unknown[]): void {
    transmit({ t: "send", ch: channel, a: args });
  },
  sendSync(channel: string, ...args: unknown[]): unknown {
    return post("/hv/sync", { key, ch: channel, a: args });
  },
  on(channel: string, listener: Listener): typeof ipcRenderer {
    let set = listeners.get(channel);
    if (!set) listeners.set(channel, (set = new Set()));
    set.add(listener);
    return ipcRenderer;
  },
  once(channel: string, listener: Listener): typeof ipcRenderer {
    const once: Listener = (e, ...a) => {
      ipcRenderer.off(channel, once);
      listener(e, ...a);
    };
    return ipcRenderer.on(channel, once);
  },
  off(channel: string, listener: Listener): typeof ipcRenderer {
    listeners.get(channel)?.delete(listener);
    return ipcRenderer;
  },
  removeListener(channel: string, listener: Listener): typeof ipcRenderer {
    return ipcRenderer.off(channel, listener);
  },
  removeAllListeners(channel?: string): typeof ipcRenderer {
    if (channel === undefined) listeners.clear();
    else listeners.delete(channel);
    return ipcRenderer;
  },
};

/**
 * The `window.hv` methods whose answer depends on WHERE the person is, not on
 * the machine main runs on:
 *
 *   - a web link opens in a new tab of this browser (a popup blocker can refuse
 *     one opened after a round trip — then the server opens it, as the desktop
 *     app would);
 *   - the microphone is this browser's to grant: it asks at getUserMedia, so
 *     main's OS-permission check (the server's microphone) does not apply.
 */
const pageSide = {
  openExternal(url: string): Promise<void> {
    if (/^https?:\/\//i.test(url)) {
      const w = window.open(url, "_blank");
      if (w) {
        w.opener = null;
        return Promise.resolve();
      }
    }
    return ipcRenderer.invoke("hv:open-external", url) as Promise<void>;
  },
  voiceMicStatus: (): Promise<string> => Promise.resolve("not-needed"),
  voiceAskMic: (): Promise<boolean> => Promise.resolve(true),
  voiceOpenMicSettings: (): Promise<void> => Promise.resolve(),
};

export const contextBridge = {
  exposeInMainWorld(name: string, api: Record<string, unknown>): void {
    (window as unknown as Record<string, unknown>)[name] = name === "hv" ? { ...api, ...pageSide } : api;
  },
};

/** A dropped file has no path in a browser; the callers already skip an empty one. */
export const webUtils = {
  getPathForFile: (_file: File): string => "",
};

// ---- what the desktop window does for the page -----------------------------

/** Lets the renderer leave out what only exists in the desktop app. */
Object.defineProperty(window, "hvWeb", { value: true });

/**
 * main's navigation guard (navGuard.ts), on this side: a web or mail link
 * opens in a new tab, and any other link — a relative one from a markdown
 * answer, say — would replace the app with a dead page, so it goes nowhere.
 * A download link (blob:, data:, or `download`) is left alone.
 */
document.addEventListener(
  "click",
  (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download")) return;
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#") || /^(blob|data):/i.test(a.href)) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(a.href) && new URL(a.href).origin !== location.origin) {
      window.open(a.href, "_blank", "noopener");
    }
  },
  true,
);

/**
 * The browser keeps ⌘W/Ctrl+W, and in the app that key closes a file tab — so
 * muscle memory closes the whole page. Ask first. Nothing is lost either way
 * (the window waits, dormant, and opening the address again picks it back up),
 * but the work in front of you disappears from view.
 */
window.addEventListener("beforeunload", (e) => {
  if (leaving) return;
  e.preventDefault();
  e.returnValue = "";
});
