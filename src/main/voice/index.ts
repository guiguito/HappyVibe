/**
 * §27. The voice model's state, and the only thing ipc.ts talks to.
 *
 * State is derived from disk rather than remembered, so an interrupted
 * download or a hand-deleted file cannot leave the UI claiming "ready".
 */
import fs from "node:fs";
import path from "node:path";
import { VOICE_MODEL, fileUrl, type VoiceModelFile } from "./manifest";
import { downloadFile } from "./download";
import { voiceModelDir, voiceHost } from "./host";

export type VoiceState = "unactivated" | "downloading" | "ready" | "error";

export interface VoiceStatus {
  state: VoiceState;
  /** Bytes present across all four files, resume included. */
  bytesDone: number;
  bytesTotal: number;
  /** Set only in the `error` state. */
  error?: string;
  /** What Remove would free. 0 when nothing is on disk. */
  sizeOnDisk: number;
}

type Listener = (s: VoiceStatus) => void;

let listeners: Listener[] = [];
let downloading = false;
let abort: AbortController | null = null;
let lastError: string | undefined;
/** Bytes of the file currently in flight, so progress is smooth across four files. */
let inFlightBytes = 0;
let inFlightName: string | null = null;

export function onVoiceStatus(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** Broadcast a WHOLE-STATE snapshot, the same shape as hv:mcp-status-changed. */
function emit(): void {
  const s = voiceStatus();
  for (const l of listeners) l(s);
}

function sizeOf(f: VoiceModelFile): number {
  const p = path.join(voiceModelDir(), f.name);
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * A file counts as present when it is on disk at EXACTLY the pinned length.
 * Re-digesting 671 MB on every launch would cost seconds at boot; the digest
 * is verified once, at download time, before the file is ever renamed into
 * place — so a wrong-length file here means an interrupted or tampered copy.
 */
function isComplete(f: VoiceModelFile): boolean {
  return sizeOf(f) === f.bytes;
}

export function isModelReady(): boolean {
  return VOICE_MODEL.files.every(isComplete);
}

export function voiceStatus(): VoiceStatus {
  const sizeOnDisk = VOICE_MODEL.files.reduce((n, f) => n + sizeOf(f), 0);
  if (downloading) {
    // Completed files + however far the in-flight one has got.
    const done = VOICE_MODEL.files.reduce(
      (n, f) => n + (f.name === inFlightName ? inFlightBytes : isComplete(f) ? f.bytes : 0),
      0,
    );
    return { state: "downloading", bytesDone: done, bytesTotal: VOICE_MODEL.totalBytes, sizeOnDisk };
  }
  if (lastError) {
    return { state: "error", bytesDone: 0, bytesTotal: VOICE_MODEL.totalBytes, error: lastError, sizeOnDisk };
  }
  if (isModelReady()) {
    return { state: "ready", bytesDone: VOICE_MODEL.totalBytes, bytesTotal: VOICE_MODEL.totalBytes, sizeOnDisk };
  }
  return { state: "unactivated", bytesDone: 0, bytesTotal: VOICE_MODEL.totalBytes, sizeOnDisk };
}

/**
 * Fetch whatever is missing. Idempotent and non-blocking: the user keeps
 * typing and working, and the mic becomes active when it finishes.
 */
export async function startVoiceDownload(): Promise<void> {
  if (downloading || isModelReady()) return;
  downloading = true;
  lastError = undefined;
  abort = new AbortController();
  const dir = voiceModelDir();
  fs.mkdirSync(path.join(dir, "test_wavs"), { recursive: true });

  // Throttle the broadcast: a 652 MB body fires `data` thousands of times a
  // second, and one IPC message per chunk would flood the renderer.
  let lastEmit = 0;
  const tick = (): void => {
    const now = Date.now();
    if (now - lastEmit < 250) return;
    lastEmit = now;
    emit();
  };

  try {
    emit();
    for (const f of VOICE_MODEL.files) {
      if (isComplete(f)) continue;
      inFlightName = f.name;
      inFlightBytes = 0;
      await downloadFile(
        fileUrl(f),
        path.join(dir, f.name),
        f,
        (n) => {
          inFlightBytes = n;
          tick();
        },
        abort.signal,
      );
      inFlightName = null;
      inFlightBytes = 0;
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  } finally {
    downloading = false;
    inFlightName = null;
    inFlightBytes = 0;
    abort = null;
    emit();
  }
}

export function cancelVoiceDownload(): void {
  abort?.abort();
  // The .part files stay: §7.3's resume is the point of writing them.
}

/**
 * Delete the model and return the feature to unactivated. Recoverable by
 * re-downloading, so §7.4 asks for no confirmation beyond a size statement.
 */
export function removeVoiceModel(): void {
  cancelVoiceDownload();
  voiceHost.unload(); // release the files before unlinking them
  fs.rmSync(voiceModelDir(), { recursive: true, force: true });
  lastError = undefined;
  emit();
}
