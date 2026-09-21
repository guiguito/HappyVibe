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
 * An exit the app ASKED for, and the two rules are NOT the same — which the GUI
 * pass caught after a first version used one set for both kinds.
 *
 * `clean-exit` is deliberate for either: the SDK reports `renderer-gone` on
 * every normal window close, and without dropping it each user files a crash
 * report every time they close a window.
 *
 * **`killed` is deliberate only for a CHILD.** That one is the voice host's own
 * `kill()`, which we asked for. A RENDERER is never killed on purpose by this
 * app, so `killed` there is the OS killing it — an OOM kill is the textbook
 * case — which is exactly the crash worth hearing about. Measured: a forcefully
 * crashed renderer reports `killed`, so the broader rule silently swallowed
 * every renderer death and the server received nothing at all.
 */
const DELIBERATE: Record<string, ReadonlySet<string>> = {
  "child-exit": new Set(["clean-exit", "killed"]),
  "renderer-gone": new Set(["clean-exit"]),
};

export function scrubEnvelope(e: CrashEnvelope): CrashEnvelope | null {
  if (DELIBERATE[e.kind]?.has(String(e.exit?.reason ?? ""))) return null;

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
