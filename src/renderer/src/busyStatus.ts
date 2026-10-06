import { toolLabel } from "./toolLabel";

/**
 * §7 round 25 — what the busy dots say. Pure, so the no-DOM suite pins it.
 *
 * Pi strips the parsed arguments in RPC mode (modes/json-event.js): the
 * renderer only sees `toolcall_delta` fragments, so the path and the line
 * count are read out of the RAW JSON here (docs/validation/d1.md, round 25).
 */
export interface ToolDraft {
  contentIndex: number;
  toolName: string;
  /** The `toolcall_delta` fragments so far, concatenated. */
  raw: string;
}

/** When the session last heard ANY Pi event, and the last text/thinking delta. */
export interface Activity {
  eventAt: number;
  streamAt: number;
}

/** Text that stopped arriving this long ago no longer counts as "moving". */
export const STREAM_QUIET_MS = 2_000;

/** The `content` string: where its key starts, where its body starts, its closing quote (-1 while open). */
function contentSpan(raw: string): { key: number; body: number; close: number } | null {
  const m = /"content"\s*:\s*"/.exec(raw);
  if (!m) return null;
  const body = m.index + m[0].length;
  for (let i = body; i < raw.length; i++) {
    if (raw[i] === "\\") {
      i++;
      continue;
    }
    if (raw[i] === '"') return { key: m.index, body, close: i };
  }
  return { key: m.index, body, close: -1 };
}

/** A string field once its closing quote has arrived; null before. Never reads inside `content`. */
export function partialField(raw: string, key: string): string | null {
  const c = contentSpan(raw);
  // A JSON or YAML file being written can contain `"path": "…"` — search outside the body only.
  const outside = c ? raw.slice(0, c.key) + (c.close >= 0 ? raw.slice(c.close + 1) : "") : raw;
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(outside);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

/** Lines of `content` so far; ends on the card's own count (`toolDiff`). null before the string opens. */
export function streamedLines(raw: string): number | null {
  const c = contentSpan(raw);
  if (!c) return null;
  const body = raw.slice(c.body, c.close >= 0 ? c.close : undefined);
  // ponytail: counts the two-char escape `\n`; a literal backslash before an `n` miscounts by one.
  return body.split("\\n").length;
}

const ARG_KEYS = ["path", "command", "intent", "url", "query"] as const;

export function busyStatus(i: {
  promptWaiting: boolean;
  draft: ToolDraft | null;
  runningLabel: string | null;
  activity: Activity | null;
  now: number;
}): string | null {
  if (i.promptWaiting) return "Waiting for your answer";
  if (i.draft) {
    const args: Record<string, string> = {};
    for (const k of ARG_KEYS) {
      const v = partialField(i.draft.raw, k);
      if (v !== null) args[k] = v;
    }
    const head = toolLabel(i.draft.toolName, args).label;
    const lines = i.draft.toolName === "write" ? streamedLines(i.draft.raw) : null;
    return lines === null ? head : `${head} · ${lines} ${lines === 1 ? "line" : "lines"}`;
  }
  if (i.runningLabel) return i.runningLabel;
  if (i.activity && i.now - i.activity.streamAt < STREAM_QUIET_MS) return null;
  const since = i.activity ? i.activity.eventAt : i.now;
  return `Waiting for the model · ${Math.max(0, Math.floor((i.now - since) / 1000))}s`;
}
