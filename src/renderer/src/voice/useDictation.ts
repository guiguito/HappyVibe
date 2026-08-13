import { useCallback, useEffect, useRef, useState } from "react";
import {
  gestureReducer,
  initialGesture,
  triggerCode,
  type GestureEvent,
  type GestureState,
} from "./gesture";
import { startCapture, type CaptureSession } from "./capture";
import type { MicState } from "../components/MicButton";

/**
 * §27. The composer's dictation controller: gesture in, transcript out.
 *
 * Everything decision-shaped lives in the pure reducer (gesture.ts) and the
 * pure gates (gates.ts); this hook is the wiring that owns the effects.
 */
interface Options {
  /**
   * App-owned voice settings, passed down like termSettings. NOT fetched here:
   * a hook-local fetch happens once at mount, so toggling a setting on the
   * Voice page would not reach an already-mounted composer.
   */
  settings: HvVoiceSettings | null;
  /** Called with the transcript. Empty strings never reach it. */
  onText: (text: string) => void;
  /** Surfaced as a transient composer notice. */
  onError: (message: string) => void;
  /** Opens the activation modal when the model is not downloaded yet. */
  onNeedsActivation: () => void;
}

export interface Dictation {
  micState: MicState;
  level: number;
  progress: number;
  /** The chip's onClick — click is the same gesture as a tap. */
  toggle: () => void;
  /** Feed the composer's keydown/keyup here. Returns true when consumed. */
  handleKey: (e: React.KeyboardEvent | KeyboardEvent, kind: "down" | "up") => void;
  /** Escape handler, to be called LAST in the composer's Escape chain.
      Returns true only when a recording was actually cancelled. */
  cancelOnEscape: () => boolean;
  hint: string;
  /** Overlay visibility — true from start until stop. */
  recording: boolean;
  /** Overlay spinner — true from stop until the transcript lands. */
  transcribing: boolean;
  /**
   * Whether the composer should render the chip at all. False when voice is
   * disabled OR when the user has hidden it to reclaim the row's width; in the
   * hidden case the gesture and the overlay still work.
   */
  showChip: boolean;
  /** Stop and transcribe — the overlay's click target. */
  stop: () => void;
}

/**
 * Which hook instance currently holds the microphone, app-wide.
 *
 * Round 2. ChatView is mounted per chat tab and two composers can be visible at
 * once (App.tsx says so where it focuses a pane), so each visible chat owns its
 * own useDictation. Nothing stopped two of them recording at the same time:
 * clicking one chip then the other opened two getUserMedia streams and, now,
 * would stack two overlays. Module scope is the right scope for "the microphone"
 * because there is exactly one microphone.
 */
let micHolder: symbol | null = null;

const isMac = navigator.platform.toLowerCase().includes("mac");
const TRIGGER = triggerCode(isMac ? "darwin" : "other");
const HINT = isMac ? "hold right ⌘" : "hold right Ctrl";

export function useDictation({ settings, onText, onError, onNeedsActivation }: Options): Dictation {
  const [status, setStatus] = useState<HvVoiceStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);

  /** Identity for the module-level microphone token. */
  const instanceRef = useRef<symbol | null>(null);
  if (instanceRef.current === null) instanceRef.current = Symbol("dictation");
  const instanceId = instanceRef.current;

  const gesture = useRef<GestureState>(initialGesture());
  const session = useRef<CaptureSession | null>(null);
  /** Guards against a stop() landing after a cancel() for the same recording. */
  const runId = useRef(0);

  useEffect(() => {
    void window.hv.voiceStatus().then(setStatus);
    return window.hv.onVoiceStatusChanged(setStatus);
  }, []);

  // Round 2: functional activation gates everything. `enabled: false` means the
  // gesture is inert and the microphone is never opened — not merely hidden.
  const on = settings?.enabled !== false;
  const ready = on && status?.state === "ready";

  const begin = useCallback(async () => {
    if (session.current) return;
    // Another composer already holds the microphone. Refuse rather than open a
    // second stream — one microphone, one recording, one overlay.
    if (micHolder !== null && micHolder !== instanceId) return;
    micHolder = instanceId;
    const id = ++runId.current;
    try {
      const s = await startCapture({
        deviceId: settings?.inputDeviceId || undefined,
        echoCancellation: settings?.echoCancellation ?? true,
        noiseSuppression: settings?.noiseSuppression ?? true,
        autoGainControl: settings?.autoGainControl ?? true,
        onLevel: (rms) => {
          if (runId.current === id) setLevel(rms);
        },
      });
      // Cancelled while getUserMedia was still resolving.
      if (runId.current !== id) {
        s.cancel();
        if (micHolder === instanceId) micHolder = null;
        return;
      }
      session.current = s;
      setRecording(true);
    } catch (err) {
      if (micHolder === instanceId) micHolder = null;
      gesture.current = initialGesture();
      setRecording(false);
      // ALWAYS surface the underlying message. The first version collapsed
      // every non-CaptureError to "Could not start recording.", and when the
      // audio worklet was blocked by the renderer CSP that string was the only
      // symptom available — the real error ("Unable to load a worklet's
      // module") existed but was thrown away, so a one-line fix read as a
      // mystery. A generic fallback is only for the case with nothing to say.
      const detail = err instanceof Error ? err.message : String(err);
      onError(detail || "Could not start recording.");
      // Keep the full object in the console for anyone with devtools open.
      console.error("[voice] startCapture failed", err);
    }
  }, [onError]);

  const finish = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    if (micHolder === instanceId) micHolder = null;
    setRecording(false);
    setLevel(0);
    const id = runId.current;

    const pcm = await s.stop();
    // A gate rejected it (too short, or never cleared the noise floor). Say
    // nothing and insert nothing — this is the "nothing happened" outcome,
    // which is the correct one.
    if (pcm.length === 0) return;

    setTranscribing(true);
    try {
      const text = (await window.hv.voiceTranscribe(pcm)).trim();
      if (runId.current === id && text) onText(text);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      setTranscribing(false);
    }
  }, [onError, onText]);

  const discard = useCallback(() => {
    runId.current++;
    session.current?.cancel();
    session.current = null;
    if (micHolder === instanceId) micHolder = null;
    setRecording(false);
    setLevel(0);
  }, []);

  const dispatch = useCallback(
    (e: GestureEvent) => {
      const r = gestureReducer(gesture.current, e, {
        code: TRIGGER,
        holdMs: settings?.holdThresholdMs,
        maxMs: settings?.maxRecordingMs,
      });
      gesture.current = r.state;
      if (r.action === "start") void begin();
      else if (r.action === "stop") void finish();
      else if (r.action === "cancel") discard();
    },
    [begin, finish, discard],
  );

  // The toggle-mode cap. One timer while recording, rather than a global tick.
  useEffect(() => {
    if (!recording) return;
    const max = settings?.maxRecordingMs ?? 300_000;
    const t = setTimeout(() => dispatch({ type: "tick", at: Date.now() + max + 1 }), max);
    return () => clearTimeout(t);
  }, [recording, dispatch]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent | KeyboardEvent, kind: "down" | "up") => {
      const code = (e as KeyboardEvent).code;
      if (!code) return;
      // Only the trigger can START anything; every other key is forwarded so
      // the reducer can ABANDON the gesture (right-⌘+S must not dictate).
      if (code !== TRIGGER && !gesture.current.recording) return;
      if (code === TRIGGER && !ready) {
        // Disabled means inert: no modal, no mic status query, nothing.
        if (kind === "down" && on) onNeedsActivation();
        return;
      }
      dispatch({ type: kind === "down" ? "keydown" : "keyup", code, at: Date.now() });
    },
    [dispatch, ready, onNeedsActivation],
  );

  const toggle = useCallback(() => {
    if (!ready) {
      if (on) onNeedsActivation();
      return;
    }
    if (recording) void finish();
    else {
      // A click is a tap: latch on, so a second click stops it.
      gesture.current = { ...initialGesture(), recording: true, latched: true, startedAt: Date.now() };
      void begin();
    }
  }, [ready, recording, begin, finish, onNeedsActivation]);

  const cancelOnEscape = useCallback((): boolean => {
    if (!session.current && !recording) return false;
    dispatch({ type: "escape", at: Date.now() });
    return true;
  }, [dispatch, recording]);

  // Never leave a hot microphone behind on unmount.
  useEffect(() => () => discard(), [discard]);

  const micState: MicState = transcribing
    ? "transcribing"
    : recording
      ? "recording"
      : status?.state === "downloading"
        ? "downloading"
        : ready
          ? "ready"
          : "unactivated";

  return {
    micState,
    level,
    progress: status && status.bytesTotal > 0 ? status.bytesDone / status.bytesTotal : 0,
    toggle,
    handleKey,
    cancelOnEscape,
    hint: HINT,
    recording,
    transcribing,
    showChip: on && settings?.showInComposer !== false,
    stop: () => void finish(),
  };
}
