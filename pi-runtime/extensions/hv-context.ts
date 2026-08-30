/**
 * HappyVibe context-visibility core (B5) — PURE module, zero imports.
 *
 * Lives next to the bridge so Pi's extension loader can resolve it at runtime,
 * and is imported directly by vitest. One implementation, logic never forks.
 *
 * THE PROBLEM this module solves: the panel (renderer) identifies removable
 * items by session-entry id (from get_entries). But the `context` event — the
 * only place removal can actually take effect — hands the bridge an
 * AgentMessage[] with NO entry ids. The only identifiers present in BOTH
 * get_entries entries AND context-event messages are:
 *   - toolCall.id / toolResult.toolCallId  (tool pairs)
 *   - message.timestamp                     (plain user/assistant messages)
 * So a "mark key" is one of those, and the panel must send us mark keys, not
 * entry ids. mark-key derivation from a get_entries entry is `entryMarkKey`.
 *
 * HARD RULE (s0.3): only COMPLETED turns are removable. Stripping the in-flight
 * turn's toolCall/toolResult pair made the model re-run the tool forever
 * (579-turn runaway). `completedMarkKeys` is the allow-list; the bridge refuses
 * any mark key not in it, and the renderer must not offer them.
 */

// ── Minimal structural types (mirror pi session-format.md; we read, never build) ──

export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | ToolCallBlock
  | { type: string; [k: string]: unknown };

export interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | "custom" | "bashExecution" | "branchSummary" | "compactionSummary";
  content?: string | ContentBlock[];
  /** toolResult only. */
  toolCallId?: string;
  toolName?: string;
  timestamp?: number;
  usage?: MessageUsage;
  // custom
  customType?: string;
  [k: string]: unknown;
}

export interface MessageUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

/** A get_entries entry (only the fields we touch). */
export interface SessionEntry {
  type: string; // "message" | "compaction" | "branch_summary" | "custom" | "custom_message" | "label" | ...
  id: string;
  parentId?: string | null;
  timestamp?: string | number;
  message?: AgentMessage;
  // compaction
  summary?: string;
  customType?: string;
  data?: unknown;
}

// ── Mark keys ──────────────────────────────────────────────────────────────
// A stable identifier shared between get_entries and the context event.

export type MarkKey = `tool:${string}` | `msg:${number}`;

const toolKey = (toolCallId: string): MarkKey => `tool:${toolCallId}`;
const msgKey = (timestamp: number): MarkKey => `msg:${timestamp}`;

function contentBlocks(m: AgentMessage): ContentBlock[] {
  return Array.isArray(m.content) ? m.content : [];
}

/**
 * Every mark key a single message contributes. An assistant message with tool
 * calls contributes one tool:<id> per call (removing the assistant text also
 * removes its calls, which drag their results — pairing-aware by construction).
 * A toolResult contributes its tool:<id>. Everything else keys on timestamp.
 */
export function messageMarkKeys(m: AgentMessage): MarkKey[] {
  if (m.role === "toolResult" && m.toolCallId) return [toolKey(m.toolCallId)];
  if (m.role === "assistant") {
    const calls = contentBlocks(m).filter((b): b is ToolCallBlock => b.type === "toolCall" && typeof (b as ToolCallBlock).id === "string");
    if (calls.length) return calls.map((c) => toolKey(c.id));
  }
  return typeof m.timestamp === "number" ? [msgKey(m.timestamp)] : [];
}

/** The mark key the renderer should send when the user selects this entry. */
export function entryMarkKey(entry: SessionEntry): MarkKey | null {
  if (entry.type !== "message" || !entry.message) return null;
  const keys = messageMarkKeys(entry.message);
  return keys[0] ?? null;
}

// ── Pairing ─────────────────────────────────────────────────────────────────

/**
 * Expand a user selection to the FULL atomic removal set. Selecting either half
 * of a toolCall/toolResult pair must remove both, so:
 *   - a tool:<id> mark drops the assistant's call block AND the toolResult;
 *     both already share tool:<id>, so no expansion is needed for that.
 *   - selecting an assistant message with N calls yields N tool:<id> keys
 *     (from messageMarkKeys) — each drags its result. Atomic.
 * This function just normalises + dedupes the keys the renderer sends.
 */
export function expandSelection(keys: MarkKey[]): MarkKey[] {
  return [...new Set(keys)];
}

// ── Completed-turn gate (s0.3 HARD RULE) ─────────────────────────────────────

/**
 * Mark keys that belong to COMPLETED turns and are therefore safe to remove.
 * "In-flight" = everything at or after the last user message: the turn the
 * model is (or was last) working on. Removing any of its messages risks the
 * runaway re-execution loop from the spike. We treat the last user message and
 * all entries after it as in-flight; everything before is completed.
 */
export function completedMarkKeys(entries: SessionEntry[]): Set<MarkKey> {
  const msgs = entries.filter((e) => e.type === "message" && e.message);
  let lastUserIdx = -1;
  for (let i = 0; i < msgs.length; i++) if (msgs[i].message!.role === "user") lastUserIdx = i;
  const completed = new Set<MarkKey>();
  const cutoff = lastUserIdx < 0 ? msgs.length : lastUserIdx; // no user msg → nothing in-flight
  for (let i = 0; i < cutoff; i++) {
    for (const k of messageMarkKeys(msgs[i].message!)) completed.add(k);
  }
  return completed;
}

/** Keep only mark keys from completed turns. Bridge REFUSES the rest. */
export function acceptableMarks(requested: MarkKey[], entries: SessionEntry[]): { accepted: MarkKey[]; refused: MarkKey[] } {
  const ok = completedMarkKeys(entries);
  const accepted: MarkKey[] = [];
  const refused: MarkKey[] = [];
  for (const k of expandSelection(requested)) (ok.has(k) ? accepted : refused).push(k);
  return { accepted, refused };
}

// ── Context filter (runs in the bridge's `context` handler) ──────────────────

/**
 * Drop marked messages non-destructively (session file untouched — s0.3).
 * Pairing: a tool:<id> mark drops both the toolResult message AND the matching
 * toolCall block inside the assistant message. If stripping calls empties an
 * assistant message of all content, drop the whole message so we never send an
 * empty assistant turn to the provider.
 */
export function filterMessages<M extends { role: string; content?: unknown; toolCallId?: string; timestamp?: number }>(
  messages: M[],
  marks: Set<MarkKey>,
): M[] {
  // Identity-preserving generic: the bridge passes upstream's AgentMessage[]
  // (this module stays zero-import, so the bound is structural, not upstream's).
  if (marks.size === 0) return messages;
  const out: M[] = [];
  for (const m of messages) {
    if (m.role === "toolResult" && m.toolCallId && marks.has(toolKey(m.toolCallId))) continue;
    if (typeof m.timestamp === "number" && marks.has(msgKey(m.timestamp))) continue;
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const blocks = m.content as ContentBlock[]; // every block shape carries `type`
      const kept = blocks.filter((b) => !(b.type === "toolCall" && marks.has(toolKey((b as ToolCallBlock).id))));
      if (kept.length === 0) continue; // whole assistant turn was tool calls, all removed
      // Same message, a subset of its own content array — still an M.
      if (kept.length !== blocks.length) { out.push({ ...m, content: kept } as M); continue; }
    }
    out.push(m);
  }
  return out;
}

// ── Panel serialization (compact, for the hv.context notify) ─────────────────

export interface ContextGroup {
  system: SystemBlock | null;
  items: ContextItem[];
}

export interface SystemBlock {
  /** char length of the system prompt string. */
  chars: number;
  estTokens: number;
  toolCount: number;
  contextFiles: Array<{ path: string; chars: number; estTokens: number }>;
  /** v5: per-tool schema sizes (estimated from the LLM tool spec) for drill-in. */
  toolDefs?: Array<{ name: string; chars: number }>;
}

export interface ContextItem {
  markKey: MarkKey | null;
  entryId: string;
  /** UI group. */
  group: "conversation" | "tool" | "compaction" | "branch" | "other";
  role?: string;
  toolName?: string;
  /** the tool pair's shared id, for rendering "paired" affordance. */
  toolCallId?: string;
  preview: string;
  chars: number;
  estTokens: number;
  /** measured, from an assistant message's own usage. */
  usage?: { input?: number; output?: number; total?: number };
  removable: boolean;
}

/** char-based token estimate. ≈ chars/4 — always LABELED estimated in the UI. */
export const estTokens = (chars: number): number => Math.ceil(chars / 4);

function messageText(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      b.type === "text" ? (b as { text?: string }).text ?? ""
      : b.type === "toolCall" ? `${(b as ToolCallBlock).name}(${JSON.stringify((b as ToolCallBlock).arguments ?? {})})`
      : b.type === "thinking" ? "" : "",
    )
    .filter(Boolean)
    .join("\n");
}

const PREVIEW = 120;
const preview = (s: string): string => (s.length > PREVIEW ? s.slice(0, PREVIEW - 1) + "…" : s);

/**
 * Entry types the context panel never lists: HappyVibe's own control-channel
 * entries (label/custom/custom_message carry context marks and plan state), and
 * Pi's session bookkeeping (session/model_change/thinking_level_change/
 * session_info carry only provider+modelId, thinkingLevel, or a session name —
 * no message, no tokens). Verified against Pi's docs/session-format.md.
 */
const SKIPPED_ENTRY_TYPES = new Set([
  "label",
  "custom",
  "custom_message",
  "session",
  "model_change",
  "thinking_level_change",
  "session_info",
]);

function groupOf(entry: SessionEntry): ContextItem["group"] {
  if (entry.type === "compaction") return "compaction";
  if (entry.type === "branch_summary") return "branch";
  if (entry.type !== "message") return "other";
  const role = entry.message?.role;
  if (role === "toolResult") return "tool";
  if (role === "bashExecution") return "tool"; // v5: bash runs are tool activity, not "other"
  if (role === "assistant" && Array.isArray(entry.message?.content) && entry.message.content.some((b) => b.type === "toolCall")) return "tool";
  return "conversation";
}

/**
 * Serialize get_entries into the compact snapshot the renderer groups & sizes.
 * `removable` reflects the completed-turn gate so the UI never offers an
 * in-flight item.
 */
export function serializeEntries(entries: SessionEntry[]): ContextItem[] {
  const completed = completedMarkKeys(entries);
  const items: ContextItem[] = [];
  for (const entry of entries) {
    // §9 round 6: the bookkeeping types above rendered as unnamed "item ≈0 tok"
    // rows and were the last occupants of "Other". Drop them here so the panel
    // only lists real consumers of the window.
    if (SKIPPED_ENTRY_TYPES.has(entry.type)) continue;
    if (entry.type === "message" && !entry.message) continue;
    const m = entry.message;
    let text = "";
    if (entry.type === "compaction" || entry.type === "branch_summary") text = entry.summary ?? "";
    else if (m) text = m.role === "toolResult" ? messageText(m.content) : messageText(m?.content);
    const chars = text.length;
    const key = entryMarkKey(entry);
    const toolCallId =
      m?.role === "toolResult" ? m.toolCallId
      : m?.role === "assistant" && Array.isArray(m.content)
        ? (m.content.find((b) => b.type === "toolCall") as ToolCallBlock | undefined)?.id
        : undefined;
    items.push({
      markKey: key,
      entryId: entry.id,
      group: groupOf(entry),
      role: m?.role,
      toolName: m?.role === "toolResult" ? m.toolName : m?.role === "assistant" && Array.isArray(m.content) ? (m.content.find((b) => b.type === "toolCall") as ToolCallBlock | undefined)?.name : undefined,
      toolCallId,
      preview: preview(text.replace(/\s+/g, " ").trim()),
      chars,
      estTokens: estTokens(chars),
      usage: m?.role === "assistant" && m.usage ? { input: m.usage.input, output: m.usage.output, total: m.usage.totalTokens } : undefined,
      removable: key !== null && completed.has(key),
    });
  }
  return items;
}

export interface ToolSpecLike {
  name?: string;
  description?: string;
  parameters?: unknown;
}

/**
 * Pi passes `systemPromptOptions.selectedTools` as a string[] of tool NAMES
 * (core/agent-session.js builds it from validToolNames) — not as tool specs.
 * Join those names against pi.getAllTools() to recover each tool's real schema
 * so the context panel can name it and size it. Unknown name → chars 0, which
 * the renderer labels rather than showing a fabricated estimate.
 */
export function buildToolDefs(selectedTools: unknown, allTools: ToolSpecLike[]): { name: string; chars: number }[] {
  if (!Array.isArray(selectedTools)) return [];
  const byName = new Map<string, ToolSpecLike>();
  for (const t of allTools) if (typeof t?.name === "string") byName.set(t.name, t);
  const out: { name: string; chars: number }[] = [];
  for (const entry of selectedTools) {
    const name = typeof entry === "string" ? entry : typeof (entry as ToolSpecLike)?.name === "string" ? (entry as ToolSpecLike).name! : "";
    if (!name) continue;
    const spec = byName.get(name) ?? (typeof entry === "string" ? undefined : (entry as ToolSpecLike));
    const chars = spec ? JSON.stringify({ name, description: spec.description, parameters: spec.parameters }).length : 0;
    out.push({ name, chars });
  }
  return out;
}
