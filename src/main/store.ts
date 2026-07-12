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
}

/** Per-workspace settings (W1.4). Model hierarchy: session → workspace → global;
 *  the session tier lands in Wave 2 — `model` here is the workspace tier. */
export interface WorkspaceEntry {
  path: string;
  model?: { provider: string; modelId: string };
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

  add(p: string): void {
    if (!this.entries.some((e) => e.path === p)) {
      this.entries.push({ path: p });
      this.save();
    }
  }

  remove(p: string): void {
    this.entries = this.entries.filter((e) => e.path !== p);
    this.save();
  }

  getModel(p: string): { provider: string; modelId: string } | null {
    return this.entries.find((e) => e.path === p)?.model ?? null;
  }

  setModel(p: string, model: { provider: string; modelId: string } | null): void {
    const entry = this.entries.find((e) => e.path === p);
    if (!entry) return; // unknown workspace — nothing to set
    if (model) entry.model = model;
    else delete entry.model;
    this.save();
  }
}
