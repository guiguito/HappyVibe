import type { DiscoveredPromptTemplate } from "./discovery";
import type { PromptTemplateProvenance, PromptTemplateRegistry } from "./registry";

/**
 * Command status for the UI (PRD §24) — PURE, the sibling of
 * `../skills/view.ts`. Combines the name-collision check, approval trust,
 * enablement and (optionally) per-workspace activation into the four statuses
 * the renderer shows.
 *
 *  - shadowed     : the name collides with a bridge `/hv-*` command, so Pi can
 *                   never reach this file (see RESERVED_SLASH_COMMANDS)
 *  - needs-review : not approved at the current content hash (new OR changed)
 *  - active       : approved + enabled (+ active in this workspace when a
 *                   workspace activation map is supplied)
 *  - disabled     : approved but switched off (globally or for this workspace)
 *
 * `shadowed` takes skills' `error` slot, and outranks every other status rather
 * than merely competing with them: approval, enablement and activation all
 * describe whether HappyVibe passes `--prompt-template`, and none of them can
 * make a shadowed command reachable.
 */
export type PromptTemplateStatus = "active" | "disabled" | "needs-review" | "shadowed";

/**
 * Command names the bridge registers as extension commands. Pi matches
 * extension commands and RETURNS before it ever looks at prompt templates
 * (`core/agent-session.js:799-806`), so a `.md` named after one of these is
 * dead on disk while still appearing in `get_commands` as `source:"prompt"` —
 * silently, which is why we surface it as its own status instead.
 *
 * Do not hand-edit this to match a hunch: `tests/commands-reserved.test.ts`
 * re-derives it by scanning every `pi.registerCommand("…")` in
 * `pi-runtime/extensions/happyvibe-bridge.ts`. If that test just went red, you
 * added (or renamed) an `/hv-*` command — add it here too.
 */
export const RESERVED_SLASH_COMMANDS: ReadonlySet<string> = new Set([
  "hv-agents",
  "hv-auth-status",
  "hv-context",
  "hv-context-remove",
  "hv-context-restore",
  "hv-dangerous",
  "hv-login",
  "hv-login-cancel",
  "hv-logout",
  "hv-plan",
  "hv-rules-reload",
  "hv-subagent-interrupt",
  "hv-subagent-list",
  "hv-subagent-stop-child",
  "hv-sysprompt",
  "hv-tools",
]);

/** A bare command name (no leading slash), as discovery derives it from the filename. */
export function isShadowed(name: string): boolean {
  return RESERVED_SLASH_COMMANDS.has(name);
}

export interface PromptTemplateView {
  id: string;
  name: string;
  description: string;
  argumentHint?: string;
  source: DiscoveredPromptTemplate["source"];
  status: PromptTemplateStatus;
  hasBashInjection: boolean;
  estTokens: DiscoveredPromptTemplate["estTokens"];
  /** true when it was approved before but the content changed — the re-review case (diff available). */
  changed: boolean;
  provenance?: PromptTemplateProvenance;
}

/**
 * @param activation per-workspace checklist (templateId → on/off). Omit for the
 * global Commands screen (status reflects the global enabled flag only). Supply
 * it for the workspace settings view (status reflects approved ∩ active-here).
 */
export function toPromptTemplateView(
  cmd: DiscoveredPromptTemplate,
  registry: Pick<PromptTemplateRegistry, "approvalStatus" | "record">,
  activation?: Record<string, boolean>,
): PromptTemplateView {
  const rec = registry.record(cmd.id);
  const needsReview = registry.approvalStatus(cmd) !== "approved";
  let status: PromptTemplateStatus;
  if (isShadowed(cmd.name)) {
    status = "shadowed";
  } else if (needsReview) {
    status = "needs-review";
  } else if (rec?.enabled !== true) {
    status = "disabled";
  } else {
    status = activation && (activation[cmd.id] ?? true) === false ? "disabled" : "active";
  }
  return {
    id: cmd.id,
    name: cmd.name,
    description: cmd.description,
    argumentHint: cmd.argumentHint,
    source: cmd.source,
    status,
    hasBashInjection: cmd.hasBashInjection,
    estTokens: cmd.estTokens,
    // changed = there's an approval record but the hash no longer matches. Keyed
    // off the approval axis, not `status`, so a shadowed row still offers its diff.
    changed: needsReview && !!rec && rec.hash !== "" && rec.hash !== cmd.hash,
    provenance: rec?.provenance,
  };
}
