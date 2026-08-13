/**
 * §27/§5.3. Runs INSIDE an Electron utilityProcess.
 *
 * Isolated for the same reason `pi/spawn.ts` isolates Pi: a native ONNX crash
 * or OOM must not take the app down, and a ~1.83 GB working set must be
 * reclaimable by killing a PID. The app is simultaneously running Pi sessions,
 * so holding that for a feature nobody is using is not acceptable — the host
 * unloads this process after five idle minutes.
 *
 * The protocol is deliberately tiny:
 *   host -> here   { init: { dir, numThreads } }  |  { id, pcm }
 *   here -> host   { ready } | { fatal }          |  { id, text } | { id, error }
 */
import { createRequire } from "node:module";
import { buildRecognizerConfig, VOICE_SAMPLE_RATE } from "./recognizer";

const require_ = createRequire(import.meta.url);

interface SherpaStream {
  acceptWaveform(o: { sampleRate: number; samples: Float32Array }): void;
}
interface SherpaRecognizer {
  createStream(): SherpaStream;
  decode(s: SherpaStream): void;
  getResult(s: SherpaStream): { text?: string };
}

let recognizer: SherpaRecognizer | null = null;

function load(dir: string, numThreads: number): void {
  // Required lazily and by path so nothing native is touched until the user
  // actually dictates. Kept OUT of the bundle (rollup `external`) — it is a
  // native module and must resolve from node_modules at runtime.
  const sherpa = require_("sherpa-onnx-node") as {
    OfflineRecognizer: new (c: ReturnType<typeof buildRecognizerConfig>) => SherpaRecognizer;
  };
  recognizer = new sherpa.OfflineRecognizer(buildRecognizerConfig(dir, numThreads));
}

function transcribe(pcm: Int16Array): string {
  if (!recognizer) throw new Error("voice model is not loaded");
  // The renderer sent int16 to halve the IPC payload; sherpa wants float in
  // [-1, 1]. Divide by 32768 so -32768 maps to exactly -1.
  const samples = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: VOICE_SAMPLE_RATE, samples });
  recognizer.decode(stream);
  return recognizer.getResult(stream).text ?? "";
}

const port = process.parentPort;

port.on("message", (e) => {
  const msg = e.data as { init?: { dir: string; numThreads: number }; id?: number; pcm?: Int16Array };

  if (msg.init) {
    try {
      load(msg.init.dir, msg.init.numThreads);
      port.postMessage({ ready: true });
    } catch (err) {
      port.postMessage({ fatal: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (typeof msg.id !== "number" || !msg.pcm) return;
  try {
    port.postMessage({ id: msg.id, text: transcribe(msg.pcm) });
  } catch (err) {
    port.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
});
