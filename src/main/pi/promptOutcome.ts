/**
 * §7 round 27 — what Pi did with a message. Since Pi 0.99, `prompt`/`steer`/`follow_up`
 * answer with `data.disposition`; a refusal (a run already going, compaction running, an
 * expired sign-in) is `success:false`. PiClient resolves BOTH, so a caller that reads
 * neither drops the user's message silently — which is what promptSession used to do.
 */
import type { PiResponse } from "./types";

export type PromptDisposition = "started" | "queued" | "handled";
export type PromptOutcome = { ok: true; disposition: PromptDisposition } | { ok: false; error: string };

export function promptOutcome(res: PiResponse): PromptOutcome {
  if (res.success === false) return { ok: false, error: typeof res.error === "string" ? res.error : "" };
  const d = (res.data as { disposition?: unknown } | undefined)?.disposition;
  return { ok: true, disposition: d === "queued" || d === "handled" ? d : "started" };
}

/** Pi's clear_queue answer: exactly the texts it removed. Anything else is not ours to return. */
export function clearedTexts(res: PiResponse): { steering: string[]; followUp: string[] } {
  const d = (res.success === false ? {} : res.data ?? {}) as { steering?: unknown; followUp?: unknown };
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { steering: strs(d.steering), followUp: strs(d.followUp) };
}
