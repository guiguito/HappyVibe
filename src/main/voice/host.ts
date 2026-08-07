/**
 * §27/§5.3. Owns the inference child: lazy load, idle unload, one restart.
 *
 * utilityProcess (a Chromium service) rather than a raw child spawn — which is
 * also why the documented "generic exec Dock icon" class for Electron-as-node
 * children should not apply here. Confirm it once on the first GUI pass
 * anyway; that failure has bitten this repo before and costs thirty seconds
 * to check.
 */
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { modelCacheDir } from "../config";

/** Holding ~1.83 GB for a feature nobody is using is not acceptable. */
const IDLE_UNLOAD_MS = 5 * 60_000;
const NUM_THREADS = 4;

/** `<userData>/models/voice` — where the downloader puts the four files. */
export function voiceModelDir(): string {
  return path.join(modelCacheDir(), "voice");
}

interface Pending {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

export class VoiceHost {
  private proc: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private idleTimer: NodeJS.Timeout | null = null;

  isLoaded(): boolean {
    return this.proc !== null;
  }

  private spawn(): Promise<void> {
    // electron-vite emits this beside the main bundle (a second rollup input).
    const entry = path.join(__dirname, "voice-worker.js");
    const proc = utilityProcess.fork(entry, [], { serviceName: "HappyVibe Voice" });
    this.proc = proc;

    const ready = new Promise<void>((resolve, reject) => {
      proc.on("message", (m: { ready?: boolean; fatal?: string; id?: number; text?: string; error?: string }) => {
        if (m.ready) return resolve();
        if (m.fatal) return reject(new Error(m.fatal));
        if (typeof m.id !== "number") return;
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.text ?? "");
      });
      proc.on("exit", () => {
        this.proc = null;
        this.ready = null;
        // Whoever was waiting will never hear back — fail them rather than hang.
        for (const p of this.pending.values()) p.reject(new Error("voice engine exited"));
        this.pending.clear();
        reject(new Error("voice engine exited during load"));
      });
    });

    proc.postMessage({ init: { dir: voiceModelDir(), numThreads: NUM_THREADS } });
    return ready;
  }

  private async send(pcm: Int16Array): Promise<string> {
    if (!this.ready) this.ready = this.spawn();
    await this.ready;
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.postMessage({ id, pcm });
    });
  }

  /**
   * Transcribe one utterance. The model loads on the first call — about 930 ms,
   * absorbed by the recording gesture itself, since it loads while the user is
   * still speaking.
   */
  async transcribe(pcm: Int16Array): Promise<string> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    try {
      try {
        return await this.send(pcm);
      } catch (err) {
        // §10: a utilityProcess death gets ONE automatic restart, then a clear
        // error. Retrying more would just spend the user's time twice over.
        this.unload();
        void err;
        return await this.send(pcm);
      }
    } finally {
      this.idleTimer = setTimeout(() => this.unload(), IDLE_UNLOAD_MS);
    }
  }

  /** Reclaim the working set. Safe to call when nothing is loaded. */
  unload(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
  }
}

export const voiceHost = new VoiceHost();
