/**
 * §27. The voice model, pinned by revision and verified per file.
 *
 * NEVER change `revision` to a branch name. `main` is a mutable pointer on a
 * third party's repository and ONNX Runtime parses these files with NATIVE
 * code, so 671 MB of unverified bytes landing in userData is a real
 * supply-chain surface rather than a theoretical one.
 *
 * The digests are the Hugging Face LFS `oid`, which IS the sha256 of the
 * object; `tokens.txt` is not an LFS object, so its digest was computed from
 * the downloaded file. Re-derive both the same way if the pin ever moves —
 * `tests/voice-manifest.test.ts` is what tells you upstream changed before a
 * user finds out.
 */
export interface VoiceModelFile {
  /** Path within the repo, and the path under the local model dir. */
  name: string;
  bytes: number;
  sha256: string;
}

export const VOICE_MODEL = {
  repo: "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  revision: "2bda32ec70b097a55adaa07d9a7173915b43cc78",
  /**
   * The upstream weights, for the licenses block only. Per §12 the model is
   * NEVER named in the dictation flow — the chip, the activation modal and the
   * progress UI say "voice model" and nothing more.
   */
  attribution: {
    model: "nvidia/parakeet-tdt-0.6b-v3",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    modelUrl: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3",
  },
  files: [
    {
      name: "encoder.int8.onnx",
      bytes: 652_184_281,
      sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
    },
    {
      name: "decoder.int8.onnx",
      bytes: 11_845_275,
      sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
    },
    {
      name: "joiner.int8.onnx",
      bytes: 6_355_277,
      sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
    },
    {
      name: "tokens.txt",
      bytes: 93_939,
      sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
    },
  ] as VoiceModelFile[],
  totalBytes: 670_478_772,
} as const;

/** The English fixture used by the model-gated end-to-end test. Same revision. */
export const VOICE_FIXTURE_WAV: VoiceModelFile = {
  name: "test_wavs/en.wav",
  bytes: 184_608,
  sha256: "148b936b43ce7c546a866e64da059f0458aee2d65e617f16e9d94f06e8d99ed6",
};

export function fileUrl(f: VoiceModelFile): string {
  return `https://huggingface.co/${VOICE_MODEL.repo}/resolve/${VOICE_MODEL.revision}/${f.name}`;
}

/**
 * What the product says out loud, in §3.2's activation modal and on the Voice
 * page. CEILING of MB, not round: 670,478,772 B rounds down to 670, and
 * quoting a download as smaller than it is, is the wrong direction to be wrong
 * in. Pinned against the manifest by `tests/voice-manifest.test.ts`.
 */
export const VOICE_MODEL_SIZE_LABEL = "671 MB";
