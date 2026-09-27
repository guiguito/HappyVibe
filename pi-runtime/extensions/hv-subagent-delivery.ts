/**
 * Give the main agent its sub-agent's WHOLE answer, in the turn it arrives
 * (PRD §12 decision 4, 2026-09-26).
 *
 * The full answer arrives on the `subagents:completed` bus payload (hv-tw-relay
 * hands it here); the notification the model reads carries a truncated copy. The
 * context hook swaps the full one back in before the model ever sees it. That is
 * CHEAPER than the round-trip it replaces: the model would otherwise call
 * `get_subagent_result` to read it anyway.
 *
 * NOT persisted — the session file keeps what upstream sent; we repair what the
 * model sees. Pure and dependency-free apart from the redaction screen.
 */
import { displayableTask } from "./hv-rules.ts";

/** Enough for a thorough report; past this the model should decide for itself
 *  whether to fetch it, rather than us pushing ~10k tokens into every subsequent request. */
export const MAX_INLINE_DELIVERY = 32_000;

/** How many completed children to remember. A delivery follows its completion
 *  within one turn, so this only needs to cover bursts, never history. */
const MAX_REMEMBERED = 32;

/** The shape we care about on a context message. `content` is a STRING on the
 *  notification (measured) — not the block array other roles use. */
export interface DeliveryMessage {
  role?: unknown;
  customType?: unknown;
  content?: unknown;
}

export interface ChildOutput {
  agent?: string;
  output: string;
}

export type ChildOutputStore = Map<string, ChildOutput>;

export function createChildOutputStore(): ChildOutputStore {
  return new Map();
}

// tintinweb's completion notification is a `<task-notification>` XML string (customType
// "subagent-notification") whose `<result>` is cut at `resultMaxLen` with this pointer
// appended (formatTaskNotification, index.ts). The full text arrives on the
// `subagents:completed` bus payload, keyed by the same id as `<task-id>`.
const TW_TRUNCATED = "...(truncated, use get_subagent_result for full output)";
const TW_TASK_ID = /<task-id>([^<]+)<\/task-id>/g;
const TW_RESULT = /<result>[\s\S]*<\/result>/;

/** Upstream's own escape (xml.ts), so a repaired `<result>` is exactly what it would have sent. */
const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Remember one completed tintinweb run's full answer (from `subagents:completed.result`). */
export function rememberTwResult(store: ChildOutputStore, id: string, agent: string | undefined, result: string): void {
  if (!id || !displayableTask(result)) return;
  store.set(id, { ...(agent ? { agent } : {}), output: result });
  if (store.size > MAX_REMEMBERED) store.delete(store.keys().next().value as string);
}

/**
 * Repair one tintinweb notification, or null to leave it untouched: exactly one
 * `<task-id>` (a batch naming several is ambiguous), a result upstream actually
 * TRUNCATED (otherwise nothing is gained), and a remembered answer that fits.
 */
export function substituteTwNotification(content: string, store: ChildOutputStore): string | null {
  if (typeof content !== "string" || !content.includes("<task-notification>") || !content.includes(TW_TRUNCATED)) return null;
  const ids = [...content.matchAll(TW_TASK_ID)].map((m) => m[1]);
  if (ids.length !== 1) return null;
  const held = store.get(ids[0]);
  const clean = held ? displayableTask(held.output) : undefined;
  if (!clean || clean.length > MAX_INLINE_DELIVERY) return null;
  if (!TW_RESULT.test(content)) return null;
  return content.replace(TW_RESULT, () => `<result>${escapeXml(clean)}</result>`);
}

/**
 * Apply the repair across a context message list. Returns a NEW array when
 * anything changed, else null so the caller can leave the context untouched.
 */
export function substituteDeliveries<M extends DeliveryMessage>(
  messages: M[] | undefined,
  store: ChildOutputStore,
): M[] | null {
  // Identity-preserving generic: the bridge passes upstream's AgentMessage[].
  if (!Array.isArray(messages) || store.size === 0) return null;
  let changed = false;
  const out = messages.map((m) => {
    if (typeof m?.content !== "string") return m;
    const next = m.customType === "subagent-notification" ? substituteTwNotification(m.content, store) : null;
    if (next === null) return m;
    changed = true;
    // Same message, its (measured-string) content swapped for the repaired string.
    return { ...m, content: next } as M;
  });
  return changed ? out : null;
}
