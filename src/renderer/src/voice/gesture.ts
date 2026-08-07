/**
 * §27/§3.5. Tap vs hold vs abandon, as a pure reducer.
 *
 * Why this is not a `SHORTCUT_ACTIONS` entry: the registry cannot express it.
 * `eventToBinding` returns null the moment the key IS a modifier, and null
 * again when no modifier accompanies it; the canonical form carries no
 * left/right distinction (`e.key` is "Meta" for both Commands); and the format
 * is CodeMirror's because one of the three dispatch sites is a CodeMirror
 * keymap, which has no representation for press-and-hold. It is a built-in
 * listed in FIXED_SHORTCUTS instead.
 *
 * The ABANDON rule is the load-bearing one: the trigger IS a modifier, so
 * right-Cmd+S produces a trailing key-up that would otherwise read as a tap
 * and silently start recording. If any other key goes down while the trigger
 * is held, the gesture is off. That failure is invisible in code review, which
 * is why this is a pure function with its own test.
 */
export type GestureEvent =
  | { type: "keydown"; code: string; at: number }
  | { type: "keyup"; code: string; at: number }
  | { type: "escape"; at: number }
  | { type: "tick"; at: number };

export interface GestureState {
  /** When the trigger went down, or null when it is up. */
  downAt: number | null;
  recording: boolean;
  /** Latched by a TAP; a hold is not latched and ends on release. */
  latched: boolean;
  /** Set when another key joined the trigger — this is a shortcut, not dictation. */
  abandoned: boolean;
  startedAt: number | null;
}

export type GestureAction = "start" | "stop" | "cancel" | null;

export interface GestureOpts {
  code?: string;
  holdMs?: number;
  maxMs?: number;
}

/**
 * Right Command on macOS; right Control elsewhere. Right ⌘ does not travel —
 * `MetaRight` is the right Windows key, which raises the Start menu on release
 * and is not reliably suppressible from a renderer, and on Linux Super is
 * usually grabbed by the window manager.
 */
export function triggerCode(platform: string): string {
  return platform === "darwin" ? "MetaRight" : "ControlRight";
}

export const DEFAULT_HOLD_MS = 300;
export const DEFAULT_MAX_MS = 300_000;

export function initialGesture(): GestureState {
  return { downAt: null, recording: false, latched: false, abandoned: false, startedAt: null };
}

export function gestureReducer(
  s: GestureState,
  e: GestureEvent,
  opts: GestureOpts = {},
): { state: GestureState; action: GestureAction } {
  const CODE = opts.code ?? "MetaRight";
  const HOLD = opts.holdMs ?? DEFAULT_HOLD_MS;
  const MAX = opts.maxMs ?? DEFAULT_MAX_MS;

  switch (e.type) {
    case "keydown": {
      if (e.code !== CODE) {
        // Another key while the trigger is held and unlatched ⇒ a real
        // shortcut (right-Cmd+S). Drop the recording rather than transcribe it.
        if (s.downAt !== null && s.recording && !s.latched) {
          return { state: { ...initialGesture(), abandoned: true }, action: "cancel" };
        }
        return { state: s, action: null };
      }
      // Already latched: this press is the beginning of the SECOND tap.
      if (s.latched) return { state: { ...s, downAt: e.at }, action: null };
      return {
        state: { ...s, downAt: e.at, recording: true, abandoned: false, startedAt: e.at },
        action: "start",
      };
    }

    case "keyup": {
      if (e.code !== CODE) return { state: s, action: null };
      // Clear the abandoned flag on the trigger's own release, so the next
      // press is a clean gesture rather than inheriting the shortcut.
      if (s.abandoned) return { state: initialGesture(), action: null };
      if (s.downAt === null) return { state: s, action: null };
      if (s.latched) return { state: initialGesture(), action: "stop" };
      const held = e.at - s.downAt;
      if (held >= HOLD) return { state: initialGesture(), action: "stop" };
      // Under the threshold: a tap. Latch and keep recording until the next tap.
      return { state: { ...s, downAt: null, latched: true }, action: null };
    }

    case "escape":
      return s.recording ? { state: initialGesture(), action: "cancel" } : { state: s, action: null };

    case "tick":
      // The 5-minute cap, so a forgotten hot mic cannot record indefinitely.
      if (s.recording && s.startedAt !== null && e.at - s.startedAt >= MAX) {
        return { state: initialGesture(), action: "stop" };
      }
      return { state: s, action: null };
  }
}
