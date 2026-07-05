import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Runs N concurrent Pi processes keyed by our sessionId (electron-free,
 * vitest-importable — the PiClient factory is injected).
 *
 * - Cap: 4 active default, 8 hard (S0.1). Exceeding it throws a clear error
 *   the UI surfaces; nothing is queued.
 * - Spawn stagger: simultaneous starts are spaced ~1s apart (S0.1 measured
 *   5x ready-latency contention at 8-at-once).
 * - Crash isolation: each child's exit only affects its own record; a
 *   "session-exit" event carries { sessionId, code, intentional }.
 * - PID tracking: live pids persisted to disk so a later app run can sweep
 *   orphans (verify command before kill).
 */

export const DEFAULT_CAP = 4;
export const HARD_CAP = 8;
export const SPAWN_STAGGER_MS = 1000;

/** Structural subset of PiClient the manager needs — lets tests inject fakes. */
export interface ManagedClient {
  start(): Promise<void>;
  stop(): void;
  readonly pid: number | undefined;
  on(event: "exit", cb: (info: { code: number | null }) => void): unknown;
}

export interface SessionExit {
  sessionId: string;
  code: number | null;
  intentional: boolean;
}

type PidFile = Record<string, string>; // pid -> sessionId

function readPids(file: string): PidFile {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as PidFile;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writePids(file: string, pids: PidFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(pids));
}

function defaultReadCmd(pid: number): string | null {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim() || null;
  } catch {
    return null; // process gone
  }
}

/**
 * Kill leftover pi processes from a previous app run. Only kills a pid when it
 * is BOTH in our pid file AND its current command looks like our Pi runtime —
 * pids get recycled, never kill blind. Returns the pids killed.
 */
export function sweepOrphans(
  pidFile: string,
  readCmd: (pid: number) => string | null = defaultReadCmd,
  kill: (pid: number) => void = (pid) => process.kill(pid, "SIGTERM")
): number[] {
  const killed: number[] = [];
  for (const key of Object.keys(readPids(pidFile))) {
    const pid = Number(key);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const cmd = readCmd(pid);
    if (cmd?.includes("pi-coding-agent")) {
      try {
        kill(pid);
        killed.push(pid);
      } catch {
        /* already gone */
      }
    }
  }
  writePids(pidFile, {}); // swept (or dead) — start clean
  return killed;
}

interface Record_ {
  client: ManagedClient | null;
  stopping: boolean;
  /** Resolves when the spawn completes — makes concurrent start() calls idempotent. */
  startPromise: Promise<ManagedClient>;
}

export class SessionManager extends EventEmitter {
  private records = new Map<string, Record_>();
  private nextSpawnAt = 0;
  private readonly maxActive: number;
  private readonly staggerMs: number;

  constructor(
    private readonly opts: {
      spawn: (workspace: string, resumeFile?: string) => ManagedClient;
      pidFile: string;
      maxActive?: number;
      staggerMs?: number;
    }
  ) {
    super();
    this.maxActive = Math.min(opts.maxActive ?? DEFAULT_CAP, HARD_CAP);
    this.staggerMs = opts.staggerMs ?? SPAWN_STAGGER_MS;
  }

  get(sessionId: string): ManagedClient | null {
    return this.records.get(sessionId)?.client ?? null;
  }

  activeIds(): string[] {
    return [...this.records.keys()];
  }

  start(sessionId: string, workspace: string, resumeFile?: string): Promise<ManagedClient> {
    const existing = this.records.get(sessionId);
    if (existing) return existing.startPromise; // active or mid-spawn — never double-spawn
    if (this.records.size >= this.maxActive) {
      return Promise.reject(
        new Error(`Session cap reached (${this.maxActive} active). Stop a session to start another.`)
      );
    }
    const rec: Record_ = { client: null, stopping: false, startPromise: undefined as never };
    rec.startPromise = (async (): Promise<ManagedClient> => {
      try {
        const wait = Math.max(0, this.nextSpawnAt - Date.now());
        this.nextSpawnAt = Date.now() + wait + this.staggerMs;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        const client = this.opts.spawn(workspace, resumeFile);
        rec.client = client;
        client.on("exit", ({ code }) => {
          if (this.records.get(sessionId) !== rec) return; // superseded by a restart
          this.records.delete(sessionId);
          this.untrackPid(client.pid);
          this.emit("session-exit", { sessionId, code, intentional: rec.stopping } satisfies SessionExit);
        });
        await client.start();
        this.trackPid(client.pid, sessionId);
        return client;
      } catch (err) {
        if (this.records.get(sessionId) === rec) this.records.delete(sessionId);
        throw err;
      }
    })();
    this.records.set(sessionId, rec); // reserve the slot before any await resolves
    return rec.startPromise;
  }

  stop(sessionId: string): void {
    const rec = this.records.get(sessionId);
    if (!rec) return;
    rec.stopping = true;
    rec.client?.stop();
  }

  stopAll(): void {
    for (const id of this.records.keys()) this.stop(id);
  }

  private trackPid(pid: number | undefined, sessionId: string): void {
    if (!pid) return;
    const pids = readPids(this.opts.pidFile);
    pids[String(pid)] = sessionId;
    writePids(this.opts.pidFile, pids);
  }

  private untrackPid(pid: number | undefined): void {
    if (!pid) return;
    const pids = readPids(this.opts.pidFile);
    delete pids[String(pid)];
    writePids(this.opts.pidFile, pids);
  }
}
