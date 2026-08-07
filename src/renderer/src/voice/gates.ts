/**
 * §27/§10. The two guards standing between silence and a fabricated prompt.
 *
 * Both run in the RENDERER, before any IPC — a clip that fails either never
 * reaches the model, so there is nothing for the model to hallucinate over.
 * That is the whole mitigation for the phantom-text risk: a TDT transducer is
 * structurally far less prone to it than an autoregressive model, but no
 * benchmark confirming immunity was found, and the energy gate makes the
 * question moot by never invoking the model on silence.
 *
 * Four lines of logic between them, and they are the difference between
 * "nothing happened" and "the agent received a sentence I never said".
 */

/**
 * Scale asymmetrically (32767 up, 32768 down) and CLAMP, so a hot mic
 * saturates rather than wrapping — a wrap turns a loud vowel into a click.
 * Done here rather than in main because it halves the IPC payload.
 */
export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** An accidental tap must never reach the model. */
export const MIN_CLIP_MS = 300;

export function passesLengthGate(sampleCount: number, sampleRate: number, minMs = MIN_CLIP_MS): boolean {
  if (sampleRate <= 0) return false;
  return (sampleCount / sampleRate) * 1000 >= minMs;
}

/** Root-mean-square over the whole clip, normalised to [0, 1]. */
export function peakRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}

/** Room tone measures well under this; speech measures well over it. */
export const NOISE_FLOOR = 0.005;

export function passesEnergyGate(pcm: Int16Array, floor = NOISE_FLOOR): boolean {
  return peakRms(pcm) > floor;
}
