import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Upgrade-proof session index + workspace registry (electron-free, vitest-importable).
 *
 * Pi session files are OPAQUE blobs we hand back to Pi via `--session <file>`;
 * everything HappyVibe needs to list/search/resume lives here.
 * ponytail: plain JSON files rewritten on each mutation — fine for the
 * documented ceiling (thousands of sessions); move to incremental storage if that's ever hit.
 */
export interface SessionMeta {
  id: string;
  title: string;
  workspaceId: string; // absolute workspace folder path — the path IS the id
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  piSessionFile?: string;
  /** W1.3: process stopped to make room; restored transparently on reopen. Additive — absent = false. */
  hibernated?: boolean;
  /** W2.1: per-session model override (hierarchy: session → workspace → global). Additive; survives hibernation/resume. */
  model?: { provider: string; modelId: string };
  /** Who last set the title. "user" is never overwritten by generation. */
  titleSource: "fallback" | "model" | "user";
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export class SessionIndex {
  private sessions: SessionMeta[];

  constructor(private readonly file: string) {
    this.sessions = readJson<SessionMeta[]>(file, []);
    if (!Array.isArray(this.sessions)) this.sessions = [];
  }

  private save(): void {
    writeJson(this.file, this.sessions);
  }

  create(workspaceId: string): SessionMeta {
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: randomUUID(),
      title: "New session",
      workspaceId,
      createdAt: now,
      updatedAt: now,
      archived: false,
      titleSource: "fallback",
    };
    this.sessions.push(meta);
    this.save();
    return meta;
  }

  get(id: string): SessionMeta | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  list(): SessionMeta[] {
    return [...this.sessions];
  }

  update(id: string, patch: Partial<Omit<SessionMeta, "id" | "createdAt">>): SessionMeta | undefined {
    const meta = this.get(id);
    if (!meta) return undefined;
    Object.assign(meta, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return meta;
  }

  remove(id: string): void {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.save();
  }

  /**
   * Repair stale `piSessionFile` paths. They're stored absolute, so anything
   * that moves the userData dir (e.g. the hv-scaffold → HappyVibe rename) leaves
   * them pointing at a path that no longer exists, and resume silently loads no
   * history. When a stored path is missing but a file of the same name lives in
   * the current session dir, rebase onto it. Idempotent; persists on change.
   */
  rebaseSessionFiles(sessionDirPath: string): void {
    let changed = false;
    for (const s of this.sessions) {
      const f = s.piSessionFile;
      if (!f || fs.existsSync(f)) continue;
      const candidate = path.join(sessionDirPath, path.basename(f));
      if (fs.existsSync(candidate)) {
        s.piSessionFile = candidate;
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

/**
 * Round 15 — "this session has no content", the test that decides whether
 * closing its last tab deletes it.
 *
 * Content means A USER EVER SENT A PROMPT. Not "the file is small" and not
 * "the title is still the fallback": a session that Pi has merely booted
 * already has a file with session/model bookkeeping entries in it, and a
 * titled session is by definition one that got a prompt. So the question is
 * asked of the entries directly.
 *
 * Reads the file with the same tolerant line-by-line parse the rest of the app
 * uses (a live file's last line can be torn mid-write), and answers EMPTY on
 * anything it cannot read — a session with no file has certainly had no
 * prompt, and the alternative reading, "unreadable means keep", would leave
 * exactly the rows this exists to stop accumulating.
 *
 * `titleSource` is checked too, and it is the cheap half: a user-renamed
 * session is never empty whatever the file says, because naming a thing is a
 * statement that you want it.
 */
export function isSessionEmpty(meta: SessionMeta, sessionDirPath: string): boolean {
  if (meta.titleSource === "user") return false;
  const resolved = confinedSessionPath(sessionDirPath, meta.piSessionFile);
  if (!resolved) return true; // never spawned, or a path we will not read
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch {
    return true; // no file on disk = no prompt was ever sent
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e: { type?: string; message?: { role?: string } };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue; // torn tail line
    }
    if (e.type === "message" && e.message?.role === "user") return false;
  }
  return true;
}

/**
 * V2.C2 session delete: remove a session's Pi session file, confined to the
 * app-owned session dir. Never deletes outside it (piSessionFile is
 * Pi-reported — treat as untrusted); a missing file is fine.
 */
export function deleteSessionFile(sessionDirPath: string, file: string | undefined): void {
  const resolved = confinedSessionPath(sessionDirPath, file);
  if (!resolved) return;
  try {
    fs.rmSync(resolved, { force: true }); // force: missing file is fine
  } catch {
    /* unreadable/locked — the index entry is gone either way */
  }
}

/**
 * Resolve a Pi-reported session-file path, or null if it lands outside the
 * app-owned session dir. Trailing path.sep matters twice: it rejects the dir
 * itself, and it stops a sibling that merely shares the name prefix
 * ("…/sessions-evil") from passing a plain startsWith.
 */
function confinedSessionPath(sessionDirPath: string, file: string | undefined): string | null {
  if (!file) return null;
  const resolved = path.resolve(file);
  return resolved.startsWith(path.resolve(sessionDirPath) + path.sep) ? resolved : null;
}

/**
 * Read a session's Pi JSONL for the cost ledger (calls.ts). Same confinement as
 * deleteSessionFile — piSessionFile is Pi-reported, so it is untrusted input and
 * a read must never escape the session dir. Missing/unreadable file → null (a
 * session that has not had its first turn yet has no file).
 */
export function readSessionFile(sessionDirPath: string, file: string | undefined): string | null {
  const resolved = confinedSessionPath(sessionDirPath, file);
  if (!resolved) return null;
  try {
    return fs.readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

/** One sub-agent child's Pi session file, tagged with the run that spawned it. */
export interface ChildSessionFile {
  runId: string;
  file: string;
}

const subdirs = (dir: string): string[] => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return []; // never delegated, or not readable — both mean "no children"
  }
};

/**
 * The Pi session files of a session's sub-agent children.
 *
 * pi-subagents roots a child's session beside the PARENT's own file —
 * `<sessionsDir>/<parentBasename>/<runId>/run-<idx>/session.jsonl`
 * (`getSubagentSessionRoot` + `sessionDirForIndex`) — and a child is an ordinary
 * Pi process, so that file is an ordinary Pi session file the cost ledger parses
 * with no special case (PRD §19). It is NOT in a tmpdir: it lives as long as the
 * parent session does, which is what lets a reopened session show the same
 * numbers it showed live.
 *
 * Confinement is the same as readSessionFile's, and free: the root is derived
 * from an already-confined parent path.
 *
 * ponytail: resolves upstream's layout rather than tracking a path per run. It
 * is the only option that works for a COMPLETED run anyway — a live run
 * publishes its child's path on status.json, but that file is in a tmpdir that
 * is gone by the time a session is reopened, so a status-field shortcut would
 * be a second mechanism serving only the live case. Pinned by
 * tests/pi-subagents-contract.test.ts so a pin bump fails loudly instead of
 * silently returning nothing. Known ceiling: a delegation for which the MODEL
 * passed its own `sessionDir` relocates the child outside this root and is
 * missed; upgrade path = record status.json's `sessionFile` at dispatch.
 */
export function childSessionFiles(
  sessionDirPath: string,
  piSessionFile: string | undefined,
  runId?: string,
): ChildSessionFile[] {
  const parent = confinedSessionPath(sessionDirPath, piSessionFile);
  if (!parent) return [];
  const root = parent.replace(/\.jsonl$/, "");
  const runDirs = runId ? [path.join(root, runId)] : subdirs(root);
  const out: ChildSessionFile[] = [];
  for (const runDir of runDirs) {
    for (const stepDir of subdirs(runDir)) {
      const file = path.join(stepDir, "session.jsonl");
      if (fs.existsSync(file)) out.push({ runId: path.basename(runDir), file });
    }
  }
  return out;
}

/** Per-workspace settings (W1.4). Model hierarchy: session → workspace → global;
 *  the session tier lands in Wave 2 — `model` here is the workspace tier. */
export interface WorkspaceEntry {
  path: string;
  model?: { provider: string; modelId: string };
  /** §14: per-workspace skill activation checklist, keyed by skill id (absolute
   *  dir path). Absent id = default (normal skills on, bundled off — resolved in
   *  resolveActiveSkills). Only stores explicit user overrides. */
  skillsActive?: Record<string, boolean>;
  /** §24: per-workspace command activation checklist, keyed by command id
   *  (absolute FILE path — approval is per file, never per directory). Absent id
   *  = default, resolved in resolveActivePromptTemplates. Only stores explicit overrides. */
  promptTemplatesActive?: Record<string, boolean>;
}

/** V2.A: workspace paths are dialog-provided strings — compare them
 *  trailing-slash-insensitively so a "/ws/" vs "/ws" mismatch can never make
 *  setModel silently no-op or getModel miss the override. */
const normPath = (p: string): string => p.replace(/\/+$/, "") || "/";

/**
 * Round 11: every session belonging to a workspace, archived ones included.
 *
 * Removing a workspace used to drop only the registry entry, leaving each
 * session's `workspaceId` pointing at a workspace that no longer exists —
 * invisible in the sidebar (which iterates workspaces) and never cleaned up.
 * Both removal outcomes need this list: to archive them, or to delete them.
 *
 * Uses the same trailing-slash normalisation as the registry, so a workspace
 * added as "/w/" still matches sessions recorded under "/w".
 */
export function sessionsOfWorkspace(sessions: SessionMeta[], workspace: string): SessionMeta[] {
  const target = normPath(workspace);
  return sessions.filter((s) => normPath(s.workspaceId) === target);
}

export class WorkspaceRegistry {
  private entries: WorkspaceEntry[];

  constructor(private readonly file: string) {
    const raw = readJson<unknown>(file, []);
    // Migration: pre-W1.4 format was a plain string[] of paths.
    this.entries = Array.isArray(raw)
      ? raw
          .map((e) => (typeof e === "string" ? { path: e } : (e as WorkspaceEntry)))
          .filter((e): e is WorkspaceEntry => !!e && typeof e.path === "string")
      : [];
  }

  private save(): void {
    writeJson(this.file, this.entries);
  }

  list(): string[] {
    return this.entries.map((e) => e.path);
  }

  private find(p: string): WorkspaceEntry | undefined {
    return this.entries.find((e) => normPath(e.path) === normPath(p));
  }

  add(p: string): void {
    if (!this.find(p)) {
      this.entries.push({ path: p });
      this.save();
    }
  }

  remove(p: string): void {
    this.entries = this.entries.filter((e) => normPath(e.path) !== normPath(p));
    this.save();
  }

  getModel(p: string): { provider: string; modelId: string } | null {
    return this.find(p)?.model ?? null;
  }

  setModel(p: string, model: { provider: string; modelId: string } | null): void {
    const entry = this.find(p);
    if (!entry) return; // unknown workspace — nothing to set
    if (model) entry.model = model;
    else delete entry.model;
    this.save();
  }

  /** §14: the explicit skill-activation overrides for a workspace (empty if none). */
  getSkillsActive(p: string): Record<string, boolean> {
    return this.find(p)?.skillsActive ?? {};
  }

  /** Set (on=true|false) or clear (on=null → back to default) one skill's activation for a workspace. */
  setSkillActive(p: string, skillId: string, on: boolean | null): void {
    const entry = this.find(p);
    if (!entry) return;
    entry.skillsActive ??= {};
    if (on === null) delete entry.skillsActive[skillId];
    else entry.skillsActive[skillId] = on;
    if (Object.keys(entry.skillsActive).length === 0) delete entry.skillsActive;
    this.save();
  }

  /** §24: the explicit command-activation overrides for a workspace (empty if none). */
  getPromptTemplatesActive(p: string): Record<string, boolean> {
    return this.find(p)?.promptTemplatesActive ?? {};
  }

  /** Set (on=true|false) or clear (on=null → back to default) one command's activation for a workspace. */
  setPromptTemplateActive(p: string, templateId: string, on: boolean | null): void {
    const entry = this.find(p);
    if (!entry) return;
    entry.promptTemplatesActive ??= {};
    if (on === null) delete entry.promptTemplatesActive[templateId];
    else entry.promptTemplatesActive[templateId] = on;
    if (Object.keys(entry.promptTemplatesActive).length === 0) delete entry.promptTemplatesActive;
    this.save();
  }
}
