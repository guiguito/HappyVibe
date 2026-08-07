/**
 * §27/§5.1. The audio worklet processor, as a REAL FILE.
 *
 * It must be a genuine same-origin asset, loaded via Vite's `?url`, because the
 * renderer's CSP is `script-src 'self'` and `'self'` does not cover `blob:`.
 * The first implementation inlined this as a blob URL and every single
 * dictation attempt died on:
 *
 *   Loading the script 'blob:…' violates the following Content Security Policy
 *   directive: "script-src 'self'". The action has been blocked.
 *
 * Pinned by tests/voice-worklet-csp.test.ts. Do not "simplify" this back into a
 * template string, and do not widen the CSP to permit blob: — that trades the
 * renderer's only-bundled-code guarantee for a bundling convenience.
 *
 * Plain JavaScript on purpose: this runs on the audio thread in worklet scope,
 * where `AudioWorkletProcessor`, `registerProcessor`, `currentTime` and
 * `sampleRate` are globals and no bundler transform should touch it.
 *
 * AudioWorkletNode rather than ScriptProcessorNode (deprecated, runs on the
 * main thread, drops audio during React renders) and rather than MediaRecorder
 * (encoded Opus, a lossy round-trip back to PCM for nothing).
 */
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

    for (let i = 0; i < ch.length; i++) {
      this._acc += ch[i] * ch[i];
      this._n++;
    }

    // ~30 Hz level updates — enough to read as live without flooding the main
    // thread. This is not decoration: without it a user cannot tell a dead
    // microphone from a slow model.
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
