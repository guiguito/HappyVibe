import fs from "node:fs";
import { platform } from "./platform";
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
  /** §16 round 16: per-session thinking override (session → global — there is
   *  deliberately no workspace tier). Additive; survives hibernation/resume. */
  thinking?: string;
  /** Who last set the title. "user" is never overwritten by generation. */
  titleSource: "fallback" | "model" | "user";
  /**
   * When the user last OPENED or PROMPTED this session — what the sidebar
   * orders by, and the age its row shows.
   *
   * Deliberately not `updatedAt`, which means "metadata last changed" and is
   * bumped by a rename, a model swap, archive and hibernate. That is a useful
   * fact in its own right, and overloading it would erase it — while leaving
   * the ordering just as wrong, since neither prompting nor opening touches it.
   *
   * Optional, and every reader falls back to `updatedAt` (sessionOrder.ts), so
   * sessions that predate the field keep exactly the order they already had and
   * there is nothing to migrate.
   */
  lastUsedAt?: string;
  /**
   * §35: the schedule that opened this session.
   *
   * Additive, absent = an ordinary session the user started, so there is
   * nothing to migrate. Read by the sidebar (the clock glyph), by the spawn
   * (a read-only schedule's run spawns clamped) and by the outcome routing;
   * nothing in the transcript reads it.
   */
  scheduleId?: string;
  /**
   * §34: when the session pulse was SHOWN for this session.
   *
   * Asked-at-show, not asked-at-answer, and that is the whole rule: a user who
   * quit with the row up is not asked again. Strict once per session, ever —
   * the pulse's value depends on it never becoming a nag.
   *
   * Additive; absent = never asked, so there is nothing to migrate. Survives
   * hibernation, reload and reopen because it lives here rather than in the
   * renderer.
   */
  pulseAskedAt?: string;
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

  /**
   * Mark the session as used, now.
   *
   * Deliberately NOT `update({lastUsedAt})`: that bumps `updatedAt` on every
   * call, which would drag the two meanings back together — every open would
   * also read as a metadata change.
   */
  touch(id: string): SessionMeta | undefined {
    const meta = this.get(id);
    if (!meta) return undefined;
    meta.lastUsedAt = new Date().toISOString();
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
  const resolved = sessionFilePath(sessionDirPath, meta.piSessionFile);
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
  const resolved = sessionFilePath(sessionDirPath, file);
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
 *
 * §17 round 24: exported, because the HTML export needs the confined PATH
 * rather than the contents — three consumers now, one confinement.
 */
export function sessionFilePath(sessionDirPath: string, file: string | undefined): string | null {
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
  const resolved = sessionFilePath(sessionDirPath, file);
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
  const parent = sessionFilePath(sessionDirPath, piSessionFile);
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

/**
 * Everything a session's sub-agents left on disk, in the two places they land.
 *
 * `subagent-artifacts/` is upstream's, written straight into OUR session dir, and
 * flat: one `<runId>_<agent>[_<idx>]_{input,output,meta,transcript}` set per child
 * run, with no record of which session it belonged to (`_meta.json` names the run
 * and the agent, never the parent). So the association exists in exactly one
 * place — the parent session file — and only until it is deleted.
 */
const ARTIFACT_DIR = "subagent-artifacts";

/** A run id we are willing to match artifacts against. Long enough that it cannot
 *  prefix-match half the directory, and free of separators so it cannot escape. */
const plausibleRunId = (id: string): boolean =>
  id.length >= 8 && id.length <= 128 && /^[A-Za-z0-9._-]+$/.test(id);

/**
 * Every run id a session's children could be filed under.
 *
 * A UNION on purpose. The `<stem>/` sub-directory names, `details.asyncId` and the
 * artifact prefixes are three id spaces that only sometimes coincide (CLAUDE.md's
 * "two ids" finding), so deriving one from another silently misses files. Reading
 * both sources costs one file read we are about to throw away anyway.
 */
function sessionRunIds(sessionDirPath: string, piSessionFile: string | undefined): Set<string> {
  const ids = new Set<string>();
  for (const child of childSessionFiles(sessionDirPath, piSessionFile)) {
    if (plausibleRunId(child.runId)) ids.add(child.runId);
  }
  const raw = readSessionFile(sessionDirPath, piSessionFile);
  if (raw) {
    for (const m of raw.matchAll(/"(?:asyncId|runId)"\s*:\s*"([^"]+)"/g)) {
      if (plausibleRunId(m[1])) ids.add(m[1]);
    }
  }
  return ids;
}

/** Upstream's per-run output directory inside the artifacts dir: a child that
 *  declares `output: context.md` writes it to `outputs/<runId>/`. */
const OUTPUTS_DIR = "outputs";

/**
 * Delete `subagent-artifacts/<id>_*` AND `subagent-artifacts/outputs/<id>/` for
 * each id. Exact `<id>_` prefix, never a bare startsWith, and every path
 * re-confined before it is removed.
 *
 * `outputs/` was missed until 2026-08-29: both cleanup halves keyed on the flat
 * `<runId>_<agent>_*` filenames and skipped anything without an underscore. That
 * guard is right (pi-subagents keeps `.last-cleanup` in the same directory) but
 * it also made the output directory permanently invisible, so a child's written
 * answer outlived the session that asked for it.
 */
function deleteArtifactsFor(sessionDirPath: string, ids: ReadonlySet<string>): number {
  if (ids.size === 0) return 0;
  const dir = path.join(path.resolve(sessionDirPath), ARTIFACT_DIR);
  let removed = 0;
  // The per-run output directories, which are named by id alone (no `_`).
  for (const id of ids) {
    if (!plausibleRunId(id)) continue;
    const resolved = sessionFilePath(sessionDirPath, path.join(dir, OUTPUTS_DIR, id));
    if (!resolved || !fs.existsSync(resolved)) continue;
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      removed++;
    } catch {
      /* locked — try again next start */
    }
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed; // no artifacts dir = nothing more to clean
  }
  for (const name of names) {
    // A name with no `_` is not an artifact: pi-subagents keeps its own
    // bookkeeping in this directory (`.last-cleanup`, a retention timestamp).
    // Without this guard `indexOf` returns -1, `slice(0, -1)` yields a
    // plausible-looking id, and the sweep deletes a file that is not ours.
    const sep = name.indexOf("_");
    if (sep <= 0) continue;
    const id = name.slice(0, sep);
    if (!ids.has(id)) continue;
    const resolved = sessionFilePath(sessionDirPath, path.join(dir, name));
    if (!resolved) continue;
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      removed++;
    } catch {
      /* locked — the session is going either way */
    }
  }
  return removed;
}

/**
 * Delete a session's sub-agent data: its child Pi session files and its artifacts.
 *
 * The sibling of `deleteSessionSnapshots` — §5's "delete means delete" applied to
 * the one thing it was missing. Before this, `deleteSessionFile` removed only the
 * `.jsonl` (no `recursive`, and it is handed a FILE path), so `<stem>/` and every
 * `subagent-artifacts/<runId>_*` survived the session forever. Measured 2026-08-29
 * on a real install: 18 orphaned child directories and 13 artifact run-ids
 * belonging to no surviving session. `_output.md` holds the child's whole answer
 * and `_transcript.jsonl` its thinking, so this is content a user believed they
 * had deleted.
 *
 * MUST be called BEFORE deleteSessionFile: the artifact ids are only recoverable
 * while the parent session file exists. tests/session-delete-children.test.ts pins
 * that ordering at the call sites.
 *
 * Never throws — a cleanup failure must not block the delete the user asked for.
 */
export function deleteSessionChildren(sessionDirPath: string, piSessionFile: string | undefined): void {
  const parent = sessionFilePath(sessionDirPath, piSessionFile);
  if (!parent) return;
  try {
    const ids = sessionRunIds(sessionDirPath, piSessionFile);
    // The child-session root is the parent path minus its extension, so it needs
    // no lookup and cannot point anywhere the parent does not already.
    fs.rmSync(parent.replace(/\.jsonl$/, ""), { recursive: true, force: true });
    deleteArtifactsFor(sessionDirPath, ids);
  } catch {
    /* best effort: the index entry and the session file go regardless */
  }
}

/**
 * Reclaim sub-agent data whose session is already gone.
 *
 * Two halves, deliberately unequal in cost. A `<stem>/` directory whose
 * `<stem>.jsonl` does not exist is unambiguously dead and needs no scanning — that
 * is the bulk of the bytes. The flat artifacts have no parent recorded anywhere,
 * so the only sound test is REFERENCE: an id named by no surviving session file
 * belongs to no surviving session.
 *
 * Conservative by construction. If any session file fails to read, the artifact
 * half is skipped entirely rather than run on partial knowledge — a leak is a
 * smaller failure than deleting a live session's data. And a directory must look
 * like a session stem before it is considered, so an unexpected neighbour in the
 * sessions dir is left alone.
 *
 * NOTE: a CLOSED session is not an orphan. Its `.jsonl` is still there, so both
 * halves skip it — which matters because the sub-agent cost readout re-parses
 * exactly those child session files when the session is reopened (PRD §19).
 */
export function sweepOrphanedSubagentData(sessionDirPath: string): { dirs: number; artifacts: number } {
  const root = path.resolve(sessionDirPath);
  const out = { dirs: 0, artifacts: 0 };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out; // no sessions dir yet
  }

  // Half 1: child directories, by name. No file reads at all.
  for (const e of entries) {
    if (!e.isDirectory() || e.name === ARTIFACT_DIR) continue;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(e.name)) continue; // not a session stem — not ours
    if (fs.existsSync(path.join(root, `${e.name}.jsonl`))) continue; // its session is alive
    try {
      fs.rmSync(path.join(root, e.name), { recursive: true, force: true });
      out.dirs++;
    } catch {
      /* locked — try again next start */
    }
  }

  // Half 2: artifacts, by reference. Bail on ANY unreadable session.
  //
  // `referenced` is a UNION of the same two id spaces `sessionRunIds` unions, and
  // for the same measured reason: the id an artifact is filed under and the
  // asyncId the parent transcript records only sometimes coincide. Reading the
  // session text alone deleted a live session's child transcripts at every
  // startup (observed 2026-08-30, after the run card started reading them).
  const referenced = new Set<string>();
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(root, e.name), "utf8");
    } catch {
      return out; // partial knowledge: keep everything
    }
    for (const m of raw.matchAll(/"(?:asyncId|runId)"\s*:\s*"([^"]+)"/g)) {
      if (plausibleRunId(m[1])) referenced.add(m[1]);
    }
    // Child run directories under this session's own `<stem>/`. Read AFTER half 1
    // has removed the stems whose session file is gone, so a deleted session can
    // never protect its own artifacts with the directories it left behind.
    for (const name of subdirs(path.join(root, e.name.replace(/\.jsonl$/, "")))) {
      const id = path.basename(name);
      if (plausibleRunId(id)) referenced.add(id);
    }
  }
  let names: string[];
  try {
    names = fs.readdirSync(path.join(root, ARTIFACT_DIR));
  } catch {
    return out;
  }
  const orphaned = new Set<string>();
  for (const name of names) {
    const sep = name.indexOf("_");
    if (sep <= 0) continue; // not an artifact (see deleteArtifactsFor)
    const id = name.slice(0, sep);
    if (plausibleRunId(id) && !referenced.has(id)) orphaned.add(id);
  }
  // A run can survive ONLY as an output directory — its flat artifacts may have
  // been taken by pi-subagents' own 30-day retention while `outputs/<id>/`
  // stayed. Those ids appear in no filename here, so they need their own pass.
  try {
    for (const id of fs.readdirSync(path.join(root, ARTIFACT_DIR, OUTPUTS_DIR))) {
      if (plausibleRunId(id) && !referenced.has(id)) orphaned.add(id);
    }
  } catch {
    /* no outputs dir — nothing more to collect */
  }
  out.artifacts = deleteArtifactsFor(sessionDirPath, orphaned);
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
  /** §33: "Use memory in this workspace". Absent = ON — only an explicit opt-out is stored,
   *  the skillsActive convention. Off ⇒ this workspace's sessions get no workspace index and
   *  no workspace scope (resolved at spawn, so it costs a respawn). */
  memoryActive?: boolean;
}

/** V2.A: workspace paths are dialog-provided strings — compare them
 *  trailing-slash-insensitively so a "/ws/" vs "/ws" mismatch can never make
 *  setModel silently no-op or getModel miss the override. */
/** §35: schedules.ts and ipc.ts compare workspace paths with the SAME rule the registry uses —
    "/w/" and "/w" are one workspace. Exported rather than re-spelled (CLAUDE.md: never compare raw path strings). */
/**
 * The canonical comparison key for a workspace path — the ONE answer to "are these
 * the same workspace", used by the registry, the session index, the schedule store
 * and main's workspace lookups.
 *
 * Via the platform seam since the Windows round (PRD §4): there a workspace is
 * `C:\ws`, git answers `C:/ws` and the filesystem is case-insensitive, so a
 * separator-only strip left the same folder with several identities — two sidebar
 * rows for one project, and a schedule that cannot find its own workspace.
 * Comparison only: never render this, it is lower-cased on win32.
 */
export const normPath = (p: string): string => platform.workspaceKey(p);

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
  /** §33: absent = on. */
  getMemoryActive(p: string): boolean {
    return this.find(p)?.memoryActive ?? true;
  }

  setMemoryActive(p: string, on: boolean): void {
    const entry = this.find(p);
    if (!entry) return;
    if (on) delete entry.memoryActive;
    else entry.memoryActive = false;
    this.save();
  }

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
