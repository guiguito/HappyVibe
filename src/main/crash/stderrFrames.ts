/**
 * §37 — turning a Pi child's stderr into frames, and nothing else.
 *
 * The child is a separate process, so the SDK never sees its exception: all we
 * have is the stderr ring. Two functions, both pure, and the boundary between
 * them is the privacy line this whole feature is built on — **the message line
 * never leaves this file.** `piErrorType` returns a TYPE (`TypeError`), never
 * the sentence after the colon, which is where a path, a prompt or a key would
 * be. The tail that names the cause stays in the local `session.crash` row,
 * exactly where it has always been.
 *
 * A frame is kept only when its path runs through the app's own tree. That is
 * not a tidiness rule: `.pi/extensions/whatever.ts` is a user file at a user
 * path, and a user's home directory is not ours to send.
 */
import type { CrashFrame } from "inlet-sdk/crash";

/** At most this many frames travel. The SDK bounds the envelope anyway; this
    keeps a runaway recursion from spending the whole budget on one report. */
const MAX_FRAMES = 30;

/**
 * Admission: the path runs through the vendored runtime, the packaged asar or
 * the build output. Matched as whole SEGMENTS — a bare `out` substring would
 * admit `/Users/checkout/…`, which is someone's home directory.
 */
const ADMIT = /\/(?:pi-runtime|app\.asar|out)\//;

/**
 * Where the reported path starts. `pi-runtime` and `out` are preferred over
 * `app.asar` so that the SAME file reports the same path in dev and in a
 * packaged build — `…/app.asar/out/main/index.js` and `…/repo/out/main/index.js`
 * both become `out/main/index.js`, which is what lets one fingerprint cover
 * both and what makes a source map apply.
 */
const ROOT = /\/(pi-runtime|out)\//;
const ASAR = /\/(app\.asar)\//;

/** `    at fn (/abs/path.js:12:34)` or `    at /abs/path.js:12:34`. */
const FRAME = /^\s*at\s+(?:(.+?)\s+\()?(\/[^\s()]+?):(\d+):(\d+)\)?\s*$/;

function rootRelative(abs: string): string | null {
  const m = ROOT.exec(abs) ?? ASAR.exec(abs);
  if (!m) return null;
  return abs.slice(m.index + 1);
}

export function piFrames(lines: readonly string[]): CrashFrame[] {
  const frames: CrashFrame[] = [];
  for (const line of lines) {
    if (frames.length >= MAX_FRAMES) break;
    const m = FRAME.exec(line);
    if (!m) continue;
    const abs = m[2];
    if (!ADMIT.test(abs)) continue; // outside the bundle: not ours to report
    const file = rootRelative(abs);
    if (!file) continue;
    frames.push({
      ...(m[1] ? { function: m[1] } : {}),
      file,
      line: Number(m[3]),
      col: Number(m[4]),
      inApp: true,
    });
  }
  return frames;
}

/**
 * The error CLASS, never the message. `PiExit` is the honest answer when the
 * child left no error shape at all — and it is also the signal that this exit
 * is probably not ours, which is why the call site requires a frame before it
 * reports anything (§37: a bad key, an empty account and a killed terminal all
 * land here, and all of them would share one fingerprint).
 */
export function piErrorType(lines: readonly string[]): string {
  for (const line of lines) {
    const m = /^([A-Z][A-Za-z]*Error)\b/.exec(line.trim());
    if (m) return m[1];
  }
  return "PiExit";
}
