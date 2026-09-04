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
import type { LedgerTotal } from "./calls";

export type RestoreItem =
  // §24: `command` is present when this user message was a prompt-template
  // expansion — the renderer then draws the command card instead of the bubble.
  // §7 round 12: `images` are data URLs rebuilt from the file's image blocks;
  // `imagesDropped` marks a message whose images exceeded the payload budget.
  | {
      kind: "user" | "assistant";
      text: string;
      promptTemplate?: { typed: string };
      images?: string[];
      imagesDropped?: boolean;
      /** Round 15: epoch ms from the session file. Absent on older entries. */
      ts?: number;
      /** Round 15: assistant only, and only on the LAST bubble of a turn — how
          long the turn took, from the user message that started it. */
      turnMs?: number;
    }
  // §7 round 16: the agent's own reasoning, dropped on purpose until this
  // round. Rendered collapsed, so a reopened session shows what a live one does.
  | { kind: "thinking"; text: string; ts?: number }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      args: unknown;
      result?: string;
      error?: boolean;
      images?: string[];
      imagesDropped?: boolean;
      /** §12 (2026-08-30): an async delegation's run id, so a reopened card can
          inspect its child. Absent for every non-delegation card and for a
          blocking (`async:false`) delegation, which has no detached run. */
      asyncId?: string;
      /** Round 15: epoch ms — the RESULT's stamp where there is one (when the
          tool finished), else the call's. Not rendered on the card; it is what
          lets a turn ending in a tool call measure its true length. */
      ts?: number;
      /** §12/§19: what this delegation cost. Filled by main from the child's own
          session files, so a reopened card shows the live run's numbers. Absent
          for every non-delegation card and for runs whose files are gone. */
      subagentCost?: LedgerTotal;
      /** §33: what a memory card shows when expanded, and what its Forget button needs. Carried
          STRUCTURALLY from the tool result's `details` — the flattened text says the slug in
          prose, and a card rebuilt by parsing prose is a card that breaks on a copy edit.
          Absent for every non-memory card. */
      memory?: { scope: "global" | "workspace"; type?: string; name: string; description?: string; replaced?: boolean };
    }
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
  /**
   * §12 (2026-08-30): a toolResult's structured sibling of `content`.
   *
   * `messageText` keeps only the text blocks, so an async delegation's
   * `details.asyncId` was dropped on restore — and that id is the ONLY way a
   * reopened card can ask upstream for its child's transcript. Measured on a
   * real session file: the text block spells the id inside `[brackets]` but the
   * structured field is right here, so it is read rather than parsed back out.
   */
  details?: {
    asyncId?: unknown;
    /** §33: the memory card's fields. Same reasoning as asyncId directly above — read from the
     *  structured sibling, never parsed back out of the text. */
    scope?: unknown;
    type?: unknown;
    name?: unknown;
    description?: unknown;
    replaced?: unknown;
  };
  /**
   * Round 15: epoch ms, written by Pi on every message entry. Measured on a real
   * session file — `entry.timestamp` is an ISO string but `entry.message
   * .timestamp` (this one) is a number, and it is the message-level one that
   * survives into `restoreItems`.
   */
  timestamp?: number;
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

/**
 * §7 round 12 — the image blocks of a message's content, as data URLs.
 *
 * Pi persists `{type:"image", data:<base64>, mimeType}` (measured across 61 real
 * session files), which is the same shape the composer's `attachmentUrl` builds,
 * so one renderer component displays live and restored images alike.
 *
 * ponytail: the budget is inline and per-restore. Reopening is a 1–5 ms file
 * read (§17 round 10) and the whole point is that the transcript paints before
 * the child spawns — so a session full of screenshots must not turn that into a
 * multi-megabyte IPC payload. Worst real session measured: 1.80 MB of image in
 * a 1.86 MB file, comfortably under. Upgrade path if this cap is ever hit in
 * practice: emit a locator and fetch the bytes lazily instead of inlining them.
 */
export const RESTORE_IMAGE_BUDGET = 8_000_000; // chars of base64 per restore

export function imagesOf(
  content: unknown,
  budget: { left: number },
): { images?: string[]; imagesDropped?: boolean } {
  if (!Array.isArray(content)) return {};
  const images: string[] = [];
  let dropped = false;
  for (const b of content) {
    const blk = b as { type?: string; data?: string; mimeType?: string };
    if (blk.type !== "image" || !blk.data) continue;
    if (blk.data.length > budget.left) {
      dropped = true;
      continue;
    }
    budget.left -= blk.data.length;
    images.push(`data:${blk.mimeType ?? "image/png"};base64,${blk.data}`);
  }
  // Undefined rather than [] so a session with no images restores to exactly
  // the object shape it did before this existed.
  return { ...(images.length ? { images } : {}), ...(dropped ? { imagesDropped: true } : {}) };
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
export function pairPromptTemplateItems(items: RestoreItem[], typedByHash: Map<string, string>): RestoreItem[] {
  if (typedByHash.size === 0) return items;
  for (const it of items) {
    if (it.kind !== "user") continue;
    const typed = typedByHash.get(expandedHash(it.text));
    if (typed) it.promptTemplate = { typed };
  }
  return items;
}

/** Round 15: the message's epoch-ms stamp, as a spreadable patch. */
const tsOf = (m: RawMessage): { ts?: number } =>
  typeof m.timestamp === "number" && Number.isFinite(m.timestamp) ? { ts: m.timestamp } : {};

/**
 * Round 15 — stamp each turn's LAST assistant bubble with how long it took.
 *
 * A "turn" is one user message and everything until the next one. The duration
 * runs to the last STAMPED item of that run — tool cards included, which is why
 * they carry a `ts` nobody renders: a turn very often ends on a tool call (the
 * agent edits a file and says nothing after), and stopping at the last text
 * bubble would report a turn as shorter than it was. Only the final bubble
 * displays it, so a five-bubble turn shows one duration, not five running
 * totals. A turn with no trailing bubble shows none — there is nowhere to put
 * it, and inventing a row for a number is worse than omitting the number.
 */
function stampTurnDurations(items: RestoreItem[]): RestoreItem[] {
  // The union's message member is `kind: "user" | "assistant"`, so
  // Extract<…, {kind:"assistant"}> is `never` — name the member instead.
  //
  // §7 round 16: matched on KIND, not on `{ text: string }`. The thinking item
  // also carries `text`, so the structural form silently widened this to a
  // member with no `turnMs` — a duration belongs on a bubble, never on the
  // reasoning that preceded it. (A thinking item still moves `lastTs` below,
  // which is right: a turn that ends thinking really did run that long.)
  type MsgItem = Extract<RestoreItem, { kind: "user" | "assistant" }>;
  const stampOf = (it: RestoreItem): number | undefined => ("ts" in it ? it.ts : undefined);

  let turnStart: number | undefined;
  let lastBubble: MsgItem | null = null;
  let lastTs: number | undefined;
  const close = (): void => {
    if (lastBubble && turnStart !== undefined && lastTs !== undefined && lastTs > turnStart) {
      lastBubble.turnMs = lastTs - turnStart;
    }
    lastBubble = null;
  };
  for (const it of items) {
    const ts = stampOf(it);
    if (it.kind === "user") {
      close();
      turnStart = ts;
      lastTs = ts;
      continue;
    }
    if (ts !== undefined) lastTs = ts;
    if (it.kind === "assistant") lastBubble = it;
  }
  close();
  return items;
}

/**
 * Strip the app-authored context blocks from a reconstructed user message.
 *
 * §9 (open files), §26 (agent terminals) and §28 (the browser pane) append a
 * block to the OUTGOING prompt so the agent can see what the user is looking at.
 * That text is part of the user message Pi records, so it lives in the session
 * file — and while the live renderer echoes only what was typed, a RELOAD
 * reconstructs the bubble from the file and the machinery shows up inside the
 * user's own words. Reported 2026-08-22, when a reload surfaced an
 * <open-browser> block in a prompt about a penalty game.
 *
 * §24 already solved this exact shape for prompt-template expansions by storing
 * the typed form and showing that instead; these three blocks had no equivalent.
 * Stripping is the cheaper half of the same idea: the blocks are machine-authored
 * with fixed delimiters, so they can be removed exactly.
 *
 * Removed only from the END, one block at a time, because that is precisely how
 * they are appended. A user who types "<open-browser>" mid-sentence keeps it —
 * anything with text after it is theirs, not ours.
 */
const TRAILING_CONTEXT_BLOCK =
  /\n{0,2}<(open-files|open-terminals|open-browser)>\n[\s\S]*?\n<\/\1>[ \t]*$/;

export function stripInjectedContext(text: string): string {
  let out = text.trimEnd();
  for (;;) {
    const next = out.replace(TRAILING_CONTEXT_BLOCK, "").trimEnd();
    if (next === out) return out;
    out = next;
  }
}

export function restoreItems(raw: RawMessage[]): RestoreItem[] {
  const items: RestoreItem[] = [];
  // §7 round 12: one budget for the whole restore — see imagesOf.
  const budget = { left: RESTORE_IMAGE_BUDGET };
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
        // The result's stamp is when the tool FINISHED — truer than the call's
        // for a turn that ends on a long-running command.
        if (typeof m.timestamp === "number") tool.ts = m.timestamp;
        // §12 (2026-08-30): read, never parsed back out of the flattened text
        // (see RawMessage.details). Without it a reopened delegation card has no
        // id to inspect its child with, and expands to an empty panel.
        if (typeof m.details?.asyncId === "string" && m.details.asyncId) tool.asyncId = m.details.asyncId;
        // §33: the same lift for a memory card. Gated on the TOOL NAME rather than on the
        // fields, because `name` and `type` are common words that other tools' details could
        // carry — this must never turn some future tool's result into a memory card.
        if (m.toolName?.startsWith("memory_") && typeof m.details?.name === "string" && m.details.name) {
          const sc = m.details.scope === "workspace" ? "workspace" : "global";
          tool.memory = {
            scope: sc,
            name: m.details.name,
            ...(typeof m.details.type === "string" ? { type: m.details.type } : {}),
            ...(typeof m.details.description === "string" ? { description: m.details.description } : {}),
            ...(typeof m.details.replaced === "boolean" ? { replaced: m.details.replaced } : {}),
          };
        }
        // §7 round 12: a screenshot comes back HERE — 7 of the 8 image blocks
        // found in real session files were tool results.
        Object.assign(tool, imagesOf(m.content, budget));
      }
      continue;
    }
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.role === "user") {
      // Drop the app-authored context blocks — see stripInjectedContext.
      const text = stripInjectedContext(messageText(m.content)).trim();
      const pics = imagesOf(m.content, budget);
      // A message that is JUST a picture is not empty — the old text-only guard
      // reconstructed it as nothing at all.
      if (text || pics.images || pics.imagesDropped) items.push({ kind: "user", text, ...pics, ...tsOf(m) });
      continue;
    }
    // Assistant: text bubbles, thinking blocks and tool cards, in document order.
    const blocks = Array.isArray(m.content) ? m.content : [];
    for (const b of blocks) {
      const block = b as { type?: string; text?: string; id?: string; name?: string; arguments?: unknown };
      if (block.type === "thinking") {
        // §7 round 16: restored WHOLE and unbudgeted. Measured on a real
        // install, the worst session carries 407k chars of thinking against a
        // median of 6k — 5% of the image budget, and this file is already
        // parsed end to end, so a second budget would buy nothing.
        const thought = (b as { thinking?: string }).thinking ?? block.text ?? "";
        if (thought.trim()) items.push({ kind: "thinking", text: thought, ...tsOf(m) });
      } else if (block.type === "text" && block.text?.trim()) {
        items.push({ kind: "assistant", text: block.text, ...tsOf(m) });
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
          ...tsOf(m),
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
  return stampTurnDurations(
    items.filter((it, i) => it.kind !== "plan" || (it.planPath !== "" && lastPlanIdx.get(it.planPath) === i)),
  );
}
