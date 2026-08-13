# Voice Input (PRD §27) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A microphone button in the composer that turns speech into text, transcribed entirely on-device by a model the user downloads once.

**Architecture:** Renderer captures 16 kHz mono via an `AudioWorkletNode`, converts to `Int16Array` in the worklet, and gates on length and energy *before* any IPC. Main owns the model download (resumable, SHA-256 verified) and forwards audio to an Electron `utilityProcess` running `sherpa-onnx-node` — isolated for the same reason `pi/spawn.ts` isolates Pi: a native OOM must not take the app down, and a 1.83 GB working set must be reclaimable by killing a PID. Transcribed text is appended to the composer; it is never auto-sent.

**Tech Stack:** `sherpa-onnx-node@1.13.4` (ONNX Runtime, CPU provider), Electron `utilityProcess`, Web Audio `AudioWorkletNode`, existing HappyVibe IPC/config/settings patterns.

## Global Constraints

- **Model repo:** `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`, revision **`2bda32ec70b097a55adaa07d9a7173915b43cc78`**. Pinned by revision, **never `resolve/main`**. Verified `gated: false`, no auth token required.
- **Upstream weights:** `nvidia/parakeet-tdt-0.6b-v3`, **CC-BY-4.0**, 25 languages. Attribution required.
- **The four files, with exact bytes and SHA-256** (digests taken from Hugging Face LFS `oid`, which *is* the sha256; `tokens.txt` is not LFS so its digest was computed from the downloaded file):

  | File | Bytes | SHA-256 |
  |---|---:|---|
  | `encoder.int8.onnx` | 652,184,281 | `acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247` |
  | `decoder.int8.onnx` | 11,845,275 | `179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e` |
  | `joiner.int8.onnx` | 6,355,277 | `3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3` |
  | `tokens.txt` | 93,939 | `d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d` |

  **Total 670,478,772 bytes.** Present this to users as "671 MB".
- **Test fixture:** `test_wavs/en.wav` from the same repo/revision, 184,608 bytes, sha256 `148b936b43ce7c546a866e64da059f0458aee2d65e617f16e9d94f06e8d99ed6`.
- **`provider` is `'cpu'`, always.** ONNX Runtime's CoreML EP is 3–4× *slower* for this model. Pinned by a contract test so nobody "optimises" it.
- **The model is never named in the dictation flow.** The button, activation modal and progress UI say "voice model". `parakeet`, `NVIDIA`, `sherpa`, `FastConformer` appear only in the Voice page's licenses block and `NOTICE`.
- **No audio to disk, no transcript to any log.** No EventLog entry, no audit entry, no telemetry.
- **Settings are global only** (no per-workspace voice settings), matching §26.
- **Never run `npm run lint` / `npm run format`** — scaffold leftovers, see CLAUDE.md.
- **Gate:** `npm run gate` (= `build` → non-live suite). `npm run typecheck` is already inside `build`; do not run it separately. **Never pipe a test run to `tail`/`grep`** — redirect to a file, then grep the file.
- **No live-Pi run is required for any task in this plan.** Voice registers no Pi tools and never touches the bridge; `npm run live:why` will print nothing for these files.

---

## File Structure

**New — main:**
- `src/main/voice/manifest.ts` — pure data: repo, revision, per-file size + digest, total. No I/O.
- `src/main/voice/download.ts` — resumable, digest-verified fetch of one file; `.part` → rename.
- `src/main/voice/recognizer.ts` — builds the `sherpa-onnx-node` config object. Pure, so a contract test can assert its shape without loading the native module.
- `src/main/voice/worker.ts` — the `utilityProcess` body: loads the native module, answers `transcribe` messages.
- `src/main/voice/host.ts` — `utilityProcess` lifecycle: lazy spawn, 5-min idle unload, one restart on crash.
- `src/main/voice/settings.ts` — `VoiceSettings` + `mergeVoiceSettings` (mirrors `terminalSettings.ts`).
- `src/main/voice/languages.ts` — the 25 languages, accuracy tier, locale resolution. Pure.
- `src/main/voice/index.ts` — the facade `ipc.ts` talks to: state machine + status snapshot.

**New — renderer:**
- `src/renderer/src/composerText.ts` — `appendToComposer(prev, text)`. One definition, two callers.
- `src/renderer/src/voice/gesture.ts` — pure tap/hold/abandon reducer.
- `src/renderer/src/voice/gates.ts` — `floatToInt16`, `passesLengthGate`, `passesEnergyGate`. Pure.
- `src/renderer/src/voice/worklet.ts` — the `AudioWorkletProcessor` source (built as a separate asset).
- `src/renderer/src/voice/capture.ts` — `getUserMedia` + `AudioContext` + worklet wiring.
- `src/renderer/src/components/MicButton.tsx` — the five-state chip.
- `src/renderer/src/components/VoiceActivateModal.tsx` — the activation modal.
- `src/renderer/src/components/VoiceView.tsx` — the settings page.

**Modified:** `src/main/config.ts` · `src/main/ipc.ts` · `src/preload/index.ts` · `src/renderer/src/hv.d.ts` · `src/renderer/src/components/{Sidebar,ChatView,Section}.tsx` · `src/renderer/src/App.tsx` · `src/renderer/src/shortcuts.ts` · `electron.vite.config.ts` · `electron-builder.yml` · `build/entitlements.mac.plist` · `build/afterPack.mjs` · `package.json` · `NOTICE` (new).

---

# Phase 1 — Model plumbing, no UI

## Task 1: The pinned manifest and its contract test

**Files:**
- Create: `src/main/voice/manifest.ts`
- Test: `tests/voice-manifest.test.ts`

**Interfaces:**
- Produces: `VOICE_MODEL = { repo: string; revision: string; files: VoiceModelFile[]; totalBytes: number }`, `VoiceModelFile = { name: string; bytes: number; sha256: string }`, `fileUrl(f: VoiceModelFile): string`, `VOICE_FIXTURE_WAV: VoiceModelFile`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice-manifest.test.ts
import { describe, it, expect } from "vitest";
import { VOICE_MODEL, fileUrl, VOICE_FIXTURE_WAV } from "../src/main/voice/manifest";

describe("voice model manifest", () => {
  it("pins an exact revision, never a mutable branch", () => {
    expect(VOICE_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(VOICE_MODEL.revision).toBe("2bda32ec70b097a55adaa07d9a7173915b43cc78");
    expect(fileUrl(VOICE_MODEL.files[0])).not.toContain("resolve/main");
    expect(fileUrl(VOICE_MODEL.files[0])).toContain(`/resolve/${VOICE_MODEL.revision}/`);
  });

  it("pins the four files with their exact bytes and digests", () => {
    expect(VOICE_MODEL.files.map((f) => f.name).sort()).toEqual([
      "decoder.int8.onnx", "encoder.int8.onnx", "joiner.int8.onnx", "tokens.txt",
    ]);
    const by = Object.fromEntries(VOICE_MODEL.files.map((f) => [f.name, f]));
    expect(by["encoder.int8.onnx"]).toMatchObject({
      bytes: 652_184_281,
      sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
    });
    expect(by["decoder.int8.onnx"]).toMatchObject({
      bytes: 11_845_275,
      sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
    });
    expect(by["joiner.int8.onnx"]).toMatchObject({
      bytes: 6_355_277,
      sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
    });
    expect(by["tokens.txt"]).toMatchObject({
      bytes: 93_939,
      sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
    });
  });

  it("every digest is a lowercase sha256 and totalBytes is the real sum", () => {
    for (const f of VOICE_MODEL.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    const sum = VOICE_MODEL.files.reduce((n, f) => n + f.bytes, 0);
    expect(sum).toBe(670_478_772);
    expect(VOICE_MODEL.totalBytes).toBe(sum);
  });

  it("carries a fixture wav from the same pinned revision", () => {
    expect(VOICE_FIXTURE_WAV.name).toBe("test_wavs/en.wav");
    expect(VOICE_FIXTURE_WAV.bytes).toBe(184_608);
    expect(fileUrl(VOICE_FIXTURE_WAV)).toContain(VOICE_MODEL.revision);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/voice-manifest.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — cannot resolve `../src/main/voice/manifest`.

- [ ] **Step 3: Write the manifest**

```ts
// src/main/voice/manifest.ts
/**
 * §27. The voice model, pinned by revision and verified per file.
 *
 * NEVER change `revision` to a branch name. `main` is a mutable pointer on a
 * third party's repository and ONNX Runtime parses these files with native
 * code, so unverified bytes in userData are a real supply-chain surface.
 * Digests are the Hugging Face LFS `oid` (which IS the sha256); tokens.txt is
 * not an LFS object, so its digest was computed from the downloaded file.
 */
export interface VoiceModelFile {
  /** Path within the repo, also the path under the local model dir. */
  name: string;
  bytes: number;
  sha256: string;
}

export const VOICE_MODEL = {
  repo: "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  revision: "2bda32ec70b097a55adaa07d9a7173915b43cc78",
  /** Upstream weights, for the licenses block — never shown in the dictation flow. */
  attribution: {
    model: "nvidia/parakeet-tdt-0.6b-v3",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
  files: [
    { name: "encoder.int8.onnx", bytes: 652_184_281, sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247" },
    { name: "decoder.int8.onnx", bytes: 11_845_275, sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e" },
    { name: "joiner.int8.onnx", bytes: 6_355_277, sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3" },
    { name: "tokens.txt", bytes: 93_939, sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d" },
  ] as VoiceModelFile[],
  totalBytes: 670_478_772,
} as const;

/** The English fixture used by the model-gated end-to-end test (Task 12). */
export const VOICE_FIXTURE_WAV: VoiceModelFile = {
  name: "test_wavs/en.wav",
  bytes: 184_608,
  sha256: "148b936b43ce7c546a866e64da059f0458aee2d65e617f16e9d94f06e8d99ed6",
};

export function fileUrl(f: VoiceModelFile): string {
  return `https://huggingface.co/${VOICE_MODEL.repo}/resolve/${VOICE_MODEL.revision}/${f.name}`;
}
```

- [ ] **Step 4: Run the test — expect PASS**

```
L=/tmp/vitest.log; npx vitest run tests/voice-manifest.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/manifest.ts tests/voice-manifest.test.ts
git commit -m "feat(voice): pin the model by revision, with per-file digests"
```

---

## Task 2: `modelCacheDir()` and the resumable, verified downloader

**Files:**
- Modify: `src/main/config.ts` (add `modelCacheDir` beside `snapshotDir` at ~line 405)
- Create: `src/main/voice/download.ts`
- Test: `tests/voice-download.test.ts`

**Interfaces:**
- Consumes: `VoiceModelFile`, `fileUrl` from Task 1.
- Produces: `downloadFile(url, dest, expect: VoiceModelFile, onBytes: (n:number)=>void, signal?: AbortSignal): Promise<void>` — resumes from an existing `.part`, verifies sha256, renames on success, deletes and throws on mismatch. `sha256File(path): Promise<string>`. `modelCacheDir(): string`.

- [ ] **Step 1: Write the failing test**

The test runs a real local `http.Server` so no network is touched. It covers the three behaviours that matter: a clean download verifies and renames; a partial `.part` resumes via `Range` and does **not** refetch the prefix; a corrupt body is deleted rather than kept.

```ts
// tests/voice-download.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { downloadFile, sha256File } from "../src/main/voice/download";

const BODY = Buffer.from("hello voice model bytes, long enough to slice");
const DIGEST = crypto.createHash("sha256").update(BODY).digest("hex");

let server: http.Server;
let base = "";
let rangeHeaders: (string | undefined)[] = [];
let corrupt = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    rangeHeaders.push(req.headers.range as string | undefined);
    const body = corrupt ? Buffer.from("not the bytes you asked for") : BODY;
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (m) {
      const start = Number(m[1]);
      res.writeHead(206, {
        "content-range": `bytes ${start}-${body.length - 1}/${body.length}`,
        "content-length": String(body.length - start),
      });
      res.end(body.subarray(start));
      return;
    }
    res.writeHead(200, { "content-length": String(body.length) });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hv-voice-"));
}
const spec = { name: "f.bin", bytes: BODY.length, sha256: DIGEST };

describe("voice model downloader", () => {
  it("downloads, verifies and renames off .part", async () => {
    const dir = tmp();
    const dest = path.join(dir, "f.bin");
    let seen = 0;
    await downloadFile(`${base}/f.bin`, dest, spec, (n) => { seen = n; });
    expect(fs.readFileSync(dest)).toEqual(BODY);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(seen).toBe(BODY.length);
  });

  it("resumes from a partial .part instead of restarting", async () => {
    const dir = tmp();
    const dest = path.join(dir, "f.bin");
    fs.writeFileSync(`${dest}.part`, BODY.subarray(0, 10));
    rangeHeaders = [];
    await downloadFile(`${base}/f.bin`, dest, spec, () => {});
    expect(rangeHeaders).toContain("bytes=10-");
    expect(fs.readFileSync(dest)).toEqual(BODY);
  });

  it("deletes the file and throws when the digest does not match", async () => {
    const dir = tmp();
    const dest = path.join(dir, "f.bin");
    corrupt = true;
    await expect(downloadFile(`${base}/f.bin`, dest, spec, () => {})).rejects.toThrow(/checksum/i);
    corrupt = false;
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("sha256File matches node crypto", async () => {
    const dir = tmp();
    const p = path.join(dir, "x");
    fs.writeFileSync(p, BODY);
    expect(await sha256File(p)).toBe(DIGEST);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/voice-download.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — cannot resolve `../src/main/voice/download`.

- [ ] **Step 3: Write the downloader**

Mirrors `skills/gitImport.ts`'s redirect-following `https.get`, adding the three things it lacks: `Range` resume, a running byte callback, and digest verification. It uses `node:http` **or** `node:https` chosen by protocol so the test can drive it over loopback http.

```ts
// src/main/voice/download.ts
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

interface Res { status: number; headers: http.IncomingHttpHeaders; stream: NodeJS.ReadableStream }

/** GET with redirect following. `from > 0` asks for a byte range. */
function get(url: string, from: number, signal?: AbortSignal, redirects = 5): Promise<Res> {
  return new Promise((resolve, reject) => {
    const mod = new URL(url).protocol === "http:" ? http : https;
    const headers: Record<string, string> = { "User-Agent": "HappyVibe" };
    if (from > 0) headers.Range = `bytes=${from}-`;
    const req = mod.get(url, { headers, signal }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error("too many redirects"));
        resolve(get(new URL(res.headers.location, url).toString(), from, signal, redirects - 1));
        return;
      }
      if (status !== 200 && status !== 206) {
        res.resume();
        return reject(new Error(`download failed: HTTP ${status}`));
      }
      resolve({ status, headers: res.headers, stream: res });
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("download timed out")));
  });
}

/**
 * Fetch one model file to `dest`, resuming any `<dest>.part`, verifying the
 * pinned sha256, and renaming only after it verifies — so a crash mid-download
 * can never present a truncated model as ready.
 *
 * `onBytes` receives the TOTAL bytes on disk for this file (resume included),
 * not a delta, so a progress bar can be driven from it directly.
 */
export async function downloadFile(
  url: string,
  dest: string,
  expect: VoiceModelFile,
  onBytes: (n: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const part = `${dest}.part`;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (have > expect.bytes) { fs.rmSync(part); have = 0; } // a stale/oversized part is garbage

  const res = await get(url, have, signal);
  // A server that ignores Range answers 200 with the whole body: restart cleanly.
  const append = res.status === 206 && have > 0;
  if (!append) have = 0;

  let seen = have;
  res.stream.on("data", (c: Buffer) => { seen += c.length; onBytes(seen); });
  await pipeline(res.stream, fs.createWriteStream(part, append ? { flags: "a" } : {}));

  const actual = await sha256File(part);
  if (actual !== expect.sha256) {
    fs.rmSync(part, { force: true });
    fs.rmSync(dest, { force: true });
    throw new Error(`checksum mismatch for ${expect.name}: expected ${expect.sha256}, got ${actual}`);
  }
  fs.renameSync(part, dest);
}
```

- [ ] **Step 4: Add `modelCacheDir()` to `config.ts`**

Place it directly after `snapshotDir()` (~line 405) and copy that function's shape exactly.

```ts
/** §27: downloaded model weights (voice, and anything later). */
export function modelCacheDir(): string {
  const d = path.join(app.getPath("userData"), "models");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
```

- [ ] **Step 5: Run the test — expect PASS**

```
L=/tmp/vitest.log; npx vitest run tests/voice-download.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 6: Commit**

```bash
git add src/main/voice/download.ts src/main/config.ts tests/voice-download.test.ts
git commit -m "feat(voice): resumable, digest-verified model download"
```

---

## Task 3: The recognizer config, pinned by contract test

**Files:**
- Create: `src/main/voice/recognizer.ts`
- Modify: `package.json` (add `sherpa-onnx-node`)
- Test: `tests/voice-runtime-contract.test.ts`

**Interfaces:**
- Produces: `buildRecognizerConfig(dir: string, numThreads?: number): OfflineRecognizerConfig`.

The config is built by a **pure** function so the contract test can assert its shape without loading a 1.83 GB native module.

- [ ] **Step 1: Install the runtime**

```bash
npm install sherpa-onnx-node@1.13.4
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/voice-runtime-contract.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { buildRecognizerConfig } from "../src/main/voice/recognizer";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("sherpa-onnx runtime contract", () => {
  it("is pinned exactly, and ships a platform package for every target §27 promises", () => {
    expect(pkg.dependencies["sherpa-onnx-node"]).toBe("1.13.4");
    const optional = JSON.parse(
      readFileSync(new URL("../node_modules/sherpa-onnx-node/package.json", import.meta.url), "utf8"),
    ).optionalDependencies as Record<string, string>;
    for (const p of ["sherpa-onnx-darwin-arm64", "sherpa-onnx-darwin-x64", "sherpa-onnx-linux-x64", "sherpa-onnx-win-x64"]) {
      expect(Object.keys(optional)).toContain(p);
    }
  });

  it("uses the CPU provider — the CoreML EP is 3-4x SLOWER for this model", () => {
    const c = buildRecognizerConfig("/models/voice");
    expect(c.modelConfig.provider).toBe("cpu");
    expect(c.modelConfig.provider).not.toBe("coreml");
  });

  it("describes a nemo transducer with the encoder/decoder/joiner triple", () => {
    const c = buildRecognizerConfig("/models/voice");
    expect(c.modelConfig.modelType).toBe("nemo_transducer");
    expect(c.featConfig).toEqual({ sampleRate: 16000, featureDim: 128 });
    expect(c.modelConfig.transducer).toEqual({
      encoder: path.join("/models/voice", "encoder.int8.onnx"),
      decoder: path.join("/models/voice", "decoder.int8.onnx"),
      joiner: path.join("/models/voice", "joiner.int8.onnx"),
    });
    expect(c.modelConfig.tokens).toBe(path.join("/models/voice", "tokens.txt"));
  });

  it("sets numThreads deliberately — ORT's default oversubscribes against Chromium's pools", () => {
    expect(buildRecognizerConfig("/m").modelConfig.numThreads).toBe(4);
    expect(buildRecognizerConfig("/m", 2).modelConfig.numThreads).toBe(2);
  });

  it("every model path it names is a file the manifest pins", async () => {
    const { VOICE_MODEL } = await import("../src/main/voice/manifest");
    const c = buildRecognizerConfig("/m");
    const used = [c.modelConfig.transducer.encoder, c.modelConfig.transducer.decoder,
                  c.modelConfig.transducer.joiner, c.modelConfig.tokens].map((p) => path.basename(p));
    expect(used.sort()).toEqual(VOICE_MODEL.files.map((f) => f.name).sort());
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/voice-runtime-contract.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 4: Write the builder**

```ts
// src/main/voice/recognizer.ts
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

/**
 * §27. Built as a pure function so the contract test can pin its shape without
 * loading the native module.
 *
 * `provider` is 'cpu' ON PURPOSE and is asserted by that test: ONNX Runtime's
 * CoreML execution provider measured 3-4x SLOWER than its own CPU provider for
 * this model, because the Conformer encoder's dynamic sequence lengths force
 * graph partitioning. "CoreML EP" is not "Neural Engine".
 */
export function buildRecognizerConfig(dir: string, numThreads = 4): OfflineRecognizerConfig {
  return {
    featConfig: { sampleRate: 16000, featureDim: 128 },
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
```

- [ ] **Step 5: Run the test — expect PASS**, then commit

```bash
L=/tmp/vitest.log; npx vitest run tests/voice-runtime-contract.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add package.json package-lock.json src/main/voice/recognizer.ts tests/voice-runtime-contract.test.ts
git commit -m "feat(voice): pin the sherpa-onnx config, cpu provider included"
```

---

## Task 4: The `utilityProcess` worker and its host

**Files:**
- Create: `src/main/voice/worker.ts`, `src/main/voice/host.ts`
- Modify: `electron.vite.config.ts` (second main entry so the worker is bundled)

**Interfaces:**
- Consumes: `buildRecognizerConfig` (Task 3), `modelCacheDir` (Task 2).
- Produces: `VoiceHost` with `transcribe(pcm: Int16Array): Promise<string>`, `unload(): void`, `isLoaded(): boolean`.

Worker protocol: host → worker `{ id, pcm }`; worker → host `{ id, text }` or `{ id, error }`. Plus a one-shot `{ ready: true }` / `{ fatal: string }` on load.

- [ ] **Step 1: Write the worker**

```ts
// src/main/voice/worker.ts
/**
 * §27. Runs INSIDE an Electron utilityProcess. Loads the native ONNX runtime
 * and answers transcribe requests. Isolated for the same reason pi/spawn.ts
 * isolates Pi: a native crash or OOM must not take the app down, and a 1.83 GB
 * working set must be reclaimable by killing a PID.
 */
import { buildRecognizerConfig } from "./recognizer";

interface Req { id: number; pcm: Int16Array }

let recognizer: { createStream: () => unknown; decode: (s: unknown) => void; getResult: (s: unknown) => { text: string } } | null = null;

function load(dir: string, numThreads: number): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require("sherpa-onnx-node");
  recognizer = new sherpa.OfflineRecognizer(buildRecognizerConfig(dir, numThreads));
}

process.parentPort.on("message", (e) => {
  const msg = e.data as Req | { init: { dir: string; numThreads: number } };
  if ("init" in msg) {
    try {
      load(msg.init.dir, msg.init.numThreads);
      process.parentPort.postMessage({ ready: true });
    } catch (err) {
      process.parentPort.postMessage({ fatal: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const { id, pcm } = msg;
  try {
    if (!recognizer) throw new Error("recognizer not loaded");
    // sherpa wants float32 in [-1, 1]; the renderer sent int16 to halve the IPC payload.
    const samples = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
    const stream = recognizer.createStream();
    (stream as { acceptWaveform: (o: { sampleRate: number; samples: Float32Array }) => void })
      .acceptWaveform({ sampleRate: 16000, samples });
    recognizer.decode(stream);
    process.parentPort.postMessage({ id, text: recognizer.getResult(stream).text ?? "" });
  } catch (err) {
    process.parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
```

- [ ] **Step 2: Write the host**

```ts
// src/main/voice/host.ts
import path from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { modelCacheDir } from "../config";

const IDLE_UNLOAD_MS = 5 * 60_000;
const VOICE_DIR = "voice";

/**
 * §27. Owns the inference child: lazy load, idle unload, one restart on crash.
 *
 * utilityProcess (a Chromium service) rather than a raw spawn — which is also
 * why the "generic exec Dock icon" class documented for Electron-as-node
 * children should not apply. Verify once on the first GUI pass anyway.
 */
export class VoiceHost {
  private proc: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private idleTimer: NodeJS.Timeout | null = null;
  private restarted = false;

  isLoaded(): boolean { return this.proc !== null; }

  private spawn(): Promise<void> {
    const dir = path.join(modelCacheDir(), VOICE_DIR);
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
        for (const p of this.pending.values()) p.reject(new Error("voice engine exited"));
        this.pending.clear();
      });
    });

    proc.postMessage({ init: { dir, numThreads: 4 } });
    return ready;
  }

  async transcribe(pcm: Int16Array): Promise<string> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    try {
      return await this.send(pcm);
    } catch (err) {
      // One automatic restart, then a clear error (§10).
      if (this.restarted) throw err;
      this.restarted = true;
      this.unload();
      const text = await this.send(pcm);
      this.restarted = false;
      return text;
    } finally {
      this.idleTimer = setTimeout(() => this.unload(), IDLE_UNLOAD_MS);
    }
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

  /** Reclaim the ~1.83 GB working set. The app runs Pi sessions beside this. */
  unload(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
  }
}

export const voiceHost = new VoiceHost();
```

- [ ] **Step 3: Add the worker as a second main entry**

In `electron.vite.config.ts`, give the `main` build two inputs so the worker is emitted as `out/main/voice-worker.js` (the path `host.ts` forks). `sherpa-onnx-node` must stay **external** — it is a native module and must not be bundled.

```ts
main: {
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/main/index.ts"),
        "voice-worker": resolve(__dirname, "src/main/voice/worker.ts"),
      },
      external: ["sherpa-onnx-node"],
    },
  },
  // …existing plugins/config unchanged
}
```

- [ ] **Step 4: Verify it builds and the worker is emitted**

```bash
npm run build 2>&1 | tail -20
ls -la out/main/voice-worker.js
```
Expected: both typechecks pass and `out/main/voice-worker.js` exists.

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/worker.ts src/main/voice/host.ts electron.vite.config.ts
git commit -m "feat(voice): isolate inference in a utilityProcess with idle unload"
```

---

## Task 5: Settings, languages, and the state facade

**Files:**
- Create: `src/main/voice/settings.ts`, `src/main/voice/languages.ts`, `src/main/voice/index.ts`
- Modify: `src/main/config.ts` (a `voice` key, mirroring `terminal`)
- Test: `tests/voice-languages.test.ts`

**Interfaces:**
- Produces: `VoiceSettings { language, inputDeviceId, echoCancellation, noiseSuppression, autoGainControl, holdThresholdMs, maxRecordingMs }`; `mergeVoiceSettings(partial): VoiceSettings`; `VOICE_LANGUAGES: {code,name,tier:"good"|"lower"}[]`; `resolveLocale(locale): {code, supported}`; `voiceStatus(): VoiceStatus`.

- [ ] **Step 1: Write the failing language test**

```ts
// tests/voice-languages.test.ts
import { describe, it, expect } from "vitest";
import { VOICE_LANGUAGES, resolveLocale } from "../src/main/voice/languages";
import { mergeVoiceSettings } from "../src/main/voice/settings";

describe("voice languages", () => {
  it("offers exactly the 25 the model supports", () => {
    expect(VOICE_LANGUAGES).toHaveLength(25);
    expect(new Set(VOICE_LANGUAGES.map((l) => l.code)).size).toBe(25);
  });

  it("excludes the languages that fail catastrophically — never greyed out, absent", () => {
    const codes = VOICE_LANGUAGES.map((l) => l.code);
    for (const bad of ["ja", "ko", "zh"]) expect(codes).not.toContain(bad);
  });

  it("flags the low-accuracy half rather than presenting all 25 as equivalent", () => {
    const by = Object.fromEntries(VOICE_LANGUAGES.map((l) => [l.code, l.tier]));
    expect(by.it).toBe("good");   // 3.0% WER
    expect(by.es).toBe("good");   // 3.5%
    expect(by.sl).toBe("lower");  // 24.0%
    expect(by.lv).toBe("lower");  // 22.8%
    expect(by.el).toBe("lower");  // 20.7%
  });

  it("resolves a system locale, and says so plainly when it is unsupported", () => {
    expect(resolveLocale("fr-FR")).toEqual({ code: "fr", supported: true });
    expect(resolveLocale("en")).toEqual({ code: "en", supported: true });
    expect(resolveLocale("ja-JP")).toEqual({ code: "en", supported: false });
    expect(resolveLocale("")).toEqual({ code: "en", supported: false });
  });
});

describe("voice settings merge", () => {
  it("supplies defaults, with the processing toggles ON", () => {
    const s = mergeVoiceSettings(undefined);
    expect(s.language).toBe("en");
    expect(s.echoCancellation).toBe(true);
    expect(s.noiseSuppression).toBe(true);
    expect(s.autoGainControl).toBe(true);
    expect(s.holdThresholdMs).toBe(300);
    expect(s.maxRecordingMs).toBe(300_000);
  });

  it("range-checks rather than trusting a stored value", () => {
    expect(mergeVoiceSettings({ holdThresholdMs: 5 }).holdThresholdMs).toBe(300);
    expect(mergeVoiceSettings({ maxRecordingMs: 999_999_999 }).maxRecordingMs).toBe(300_000);
    expect(mergeVoiceSettings({ language: "ja" }).language).toBe("en"); // unsupported never persists
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/voice-languages.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 3: Write `languages.ts`**

```ts
// src/main/voice/languages.ts
/**
 * §27. The 25 languages the model supports, and nothing else.
 *
 * Out-of-set input does NOT degrade gracefully — measured CER 171 (Korean),
 * 159 (Japanese), 124 (Chinese): confident, fluent-looking garbage handed to an
 * agent that acts on it. So unsupported languages are ABSENT from the picker,
 * not greyed out. `tier` marks the accuracy spread inside the supported set
 * (VoxPopuli-dominated training data: Italian 3.0% WER against Slovenian 24.0%).
 */
export interface VoiceLanguage { code: string; name: string; tier: "good" | "lower" }

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: "bg", name: "Bulgarian", tier: "lower" },
  { code: "hr", name: "Croatian", tier: "lower" },
  { code: "cs", name: "Czech", tier: "good" },
  { code: "da", name: "Danish", tier: "lower" },
  { code: "nl", name: "Dutch", tier: "good" },
  { code: "en", name: "English", tier: "good" },
  { code: "et", name: "Estonian", tier: "lower" },
  { code: "fi", name: "Finnish", tier: "lower" },
  { code: "fr", name: "French", tier: "good" },
  { code: "de", name: "German", tier: "good" },
  { code: "el", name: "Greek", tier: "lower" },
  { code: "hu", name: "Hungarian", tier: "lower" },
  { code: "it", name: "Italian", tier: "good" },
  { code: "lv", name: "Latvian", tier: "lower" },
  { code: "lt", name: "Lithuanian", tier: "lower" },
  { code: "mt", name: "Maltese", tier: "lower" },
  { code: "pl", name: "Polish", tier: "good" },
  { code: "pt", name: "Portuguese", tier: "good" },
  { code: "ro", name: "Romanian", tier: "good" },
  { code: "ru", name: "Russian", tier: "good" },
  { code: "sk", name: "Slovak", tier: "lower" },
  { code: "sl", name: "Slovenian", tier: "lower" },
  { code: "es", name: "Spanish", tier: "good" },
  { code: "sv", name: "Swedish", tier: "good" },
  { code: "uk", name: "Ukrainian", tier: "good" },
];

export function isSupported(code: string): boolean {
  return VOICE_LANGUAGES.some((l) => l.code === code);
}

/** System locale → a supported code. Never guesses: unsupported falls to English and SAYS so. */
export function resolveLocale(locale: string): { code: string; supported: boolean } {
  const base = (locale || "").split(/[-_]/)[0]?.toLowerCase() ?? "";
  return isSupported(base) ? { code: base, supported: true } : { code: "en", supported: false };
}
```

- [ ] **Step 4: Write `settings.ts`**

```ts
// src/main/voice/settings.ts
import { isSupported } from "./languages";

export interface VoiceSettings {
  language: string;
  /** "" means the system default input. */
  inputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  holdThresholdMs: number;
  maxRecordingMs: number;
}

const DEFAULTS: VoiceSettings = {
  language: "en",
  inputDeviceId: "",
  // On by default — right for most people. Off is the calibration knob for
  // anyone on a real audio interface, who reliably wants these gone.
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  holdThresholdMs: 300,
  maxRecordingMs: 300_000,
};

const clamp = (n: unknown, lo: number, hi: number, dflt: number): number =>
  typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;

/** Always complete and always in range — same contract as mergeTerminalSettings. */
export function mergeVoiceSettings(p: Partial<VoiceSettings> | undefined): VoiceSettings {
  return {
    language: typeof p?.language === "string" && isSupported(p.language) ? p.language : DEFAULTS.language,
    inputDeviceId: typeof p?.inputDeviceId === "string" ? p.inputDeviceId : DEFAULTS.inputDeviceId,
    echoCancellation: p?.echoCancellation ?? DEFAULTS.echoCancellation,
    noiseSuppression: p?.noiseSuppression ?? DEFAULTS.noiseSuppression,
    autoGainControl: p?.autoGainControl ?? DEFAULTS.autoGainControl,
    holdThresholdMs: clamp(p?.holdThresholdMs, 100, 1000, DEFAULTS.holdThresholdMs),
    maxRecordingMs: clamp(p?.maxRecordingMs, 30_000, 600_000, DEFAULTS.maxRecordingMs),
  };
}
```

- [ ] **Step 5: Add the `voice` key to `config.ts`**, copying the `terminal` pattern exactly (`getVoiceSettings` / `setVoiceSettings`, global only).

- [ ] **Step 6: Write `index.ts`, the state facade**

`VoiceStatus = { state: "unactivated" | "downloading" | "ready" | "error"; bytesDone: number; bytesTotal: number; error?: string; sizeOnDisk: number }`. It verifies on boot by checking each manifest file exists with the right byte length (cheap — a full re-digest of 671 MB on every launch is not), exposes `startDownload()`, `cancelDownload()`, `removeModel()`, and broadcasts a whole-state snapshot, the same shape as `hv:mcp-status-changed`.

- [ ] **Step 7: Run the test — expect PASS**, then commit

```bash
L=/tmp/vitest.log; npx vitest run tests/voice-languages.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/main/voice/ src/main/config.ts tests/voice-languages.test.ts
git commit -m "feat(voice): settings, the 25 languages, and the model state facade"
```

---

## Task 6: IPC, preload, and the `hv.d.ts` mirror

**Files:**
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/hv.d.ts`

**Interfaces:**
- Produces on `window.hv`: `voiceStatus()`, `voiceDownload()`, `voiceCancelDownload()`, `voiceRemoveModel()`, `voiceGetSettings()`, `voiceSetSettings(p)`, `voiceMicStatus()`, `voiceAskMic()`, `voiceOpenMicSettings()`, `voiceTranscribe(pcm: Int16Array)`, `onVoiceProgress(cb)`.

- [ ] **Step 1: Add the handlers in `ipc.ts`**

`hv:voice-transcribe` forwards to `voiceHost.transcribe`. `hv:voice-mic-status` returns `systemPreferences.getMediaAccessStatus("microphone")` on darwin and `"granted"` elsewhere — **this call is the whole point of §8.3**: Chromium on macOS resolves `getUserMedia` with a live track producing nothing but zeros when TCC has not granted, so the renderer must never call `getUserMedia` without asking first. `hv:voice-open-mic-settings` uses `shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")`.

- [ ] **Step 2: Add the progress broadcast**

Beside the existing `send("hv:mcp-status-changed", …)` pattern, broadcast `hv:voice-status` with the whole `VoiceStatus` snapshot on every tick. Throttle to ~4 Hz — a 652 MB download fires `data` thousands of times a second and one IPC message per chunk would flood the renderer.

- [ ] **Step 3: Mirror into `preload/index.ts` and `hv.d.ts`**

`hv.d.ts` is hand-maintained and a missing entry fails the **web** typecheck, so add `HvVoiceStatus` / `HvVoiceSettings` interfaces mirroring the main-side types.

- [ ] **Step 4: Verify with the build**

```bash
npm run build 2>&1 | tail -20
```
Expected: both typechecks pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts
git commit -m "feat(voice): IPC surface, throttled progress, mic-permission probe"
```

---

# Phase 2 — Capture

## Task 7: The pure gates and the Float32→Int16 conversion

**Files:**
- Create: `src/renderer/src/voice/gates.ts`
- Test: `tests/voice-gates.test.ts`

**Interfaces:**
- Produces: `floatToInt16(f: Float32Array): Int16Array`, `passesLengthGate(samples, sampleRate, minMs?)`, `peakRms(pcm: Int16Array): number`, `passesEnergyGate(pcm, floor?)`.

These are four lines of logic and they are the difference between "nothing happened" and "the agent received a sentence I never said". They are pure, so they are unit-tested properly.

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice-gates.test.ts
import { describe, it, expect } from "vitest";
import { floatToInt16, passesLengthGate, peakRms, passesEnergyGate } from "../src/renderer/src/voice/gates";

describe("float32 -> int16", () => {
  it("maps the full scale and clamps beyond it", () => {
    const out = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(32767);
    expect(out[2]).toBe(-32768);
    expect(out[3]).toBe(32767);   // clamped, never wrapped
    expect(out[4]).toBe(-32768);  // clamped, never wrapped
    expect(out[5]).toBe(16384);
  });
  it("returns an Int16Array of the same length", () => {
    const out = floatToInt16(new Float32Array(320));
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(320);
  });
});

describe("length gate — an accidental tap must never reach the model", () => {
  it("rejects under 300 ms and accepts at or over it", () => {
    expect(passesLengthGate(4_799, 16000)).toBe(false); // 299.9 ms
    expect(passesLengthGate(4_800, 16000)).toBe(true);  // 300 ms
    expect(passesLengthGate(16_000, 16000)).toBe(true);
    expect(passesLengthGate(0, 16000)).toBe(false);
  });
});

describe("energy gate — silence must not invoke the model at all", () => {
  it("rejects digital silence", () => {
    expect(passesEnergyGate(new Int16Array(16000))).toBe(false);
  });
  it("rejects a whisper below the noise floor", () => {
    const quiet = new Int16Array(16000).fill(30); // ~0.0009 rms
    expect(passesEnergyGate(quiet)).toBe(false);
  });
  it("accepts ordinary speech level", () => {
    const speech = Int16Array.from({ length: 16000 }, (_, i) => Math.round(8000 * Math.sin(i / 8)));
    expect(passesEnergyGate(speech)).toBe(true);
    expect(peakRms(speech)).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
L=/tmp/vitest.log; npx vitest run tests/voice-gates.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/voice/gates.ts
/**
 * §27/§10. The two guards standing between silence and a fabricated prompt.
 * Both run in the RENDERER, before any IPC — a clip that fails either never
 * reaches the model, so there is nothing for the model to hallucinate over.
 */

/** Scale asymmetrically: 32767 up, 32768 down, and CLAMP so a hot mic never wraps. */
export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

const MIN_MS = 300;
export function passesLengthGate(sampleCount: number, sampleRate: number, minMs = MIN_MS): boolean {
  return (sampleCount / sampleRate) * 1000 >= minMs;
}

/** Root-mean-square over the whole clip, normalised to [0, 1]. */
export function peakRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; sum += v * v; }
  return Math.sqrt(sum / pcm.length);
}

/** Empirical floor: room tone measures well under 0.005, speech well over it. */
const NOISE_FLOOR = 0.005;
export function passesEnergyGate(pcm: Int16Array, floor = NOISE_FLOOR): boolean {
  return peakRms(pcm) > floor;
}
```

- [ ] **Step 4: Run the test — expect PASS**, then commit

```bash
L=/tmp/vitest.log; npx vitest run tests/voice-gates.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
git add src/renderer/src/voice/gates.ts tests/voice-gates.test.ts
git commit -m "feat(voice): the length and energy gates, unit-tested"
```

---

## Task 8: The worklet and the capture session

**Files:**
- Create: `src/renderer/src/voice/worklet.ts`, `src/renderer/src/voice/capture.ts`

**Interfaces:**
- Consumes: `floatToInt16`, gates (Task 7); `window.hv.voiceMicStatus()` (Task 6).
- Produces: `startCapture(opts): Promise<CaptureSession>`; `CaptureSession { stop(): Promise<Int16Array>; cancel(): void; onLevel: (cb: (rms:number)=>void) => void }`.

- [ ] **Step 1: Write the worklet**

Resampling is delegated to Chromium by constructing the context at 16 kHz. The worklet copies and clamps and posts an RMS at ~30 Hz — ten lines, no DSP, no dependency.

```ts
// src/renderer/src/voice/worklet.ts
/** §27. Runs on the audio thread. Registered via addModule() from capture.ts. */
const src = `
class VoiceProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._acc = 0; this._n = 0; this._last = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this.port.postMessage(ch.slice());          // copy: the buffer is reused
    for (let i = 0; i < ch.length; i++) { this._acc += ch[i] * ch[i]; this._n++; }
    // ~30 Hz level updates, enough to look live without flooding the main thread.
    if (currentTime - this._last > 0.033) {
      this.port.postMessage({ rms: Math.sqrt(this._acc / Math.max(1, this._n)) });
      this._acc = 0; this._n = 0; this._last = currentTime;
    }
    return true;
  }
}
registerProcessor('voice-processor', VoiceProcessor);
`;
/** A blob URL, so the worklet ships inside the bundle with no asset-copy step. */
export const workletUrl = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
```

- [ ] **Step 2: Write `capture.ts`**

It must, in order: ask main for the mic status and refuse to call `getUserMedia` unless granted (§8.3); build the constrained stream; construct `new AudioContext({ sampleRate: 16000 })`; **assert `ctx.sampleRate === 16000`** and fall back to decimate-by-3 when macOS has snapped the page to 48 kHz; accumulate Float32 chunks; and on `stop()` concatenate, convert, and run both gates, returning an empty `Int16Array` when either fails.

- [ ] **Step 3: Verify the build**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/voice/worklet.ts src/renderer/src/voice/capture.ts
git commit -m "feat(voice): 16 kHz capture through an audio worklet, with a live level"
```

---

## Task 9: The three build-config changes (§8.2 + §8.4)

**Files:**
- Modify: `electron-builder.yml`, `build/entitlements.mac.plist`, `build/afterPack.mjs`

All three are required. **Any two of them alone produce a bundle with no microphone access**, and the failure is silent.

- [ ] **Step 1: Add the entitlement**

Keep the three `cs.allow-*` keys already there; add:
```xml
<key>com.apple.security.device.audio-input</key>
<true/>
```

- [ ] **Step 2: Wire the plist and the usage string in `electron-builder.yml`**

```yaml
mac:
  target: dmg
  identity: null
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    NSMicrophoneUsageDescription: >-
      HappyVibe transcribes your speech on this device to type into
      the composer. Your audio never leaves your computer.
asarUnpack:
  - "**/node_modules/sherpa-onnx-*/**"
```

- [ ] **Step 3: Stop `afterPack.mjs` stripping what you just added**

The ad-hoc re-sign runs **after** electron-builder has applied the entitlements, and `codesign` writes only the entitlements it is handed.

```js
  if (electronPlatformName === "darwin") {
    console.log("[afterPack] Ad-hoc re-signing bundle…");
    // §27/§8.4: --entitlements is LOAD-BEARING. Without it this re-sign replaces
    // every signature — including the Helper that actually captures audio — with
    // an entitlement-free one, and the microphone silently yields zeros.
    const entitlements = path.join(__dirname, "entitlements.mac.plist");
    execFileSync("codesign", [
      "--force", "--deep", "--sign", "-", "--entitlements", entitlements, appPath,
    ], { stdio: "inherit" });
  }
```

- [ ] **Step 4: Verify against the built bundle — a command, not a screenshot**

```bash
npm run build && npx electron-builder --mac --dir
codesign -d --entitlements - "release/mac-arm64/HappyVibe.app/Contents/MacOS/HappyVibe" 2>&1 | grep -c audio-input
codesign -d --entitlements - "release/mac-arm64/HappyVibe.app/Contents/Frameworks/HappyVibe Helper.app" 2>&1 | grep -c audio-input
```
Expected: **`1` from both.** The helper is the one an otherwise-correct app-level configuration hides — if it prints `0`, Step 3 did not take.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml build/entitlements.mac.plist build/afterPack.mjs
git commit -m "build(voice): entitle the mic, and stop the re-sign from stripping it"
```

---

# Phase 3 — Composer and gesture

## Task 10: `appendToComposer` and the gesture reducer

**Files:**
- Create: `src/renderer/src/composerText.ts`, `src/renderer/src/voice/gesture.ts`
- Modify: `src/renderer/src/components/ChatView.tsx:193` (route the existing insert through the helper)
- Test: `tests/voice-gesture.test.ts`, `tests/composer-text.test.ts`

**Interfaces:**
- Produces: `appendToComposer(prev: string, text: string): string`; `gestureReducer(state, event) => {state, action}` where `action` is `"start" | "stop" | "cancel" | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/composer-text.test.ts
import { describe, it, expect } from "vitest";
import { appendToComposer } from "../src/renderer/src/composerText";

describe("appendToComposer", () => {
  it("is the empty-composer identity", () => {
    expect(appendToComposer("", "hello")).toBe("hello");
    expect(appendToComposer("   ", "hello")).toBe("hello");
  });
  it("separates existing text with exactly one blank line", () => {
    expect(appendToComposer("first", "second")).toBe("first\n\nsecond");
  });
  it("does not stack blank lines on trailing whitespace", () => {
    expect(appendToComposer("first\n\n", "second")).toBe("first\n\nsecond");
    expect(appendToComposer("first   ", "second")).toBe("first\n\nsecond");
  });
});
```

```ts
// tests/voice-gesture.test.ts
import { describe, it, expect } from "vitest";
import { initialGesture, gestureReducer } from "../src/renderer/src/voice/gesture";

const KEY = "MetaRight";
function run(events: Parameters<typeof gestureReducer>[1][]) {
  let s = initialGesture();
  const actions: (string | null)[] = [];
  for (const e of events) { const r = gestureReducer(s, e); s = r.state; actions.push(r.action); }
  return { state: s, actions };
}

describe("dictation gesture", () => {
  it("hold: down, then up past the threshold, records then stops", () => {
    const { actions } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 900 },
    ]);
    expect(actions).toEqual(["start", "stop"]);
  });

  it("tap: down and up under the threshold latches recording on", () => {
    const { actions } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 120 },
    ]);
    expect(actions).toEqual(["start", null]); // still recording after release
  });

  it("a second tap stops the latched recording", () => {
    const { actions } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 120 },
      { type: "keydown", code: KEY, at: 2000 },
      { type: "keyup", code: KEY, at: 2100 },
    ]);
    expect(actions).toEqual(["start", null, null, "stop"]);
  });

  it("ABANDONS when another key is pressed while held — right-Cmd+S must not dictate", () => {
    const { actions, state } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keydown", code: "KeyS", at: 50 },
      { type: "keyup", code: "KeyS", at: 90 },
      { type: "keyup", code: KEY, at: 140 },
    ]);
    expect(actions).toEqual(["start", "cancel", null, null]);
    expect(state.recording).toBe(false);
  });

  it("ignores the other-hand modifier entirely", () => {
    const { actions } = run([
      { type: "keydown", code: "MetaLeft", at: 0 },
      { type: "keyup", code: "MetaLeft", at: 900 },
    ]);
    expect(actions).toEqual([null, null]);
  });

  it("escape cancels a latched recording and discards", () => {
    const { actions } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 100 },
      { type: "escape", at: 500 },
    ]);
    expect(actions).toEqual(["start", null, "cancel"]);
  });

  it("the toggle cap stops a forgotten hot mic", () => {
    const { actions } = run([
      { type: "keydown", code: KEY, at: 0 },
      { type: "keyup", code: KEY, at: 100 },
      { type: "tick", at: 300_001 },
    ]);
    expect(actions).toEqual(["start", null, "stop"]);
  });
});
```

- [ ] **Step 2: Run both and watch them fail**

```
L=/tmp/vitest.log; npx vitest run tests/voice-gesture.test.ts tests/composer-text.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```

- [ ] **Step 3: Implement `composerText.ts`**

```ts
// src/renderer/src/composerText.ts
/**
 * §27/§3.4. How new text joins what is already typed — ONE definition, so
 * dictation and the editor's "Send to chat" can never drift apart.
 * Appends at the end, blank-line separated. Deliberately NOT caret-aware:
 * two insertion paths landing in different places is worse than either rule.
 */
export function appendToComposer(prev: string, text: string): string {
  return (prev.trim() ? `${prev.replace(/\s*$/, "")}\n\n` : "") + text;
}
```

Then rewrite `ChatView.tsx:193` to call it:
```ts
setInput((prev) => appendToComposer(prev, composerInsert!.text));
```

- [ ] **Step 4: Implement `gesture.ts`**

```ts
// src/renderer/src/voice/gesture.ts
/**
 * §27/§3.5. Tap vs hold vs abandon, as a pure reducer.
 *
 * The abandon rule is the load-bearing one: the trigger IS a modifier, so
 * right-Cmd+S produces a trailing key-up that would otherwise read as a tap.
 * If any other key goes down while the trigger is held, the gesture is off.
 */
export type GestureEvent =
  | { type: "keydown"; code: string; at: number }
  | { type: "keyup"; code: string; at: number }
  | { type: "escape"; at: number }
  | { type: "tick"; at: number };

export interface GestureState {
  downAt: number | null;
  recording: boolean;
  /** Latched by a tap; a hold is not latched and ends on release. */
  latched: boolean;
  abandoned: boolean;
  startedAt: number | null;
}

export type GestureAction = "start" | "stop" | "cancel" | null;

/** Right ⌘ on macOS; right Ctrl elsewhere — the right Windows/Super key is grabbed by the OS. */
export const triggerCode = (platform: string): string =>
  platform === "darwin" ? "MetaRight" : "ControlRight";

export const initialGesture = (): GestureState => ({
  downAt: null, recording: false, latched: false, abandoned: false, startedAt: null,
});

export function gestureReducer(
  s: GestureState,
  e: GestureEvent,
  opts: { code?: string; holdMs?: number; maxMs?: number } = {},
): { state: GestureState; action: GestureAction } {
  const CODE = opts.code ?? "MetaRight";
  const HOLD = opts.holdMs ?? 300;
  const MAX = opts.maxMs ?? 300_000;

  switch (e.type) {
    case "keydown":
      if (e.code !== CODE) {
        // Another key while the trigger is held ⇒ this is a real shortcut, not dictation.
        if (s.downAt !== null && s.recording && !s.latched) {
          return { state: { ...initialGesture(), abandoned: true }, action: "cancel" };
        }
        return { state: s, action: null };
      }
      if (s.latched) return { state: { ...s, downAt: e.at }, action: null }; // second tap pending
      return { state: { ...s, downAt: e.at, recording: true, abandoned: false, startedAt: e.at }, action: "start" };

    case "keyup": {
      if (e.code !== CODE) return { state: s, action: null };
      if (s.abandoned) return { state: initialGesture(), action: null };
      if (s.downAt === null) return { state: s, action: null };
      const held = e.at - s.downAt;
      if (s.latched) return { state: initialGesture(), action: "stop" };       // second tap ends it
      if (held >= HOLD) return { state: initialGesture(), action: "stop" };     // hold ended
      return { state: { ...s, downAt: null, latched: true }, action: null };    // tap latches
    }

    case "escape":
      return s.recording ? { state: initialGesture(), action: "cancel" } : { state: s, action: null };

    case "tick":
      if (s.recording && s.startedAt !== null && e.at - s.startedAt >= MAX) {
        return { state: initialGesture(), action: "stop" };
      }
      return { state: s, action: null };
  }
}
```

- [ ] **Step 5: Run both — expect PASS**, then commit

```bash
L=/tmp/vitest.log; npx vitest run tests/voice-gesture.test.ts tests/composer-text.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L
git add src/renderer/src/composerText.ts src/renderer/src/voice/gesture.ts src/renderer/src/components/ChatView.tsx tests/voice-gesture.test.ts tests/composer-text.test.ts
git commit -m "feat(voice): the gesture reducer and one shared composer-append rule"
```

---

## Task 11: The mic button, wired into the composer

**Files:**
- Create: `src/renderer/src/components/MicButton.tsx`
- Modify: `src/renderer/src/components/ChatView.tsx`, `src/renderer/src/shortcuts.ts`

- [ ] **Step 1: Build `MicButton.tsx` with the five states**

`unactivated` · `downloading` (ring progress) · `ready` · `recording` (red + live meter) · `transcribing` (spinner). Same `shrink-0 … rounded-full px-2.5 py-1.5` chip idiom as the Plan toggle.

**The unactivated state must NOT use the HTML `disabled` attribute** — a disabled button swallows clicks, and the entire activation flow depends on that first click landing. Style it as unavailable; keep it live.

- [ ] **Step 2: Place it in the composer control row**

Between the Plan toggle and the `relative flex-1 min-w-0` textarea wrapper in `ChatView.tsx`.

- [ ] **Step 3: Wire the gesture and Escape ordering**

Attach `keydown`/`keyup` on the composer, feed `gestureReducer`, and drive capture. **Escape goes LAST**: the existing handlers for search, the slash-command menu and the mention dropdown each `return` after acting, so the dictation-cancel branch is appended after all of them.

- [ ] **Step 4: Add the built-in shortcut row**

In `shortcuts.ts`, add to `FIXED_SHORTCUTS` — **not** `SHORTCUT_ACTIONS`, which cannot represent a modifier-only hold:

```ts
{ keys: "Hold right ⌘", label: "Dictate into the composer" },
```

- [ ] **Step 5: Verify the build**, then commit

```bash
npm run build 2>&1 | tail -20
git add src/renderer/src/components/MicButton.tsx src/renderer/src/components/ChatView.tsx src/renderer/src/shortcuts.ts
git commit -m "feat(voice): the mic chip, its five states, and the dictation gesture"
```

---

# Phase 4 — Settings page and activation

## Task 12: The Voice page, the activation modal, and the licenses block

**Files:**
- Create: `src/renderer/src/components/VoiceView.tsx`, `src/renderer/src/components/VoiceActivateModal.tsx`, `NOTICE`
- Modify: `src/renderer/src/components/Sidebar.tsx` (view union + nav entry + icon), `src/renderer/src/App.tsx` (view switch), `src/renderer/src/components/Section.tsx` (icon)
- Test: `tests/voice-e2e.test.ts` (model-gated)

- [ ] **Step 1: Add `"voice"` to the `View` union and the Settings nav group** in `Sidebar.tsx`, with a mic icon component beside `TerminalIcon`.

- [ ] **Step 2: Build `VoiceView.tsx`** with the six sections from §3.6: Status (with Remove), Language (25 entries, `lower` tier annotated), Microphone (device + live meter + the three processing toggles), Behaviour (hold threshold, cap), Permissions (status + open System Settings), and a collapsed **Open source licenses** block.

The licenses block is the **only** place in the product that names the model. It credits `nvidia/parakeet-tdt-0.6b-v3`, links CC-BY-4.0, and states the weights are used unmodified in a quantized export. `NOTICE` in the repo carries the same text.

- [ ] **Step 3: Build `VoiceActivateModal.tsx`**, following `AuthFlowModal.tsx`'s shape. Copy: *"Voice input needs a 671 MB speech model. It runs entirely on your machine; your voice never leaves this computer."* A **Download** primary action and a **More options** link to the Voice page. It must not name the model.

- [ ] **Step 4: Add the model-gated end-to-end test**

```ts
// tests/voice-e2e.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Gated like the live-Pi tests: skipped unless the 671 MB model is present.
const DIR = process.env.HV_VOICE_MODEL_DIR ?? path.join(os.homedir(), ".happyvibe-models", "voice");
const HAVE = fs.existsSync(path.join(DIR, "encoder.int8.onnx"));

describe.skipIf(!HAVE)("voice end-to-end", () => {
  it("transcribes the pinned English fixture", async () => {
    const sherpa = await import("sherpa-onnx-node");
    const { buildRecognizerConfig } = await import("../src/main/voice/recognizer");
    const rec = new (sherpa as any).OfflineRecognizer(buildRecognizerConfig(DIR));
    const wave = (sherpa as any).readWave(path.join(DIR, "test_wavs", "en.wav"));
    const stream = rec.createStream();
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    rec.decode(stream);
    const text = rec.getResult(stream).text as string;
    expect(text.trim().length).toBeGreaterThan(10);
    expect(text.toLowerCase()).toMatch(/[a-z]/);
  }, 120_000);
});
```

- [ ] **Step 5: Run the full gate**

```bash
npm run gate 2>&1 | tail -30
```
Expected: build green, non-live suite green, the e2e test reported as **skipped** on a machine without the model.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/VoiceView.tsx src/renderer/src/components/VoiceActivateModal.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Section.tsx src/renderer/src/App.tsx NOTICE tests/voice-e2e.test.ts
git commit -m "feat(voice): the Voice settings page, activation modal and attribution"
```

---

# Verification

## Automated

| What | Command | Expected |
|---|---|---|
| Full gate | `npm run gate` | build (both typechecks) + non-live suite green |
| Voice unit + contract only | `L=/tmp/v.log; npx vitest run tests/voice-*.test.ts tests/composer-text.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` | all pass; `voice-e2e` skipped without the model |
| Live-Pi | `npm run live:why` | **prints nothing** — no file here is Pi-facing. Say so; do not silently omit it. |
| Entitlements survive packaging | the two `codesign -d --entitlements` commands in Task 9 Step 4 | `1` from **both** the app binary and the Helper |

## GUI assertions

Not "do a GUI pass". These are the things that must be **true on screen**, each with the surface it is observed on.

**On the chat tab (composer):**
1. A mic chip sits between the Plan chip and the text area, matching their pill shape and height.
2. Before activation the chip is muted **and still clickable** — clicking opens the activation modal. In devtools, the button element has **no `disabled` attribute**. (Absence assertion: a disabled button swallows the click and the entire activation flow dies silently.)
3. During download the chip shows ring progress **and the app stays usable** — type a message and send it while the bytes are still coming down.
4. While recording the chip is red and the level meter **moves when you speak and is still when you don't**. A meter that animates regardless is the failure this assertion exists to catch.
5. After transcription the text lands at the **end** of the composer, separated by a blank line, and the text area grows. It is **not** sent.

**On the Voice settings page (Settings → Voice):**
6. The language list has exactly **25** entries; the low-accuracy half carries its note.
7. **Absence assertion: Japanese, Korean and Chinese do not appear at all** — not greyed out, not disabled, absent. They are the languages whose CER is 124–171, and showing what cannot work is the taste rule this violates.
8. **Absence assertion: the strings `parakeet`, `NVIDIA`, `sherpa` and `FastConformer` appear nowhere on the chat tab** — not on the chip, not in the activation modal, not in the progress UI. They appear **only** inside the collapsed *Open source licenses* block on this page. Check the modal on the *chat* tab, not here: the surface that owns the attribution is not the surface that must stay quiet about it.
9. Removing the model returns the **chip on the chat tab** to unactivated — the surface that owns the resource is not the surface that shows the change.

**On the Keyboard shortcuts page (Settings → Keyboard shortcuts):**
10. A built-in row reads *Hold right ⌘ — Dictate into the composer*.
11. **Absence assertion: there is no rebindable dictation row** among the editable ⌘-bindings. If one appears, someone put it in `SHORTCUT_ACTIONS`, where `eventToBinding` will return `null` for it forever and the binding will silently never fire.

**Regression sequences — perform these, don't reason about them:**
12. **Escape precedence.** Type `@` to open the mention dropdown, start recording, press Escape **once** → the dropdown closes **and the chip is still red**. Press Escape again → the chip returns to ready and **nothing is inserted**.
13. **The modifier is still a modifier.** With the composer focused, press right ⌘ + S → the save shortcut fires and the chip **never turns red**. This is the failure the abandon rule exists for, and it is invisible in code review.
14. **Dock cleanliness.** Dictate once, then look at the Dock while the utility process is alive: **no second generic "exec" icon**. This repo has been bitten by that class before; `utilityProcess` should be exempt, and it costs thirty seconds to confirm.

## Deferred, and named

- **Resident-memory measurement on an 8 GB machine** with a Pi session live and the model loaded (§14.3) — a ship gate, not an open question. Record it in a validation doc.
- Bundling the 59 MB runtime is decided (in the installer) but only becomes observable when a packaged build is produced for each platform.
