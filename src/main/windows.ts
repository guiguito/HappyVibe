/**
 * §7 round 23 — the set of app windows.
 *
 * The app was single-window BY CONSTRUCTION: `createWindow()` was called once
 * and its result handed to `registerIpc(win)`, which closed over that one
 * `BrowserWindow` so that every renderer push in the app went through a single
 * `send()` bound to its `webContents`. This is the thing that replaces it, and
 * the whole point is that the ~6,000 lines behind that one call site stop being
 * bound to a single window without any of them changing.
 *
 * Electron-free on purpose (the `spawn.ts` precedent): `WinLike` is structural,
 * so the suite drives this with fakes and index.ts hands it real windows.
 *
 * The per-window RECORD is OPAQUE. The renderer builds it (its tabs, its
 * chrome) and main only stores, hands back and persists it — the same division
 * of labour `getLayout`/`setLayout` already had, where main never learns what a
 * tab is. HOLDINGS are the one thing main does read, and even those arrive as
 * plain id lists the renderer declares, never parsed out of tab ids here.
 */

export interface WinLike {
  id: number;
  isDestroyed(): boolean;
  webContents: { id: number; isDestroyed(): boolean; send(channel: string, payload?: unknown): void };
  on(event: "closed", cb: () => void): unknown;
}

/** What a window currently shows — declared by its renderer on every layout change. */
export interface Holdings {
  sessions: string[];
  terminals: string[];
  browsers: string[];
}

const NO_HOLDS: Holdings = { sessions: [], terminals: [], browsers: [] };

export class WindowRegistry<W extends WinLike = WinLike> {
  private readonly wins: W[] = [];
  private readonly recs = new Map<number, unknown>();
  private readonly held = new Map<number, Holdings>();
  private onClosed: ((id: number, record: unknown, holds: Holdings) => void) | null = null;

  /**
   * Late-bound on purpose: index.ts creates the registry and its windows before
   * registerIpc exists, and the close hook needs the terminal and browser
   * managers that live inside it.
   */
  setOnClosed(cb: (id: number, record: unknown, holds: Holdings) => void): void {
    this.onClosed = cb;
  }

  add(win: W, record: unknown): W {
    this.wins.push(win);
    this.recs.set(win.id, record);
    win.on("closed", () => {
      const i = this.wins.indexOf(win);
      if (i >= 0) this.wins.splice(i, 1);
      const rec = this.recs.get(win.id);
      const holds = this.held.get(win.id) ?? NO_HOLDS;
      this.recs.delete(win.id);
      this.held.delete(win.id);
      this.onClosed?.(win.id, rec, holds);
    });
    return win;
  }

  /**
   * Live windows, creation order. Filtered on `isDestroyed` rather than trusting
   * the `closed` event alone: a destroyed window whose event has not been
   * delivered yet is still in the array, and sending to it throws.
   */
  all(): W[] {
    return this.wins.filter((w) => !w.isDestroyed());
  }

  /** The oldest live window. Moves on when it closes — nothing is "the" window. */
  primary(): W | null {
    return this.all()[0] ?? null;
  }

  byId(id: number): W | null {
    return this.all().find((w) => w.id === id) ?? null;
  }

  /** `BrowserWindow.fromWebContents` without importing electron. */
  bySender(wc: { id: number }): W | null {
    return this.all().find((w) => w.webContents.id === wc.id) ?? null;
  }

  broadcast(channel: string, payload?: unknown): void {
    for (const w of this.all()) {
      if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload);
    }
  }

  record(id: number): unknown {
    return this.recs.get(id);
  }

  /** A closed or unknown window is a no-op — never re-created by a late write. */
  setRecord(id: number, r: unknown): void {
    if (this.recs.has(id)) this.recs.set(id, r);
  }

  /** Live windows' records, creation order — what gets persisted, primary first. */
  records(): unknown[] {
    return this.all().map((w) => this.recs.get(w.id));
  }

  holds(id: number): Holdings {
    return this.held.get(id) ?? NO_HOLDS;
  }

  setHolds(id: number, h: Holdings): void {
    this.held.set(id, h);
  }

  /** The window showing this session's chat tab, or null. */
  holderOf(sessionId: string): number | null {
    for (const w of this.all()) {
      if (this.held.get(w.id)?.sessions.includes(sessionId)) return w.id;
    }
    return null;
  }
}
