/**
 * §27/§3.6. Voice settings — GLOBAL only, like §26's terminal settings, because
 * every field is a personal habit or a property of this machine's microphone.
 *
 * Same contract as mergeTerminalSettings: always complete, always in range, so
 * no consumer has to defend against a hand-edited config.json.
 */
import { isSupported, DEFAULT_LANGUAGE } from "./languages";

export interface VoiceSettings {
  language: string;
  /** "" means the system default input device. */
  inputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  holdThresholdMs: number;
  maxRecordingMs: number;
}

export const VOICE_DEFAULTS: VoiceSettings = {
  language: DEFAULT_LANGUAGE,
  inputDeviceId: "",
  // On by default, which is right for most people. Off is the calibration knob
  // for anyone on a real audio interface, who reliably wants these gone —
  // the physical world needs a knob a minimal model cannot see.
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  /** Under this a press is a TAP (latch on); at or over it, a HOLD. */
  holdThresholdMs: 300,
  /** The forgotten-hot-mic cap. A safety limit, not a researched number. */
  maxRecordingMs: 300_000,
};

function clampNum(n: unknown, lo: number, hi: number, dflt: number): number {
  return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
}

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

export function mergeVoiceSettings(p: Partial<VoiceSettings> | undefined | null): VoiceSettings {
  return {
    // An unsupported language never survives a read — §9's whole point is that
    // out-of-set input produces confident garbage rather than a bad transcript.
    language:
      typeof p?.language === "string" && isSupported(p.language) ? p.language : VOICE_DEFAULTS.language,
    inputDeviceId: typeof p?.inputDeviceId === "string" ? p.inputDeviceId : VOICE_DEFAULTS.inputDeviceId,
    echoCancellation: bool(p?.echoCancellation, VOICE_DEFAULTS.echoCancellation),
    noiseSuppression: bool(p?.noiseSuppression, VOICE_DEFAULTS.noiseSuppression),
    autoGainControl: bool(p?.autoGainControl, VOICE_DEFAULTS.autoGainControl),
    holdThresholdMs: clampNum(p?.holdThresholdMs, 100, 1000, VOICE_DEFAULTS.holdThresholdMs),
    maxRecordingMs: clampNum(p?.maxRecordingMs, 30_000, 600_000, VOICE_DEFAULTS.maxRecordingMs),
  };
}
