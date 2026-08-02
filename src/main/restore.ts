/**
 * Reconstruct a session transcript from Pi's `get_messages` on reopen (round-4).
 * PURE + electron-free so it's unit-testable (tests/restore.test.ts).
 *
 * Pi's message model: user/assistant messages carry a `content` array of blocks
 * ({type:"text"} | {type:"thinking"} | {type:"toolCall", id, name, arguments}),
 * and tool output is a separate `role:"toolResult"` message with toolName/
 * toolCallId. The model-authored `intent` and the result both persist in the
 * file, so a reopened session can show the same tool cards it did live.
 */

import { createHash } from "node:crypto";

export type RestoreItem =
  // §24: `command` is present when this user message was a prompt-template
  // expansion — the renderer then draws the command card instead of the bubble.
  | { kind: "user" | "assistant"; text: string; command?: { typed: string } }
  | { kind: "tool"; toolCallId: string; toolName: string; args: unknown; result?: string; error?: boolean }
  // §23: the plan card, emitted at its plan_complete position (not the bottom).
  // planPath comes from the plan_complete tool RESULT; status/done/total are
  // filled by main (readPlan) so a reopened card shows its real state (e.g.
  // "implementing"), not a stale "draft".
  | { kind: "plan"; planPath: string; status?: string; done?: number; total?: number };

export interface RawMessage {
  role?: string;
  content?: unknown;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}

/**
 * §23: plan-mode tools are internal transitions, not raw tool cards. On reopen
 * the PlanCard is rebuilt from the bridge's hv.plan notify (planPath) instead,
 * so these are skipped here to avoid a confusing duplicate.
 */
const PLAN_TOOLS = new Set(["plan_complete", "plan_start", "plan_status_update"]);

/** Concatenate the text blocks of a message's content (drops thinking/tool blocks). */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => ((b as { type?: string; text?: string }).type === "text" ? (b as { text?: string }).text ?? "" : ""))
    .filter(Boolean)
    .join("\n");
}

/** plan_complete's result text is `Plan saved to <relPath>. It is ready…`. */
function planPathFromResult(text: string): string | null {
  return /Plan saved to (\S+?\.md)/.exec(text)?.[1] ?? null;
}

/**
 * §24: the join key between a logged `command.invoked` event and a restored user
 * message. Pi keeps only the expanded text, so the hash of that text is the only
 * thing both sides can agree on. TRIMMED on both sides — main hashes the
 * bridge's `expanded`, restore hashes the message text, and Pi's own trimming
 * would otherwise decide whether the card appears.
 */
export function expandedHash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

/**
 * §24: attach the typed form (`/review src/foo.ts`) to every restored user
 * message whose text matches a logged invocation. Pairing is by HASH, never by
 * ordinal: ask-user answers and queued messages are user messages too, so
 * counting them would misattribute the card after the first mismatch. Mutates in
 * place and returns the same array (the caller owns freshly built items).
 */
export function pairCommandItems(items: RestoreItem[], typedByHash: Map<string, string>): RestoreItem[] {
  if (typedByHash.size === 0) return items;
  for (const it of items) {
    if (it.kind !== "user") continue;
    const typed = typedByHash.get(expandedHash(it.text));
    if (typed) it.command = { typed };
  }
  return items;
}

export function restoreItems(raw: RawMessage[]): RestoreItem[] {
  const items: RestoreItem[] = [];
  const byCallId = new Map<string, Extract<RestoreItem, { kind: "tool" }>>();
  // §23: plan_complete calls tracked by callId so the RESULT can fill planPath.
  const planByCallId = new Map<string, Extract<RestoreItem, { kind: "plan" }>>();
  for (const m of raw) {
    if (m.role === "toolResult") {
      if (m.toolName === "plan_complete") {
        const plan = m.toolCallId ? planByCallId.get(m.toolCallId) : undefined;
        if (plan) plan.planPath = planPathFromResult(messageText(m.content)) ?? plan.planPath;
        continue;
      }
      if (m.toolName && PLAN_TOOLS.has(m.toolName)) continue; // plan_start/status_update: not a card
      const tool = m.toolCallId ? byCallId.get(m.toolCallId) : undefined;
      if (tool) {
        tool.result = messageText(m.content);
        tool.error = m.isError === true;
      }
      continue;
    }
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.role === "user") {
      const text = messageText(m.content).trim();
      if (text) items.push({ kind: "user", text });
      continue;
    }
    // Assistant: emit text bubbles and tool cards in document order (skip thinking).
    const blocks = Array.isArray(m.content) ? m.content : [];
    for (const b of blocks) {
      const block = b as { type?: string; text?: string; id?: string; name?: string; arguments?: unknown };
      if (block.type === "text" && block.text?.trim()) {
        items.push({ kind: "assistant", text: block.text });
      } else if (block.type === "toolCall" && block.id && block.name === "plan_complete") {
        // The plan card at the position the plan was submitted (path filled by the result).
        const plan: Extract<RestoreItem, { kind: "plan" }> = { kind: "plan", planPath: "" };
        items.push(plan);
        planByCallId.set(block.id, plan);
      } else if (block.type === "toolCall" && block.id && block.name && !PLAN_TOOLS.has(block.name)) {
        const tool: Extract<RestoreItem, { kind: "tool" }> = {
          kind: "tool",
          toolCallId: block.id,
          toolName: block.name,
          args: block.arguments,
        };
        items.push(tool);
        byCallId.set(block.id, tool);
      }
    }
  }
  // Revisions overwrite the same plan file → collapse to the LAST plan card per
  // path (its final position); drop cards whose path never resolved.
  const lastPlanIdx = new Map<string, number>();
  items.forEach((it, i) => { if (it.kind === "plan" && it.planPath) lastPlanIdx.set(it.planPath, i); });
  return items.filter((it, i) => it.kind !== "plan" || (it.planPath !== "" && lastPlanIdx.get(it.planPath) === i));
}
