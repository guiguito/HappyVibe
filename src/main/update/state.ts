/**
 * PRD §38 — the updater's decisions, pure and IMPORT-FREE.
 *
 * Import-free is load-bearing, not tidiness: the renderer imports these types,
 * so one `import fs` here would put `node:fs` in the browser bundle — it
 * typechecks, runs in dev, and fails `npm run build` (the schedules.ts trap).
 * Everything Electron-shaped lives in ./index.ts, which ipc.ts never imports.
 */

/** Where a `.deb` user (and anyone clicking Download) is sent. */
export const RELEASES_URL = "https://github.com/guiguito/HappyVibe/releases/latest";

/**
 * `auto`: electron-updater replaces the app in place (macOS, Windows, AppImage).
 * `manual`: it cannot (a `.deb`), so the row links to the release page instead.
 * `disabled`: a dev build — never checks, never installs over itself.
 */
export type UpdateMode = "disabled" | "auto" | "manual";

export type UpdatePhase =
  | { k: "idle"; upToDate?: true } // upToDate: the last MANUAL check found nothing
  | { k: "checking"; manual: boolean }
  | { k: "downloading"; version: string; percent: number }
  | { k: "available"; version: string } // found, not downloaded: auto off, or manual mode
  | { k: "ready"; version: string } // downloaded; a restart installs it
  | { k: "error"; message: string; manual: boolean };

export interface UpdateGate {
  /** Titles of what a restart would interrupt. [] = safe now. */
  blockedBy: string[];
  terminalsOpen: boolean;
  /** The user clicked Restart while blocked; it fires at the next idle moment. */
  armed: boolean;
}

export interface UpdateState {
  mode: UpdateMode;
  auto: boolean;
  lastCheckedAt: number | null;
  phase: UpdatePhase;
  gate: UpdateGate;
}

export type UpdateEvent =
  | { t: "checking"; manual: boolean }
  | { t: "available"; version: string }
  | { t: "none"; at: number }
  | { t: "progress"; percent: number }
  | { t: "downloaded"; version: string; at: number }
  | { t: "error"; message: string; at: number }
  | { t: "auto"; on: boolean }
  | { t: "gate"; gate: UpdateGate };

export function initialState(mode: UpdateMode, auto: boolean): UpdateState {
  return { mode, auto, lastCheckedAt: null, phase: { k: "idle" }, gate: { blockedBy: [], terminalsOpen: false, armed: false } };
}

export function updateMode(p: { packaged: boolean; platform: string; appImage?: string }): UpdateMode {
  if (!p.packaged) return "disabled";
  if (p.platform === "linux" && !p.appImage) return "manual";
  return "auto";
}

export function reduce(s: UpdateState, e: UpdateEvent): UpdateState {
  // A downloaded update is the one thing a later check must never demote: the
  // bytes are on disk and install-on-quit will use them regardless.
  const ready = s.phase.k === "ready";
  switch (e.t) {
    case "checking":
      return ready ? s : { ...s, phase: { k: "checking", manual: e.manual } };
    case "available":
      if (ready) return s;
      return {
        ...s,
        phase: s.mode === "auto" && s.auto ? { k: "downloading", version: e.version, percent: 0 } : { k: "available", version: e.version },
      };
    case "progress":
      return s.phase.k === "downloading" ? { ...s, phase: { ...s.phase, percent: e.percent } } : s;
    case "downloaded":
      return { ...s, lastCheckedAt: e.at, phase: { k: "ready", version: e.version } };
    case "none": {
      if (ready) return { ...s, lastCheckedAt: e.at };
      const manual = s.phase.k === "checking" && s.phase.manual;
      return { ...s, lastCheckedAt: e.at, phase: manual ? { k: "idle", upToDate: true } : { k: "idle" } };
    }
    case "error": {
      if (ready) return { ...s, lastCheckedAt: e.at };
      const manual = s.phase.k === "checking" && s.phase.manual;
      return { ...s, lastCheckedAt: e.at, phase: { k: "error", message: e.message, manual } };
    }
    case "auto":
      return { ...s, auto: e.on };
    case "gate":
      return { ...s, gate: e.gate };
  }
}

/**
 * What a restart right now would interrupt. Busy sessions (a turn, a queued
 * prompt, a sub-agent, an async delegation — `activity.isIdle`) AND any retained
 * blocking prompt, even in a session that reads idle: prompts never time out,
 * and a quit would answer one with silence. The schedule-with-every-window-closed
 * case is exactly the one where nobody is looking.
 */
export function installGate(p: {
  liveSessions: Array<{ id: string; title: string }>;
  isIdle: (id: string) => boolean;
  pendingSessionIds: string[];
  terminalsOpen: number;
}): { blockedBy: string[]; terminalsOpen: boolean } {
  const titles = new Map(p.liveSessions.map((x) => [x.id, x.title]));
  const ids = new Set<string>();
  for (const x of p.liveSessions) if (!p.isIdle(x.id)) ids.add(x.id);
  for (const id of p.pendingSessionIds) ids.add(id);
  return {
    blockedBy: [...ids].map((id) => titles.get(id) || "a session waiting for you"),
    terminalsOpen: p.terminalsOpen > 0,
  };
}
