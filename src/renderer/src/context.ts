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

export type GaugeSource = "measured" | "estimated";
export type GaugeZone = "calm" | "amber" | "red";

export interface Gauge {
  tokens: number;
  contextWindow: number;
  percent: number;
  source: GaugeSource;
  zone: GaugeZone;
}

// Color thresholds (own the styling — warm-workshop tokens). ~70 / ~90.
const AMBER = 70;
const RED = 90;
export const zoneOf = (percent: number): GaugeZone => (percent >= RED ? "red" : percent >= AMBER ? "amber" : "calm");

/**
 * Derive the gauge. Prefers Pi's measured contextUsage. Falls back to a
 * char/usage-based ESTIMATE against the model's context window when Pi didn't
 * measure (e.g. no window available, or fresh post-compaction before the next
 * assistant response). Returns null when there's nothing honest to show.
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
  // Estimate: latest usage totals vs the model window.
  const window = cu?.contextWindow && cu.contextWindow > 0 ? cu.contextWindow : fallbackWindow ?? 0;
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

/** Total estimated tokens across the whole context (system + all items). */
export function totalEstTokens(snapshot: ContextSnapshot): number {
  const sys = snapshot.system ? snapshot.system.estTokens + snapshot.system.contextFiles.reduce((n, f) => n + f.estTokens, 0) : 0;
  return sys + snapshot.items.reduce((n, i) => n + i.estTokens, 0);
}
