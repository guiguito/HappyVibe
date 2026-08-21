/**
 * §12 (2026-08-21) — the live child transcript, pulled on demand.
 *
 * 0.50 stopped streaming child progress (`tool_execution_update` is never emitted
 * for a subagent) and upstream has since documented that absence as intended, so
 * a run card could only show status while running. pi-subagents 0.52 supplies the
 * honest replacement: `/subagents-inspect-rpc <requestId> <asyncId>` returns the
 * child's task, a bounded transcript window and its final output — **with no
 * model turn** — and keeps working after the result has been delivered.
 *
 * Main drives it as a slash command, exactly like `/hv-tools`. The reply comes
 * back the strange way: upstream calls `ctx.ui.setWidget(key, lines)` and
 * immediately retracts it, so the answer arrives as an `extension_ui_request`
 * with `method: "setWidget"` — the same channel as permission prompts, which is
 * why PiClient already re-emits it and needs no change.
 *
 * Two things would break this silently and are pinned in
 * tests/subagent-inspect.test.ts: Pi's RPC setWidget forwards only `undefined` or
 * an ARRAY (a bare string produces no frame and no error), and the payload is
 * prefixed rather than structured.
 *
 * Electron-free so vitest can import it.
 */

/** Upstream's widget key. Asserted against its source in the contract test. */
export const INSPECT_WIDGET_KEY = "subagent-inspect";
/** Upstream's payload prefix on the first widget line. */
export const INSPECT_PREFIX = "PI_SUBAGENT_INSPECT_JSON:";
/** Upstream's reply discriminator. */
const INSPECT_REPLY_KIND = "pi-subagents.inspect-reply";

export interface InspectMessage {
  role: string;
  kind: "text" | "toolCall" | "toolResult";
  text: string;
  name?: string;
  isError?: boolean;
}

export interface InspectReply {
  requestId: string;
  asyncId?: string;
  childId?: string;
  status?: string;
  label?: string;
  task?: string;
  messages?: InspectMessage[];
  finalOutput?: string;
  truncated?: { task: boolean; messages: number; finalOutput: boolean };
  error?: { code: string; message: string };
}

/**
 * An inspect reply, or null for anything else.
 *
 * Returning null for everything else is load-bearing: this parser sits in FRONT
 * of main's permission dispatch, and swallowing a prompt would hang the agent
 * forever, since permission prompts never time out by design.
 *
 * The RETRACT frame (`widgetLines: undefined`) must also return null rather than
 * an empty reply — upstream emits and retracts in one handler, so reading the
 * retract as a reply would blank the transcript the emit just delivered.
 */
export function parseInspectFrame(frame: unknown): InspectReply | null {
  const f = frame as { method?: unknown; widgetKey?: unknown; widgetLines?: unknown } | null | undefined;
  if (!f || typeof f !== "object") return null;
  if (f.method !== "setWidget" || f.widgetKey !== INSPECT_WIDGET_KEY) return null;
  if (!Array.isArray(f.widgetLines) || f.widgetLines.length === 0) return null;
  const line = f.widgetLines.find((l): l is string => typeof l === "string" && l.startsWith(INSPECT_PREFIX));
  if (!line) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(INSPECT_PREFIX.length));
  } catch {
    return null;
  }
  const p = parsed as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || p.kind !== INSPECT_REPLY_KIND) return null;
  if (typeof p.requestId !== "string") return null;
  return p as unknown as InspectReply;
}

/** A request id upstream will accept: `/^[A-Za-z0-9_-]{1,64}$/`. */
export function inspectRequestId(seq: number): string {
  return `hv-${seq}`;
}

/** The slash command to send. Args are positional: requestId then asyncId. */
export function inspectCommand(requestId: string, asyncId: string): string {
  return `/subagents-inspect-rpc ${requestId} ${asyncId}`;
}
