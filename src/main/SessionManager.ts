import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { platform } from "./platform";

/**
 * Runs N concurrent Pi processes keyed by our sessionId (electron-free,
 * vitest-importable — the PiClient factory is injected).
 *
 * - Cap: 8 live processes, internal only — no visible session limit (W1.3).
 *   Overflow hibernates the oldest IDLE session via the injected `hibernate`
 *   callback; when every live session is genuinely active, start() rejects
 *   with a clear error the UI surfaces. Nothing is queued.
 * - Spawn stagger: simultaneous starts are spaced ~1s apart (S0.1 measured
 *   5x ready-latency contention at 8-at-once).
 * - Crash isolation: each child's exit only affects its own record; a
 *   "session-exit" event carries { sessionId, code, intentional }.
 * - PID tracking: live pids persisted to disk so a later app run can sweep
 *   orphans (verify command before kill).
 */

export const DEFAULT_CAP = 8;
export const HARD_CAP = 8;
export const SPAWN_STAGGER_MS = 1000;

/** Structural subset of PiClient the manager needs — lets tests inject fakes. */
export interface ManagedClient {
  start(): Promise<void>;
  stop(): void;
  readonly pid: number | undefined;
  on(event: "exit", cb: (info: { code: number | null; stderr?: string; stderrLines?: string[] }) => void): unknown;
}

export interface SessionExit {
  sessionId: string;
  code: number | null;
  intentional: boolean;
  /** Tail of the child's stderr — why it died, when it died unexpectedly. */
  stderr?: string;
  /** §37: the whole 40-line ring, for frame extraction only. Never displayed,
      never logged — `piFrames` is the only consumer and it keeps no message. */
  stderrLines?: string[];
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

/**
 * Kill leftover pi processes from a previous app run. Only kills a pid when it
 * is BOTH in our pid file AND its current command looks like our Pi runtime —
 * pids get recycled, never kill blind. Returns the pids killed.
 */
export function sweepOrphans(
  pidFile: string,
  // Both halves come from the platform seam (PRD §4, Windows round). `ps` does not
  // exist on Windows, and the string matched below lives in the ARGUMENTS — which
  // tasklist does not print — so a sweep built on either verifies nothing and kills
  // nothing, leaving a crashed run's Pi processes alive with no signal at all.
  readCmd: (pid: number) => string | null = (pid) => platform.readCommand(pid),
  kill: (pid: number) => void = (pid) => platform.killTree(pid)
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
  /** Victims mid-hibernation — excluded from further victim picks. */
  private hibernating = new Set<string>();
  private nextSpawnAt = 0;
  private readonly maxActive: number;
  private readonly staggerMs: number;

  constructor(
    private readonly opts: {
      /** sessionId lets the factory resolve per-session options (W2.1 model override). */
      spawn: (workspace: string, resumeFile?: string, sessionId?: string) => ManagedClient;
      pidFile: string;
      maxActive?: number;
      staggerMs?: number;
      /**
       * W1.3: pick + prepare the hibernation victim among `liveIds` (capture
       * stats, log, mark the index). Return null when all are genuinely
       * active. The manager then stops the returned session and waits for its
       * exit before spawning the newcomer.
       */
      hibernate?: (liveIds: string[]) => Promise<string | null>;
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
    const rec: Record_ = { client: null, stopping: false, startPromise: undefined as never };
    rec.startPromise = (async (): Promise<ManagedClient> => {
      try {
        // W1.3: at the cap → hibernate the oldest idle session to make room,
        // or refuse honestly. This runs synchronously before our own slot is
        // reserved below (async body executes to the first await), so size
        // does NOT include this session yet.
        if (this.records.size >= this.maxActive) await this.makeRoom(sessionId);

        const wait = Math.max(0, this.nextSpawnAt - Date.now());
        this.nextSpawnAt = Date.now() + wait + this.staggerMs;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        const client = this.opts.spawn(workspace, resumeFile, sessionId);
        rec.client = client;
        client.on("exit", ({ code, stderr, stderrLines }) => {
          if (this.records.get(sessionId) !== rec) return; // superseded by a restart
          this.records.delete(sessionId);
          this.untrackPid(client.pid);
          this.emit("session-exit", { sessionId, code, intentional: rec.stopping, stderr, stderrLines } satisfies SessionExit);
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

  /** Hibernate one idle session (stop + wait for its exit) or throw. */
  private async makeRoom(newId: string): Promise<void> {
    const live = [...this.records.keys()].filter(
      (id) => id !== newId && !this.hibernating.has(id) && this.records.get(id)?.client
    );
    const victim = (await this.opts.hibernate?.(live)) ?? null;
    if (!victim || !this.records.has(victim)) {
      throw new Error(
        `All ${this.maxActive} running sessions are actively working — stop one to open another.`
      );
    }
    this.hibernating.add(victim);
    try {
      const exited = new Promise<void>((resolve) => {
        const onExit = (e: SessionExit): void => {
          if (e.sessionId !== victim) return;
          this.off("session-exit", onExit);
          resolve();
        };
        this.on("session-exit", onExit);
      });
      this.stop(victim);
      // ponytail: 5s escape hatch — a kill-resistant child must not wedge new
      // sessions; briefly running cap+1 processes beats blocking the user.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([exited, new Promise<void>((r) => { timer = setTimeout(r, 5_000); })]);
      clearTimeout(timer);
    } finally {
      this.hibernating.delete(victim);
    }
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
