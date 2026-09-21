/**
 * §37 — the one content rule HappyVibe holds, wired as `beforeSendSync`.
 *
 * `beforeSendSync` rather than `beforeSend` because it is the ONLY hook that
 * runs on the fatal path (an uncaught exception, an unhandled rejection). A
 * filter that skips the fatal path is a filter that is off exactly when it
 * matters — that hole was real in inlet-sdk 0.1.0 and closing it is why 0.1.2
 * is the pin.
 *
 * Electron-free and side-effect-free on purpose: every content promise §37
 * makes is asserted in the non-live suite against this function, not against a
 * running app.
 *
 * There is deliberately NO message redaction here. 0.1.2's `defaultRedaction`
 * already emits a bare `<redacted>` unless the leading token is errno-shaped,
 * which is precisely the policy we would have written — so we pass no
 * `redaction` option at all and pin upstream's behaviour in
 * `tests/crash-policy.test.ts` instead. A wrapper that agrees with the default
 * is a wrapper that can only drift away from it.
 */
import type { CrashEnvelope } from "inlet-sdk/crash";

/**
 * The only tag keys that may travel. `tags` and `context` go on the wire
 * VERBATIM, so this list is the content control, not a hint. Passed to the SDK
 * as `tagAllowlist` too, which is what stops a renderer forging one over IPC.
 */
export const TAG_ALLOW = ["runtime", "channel"] as const;

/**
 * An exit the app ASKED for. The SDK reports `renderer-gone` for a normal
 * window close and `child-process-gone` for the voice host's own `kill()` —
 * both are correct at its level and neither is a crash at ours. Dropping them
 * here rather than not installing the handler keeps the real crashes.
 */
const DELIBERATE_EXITS = new Set(["clean-exit", "killed"]);

/** Kinds whose `exit.reason` can name a deliberate shutdown. */
const EXIT_KINDS = new Set(["child-exit", "renderer-gone"]);

export function scrubEnvelope(e: CrashEnvelope): CrashEnvelope | null {
  if (EXIT_KINDS.has(e.kind) && DELIBERATE_EXITS.has(String(e.exit?.reason ?? ""))) return null;

  // `context` is free-form by type and therefore unbounded by construction:
  // anything a future call site puts in it would travel. Dropped always, and a
  // test scans the init options to be sure none is ever set either.
  const { context: _dropped, ...rest } = e;

  if (!rest.tags) return rest;
  const tags: Record<string, string> = {};
  for (const k of TAG_ALLOW) {
    const v = rest.tags[k];
    if (typeof v === "string") tags[k] = v;
  }
  return { ...rest, tags };
}
