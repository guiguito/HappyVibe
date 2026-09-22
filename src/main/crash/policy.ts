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
 * `redactMessage` EXTENDS upstream's redaction rather than replacing it — see
 * the note on it below for why the default alone left reports unreadable.
 */
import { defaultRedaction } from "inlet-sdk/crash";
import type { CrashEnvelope, RedactionPolicy } from "inlet-sdk/crash";
import { SAFE_MESSAGES } from "./safeMessages.generated";

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

/**
 * §37 — what a crash report is allowed to SAY, and why we add to the default.
 *
 * Upstream's `defaultRedaction` is a SHAPE allowlist for engine-generated
 * messages: `x is not a function`, `Cannot read properties of undefined`,
 * `socket hang up`. That is exactly backwards for us. Measured against twenty
 * realistic HappyVibe errors, **seven survived and all seven were the
 * engine's** — the ones where the stack already tells you everything. Every
 * sentence our own code authors, which is the diagnostic half, came back as a
 * bare `<redacted>`: *No workspace for this session*, *Extension failed,
 * blocking execution*, *spawnSync is not exported by __vite-browser-external*.
 * A database of `<redacted>` grouped by stack is a database you cannot triage.
 *
 * So: an EXACT-match lookup against messages HappyVibe itself throws, then fall
 * through to upstream for everything else. Four properties make that safe, and
 * losing any one of them re-opens the hole:
 *
 * 1. The set is GENERATED from the source that throws them
 *    (`npm run catalog:crash-messages`), and the generator accepts a **plain
 *    string literal only**. A literal cannot interpolate runtime data, so what
 *    is in the set is exactly what travels. `new Error(`… ${path}`)` is refused
 *    and stays redacted.
 * 2. The match is EXACT (a `Set.has` on the trimmed message), never a prefix
 *    and never a regex — so a message that merely starts like a safe one, or
 *    has data appended, does not slip through.
 * 3. Anything not in the set goes to `defaultRedaction` UNCHANGED, so every
 *    upstream protection still applies and an upstream improvement arrives for
 *    free. This is not a reimplementation of the default; it is a pre-filter.
 * 4. The generator refuses a literal that looks like a path, a key, an address
 *    or a URL even though a literal cannot be dynamic — belt and braces, and it
 *    prints what it refused so the decision is reviewable.
 *
 * `tests/crash-safe-messages.test.ts` re-derives the set from source, so a new
 * throw either joins the list or fails the gate.
 */
export const redactMessage: RedactionPolicy = (message) => {
  const trimmed = message.trim();
  if (SAFE_MESSAGES.has(trimmed)) return trimmed;
  return defaultRedaction(message);
};
