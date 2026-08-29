/**
 * Making pi-subagents' SILENT model substitution visible (§2/§19).
 *
 * pi-subagents 0.57 caches "this model failed" verdicts and then skips that model
 * on every later delegation. One flaky child is enough — the reason we saw was
 * "Subagent produced no output (possible model cold-start or empty response)" —
 * the default TTL is **24 hours**, and the store is keyed per-UID, so it spans
 * every session and every workspace rather than the run that tripped it.
 *
 * The only signal upstream emits is a `console.warn` (`model-fallback.ts`), which
 * reaches a developer's terminal as `[pi:stderr]` and a user not at all. So the
 * chat keeps showing the model they chose while their sub-agents quietly run on a
 * different one, and are billed at a different rate. Observed on a real install
 * 2026-08-29: `openrouter/qwen/qwen3.8-flash` excluded for 24h, nothing on screen.
 *
 * 0.58 sharpened it: #1556 makes an EXPLICITLY requested model fail closed rather
 * than fall back, so a per-agent model override plus one empty response means that
 * agent's delegations simply fail for a day, with the reason only on stderr.
 *
 * Two responses, and this module is the second:
 *   1. `writeSubagentConfig` sets `modelExclusions.defaultTtlMs` (5 min), so a
 *      cold-start blip costs minutes instead of a day. Setting it explicitly also
 *      shortens entries already on disk, so a stale 24h record self-heals.
 *   2. Every live exclusion becomes an audit row — §6's home for what the app did
 *      on your behalf — naming the model, the reason and when it lapses.
 *
 * **The path is OURS, not derived.** Upstream defaults to
 * `<TEMP_ROOT_DIR>/model-exclusions.json`, where TEMP_ROOT_DIR is an internal
 * `os.tmpdir()/pi-subagents-<scopeId>` derivation. Re-implementing that is exactly
 * the move the MCP keychain drift punished (CLAUDE.md: never mirror an upstream
 * storage format). It honours `PI_MODEL_EXCLUSIONS_PATH` instead, which spawn.ts
 * sets, so main reads a file whose location it chose. Side benefit: it survives a
 * tmp sweep, which with a 5-minute TTL costs nothing.
 */
import * as fs from "node:fs";

/** The env var pi-subagents reads its exclusions path from (EXCLUSIONS_PATH_ENV). */
export const EXCLUSIONS_PATH_ENV = "PI_MODEL_EXCLUSIONS_PATH";

/** One cached verdict as pi-subagents persists it. Every field treated as unknown. */
export interface ExclusionLike {
  modelId?: unknown;
  provider?: unknown;
  reason?: unknown;
  expiresAt?: unknown;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** `provider/modelId`, as upstream's own skip message spells it. */
export function exclusionModel(x: ExclusionLike | undefined): string | undefined {
  const id = str(x?.modelId);
  if (!id) return undefined;
  const provider = str(x?.provider);
  return provider ? `${provider}/${id}` : id;
}

/**
 * Stable identity for "already reported".
 *
 * Includes the expiry, so a RE-exclusion after the first lapsed is reported again —
 * that is a new fact about the user's model, not a repeat of the old one.
 */
export function exclusionKey(x: ExclusionLike | undefined): string | undefined {
  const model = exclusionModel(x);
  if (!model) return undefined;
  return `${model}@${typeof x?.expiresAt === "number" ? x.expiresAt : "?"}`;
}

/** Live exclusions only — an expired record is history, not a current substitution. */
export function liveExclusions(raw: unknown, now: number): ExclusionLike[] {
  const list = (raw as { exclusions?: unknown } | undefined)?.exclusions;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is ExclusionLike => {
    if (!x || typeof x !== "object") return false;
    const expiresAt = (x as ExclusionLike).expiresAt;
    return typeof expiresAt === "number" && expiresAt > now && !!exclusionModel(x as ExclusionLike);
  });
}

/**
 * The sentence the audit row shows: what was skipped, why, and for how long —
 * the three things the stderr line has and the user does not. Upstream's reason is
 * free text from a provider, so it is collapsed and length-capped, never trusted.
 */
export function formatExclusionNotice(x: ExclusionLike, now: number): string | undefined {
  const model = exclusionModel(x);
  if (!model) return undefined;
  const reason = str(x.reason)?.replace(/\s+/g, " ").slice(0, 160);
  const expiresAt = typeof x.expiresAt === "number" ? x.expiresAt : undefined;
  const mins = expiresAt ? Math.max(1, Math.round((expiresAt - now) / 60_000)) : undefined;
  const until = mins === undefined ? "" : mins < 60 ? ` for ~${mins} min` : ` for ~${Math.round(mins / 60)}h`;
  return `Sub-agents are not using ${model}${until}: pi-subagents cached a failure for it`
    + `${reason ? ` (${reason})` : ""}. Delegations fall back to another model until it lapses.`;
}

/** Read the store. Missing or malformed → no exclusions, never a throw. */
export function readExclusions(file: string, now: number): ExclusionLike[] {
  try {
    return liveExclusions(JSON.parse(fs.readFileSync(file, "utf8")), now);
  } catch {
    return [];
  }
}
