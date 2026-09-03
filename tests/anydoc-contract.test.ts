import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DOCUMENT_EXTENSIONS } from "../pi-runtime/extensions/hv-document";

/**
 * §31 CONTRACT TEST — the anydoc pin-bump gate. Key-free, no model.
 *
 * Everything here is a claim docs/validation/ad1.md measured on 2026-09-03 and
 * that PRD §31 then leaned on. A bump that breaks one of them fails HERE,
 * naming the claim, rather than surfacing later as "the agent can't read my
 * PDF" or — worse — as a document quietly leaving the machine.
 */

const runtime = path.join(process.cwd(), "pi-runtime");
const BRIDGE = path.join(runtime, "bin/anydoc-bridge.mjs");
const FIX = path.join(process.cwd(), "tests/fixtures/documents");
const PKG = path.join(runtime, "node_modules/@firecrawl/anydoc");

interface Reply { ok?: boolean; [k: string]: unknown }

/** Run the sidecar exactly as main does: node/helper, cwd = runtime, last stdout line is the reply. */
function run(...args: string[]): { code: number | null; reply: Reply | null; stderr: string } {
  const r = spawnSync(process.execPath, [BRIDGE, ...args], {
    cwd: runtime,
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    timeout: 30_000,
  });
  const line = r.stdout.trim().split("\n").pop() ?? "";
  let reply: Reply | null = null;
  try {
    reply = JSON.parse(line) as Reply;
  } catch {
    /* a crash — reply stays null, which is itself under test */
  }
  return { code: r.status, reply, stderr: r.stderr };
}

describe("anydoc pin (§31)", () => {
  it("is pinned EXACT and matches what is installed", () => {
    const declared = (
      JSON.parse(fs.readFileSync(path.join(runtime, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      }
    ).dependencies["@firecrawl/anydoc"];
    // Exact, like every other runtime pin: a caret here is a converter nobody chose.
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
    const installed = (JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")) as { version: string })
      .version;
    expect(installed).toBe(declared);
  });

  it("is named in the runtime pins line the Changelog page shows (§30)", () => {
    const cfg = fs.readFileSync(path.join(process.cwd(), "electron.vite.config.ts"), "utf8");
    expect(cfg).toContain("@firecrawl/anydoc");
    expect(cfg).toMatch(/anydoc \$\{pins\['@firecrawl\/anydoc'\]\}/);
  });

  it("probes ok on this platform", () => {
    const { reply, code } = run("--probe");
    expect(code).toBe(0);
    expect(reply?.ok).toBe(true);
    expect(reply?.probe).toBe(true);
  });
});

describe("anydoc surface the sidecar depends on", () => {
  it("accepts every extension we expose, mapping container variants onto a parser family", async () => {
    const mod = (await import(path.join(PKG, "index.js"))) as {
      formatFromExtension: (e: string) => string | null;
    };
    for (const ext of DOCUMENT_EXTENSIONS) {
      expect(mod.formatFromExtension(ext), ext).toBeTruthy();
    }
    // The mappings ad1.md recorded, spot-checked: a .xls is parsed as xlsx, so
    // the card's family lookup must key off what the converter REPORTS.
    expect(mod.formatFromExtension("xls")).toBe("xlsx");
    expect(mod.formatFromExtension("docm")).toBe("docx");
    expect(mod.formatFromExtension("ppsx")).toBe("pptx");
    // Text formats are not documents to it either.
    expect(mod.formatFromExtension("txt")).toBeNull();
  });

  it("still has no page count on success — the facts line's omission is a measurement", async () => {
    const mod = (await import(path.join(PKG, "index.js"))) as {
      toMarkdown: (p: string) => Promise<unknown>;
    };
    const md = await mod.toMarkdown(path.join(FIX, "text.pdf"));
    // A bare string: no metadata object, hence no page count anywhere on the
    // success path (ad1.md §3.1). If a bump makes this an object, §31 can show
    // a page count again — and this test is where that is noticed.
    expect(typeof md).toBe("string");
  });

  it("keeps `pageCount` on the needsOcr rejection — the sentence names those pages", async () => {
    const mod = (await import(path.join(PKG, "index.js"))) as { toMarkdown: (p: string) => Promise<string> };
    await expect(mod.toMarkdown(path.join(FIX, "scanned.pdf"))).rejects.toMatchObject({
      code: "needsOcr",
      pageCount: 2,
    });
  });
});

describe("the sidecar's wire", () => {
  it("converts every family and reports the read-contract fields", () => {
    for (const f of [
      "sample.docx", "sample.doc", "sample.xlsx", "sample.xls", "sample.xlsb",
      "sample.pptx", "sample.ppt", "sample.odt", "sample.ods", "sample.odp",
      "sample.rtf", "sample.epub", "text.pdf",
    ]) {
      const { reply, code } = run(path.join(FIX, f));
      expect(code, f).toBe(0);
      expect(reply?.ok, `${f}: ${JSON.stringify(reply)}`).toBe(true);
      expect(typeof reply?.text, f).toBe("string");
      expect((reply?.text as string).length, f).toBeGreaterThan(0);
      expect(reply?.totalLines as number, f).toBeGreaterThan(0);
      expect(reply?.from, f).toBe(1);
      expect(reply?.format, f).toBeTruthy();
      // No page count is ever claimed on a success.
      expect(reply?.pages, f).toBeUndefined();
    }
  });

  it("slices like Pi's read: offset is a 1-indexed line, limit a line count", () => {
    const full = run(path.join(FIX, "sample.docx"));
    const lines = (full.reply?.text as string).split("\n");
    expect(lines.length).toBeGreaterThan(4);
    const part = run(path.join(FIX, "sample.docx"), "2", "2");
    expect(part.reply?.from).toBe(2);
    expect(part.reply?.to).toBe(3);
    expect(part.reply?.text).toBe(lines.slice(1, 3).join("\n"));
    // totalLines describes the DOCUMENT, not the slice — that is what tells the
    // model there is more and where to continue from.
    expect(part.reply?.totalLines).toBe(lines.length);
  });

  it("uses Pi's own truncation bound, not a copy of it", async () => {
    const { truncateHead, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES } = (await import(
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/core/tools/truncate.js")
    )) as {
      truncateHead: (s: string) => { content: string };
      DEFAULT_MAX_LINES: number;
      DEFAULT_MAX_BYTES: number;
    };
    // The numbers §31 promises the user, straight from Pi.
    expect(DEFAULT_MAX_LINES).toBe(2000);
    expect(DEFAULT_MAX_BYTES).toBe(50 * 1024);
    const { reply } = run(path.join(FIX, "sample.docx"));
    const text = reply?.text as string;
    expect(truncateHead(text).content).toBe(text);
    // and the sidecar imports it rather than reimplementing it
    expect(fs.readFileSync(BRIDGE, "utf8")).toContain("truncate.js");
  });

  it("names anydoc's own error codes rather than leaking a stack trace", () => {
    const cases: Array<[string, string]> = [
      ["encrypted.odt", "encrypted"],
      ["notes.txt", "unsupported"],
      ["scanned.pdf", "needsOcr"],
    ];
    for (const [f, code] of cases) {
      const r = run(path.join(FIX, f));
      expect(r.code, f).toBe(0); // a failure is a REPLY, never a non-zero exit
      expect(r.reply?.ok, f).toBe(false);
      expect(r.reply?.code, f).toBe(code);
    }
    const missing = run(path.join(FIX, "does-not-exist.docx"));
    expect(missing.reply?.ok).toBe(false);
    expect(missing.reply?.code).toBe("io");
  });

  it("carries the scanned page list, which is the whole reason for the 0.2.4 pin", () => {
    // ad1.md §1: 0.2.3 rejects this same file as an undifferentiated
    // `unsupported` with no page numbers, so the sentence has nothing to name.
    const mixed = run(path.join(FIX, "mixed.pdf"));
    expect(mixed.reply?.code).toBe("needsOcr");
    expect(mixed.reply?.pages).toEqual([2]);
    expect(mixed.reply?.pageCount).toBe(2);
    const scanned = run(path.join(FIX, "scanned.pdf"));
    expect(scanned.reply?.pages).toEqual([1, 2]);
  });

  it("would convert a CSV — proving the exclusion is ours, not upstream's (decision K)", () => {
    // Kept deliberately: if this ever starts failing, decision K is being
    // enforced by accident rather than on purpose, and the reasoning in §31
    // ("read already handles it") would need rewriting.
    const { reply } = run(path.join(FIX, "table.csv"));
    expect(reply?.ok).toBe(true);
    expect(DOCUMENT_EXTENSIONS).not.toContain("csv");
  });
});

/**
 * The sidecar's CODE, with comments stripped.
 *
 * Scanning the raw file would forbid the comment that EXPLAINS why the wrapper
 * and its endpoint are avoided — which is the one place a future reader learns
 * it. The claim under test is that no network path exists in the code, so the
 * code is what gets scanned.
 */
function bridgeCode(): string {
  return fs
    .readFileSync(BRIDGE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

describe("§31 privacy, enforced in code", () => {
  it("imports the NATIVE BINDING, never the package main that carries the upload path", () => {
    const src = bridgeCode();
    // ad1.md §3.2: `main` is anydoc.js, a wrapper holding API_URL =
    // https://api.firecrawl.dev and the hosted-OCR implementation. index.js
    // beside it is the binding, with no network code at all.
    expect(src).toContain('"index.js"');
    expect(src).not.toMatch(/["'`]@firecrawl\/anydoc["'`]/); // never the bare specifier
    expect(src).not.toContain("anydoc.js");

    const wrapper = fs.readFileSync(path.join(PKG, "anydoc.js"), "utf8");
    const binding = fs.readFileSync(path.join(PKG, "index.js"), "utf8");
    // The reason the distinction matters, asserted rather than trusted.
    expect(wrapper).toContain("api.firecrawl.dev");
    expect(binding).not.toContain("api.firecrawl.dev");
    // …and the binding really does carry the whole surface we need.
    for (const fn of ["toMarkdown", "formatFromPath", "formatFromExtension"]) {
      expect(binding, fn).toContain(fn);
    }
  });

  it("has no network path and no way to ask for hosted conversion", () => {
    const src = bridgeCode();
    // No `ocr` option is passed, and no URL is reachable from this file.
    expect(src).not.toMatch(/\bocr\s*:/i);
    expect(src).not.toMatch(/apiKey|FIRECRAWL_/);
    expect(src).not.toMatch(/https?:\/\/[a-z]/i); // comments name no endpoint either
    expect(src).not.toMatch(/\bfetch\(|node:https?|require\(['"]https?['"]\)/);
  });
});
