/**
 * Web mode — a browser tab, as the window registry sees it (windows.ts `WinLike`).
 *
 * It lives in the same registry as the BrowserWindows, so every broadcast, every
 * `bySender` lookup and every per-window record already covers it.
 *
 * A tab going away is NOT a window closing. A closed tab, a laptop that slept,
 * a dropped socket or a tab the browser discarded to save memory all look the
 * same from here, and closing the window would end its terminals and browser
 * panes — work the desktop app never loses without an explicit close. So the
 * window goes DORMANT instead: out of the registry's live set (no pushes, not a
 * move target, not where a prompt is routed) with its record, its tabs and its
 * running work intact, until a tab picks it back up. A window only closes when
 * the server does.
 *
 * Electron-free (vitest-importable), and free of `ws` at runtime: the socket is
 * structural, so ipc.ts can `instanceof` this without pulling the server in.
 */

import { randomBytes } from "node:crypto";
import type { BrowserWindow } from "electron";
import { encode } from "./codec";

/** The two calls made on a socket. */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Window ids far above Electron's own counters, so `bySender` can never confuse the two. */
const ID_BASE = 1_000_000;
let nextId = ID_BASE;

export class WebWindow {
  readonly id: number;
  /** What a tab presents to come back to this window after a reload (its sessionStorage). */
  readonly key: string;
  readonly webContents: {
    id: number;
    isDestroyed(): boolean;
    send(channel: string, ...args: unknown[]): void;
  };
  /** When the last tab left; 0 while one is connected. A new tab picks the most recent. */
  dormantSince = 0;
  private socket: WebSocketLike | null = null;
  private closed = false;
  private readonly closedListeners: Array<() => void> = [];

  constructor() {
    this.id = nextId++;
    this.key = randomBytes(18).toString("base64url");
    this.webContents = {
      id: this.id,
      isDestroyed: () => this.closed,
      send: (channel: string, ...args: unknown[]) => this.push(channel, args),
    };
  }

  on(event: "closed", cb: () => void): this {
    if (event === "closed") this.closedListeners.push(cb);
    return this;
  }

  isDestroyed(): boolean {
    return this.closed;
  }

  /** No tab connected: kept, but out of the registry's live set (windows.ts). */
  isDormant(): boolean {
    return !this.closed && this.socket === null;
  }

  // The BrowserWindow calls main makes on "a window" (a notification click, the
  // attention plan). A page cannot raise or badge its own tab, so they do nothing.
  show(): void {}
  focus(): void {}
  flashFrame(_flag: boolean): void {}
  setOverlayIcon(_overlay: unknown, _description: string): void {}

  /**
   * `webContents.send`. Nothing is queued while no tab is connected: a tab that
   * comes back reloads, and a fresh renderer re-reads its state (pending
   * prompts included) exactly as a renderer reload does.
   */
  private push(channel: string, args: unknown[]): void {
    if (this.closed || !this.socket) return;
    this.socket.send(encode({ t: "push", ch: channel, a: args }));
  }

  attach(socket: WebSocketLike): void {
    const previous = this.socket;
    this.socket = socket;
    this.dormantSince = 0;
    // The same window opened in a second tab (a duplicated tab copies its
    // sessionStorage, and with it the key): the newest tab wins, and the old
    // one is told why rather than silently going deaf.
    if (previous && previous !== socket) previous.close(4001, "This window was opened in another tab.");
  }

  /** True when this was the connected socket — the window went dormant. */
  detach(socket: WebSocketLike): boolean {
    if (this.socket !== socket) return false;
    this.socket = null;
    this.dormantSince = Date.now();
    return true;
  }

  /** The server is stopping: the one way a web window closes. */
  close(): void {
    if (this.closed) return;
    // Destroyed BEFORE the listeners run, as a BrowserWindow is when its
    // `closed` fires: the window-list broadcast they trigger must not name it.
    this.closed = true;
    // Not 4004: the page reloads at once on that, into a server that is going.
    // 4010 tells it to wait for HappyVibe to be back.
    this.socket?.close(4010, "HappyVibe stopped.");
    this.socket = null;
    for (const cb of this.closedListeners) cb();
  }
}

/** Every kind of window the registry holds: the app's own, and browser tabs. */
export type AppWindow = BrowserWindow | WebWindow;
