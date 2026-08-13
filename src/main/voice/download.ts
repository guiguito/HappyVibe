/**
 * §27/§7.3. The one piece of genuinely new infrastructure in this feature:
 * the codebase has no byte-level progress plumbing today.
 *
 * Shaped after the one existing HTTPS downloader (skills/gitImport.ts), which
 * already follows redirects and counts bytes in a `res.on("data")` handler.
 * Three things it lacks and this needs: Range resume (a user on hotel wifi
 * should not restart 652 MB), a running byte callback, and digest
 * verification before the bytes are ever handed to a native ONNX parser.
 *
 * This runs in MAIN, never the renderer: the renderer's CSP is
 * `default-src 'self'` with no `connect-src`, and downloading from main
 * sidesteps that rather than weakening it.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { VoiceModelFile } from "./manifest";

export async function sha256File(p: string): Promise<string> {
  const h = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(p), h);
  return h.digest("hex");
}

interface Res {
  status: number;
  stream: NodeJS.ReadableStream;
}

/** GET with redirect following (HF `resolve` URLs redirect to a CDN). `from > 0` asks for a range. */
function get(url: string, from: number, signal?: AbortSignal, redirects = 5): Promise<Res> {
  return new Promise((resolve, reject) => {
    const mod = new URL(url).protocol === "http:" ? http : https;
    const headers: Record<string, string> = { "User-Agent": "HappyVibe" };
    if (from > 0) headers.Range = `bytes=${from}-`;
    const req = mod.get(url, { headers, signal }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) {
          reject(new Error("too many redirects"));
          return;
        }
        resolve(get(new URL(res.headers.location, url).toString(), from, signal, redirects - 1));
        return;
      }
      if (status !== 200 && status !== 206) {
        res.resume();
        reject(new Error(`download failed: HTTP ${status}`));
        return;
      }
      resolve({ status, stream: res });
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("download timed out")));
  });
}

/**
 * Fetch one model file to `dest`, resuming any `<dest>.part`, verifying the
 * pinned sha256, and renaming ONLY after it verifies — so a crash mid-download
 * can never present a truncated model as ready.
 *
 * `onBytes` receives the TOTAL bytes on disk for this file, resume included,
 * rather than a delta, so a progress bar can be driven from it directly.
 */
export async function downloadFile(
  url: string,
  dest: string,
  expected: VoiceModelFile,
  onBytes: (n: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const part = `${dest}.part`;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  // A part longer than the finished file is garbage from a changed pin — start over.
  if (have > expected.bytes) {
    fs.rmSync(part, { force: true });
    have = 0;
  }

  const res = await get(url, have, signal);
  // A server that ignores Range answers 200 with the WHOLE body. Appending that
  // to an existing part would silently produce a corrupt file that only the
  // digest catches — so treat a 200 as "start over" explicitly.
  const append = res.status === 206 && have > 0;
  if (!append) have = 0;

  let seen = have;
  res.stream.on("data", (c: Buffer) => {
    seen += c.length;
    onBytes(seen);
  });
  await pipeline(res.stream, fs.createWriteStream(part, append ? { flags: "a" } : {}));

  const actual = await sha256File(part);
  if (actual !== expected.sha256) {
    fs.rmSync(part, { force: true });
    fs.rmSync(dest, { force: true });
    throw new Error(
      `checksum mismatch for ${expected.name}: expected ${expected.sha256}, got ${actual}`,
    );
  }
  fs.renameSync(part, dest);
}
