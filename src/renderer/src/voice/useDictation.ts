import { useCallback, useEffect, useRef, useState } from "react";
import {
  gestureReducer,
  initialGesture,
  triggerCode,
  type GestureEvent,
  type GestureState,
} from "./gesture";
import { startCapture, CaptureError, type CaptureSession } from "./capture";
import type { MicState } from "../components/MicButton";

/**
 * §27. The composer's dictation controller: gesture in, transcript out.
 *
 * Everything decision-shaped lives in the pure reducer (gesture.ts) and the
 * pure gates (gates.ts); this hook is the wiring that owns the effects.
 */
interface Options {
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
}

const isMac = navigator.platform.toLowerCase().includes("mac");
const TRIGGER = triggerCode(isMac ? "darwin" : "other");
const HINT = isMac ? "hold right ⌘" : "hold right Ctrl";

export function useDictation({ onText, onError, onNeedsActivation }: Options): Dictation {
  const [status, setStatus] = useState<HvVoiceStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);

  const gesture = useRef<GestureState>(initialGesture());
  const session = useRef<CaptureSession | null>(null);
  const settings = useRef<HvVoiceSettings | null>(null);
  /** Guards against a stop() landing after a cancel() for the same recording. */
  const runId = useRef(0);

  useEffect(() => {
    void window.hv.voiceStatus().then(setStatus);
    void window.hv.getVoiceSettings().then((s) => {
      settings.current = s;
    });
    return window.hv.onVoiceStatusChanged(setStatus);
  }, []);

  const ready = status?.state === "ready";

  const begin = useCallback(async () => {
    if (session.current) return;
    const id = ++runId.current;
    try {
      const s = await startCapture({
        deviceId: settings.current?.inputDeviceId || undefined,
        echoCancellation: settings.current?.echoCancellation ?? true,
        noiseSuppression: settings.current?.noiseSuppression ?? true,
        autoGainControl: settings.current?.autoGainControl ?? true,
        onLevel: (rms) => {
          if (runId.current === id) setLevel(rms);
        },
      });
      // Cancelled while getUserMedia was still resolving.
      if (runId.current !== id) {
        s.cancel();
        return;
      }
      session.current = s;
      setRecording(true);
    } catch (err) {
      gesture.current = initialGesture();
      setRecording(false);
      onError(err instanceof CaptureError ? err.message : "Could not start recording.");
    }
  }, [onError]);

  const finish = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    session.current = null;
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
    setRecording(false);
    setLevel(0);
  }, []);

  const dispatch = useCallback(
    (e: GestureEvent) => {
      const r = gestureReducer(gesture.current, e, {
        code: TRIGGER,
        holdMs: settings.current?.holdThresholdMs,
        maxMs: settings.current?.maxRecordingMs,
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
    const max = settings.current?.maxRecordingMs ?? 300_000;
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
        if (kind === "down") onNeedsActivation();
        return;
      }
      dispatch({ type: kind === "down" ? "keydown" : "keyup", code, at: Date.now() });
    },
    [dispatch, ready, onNeedsActivation],
  );

  const toggle = useCallback(() => {
    if (!ready) {
      onNeedsActivation();
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
  };
}
