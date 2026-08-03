import fs from "node:fs";
import path from "node:path";
import type { DiscoveredPromptTemplate } from "./discovery";

/**
 * Command approval registry (PRD §24 trust) — a direct port of
 * `../skills/registry.ts`, same append-only JSONL store (EventLog pattern; no
 * SQLite), keyed by command id (absolute FILE path) + content hash. Latest
 * record per id wins.
 *
 * Approval is per FILE, never per directory: approving a directory would
 * silently approve every file dropped into it later, which is exactly the
 * review-before-active promise this store exists to keep.
 *
 * TRUST vs ENABLEMENT vs ACTIVATION are the same three axes as skills:
 *  - Trust (this file): a record whose hash matches the file's current hash
 *    means "the user reviewed THIS text". An edit breaks the match → the
 *    command stops loading until re-approved.
 *  - Enablement (`enabled`): the global on/off on the Commands screen. Bundled
 *    commands are approved at install but enabled=false (off by default).
 *  - Activation (WorkspaceRegistry.promptTemplatesActive): the per-workspace checklist.
 * A session spawns with commands that are trusted AND enabled AND active for
 * its workspace (resolveActivePromptTemplates, below).
 */

export interface PromptTemplateProvenance {
  /** "local" | "linked" | "git" | "bundled" | "created" */
  source: string;
  sourceUrl?: string;
  ref?: string;
  commitSha?: string;
  importedAt?: string;
}

export interface PromptTemplateRecord {
  id: string;
  hash: string;
  enabled: boolean;
  approvedAt: string;
  provenance?: PromptTemplateProvenance;
  /** Approved template body — the "before" side of the re-review diff. No file list: a command is one file. */
  snapshot?: { body: string };
}

export type ApprovalStatus = "approved" | "needs-review";

export class PromptTemplateRegistry {
  private latest = new Map<string, PromptTemplateRecord>();

  constructor(private readonly file: string) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return; // no store yet
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as PromptTemplateRecord;
        if (rec && typeof rec.id === "string") this.latest.set(rec.id, rec);
      } catch {
        /* skip corrupt line */
      }
    }
  }

  private append(rec: PromptTemplateRecord): void {
    this.latest.set(rec.id, rec);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(rec) + "\n", "utf8");
  }

  record(id: string): PromptTemplateRecord | undefined {
    return this.latest.get(id);
  }

  /** approved iff a record exists whose hash matches the file's current hash. */
  approvalStatus(cmd: DiscoveredPromptTemplate): ApprovalStatus {
    const rec = this.latest.get(cmd.id);
    return rec && rec.hash === cmd.hash ? "approved" : "needs-review";
  }

  /** Snapshot the current on-disk body and record approval. Defaults to enabled=on. */
  approve(cmd: DiscoveredPromptTemplate, now: string, opts?: { enabled?: boolean; provenance?: PromptTemplateProvenance }): PromptTemplateRecord {
    const rec: PromptTemplateRecord = {
      id: cmd.id,
      hash: cmd.hash,
      enabled: opts?.enabled ?? true,
      approvedAt: now,
      provenance: opts?.provenance ?? this.latest.get(cmd.id)?.provenance,
      // The body is already read and frontmatter-stripped by discovery — no second read.
      snapshot: { body: cmd.body },
    };
    this.append(rec);
    return rec;
  }

  /** Toggle the global on/off without changing trust (keeps hash/snapshot/provenance). No-op if never approved. */
  setEnabled(id: string, enabled: boolean, now: string): PromptTemplateRecord | undefined {
    const cur = this.latest.get(id);
    if (!cur) return undefined;
    const rec: PromptTemplateRecord = { ...cur, enabled, approvedAt: now };
    this.append(rec);
    return rec;
  }

  /** Forget a command entirely (e.g. it was deleted from disk). */
  forget(id: string, now: string): void {
    // Tombstone: an enabled=false record with a sentinel hash so nothing matches → needs-review if it ever returns.
    this.append({ id, hash: "", enabled: false, approvedAt: now });
    this.latest.delete(id);
  }
}

/**
 * Which command files a session in `workspace` should spawn with
 * (`--prompt-template` args). A command loads iff: trusted (approved at the
 * current hash), globally enabled, and active for this workspace. Per-workspace
 * activation is opt-OUT (active unless explicitly toggled off).
 *
 * There is no `loadable` guard, unlike resolveActiveSkills: Pi loads every
 * readable `.md` (see discovery.ts), so there is nothing to filter on. Nor is
 * `shadowed` filtered here — a shadowed command is unreachable because Pi
 * matches the extension command first, not because we withheld the flag, and
 * dropping the flag would only hide the collision from `get_commands` where the
 * UI can no longer explain it. PURE, the single source of truth for what spawns.
 */
export function resolveActivePromptTemplates(
  discovered: DiscoveredPromptTemplate[],
  registry: Pick<PromptTemplateRegistry, "approvalStatus" | "record">,
  activation: Record<string, boolean> | undefined,
): string[] {
  const out: string[] = [];
  for (const cmd of discovered) {
    if (registry.approvalStatus(cmd) !== "approved") continue;
    if (!registry.record(cmd.id)?.enabled) continue;
    if ((activation?.[cmd.id] ?? true) !== true) continue;
    out.push(cmd.id);
  }
  return out;
}
