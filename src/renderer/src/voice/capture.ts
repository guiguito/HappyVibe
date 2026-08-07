/**
 * §27/§5.1. One recording, start to finish.
 *
 * Order matters and is not negotiable: the microphone status is checked in
 * MAIN before getUserMedia is ever called (§8.3), because Chromium on macOS
 * resolves getUserMedia with a live track producing nothing but zeros when TCC
 * has not granted — which for dictation is the worst failure available, a
 * silent empty transcript rather than an error the user can act on.
 */
import { floatToInt16, passesLengthGate, passesEnergyGate } from "./gates";
// A REAL same-origin asset, not a blob: URL — the renderer's CSP is
// `script-src 'self'` and blob: is not covered by it, so addModule() on a blob
// is blocked outright. See voice-worklet.js and tests/voice-worklet-csp.test.ts.
import workletUrl from "./voice-worklet.js?url";

/** The rate the model wants; Chromium's own resampler gets us there. */
const TARGET_RATE = 16000;

export type CaptureFailure = "denied" | "not-determined" | "no-device" | "failed";

export class CaptureError extends Error {
  constructor(readonly reason: CaptureFailure, message: string) {
    super(message);
    this.name = "CaptureError";
  }
}

export interface CaptureOpts {
  deviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  onLevel?: (rms: number) => void;
}

export interface CaptureSession {
  /** Stop, run the gates, and return PCM. An empty array means a gate rejected it. */
  stop(): Promise<Int16Array>;
  /** Tear down and discard — Escape, or an aborted gesture. */
  cancel(): void;
}

/** 48 kHz → 16 kHz is an exact 3:1 ratio, so the fallback is a plain decimate. */
function decimateBy3(chunks: Float32Array[]): Float32Array[] {
  return chunks.map((c) => {
    const out = new Float32Array(Math.floor(c.length / 3));
    // A 3-tap box average is a crude low-pass, but it is a low-pass: taking
    // every third sample raw would alias everything above 8 kHz into the band.
    for (let i = 0; i < out.length; i++) {
      out[i] = (c[i * 3] + c[i * 3 + 1] + c[i * 3 + 2]) / 3;
    }
    return out;
  });
}

function concat(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function startCapture(opts: CaptureOpts = {}): Promise<CaptureSession> {
  // 1. Permission FIRST, from main. Never trust getUserMedia to tell us.
  const status = await window.hv.voiceMicStatus();
  if (status === "not-determined") {
    const granted = await window.hv.voiceAskMic();
    if (!granted) throw new CaptureError("denied", "Microphone access was not granted.");
  } else if (status !== "granted") {
    throw new CaptureError(
      "denied",
      "HappyVibe does not have microphone access. Grant it in System Settings, then restart the app.",
    );
  }

  // 2. The stream.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
        echoCancellation: opts.echoCancellation ?? true,
        noiseSuppression: opts.noiseSuppression ?? true,
        autoGainControl: opts.autoGainControl ?? true,
      },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAllowedError") throw new CaptureError("denied", "Microphone access was denied.");
    if (name === "NotFoundError") throw new CaptureError("no-device", "No microphone was found.");
    throw new CaptureError("failed", err instanceof Error ? err.message : String(err));
  }

  // 3. Resampling is Chromium's job: asking for a 16 kHz context makes the
  //    browser insert its own high-quality converter, and the worklet's global
  //    `sampleRate` is then already 16000. No DSP, no resampling library.
  const ctx = new AudioContext({ sampleRate: TARGET_RATE });
  // On macOS every AudioContext on a page must share a rate, so if the page is
  // also playing audio everything snaps to 48 kHz. Assert rather than assume.
  const needsDecimate = ctx.sampleRate !== TARGET_RATE;
  const decimatable = needsDecimate && ctx.sampleRate === TARGET_RATE * 3;
  if (needsDecimate && !decimatable) {
    void ctx.close();
    for (const t of stream.getTracks()) t.stop();
    throw new CaptureError("failed", `Unsupported audio rate ${ctx.sampleRate} Hz.`);
  }

  await ctx.audioWorklet.addModule(workletUrl);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "voice-processor");

  let chunks: Float32Array[] = [];
  let done = false;

  node.port.onmessage = (e: MessageEvent): void => {
    const d = e.data as Float32Array | { rms: number };
    if (d instanceof Float32Array) {
      chunks.push(d);
    } else if (typeof d?.rms === "number") {
      opts.onLevel?.(d.rms);
    }
  };

  source.connect(node);
  // NOT connected to ctx.destination: routing the mic to the speakers would
  // echo the user back at themselves.

  const teardown = (): void => {
    if (done) return;
    done = true;
    node.port.onmessage = null;
    try {
      source.disconnect();
      node.disconnect();
    } catch {
      /* already torn down */
    }
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
  };

  return {
    async stop(): Promise<Int16Array> {
      const rate = ctx.sampleRate;
      const collected = decimatable ? decimateBy3(chunks) : chunks;
      teardown();
      const samples = concat(collected);
      chunks = [];

      // The two guards, before any IPC. A clip that fails either never reaches
      // the model, so there is nothing for the model to invent over.
      const effectiveRate = decimatable ? rate / 3 : rate;
      if (!passesLengthGate(samples.length, effectiveRate)) return new Int16Array(0);
      const pcm = floatToInt16(samples);
      if (!passesEnergyGate(pcm)) return new Int16Array(0);
      return pcm;
    },
    cancel(): void {
      teardown();
      chunks = [];
    },
  };
}
