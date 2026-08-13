/**
 * §27/§4. The sherpa-onnx recognizer configuration.
 *
 * Built by a PURE function on purpose: `tests/voice-runtime-contract.test.ts`
 * pins this shape without loading the native module, which would otherwise
 * pull ~1.83 GB into the test process.
 *
 * `provider` is 'cpu' DELIBERATELY, and the contract test asserts it. ONNX
 * Runtime's CoreML execution provider measured 3-4x SLOWER than its own CPU
 * provider for this model (1349 ms against 308 ms): the FastConformer encoder
 * uses dynamic sequence lengths, which the CoreML EP refuses for many
 * operators, so it partitions the graph and you pay a transfer per partition.
 * "CoreML EP" does not mean "Neural Engine". Do not "optimise" this.
 */
import path from "node:path";

export interface OfflineRecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number };
  modelConfig: {
    transducer: { encoder: string; decoder: string; joiner: string };
    tokens: string;
    numThreads: number;
    provider: string;
    modelType: string;
    debug: number;
  };
}

/** The audio rate the whole pipeline is built around — the worklet resamples to this. */
export const VOICE_SAMPLE_RATE = 16000;

/**
 * ORT's default threading oversubscribes and fights Chromium's own pools, so
 * this is set rather than left alone. Four matched the measured 308 ms warm.
 */
const DEFAULT_THREADS = 4;

export function buildRecognizerConfig(dir: string, numThreads = DEFAULT_THREADS): OfflineRecognizerConfig {
  return {
    featConfig: { sampleRate: VOICE_SAMPLE_RATE, featureDim: 128 },
    modelConfig: {
      transducer: {
        encoder: path.join(dir, "encoder.int8.onnx"),
        decoder: path.join(dir, "decoder.int8.onnx"),
        joiner: path.join(dir, "joiner.int8.onnx"),
      },
      tokens: path.join(dir, "tokens.txt"),
      numThreads,
      provider: "cpu",
      modelType: "nemo_transducer",
      debug: 0,
    },
  };
}
