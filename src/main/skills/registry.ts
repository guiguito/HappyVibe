import fs from "node:fs";
import path from "node:path";
import type { DiscoveredSkill } from "./discovery";

/**
 * Skill approval registry (PRD §14 trust) — review-before-active. An append-only
 * JSONL store (EventLog pattern; no SQLite) keyed by skill id (absolute dir path)
 * + content hash. Latest record per id wins.
 *
 * TRUST vs ENABLEMENT vs ACTIVATION (three separate axes):
 *  - Trust (this file): a record with hash === the skill's current on-disk hash
 *    means "the user reviewed THIS content". A hash mismatch (content changed)
 *    means no matching record → needs-review, so a changed skill stops loading
 *    until re-approved. This is the scope-wide approval.
 *  - Enablement (this file, `enabled`): the global on/off shown on the Skills
 *    screen — approve sets it on; "disable" sets it off without losing trust.
 *    Bundled skills are approved at install but enabled=false (off by default).
 *  - Activation (WorkspaceRegistry.skillsActive): the per-workspace checklist.
 * A session spawns with skills that are trusted AND enabled AND active-for-its-
 * workspace (resolveActiveSkills, below).
 *
 * ponytail: append-only JSONL, compacted only by "latest wins" on read — fine
 * for the documented ceiling (a few hundred skills); no rewrite needed.
 */

export interface SkillProvenance {
  /** "local" | "linked" | "git" | "bundled" | "created" */
  source: string;
  sourceUrl?: string;
  ref?: string;
  commitSha?: string;
  importedAt?: string;
}

export interface SkillRecord {
  id: string;
  hash: string;
  enabled: boolean;
  approvedAt: string;
  provenance?: SkillProvenance;
  /** Approved SKILL.md content + file list — the "before" side of the re-review diff. */
  snapshot?: { skillMd: string; files: string[] };
}

export type ApprovalStatus = "approved" | "needs-review";

export class SkillRegistry {
  private latest = new Map<string, SkillRecord>();

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
        const rec = JSON.parse(line) as SkillRecord;
        if (rec && typeof rec.id === "string") this.latest.set(rec.id, rec);
      } catch {
        /* skip corrupt line */
      }
    }
  }

  private append(rec: SkillRecord): void {
    this.latest.set(rec.id, rec);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(rec) + "\n", "utf8");
  }

  record(id: string): SkillRecord | undefined {
    return this.latest.get(id);
  }

  /** approved iff a record exists whose hash matches the skill's current on-disk hash. */
  approvalStatus(skill: DiscoveredSkill): ApprovalStatus {
    const rec = this.latest.get(skill.id);
    return rec && rec.hash === skill.hash ? "approved" : "needs-review";
  }

  /** Snapshot the current on-disk content and record approval. Defaults to enabled=on. */
  approve(skill: DiscoveredSkill, now: string, opts?: { enabled?: boolean; provenance?: SkillProvenance }): SkillRecord {
    let skillMd = "";
    try {
      skillMd = fs.readFileSync(skill.skillMdPath, "utf8");
    } catch {
      /* unreadable — snapshot stays empty */
    }
    const rec: SkillRecord = {
      id: skill.id,
      hash: skill.hash,
      enabled: opts?.enabled ?? true,
      approvedAt: now,
      provenance: opts?.provenance ?? this.latest.get(skill.id)?.provenance,
      snapshot: { skillMd, files: skill.files },
    };
    this.append(rec);
    return rec;
  }

  /** Toggle the global on/off without changing trust (keeps hash/snapshot/provenance). No-op if never approved. */
  setEnabled(id: string, enabled: boolean, now: string): SkillRecord | undefined {
    const cur = this.latest.get(id);
    if (!cur) return undefined;
    const rec: SkillRecord = { ...cur, enabled, approvedAt: now };
    this.append(rec);
    return rec;
  }

  /** Forget a skill entirely (e.g. it was deleted from disk). */
  forget(id: string, now: string): void {
    // Tombstone: an enabled=false record with a sentinel hash so nothing matches → needs-review if it ever returns.
    this.append({ id, hash: "", enabled: false, approvedAt: now });
    this.latest.delete(id);
  }
}

/**
 * Which skill dir paths a session in `workspace` should spawn with (`--skill`
 * args). A skill loads iff: trusted (approved at current hash), globally enabled,
 * loadable (Pi will load it), and active for this workspace. Per-workspace
 * activation is opt-OUT (active unless explicitly toggled off). "Bundled off by
 * default" is NOT modeled here — it's the bundled skills' initial enabled=false
 * record (installBundledSkills), so a single "Enable" turns one on. PURE, the
 * single source of truth for what spawns.
 */
export function resolveActiveSkills(
  discovered: DiscoveredSkill[],
  registry: Pick<SkillRegistry, "approvalStatus" | "record">,
  activation: Record<string, boolean> | undefined,
): string[] {
  const out: string[] = [];
  for (const skill of discovered) {
    if (!skill.loadable) continue;
    if (registry.approvalStatus(skill) !== "approved") continue;
    if (!registry.record(skill.id)?.enabled) continue;
    if ((activation?.[skill.id] ?? true) !== true) continue;
    out.push(skill.id);
  }
  return out;
}
