import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { downloadFile, sha256File } from "../src/main/voice/download";

/**
 * §27/§7.3. Driven against a real loopback http server, so the resume and
 * verification paths are exercised without touching the network.
 */
const BODY = Buffer.from("hello voice model bytes, long enough to slice in half");
const DIGEST = crypto.createHash("sha256").update(BODY).digest("hex");
const SPEC = { name: "f.bin", bytes: BODY.length, sha256: DIGEST };

let server: http.Server;
let base = "";
let rangeHeaders: (string | undefined)[] = [];
/** When true the server returns different bytes, to drive the digest-mismatch path. */
let corrupt = false;
/** When true the server ignores Range and answers 200 with the whole body. */
let ignoreRange = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    rangeHeaders.push(req.headers.range as string | undefined);
    const body = corrupt ? Buffer.from("these are not the bytes you asked for") : BODY;
    const m = /^bytes=(\d+)-$/.exec((req.headers.range as string) ?? "");
    if (m && !ignoreRange) {
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
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  rangeHeaders = [];
  corrupt = false;
  ignoreRange = false;
});

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hv-voice-"));
}

describe("voice model downloader", () => {
  it("downloads, verifies and renames off .part", async () => {
    const dest = path.join(tmpdir(), "f.bin");
    let seen = 0;
    await downloadFile(`${base}/f.bin`, dest, SPEC, (n) => {
      seen = n;
    });
    expect(fs.readFileSync(dest)).toEqual(BODY);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(seen).toBe(BODY.length);
  });

  it("resumes from a partial .part instead of restarting 652 MB", async () => {
    const dest = path.join(tmpdir(), "f.bin");
    fs.writeFileSync(`${dest}.part`, BODY.subarray(0, 10));
    await downloadFile(`${base}/f.bin`, dest, SPEC, () => {});
    expect(rangeHeaders).toContain("bytes=10-");
    expect(fs.readFileSync(dest)).toEqual(BODY);
  });

  it("counts resumed bytes in the progress total, not just the new ones", async () => {
    const dest = path.join(tmpdir(), "f.bin");
    fs.writeFileSync(`${dest}.part`, BODY.subarray(0, 10));
    const seen: number[] = [];
    await downloadFile(`${base}/f.bin`, dest, SPEC, (n) => seen.push(n));
    // A progress bar reads this directly, so it must start from what is on disk.
    expect(seen[0]).toBeGreaterThan(10);
    expect(seen[seen.length - 1]).toBe(BODY.length);
  });

  it("starts over rather than appending when the server ignores Range", async () => {
    // The silent-corruption path: appending a full 200 body onto an existing
    // part yields a file only the digest would catch.
    const dest = path.join(tmpdir(), "f.bin");
    fs.writeFileSync(`${dest}.part`, BODY.subarray(0, 10));
    ignoreRange = true;
    await downloadFile(`${base}/f.bin`, dest, SPEC, () => {});
    expect(fs.readFileSync(dest)).toEqual(BODY);
  });

  it("discards a .part longer than the finished file", async () => {
    const dest = path.join(tmpdir(), "f.bin");
    fs.writeFileSync(`${dest}.part`, Buffer.concat([BODY, BODY]));
    await downloadFile(`${base}/f.bin`, dest, SPEC, () => {});
    expect(fs.readFileSync(dest)).toEqual(BODY);
  });

  it("deletes the file and throws when the digest does not match", async () => {
    const dest = path.join(tmpdir(), "f.bin");
    corrupt = true;
    await expect(downloadFile(`${base}/f.bin`, dest, SPEC, () => {})).rejects.toThrow(/checksum/i);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("reports a clear error on a non-200", async () => {
    const dest = path.join(tmpdir(), "f.bin");
    const gone = `${base.replace(/:\d+$/, ":1")}/f.bin`;
    await expect(downloadFile(gone, dest, SPEC, () => {})).rejects.toThrow();
  });

  it("sha256File matches node crypto", async () => {
    const p = path.join(tmpdir(), "x");
    fs.writeFileSync(p, BODY);
    expect(await sha256File(p)).toBe(DIGEST);
  });
});
