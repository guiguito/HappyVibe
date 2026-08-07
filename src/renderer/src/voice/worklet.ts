/**
 * §27/§5.1. The AudioWorkletProcessor source, registered via addModule().
 *
 * AudioWorkletNode rather than ScriptProcessorNode (deprecated, runs on the
 * main thread, drops audio during React renders) and rather than MediaRecorder
 * (encoded Opus, which would have to be decoded back to PCM — a lossy
 * round-trip for nothing).
 *
 * Shipped as a blob URL so it travels inside the bundle with no asset-copy
 * step. The processor stays about ten lines: resampling is Chromium's job (see
 * capture.ts), so there is no DSP here and no dependency.
 */
const SOURCE = `
class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._acc = 0;
    this._n = 0;
    this._last = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // slice(): the render quantum's buffer is REUSED, so posting it directly
    // would hand the main thread memory that is about to be overwritten.
    this.port.postMessage(ch.slice());
    for (let i = 0; i < ch.length; i++) { this._acc += ch[i] * ch[i]; this._n++; }
    // ~30 Hz level updates — enough to read as live without flooding.
    if (currentTime - this._last > 0.033) {
      this.port.postMessage({ rms: Math.sqrt(this._acc / Math.max(1, this._n)) });
      this._acc = 0;
      this._n = 0;
      this._last = currentTime;
    }
    return true;
  }
}
registerProcessor('voice-processor', VoiceProcessor);
`;

let cached: string | null = null;

export function workletUrl(): string {
  if (!cached) cached = URL.createObjectURL(new Blob([SOURCE], { type: "application/javascript" }));
  return cached;
}
