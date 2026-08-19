/**
 * Give the main agent its sub-agent's WHOLE answer, in the turn it arrives.
 *
 * pi-subagents delivers a completed delegation by injecting a `subagent-notify`
 * message, and it builds that message as
 *
 *     `Workflow completed with N child run(s). Return: ${formatWorkflowValue(v).slice(0, 1_000)}`
 *
 * (`runs/foreground/subagent-executor.ts`) — the child's entire output embedded in
 * a JSON blob and then chopped at 1,000 characters, mid-string, with no config to
 * raise it. Measured on a real delegation: a 4,107-character report arrived as
 * 1,108 characters of invalid JSON. The model reacts exactly as you would expect —
 * it says the result was truncated and goes and fetches it — so ONE delegation cost
 * four tool calls (`subagent`, `subagent_wait`, `subagent {action:"status"}`,
 * `read`) and the user watched three of them scroll past.
 *
 * We already hold the real thing. `subagent:async-complete` carries
 * `results[].output` in full (4,107 chars in that same run), so the repair is to
 * remember it at completion and put it back into the message before the model ever
 * sees it. This is CHEAPER than the round-trip it replaces, not more expensive: the
 * model reads the artifact anyway, so the full text enters context either way — we
 * just save the tool call, its result envelope, and the model's narration.
 *
 * The join key is measured, not assumed. The message names the CHILD run
 * (`"runId": "65227ea7"`), while the async id we track elsewhere is the WORKFLOW's
 * UUID (`a2df09d4-…`) — different ids. `results[].runId` is the child's, and that is
 * what appears in the message, so that is the key.
 *
 * Pure and dependency-free apart from the redaction screen, so it is unit-testable.
 */
import { displayableTask } from "./hv-rules.ts";

/** Enough for a thorough report; past this the model should decide for itself
 *  whether to read the file, rather than us pushing ~10k tokens into every
 *  subsequent request. Upstream's own ceiling for a child's output is 200 KB. */
export const MAX_INLINE_DELIVERY = 32_000;

/** How many completed children to remember. A delivery follows its completion
 *  within one turn, so this only needs to cover bursts, never history. */
const MAX_REMEMBERED = 32;

/** The shape we care about on a context message. `content` is a STRING on the
 *  notify (measured) — not the block array other roles use. */
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

/**
 * Remember what a completed child actually said, keyed by ITS run id.
 * Accepts the raw `results` array off `subagent:async-complete`.
 */
export function rememberChildOutputs(store: ChildOutputStore, results: unknown): void {
  if (!Array.isArray(results)) return;
  for (const raw of results) {
    const r = raw as { runId?: unknown; agent?: unknown; output?: unknown; summary?: unknown };
    const runId = typeof r?.runId === "string" ? r.runId.trim() : "";
    // `output` and `summary` were byte-identical when measured; prefer `output`,
    // which is the child's answer rather than a notification-shaped rendering.
    const text = typeof r?.output === "string" && r.output.trim()
      ? r.output
      : typeof r?.summary === "string" ? r.summary : "";
    if (!runId || !displayableTask(text)) continue;
    store.set(runId, {
      ...(typeof r.agent === "string" && r.agent.trim() ? { agent: r.agent.trim() } : {}),
      output: text,
    });
    if (store.size > MAX_REMEMBERED) store.delete(store.keys().next().value as string);
  }
}

const HEADER = /^(Background task|Detached foreground task) (completed|failed|paused|stopped): \*\*(.+?)\*\*(.*)$/;
const RUN_ID = /"runId":\s*"([^"]+)"/g;

/**
 * Rewrite ONE notify's content to carry the child's whole answer, or return null
 * to leave it exactly as upstream wrote it.
 *
 * Refuses, deliberately, when:
 *  - the header is not upstream's shape (a future rewording must fall through
 *    untouched rather than be mangled by us);
 *  - the message names zero or MORE THAN ONE child — a parallel fan-out would
 *    otherwise get every child's message replaced by one child's answer;
 *  - we never saw that child's output;
 *  - the output is redacted, empty, or past MAX_INLINE_DELIVERY.
 *
 * The header line is preserved and only the agent name is corrected (upstream says
 * `**workflow**` for every top-level delegation now), so the result still parses as
 * upstream's own format — `parseSubagentNotifyContent` reads line 0 and the body.
 */
export function substituteDelivery(content: string, store: ChildOutputStore): string | null {
  if (typeof content !== "string" || !content) return null;
  const lines = content.split("\n");
  const header = HEADER.exec(lines[0] ?? "");
  if (!header) return null;

  const ids = [...content.matchAll(RUN_ID)].map((m) => m[1]);
  const unique = [...new Set(ids)];
  if (unique.length !== 1) return null;

  const held = store.get(unique[0]);
  const clean = held ? displayableTask(held.output) : undefined;
  if (!clean || clean.length > MAX_INLINE_DELIVERY) return null;
  // Nothing to gain if upstream already delivered the whole thing.
  if (content.includes(clean)) return null;

  const agent = held?.agent ?? header[3];
  return `${header[1]} ${header[2]}: **${agent}**${header[4]}\n\n${clean}`;
}

/**
 * Apply the repair across a context message list. Returns a NEW array when
 * anything changed, else null so the caller can leave the context untouched.
 */
export function substituteDeliveries(
  messages: DeliveryMessage[] | undefined,
  store: ChildOutputStore,
): DeliveryMessage[] | null {
  if (!Array.isArray(messages) || store.size === 0) return null;
  let changed = false;
  const out = messages.map((m) => {
    if (m?.customType !== "subagent-notify" || typeof m.content !== "string") return m;
    const next = substituteDelivery(m.content, store);
    if (next === null) return m;
    changed = true;
    return { ...m, content: next };
  });
  return changed ? out : null;
}
