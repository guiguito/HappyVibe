import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRecognizerConfig } from "../src/main/voice/recognizer";
import { VOICE_MODEL } from "../src/main/voice/manifest";

/**
 * §27. End-to-end transcription against the pinned fixture wav.
 *
 * Gated the way the live-Pi tests are — skipped unless the 671 MB model is
 * actually present, so CI and a fresh clone stay green without it. Point
 * HV_VOICE_MODEL_DIR at a directory holding the four manifest files plus
 * test_wavs/en.wav, or let it default to the app's own model cache.
 *
 *   HV_VOICE_MODEL_DIR="$HOME/Library/Application Support/HappyVibe/models/voice" \
 *     npx vitest run tests/voice-e2e.test.ts
 */
const DIR =
  process.env.HV_VOICE_MODEL_DIR ??
  path.join(os.homedir(), "Library", "Application Support", "HappyVibe", "models", "voice");

const HAVE_MODEL = VOICE_MODEL.files.every((f) => {
  try {
    return fs.statSync(path.join(DIR, f.name)).size === f.bytes;
  } catch {
    return false;
  }
});
const FIXTURE = path.join(DIR, "test_wavs", "en.wav");
const HAVE_FIXTURE = fs.existsSync(FIXTURE);

interface Rec {
  createStream(): { acceptWaveform(o: { sampleRate: number; samples: Float32Array }): void };
  decode(s: unknown): void;
  getResult(s: unknown): { text?: string };
}

describe.skipIf(!HAVE_MODEL || !HAVE_FIXTURE)("voice end-to-end", () => {
  it("transcribes the pinned English fixture to real words", async () => {
    const sherpa = (await import("sherpa-onnx-node")) as unknown as {
      OfflineRecognizer: new (c: unknown) => Rec;
      readWave: (p: string) => { samples: Float32Array; sampleRate: number };
    };
    const rec = new sherpa.OfflineRecognizer(buildRecognizerConfig(DIR));
    const wave = sherpa.readWave(FIXTURE);
    const stream = rec.createStream();
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    rec.decode(stream);
    const text = (rec.getResult(stream).text ?? "").trim();

    // Not an exact-match assertion: the point is that the whole chain produced
    // language, not that this build reproduces one reference string.
    expect(text.length).toBeGreaterThan(10);
    expect(text).toMatch(/[a-zA-Z]{3,}/);
    expect(text.split(/\s+/).length).toBeGreaterThan(2);
  }, 180_000);

  it("returns empty for silence rather than inventing words", async () => {
    // The energy gate normally means the model never sees silence at all. This
    // asserts the model itself is not a phantom-text generator when it does.
    const sherpa = (await import("sherpa-onnx-node")) as unknown as {
      OfflineRecognizer: new (c: unknown) => Rec;
    };
    const rec = new sherpa.OfflineRecognizer(buildRecognizerConfig(DIR));
    const stream = rec.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(16000 * 3) });
    rec.decode(stream);
    expect((rec.getResult(stream).text ?? "").trim()).toBe("");
  }, 180_000);
});
