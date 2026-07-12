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

export class WorkspaceRegistry {
  private paths: string[];

  constructor(private readonly file: string) {
    this.paths = readJson<string[]>(file, []);
    if (!Array.isArray(this.paths)) this.paths = [];
  }

  list(): string[] {
    return [...this.paths];
  }

  add(p: string): void {
    if (!this.paths.includes(p)) {
      this.paths.push(p);
      writeJson(this.file, this.paths);
    }
  }

  remove(p: string): void {
    this.paths = this.paths.filter((x) => x !== p);
    writeJson(this.file, this.paths);
  }
}
