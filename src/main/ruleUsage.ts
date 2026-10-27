/**
 * Round 29 (PRD §10): when did each permission rule last DECIDE a call?
 *
 * Read from the audit log: a `permission.decision` row carries the rule that decided it
 * (`data.rule`, with its scope) — and a bypass row carries the rule that WOULD have. A rule
 * that matched but lost to a stricter one is never credited, which is why the page says
 * "decided" and not "matched". A rule naming a retired tool reads "Never decided a call",
 * with no list of tool names to keep current. Pure and import-free (vitest, main).
 */
export interface RuleRef { layer: string; pattern: string; action: string; scope: "global" | "workspace" }
interface Row { ts: string; workspaceId?: string; data?: { rule?: RuleRef } }
type Plain = { layer: string; pattern: string; action: string };

export const ruleKey = (r: RuleRef, workspace?: string): string =>
  `${r.scope}|${r.scope === "workspace" ? (workspace ?? "") : ""}|${r.layer}|${r.action}|${r.pattern}`;

/** What the renderer looks a row up by, inside one scope's list. */
export const rowKey = (r: Plain): string => `${r.layer}|${r.action}|${r.pattern}`;

/** Latest ISO timestamp per ruleKey. `norm` folds a workspace path the way the app compares them. */
export function lastDecided(rows: readonly Row[], norm: (p: string) => string = (p) => p): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const rule = row.data?.rule;
    if (!rule || typeof rule.pattern !== "string") continue;
    const k = ruleKey(rule, rule.scope === "workspace" ? norm(row.workspaceId ?? "") : undefined);
    if (!out[k] || row.ts > out[k]) out[k] = row.ts;
  }
  return out;
}

/** The same answer shaped like the rules file: global rows, and each workspace's rows, by rowKey. */
export function lastDecidedByScope(
  rules: { global: Plain[]; workspaces: Record<string, Plain[]> },
  rows: readonly Row[],
  norm: (p: string) => string = (p) => p,
): { global: Record<string, string>; workspaces: Record<string, Record<string, string>> } {
  const all = lastDecided(rows, norm);
  const pick = (list: Plain[], scope: RuleRef["scope"], ws?: string): Record<string, string> =>
    Object.fromEntries(list.flatMap((r) => {
      const ts = all[ruleKey({ ...r, scope }, ws)];
      return ts ? [[rowKey(r), ts]] : [];
    }));
  return {
    global: pick(rules.global, "global"),
    workspaces: Object.fromEntries(Object.entries(rules.workspaces).map(([ws, list]) => [ws, pick(list, "workspace", norm(ws))])),
  };
}
