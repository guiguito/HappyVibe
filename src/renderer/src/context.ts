/**
 * B5 renderer-side pure helpers — gauge sourcing + context-panel grouping.
 * Pure functions only (unit-tested in tests/context.test.ts). Trust is the
 * product: a number is NEVER shown without its measured/estimated label.
 */

// ── Token gauge ──────────────────────────────────────────────────────────────

export interface SessionStats {
  tokens?: { input?: number; output?: number; total?: number };
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

// "pending": Pi has a window but no live measurement yet (tokens null) — most
// commonly right after compaction, before the next LLM response. We refuse to
// pass cumulative session totals off as the live context %, so the UI shows a
// "measuring…" state instead of a misleading number.
export type GaugeSource = "measured" | "estimated" | "pending";
export type GaugeZone = "calm" | "amber" | "red";

export interface Gauge {
  /** null when source is "pending" — there is no honest live number yet. */
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  source: GaugeSource;
  zone: GaugeZone;
}

// Color thresholds (own the styling — warm-workshop tokens). ~70 / ~90.
const AMBER = 70;
const RED = 90;
export const zoneOf = (percent: number): GaugeZone => (percent >= RED ? "red" : percent >= AMBER ? "amber" : "calm");

/**
 * Derive the gauge. Prefers Pi's measured contextUsage. When Pi has a window but
 * no live measurement yet (tokens null — the documented post-compaction gap,
 * types.d.ts:193) returns a "pending" gauge so the UI can show "measuring…"
 * rather than a stale/misleading number. Otherwise (no contextUsage at all)
 * falls back to a rough ESTIMATE against the model's window. Returns null when
 * there's nothing honest to show.
 *
 * NOTE: `stats.tokens.{input,output}` is CUMULATIVE-since-session-start (Pi sums
 * every assistant message's usage — agent-session.js getSessionStats), so it
 * does NOT drop after compaction and is only a rough proxy for live context.
 * That's why we never present it once Pi has a real window but null tokens
 * (post-compaction): that's the "pending" case, not an estimate. We prefer the
 * measured value whenever it's available.
 *
 * @param fallbackWindow the default model's contextWindow (from list-models)
 */
export function computeGauge(stats: SessionStats | null, fallbackWindow?: number | null): Gauge | null {
  const cu = stats?.contextUsage;
  // Measured: Pi gave a real window AND real usage (percent/tokens non-null).
  if (cu && cu.contextWindow > 0 && cu.tokens != null && cu.percent != null) {
    const percent = Math.round(cu.percent);
    return { tokens: cu.tokens, contextWindow: cu.contextWindow, percent, source: "measured", zone: zoneOf(percent) };
  }
  // Pending: Pi HAS a window but tokens are null (post-compaction, before the
  // next LLM response). Do NOT pass cumulative session totals off as live
  // context — show a "measuring…" state instead.
  if (cu && cu.contextWindow > 0) {
    return { tokens: null, contextWindow: cu.contextWindow, percent: null, source: "pending", zone: "calm" };
  }
  // Estimate: no contextUsage from Pi at all — rough proxy of cumulative usage
  // vs the model window (labeled "est." in the UI; see NOTE above).
  const window = fallbackWindow ?? 0;
  const tokens = (stats?.tokens?.input ?? 0) + (stats?.tokens?.output ?? 0);
  if (window > 0 && tokens > 0) {
    const percent = Math.round((tokens / window) * 100);
    return { tokens, contextWindow: window, source: "estimated", percent, zone: zoneOf(percent) };
  }
  return null;
}

// ── Context breakdown panel ──────────────────────────────────────────────────

export type MarkKey = string;

export interface ContextItem {
  markKey: MarkKey | null;
  entryId: string;
  group: "conversation" | "tool" | "compaction" | "branch" | "other";
  role?: string;
  toolName?: string;
  toolCallId?: string;
  preview: string;
  chars: number;
  estTokens: number;
  usage?: { input?: number; output?: number; total?: number };
  removable: boolean;
}

export interface SystemBlock {
  chars: number;
  estTokens: number;
  toolCount: number;
  contextFiles: Array<{ path: string; chars: number; estTokens: number }>;
  /** W2.3: nested AGENTS.md discovered via file-tool calls (dir is cwd-relative). */
  nested?: Array<{ dir: string; path: string; chars: number }>;
}

export interface ContextSnapshot {
  system: SystemBlock | null;
  items: ContextItem[];
  /** currently-removed mark keys (struck-through, restorable). */
  marks: MarkKey[];
}

/**
 * Parse an hv.context notify payload → snapshot, or null if it isn't one.
 * (fire-and-forget notify; message field carries the JSON, B4 convention.)
 */
export function parseContextSnapshot(r: { method?: string; message?: string }): ContextSnapshot | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    if (p.kind !== "hv.context" || p.stage !== "snapshot") return null;
    return {
      system: (p.system as SystemBlock | null) ?? null,
      items: Array.isArray(p.items) ? (p.items as ContextItem[]) : [],
      marks: Array.isArray(p.marks) ? (p.marks as MarkKey[]) : [],
    };
  } catch {
    return null;
  }
}

/** Parse an hv.context remove/restore ack (updates the mark set live). */
export function parseContextAck(r: { method?: string; message?: string }): { marks: MarkKey[] } | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    if (p.kind !== "hv.context" || (p.stage !== "removed" && p.stage !== "restored")) return null;
    return { marks: Array.isArray(p.marks) ? (p.marks as MarkKey[]) : [] };
  } catch {
    return null;
  }
}

/** Parse an hv.context-files notify (live nested AGENTS.md list — W2.3). */
export function parseContextFiles(r: { method?: string; message?: string }): SystemBlock["nested"] | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    if (p.kind !== "hv.context-files" || !Array.isArray(p.nested)) return null;
    return p.nested as NonNullable<SystemBlock["nested"]>;
  } catch {
    return null;
  }
}

export interface ContextGroupView {
  key: ContextItem["group"];
  label: string;
  items: ContextItem[];
  estTokens: number;
}

const GROUP_LABELS: Record<ContextItem["group"], string> = {
  conversation: "Conversation",
  tool: "Tool calls",
  compaction: "Compaction summaries",
  branch: "Branch summaries",
  other: "Other",
};
const GROUP_ORDER: ContextItem["group"][] = ["conversation", "tool", "compaction", "branch", "other"];

/** Group items for display, summing per-group estimated tokens (labeled est.). */
export function groupItems(items: ContextItem[]): ContextGroupView[] {
  const out: ContextGroupView[] = [];
  for (const key of GROUP_ORDER) {
    const group = items.filter((i) => i.group === key);
    if (group.length === 0) continue;
    out.push({ key, label: GROUP_LABELS[key], items: group, estTokens: group.reduce((n, i) => n + i.estTokens, 0) });
  }
  return out;
}

// ── W2.4: summary-first panel ────────────────────────────────────────────────

export interface CategorySummary {
  key: "system" | "files" | "tools" | ContextItem["group"];
  label: string;
  count: number;
  chars: number;
  estTokens: number;
  /** items in this category currently marked removed. */
  removedCount: number;
  /** integer % share of the total shown estTokens (0 when total is 0). */
  share: number;
  /** false when the size can't be measured (e.g. tool definitions) — the UI
      shows the count and labels the size "not measured" rather than "0". */
  measured?: boolean;
}

/**
 * Per-category summary rows for the panel's initial view: system prompt,
 * context files (incl. nested AGENTS.md), then the item groups in display
 * order. Sizes are the same char/4 estimates as the drill-in views.
 */
export function summarizeGroups(
  items: ContextItem[],
  system: SystemBlock | null,
  marks: MarkKey[] = [],
): CategorySummary[] {
  const removed = new Set(marks);
  const rows: CategorySummary[] = [];
  if (system) {
    rows.push({ key: "system", label: "System prompt + instructions", count: 1, chars: system.chars, estTokens: system.estTokens, removedCount: 0, share: 0 });
    const nested = system.nested ?? [];
    if (system.contextFiles.length > 0 || nested.length > 0) {
      rows.push({
        key: "files",
        label: "Context files & AGENTS.md",
        count: system.contextFiles.length + nested.length,
        chars: system.contextFiles.reduce((n, f) => n + f.chars, 0) + nested.reduce((n, f) => n + f.chars, 0),
        estTokens:
          system.contextFiles.reduce((n, f) => n + f.estTokens, 0) +
          nested.reduce((n, f) => n + Math.ceil(f.chars / 4), 0),
        removedCount: 0,
        share: 0,
      });
    }
    // #9: surface the tool definitions as their own line. Their token weight
    // isn't separately exposed by Pi (it's folded into the system prompt), so
    // show the count and mark the size "not measured" rather than omitting them.
    if (system.toolCount > 0) {
      rows.push({
        key: "tools",
        label: "Tool definitions",
        count: system.toolCount,
        chars: 0,
        estTokens: 0,
        removedCount: 0,
        share: 0,
        measured: false,
      });
    }
  }
  for (const g of groupItems(items)) {
    rows.push({
      key: g.key,
      label: g.label,
      count: g.items.length,
      chars: g.items.reduce((n, i) => n + i.chars, 0),
      estTokens: g.estTokens,
      removedCount: g.items.filter((i) => i.markKey != null && removed.has(i.markKey)).length,
      share: 0,
    });
  }
  const total = rows.reduce((n, r) => n + r.estTokens, 0);
  for (const r of rows) r.share = total > 0 ? Math.round((r.estTokens / total) * 100) : 0;
  return rows;
}

/** Total estimated tokens across the whole context (system + all items). */
export function totalEstTokens(snapshot: ContextSnapshot): number {
  const sys = snapshot.system ? snapshot.system.estTokens + snapshot.system.contextFiles.reduce((n, f) => n + f.estTokens, 0) : 0;
  return sys + snapshot.items.reduce((n, i) => n + i.estTokens, 0);
}
