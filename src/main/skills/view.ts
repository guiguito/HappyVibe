import type { DiscoveredSkill } from "./discovery";
import type { SkillProvenance, SkillRegistry } from "./registry";

/**
 * Skill status for the UI (PRD §14) — PURE. Combines discovery (loadable),
 * approval trust (registry), enablement, and (optionally) per-workspace
 * activation into the four statuses the renderer shows.
 *
 *  - error        : Pi won't load it (missing description / unreadable)
 *  - needs-review : not approved at the current content hash (new OR changed)
 *  - active       : approved + enabled (+ active in this workspace when a
 *                   workspace activation map is supplied)
 *  - disabled     : approved but switched off (globally or for this workspace)
 */
export type SkillStatus = "active" | "disabled" | "needs-review" | "error";

export interface SkillView {
  id: string;
  name: string;
  description: string;
  source: DiscoveredSkill["source"];
  status: SkillStatus;
  scriptCount: number;
  disableModelInvocation: boolean;
  estTokens: { card: number; body: number };
  /** true when it was approved before but the content changed — the re-review case (diff available). */
  changed: boolean;
  provenance?: SkillProvenance;
}

/**
 * @param activation per-workspace checklist (skillId → on/off). Omit for the
 * global Skills screen (status reflects the global enabled flag only). Supply it
 * for the workspace settings view (status reflects approved ∩ active-here, with
 * bundled skills defaulting off and others on).
 */
export function toSkillView(
  skill: DiscoveredSkill,
  registry: Pick<SkillRegistry, "approvalStatus" | "record">,
  activation?: Record<string, boolean>,
): SkillView {
  const rec = registry.record(skill.id);
  let status: SkillStatus;
  if (!skill.loadable) {
    status = "error";
  } else if (registry.approvalStatus(skill) !== "approved") {
    status = "needs-review";
  } else {
    const enabledGlobally = rec?.enabled === true;
    if (!enabledGlobally) {
      status = "disabled";
    } else if (activation) {
      status = (activation[skill.id] ?? true) ? "active" : "disabled";
    } else {
      status = "active";
    }
  }
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    status,
    scriptCount: skill.scriptCount,
    disableModelInvocation: skill.disableModelInvocation,
    estTokens: skill.estTokens,
    // changed = there's an approval record but the hash no longer matches.
    changed: status === "needs-review" && !!rec && rec.hash !== "" && rec.hash !== skill.hash,
    provenance: rec?.provenance,
  };
}
