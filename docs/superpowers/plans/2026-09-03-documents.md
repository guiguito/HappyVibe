# Documents (§31) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent can read Word, PowerPoint, Excel, OpenDocument, RTF, EPUB and text-based PDF files through one tool, `document_read`, and the user can attach one from the composer with its context cost shown before send — all converted locally by `@firecrawl/anydoc` in a one-shot sidecar.

**Architecture:** A pure shared module (`hv-document.ts`) owns the tool name, the 13 extensions, the descriptions and the error sentences. Main owns conversion (`src/main/documents.ts` spawns `pi-runtime/bin/anydoc-bridge.mjs` through `nodeExecPath()`, the `mcp-oauth-bridge` precedent), the `hv.document-read` blocking envelope handler, the `hv:pick-document` picker and the `<document>` prompt blocks. The bridge registers `document_read` under `builtins.document` as a thin shell over `ctx.ui.input`, exactly like `browser_get_text`, and refuses `read` on a document path with a hint. The renderer gets the `+ → Attach document` row, chips, drop, the `Documents — 1 tool` settings row and a tool-card label.

**Tech Stack:** Electron 43 / Node 22, TypeScript, React, vitest, `@firecrawl/anydoc` (napi-rs native addon, exact-pinned in `pi-runtime/package.json`), Pi 0.84.2's `truncateHead`.

**Spec:** Notion "📋 AnyDoc" (page `3d0d33dfffca80a7b56ad02d7bb2984a`, locked 2026-09-03) and `docs/prd.md` §31 "Documents" plus the round-19 decisions in §6, §7, §13, §30. Read §31 first; every decision below is argued there.

## Global Constraints

- **13 extensions, 7 families, no CSV:** `doc docx docm · ppt pps pot pptx pptm ppsx ppsm · xls xlsx xlsm xlsb · odt ods odp · rtf · epub · pdf`. One constant, `DOCUMENT_EXTENSIONS`; every list the user or model sees derives from it (Principle 11).
- **One tool, `document_read`,** params `path`, `offset?`, `limit?`, required `intent` (declared in the schema like `browser_get_text`; `stripIntent` handles the global switch).
- **Permission class = Pi's `read`:** in `SAFE_TOOLS` and `PLAN_PASS_TOOLS`, absolute paths allowed, no workspace check, no `UNTRUSTED_BANNER`.
- **Slice contract = Pi's `read`:** 2 000 lines / 50 KB via Pi's own `truncateHead` from `pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/truncate.js`, `offset`/`limit` in lines, 1-indexed, mirroring `dist/core/tools/read.js:30-60`.
- **Inline caps = `@file` caps:** `MAX_FILE_BYTES` (1 MB per item) and `MENTION_CONTEXT_CAP` (200 000 chars, shared with mention blocks). Past the cap the block ends with `[truncated at N chars — call document_read with offset=L to continue]`.
- **Sidecar only:** conversion never runs inside Electron main or inside the Pi child. 30 s deadline then `SIGKILL`. Spawned through `nodeExecPath()` with `ELECTRON_RUN_AS_NODE: "1"`, `cwd` = runtime dir.
- **Privacy in code:** the sidecar never passes `ocr`; no `FIRECRAWL` string anywhere in it; converted text never written to disk by the app; the audit row `document.read` carries `{path, format, bytes, shown}` and never content.
- **Copy:** never the word *AI* (§19 round 18 pins its count at one). Say *the agent* / *the model*.
- **Payload placement:** a blocking input carries its payload in `title`; a notify carries it in `message`. Getting this wrong makes a card silently never appear (`happyvibe-bridge.ts:252`).
- **Main ALWAYS answers a blocking input** — an error is `{ok:false, code, message}`, never a dropped reply. Idempotent `reply()` racing a deadline, the `hv.browser-*` shape at `ipc.ts:1374-1400`.
- **Worktree prerequisites (do these first):** `npm install && (cd pi-runtime && npm ci)` — this worktree has NO `pi-runtime/node_modules`. For the live batch, `ln -s ~/Documents/Github/HappyVibe/.env .env` and read the wall time (a real batch is ~6 min; 5 s means it skipped).
- **Never run `npm run typecheck` before `npm run gate`** — `build` runs all three typechecks first. Per-task, run only the named test file.
- **Never pipe a test run to `tail`/`grep`.** Redirect once (`> $L 2>&1; echo EXIT=$?`), then grep the file.
- **Commit after every task.** Messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

**Create**
- `pi-runtime/extensions/hv-document.ts` — pure, zero imports. Tool name, `DOCUMENT_FAMILIES`/`DOCUMENT_EXTENSIONS`, descriptions, `isDocumentPath`, error → sentence, `read` refusal, facts line.
- `pi-runtime/bin/anydoc-bridge.mjs` — the sidecar. Plain ESM, committed (no esbuild step: anydoc ships JS + `.node`). argv protocol, one JSON line on stdout.
- `src/main/documents.ts` — electron-free. `convertDocument`, `probeDocuments`, `buildDocumentBlocks`, `parseDocumentHeader`.
- `tests/hv-document.test.ts`, `tests/anydoc-contract.test.ts`, `tests/documents.test.ts`, `tests/document-bridge.test.ts` (live).
- `tests/fixtures/documents/` — small real fixtures (Task 0 decides the source).
- `docs/validation/ad1.md` — the spike's numbers.

**Modify**
- `pi-runtime/package.json` (+ lockfile) — `"@firecrawl/anydoc": "<pin>"` exact.
- `pi-runtime/extensions/hv-rules.ts:65` (`SAFE_TOOLS`), `hv-plan.ts:176` (`PLAN_PASS_TOOLS`), `hv-builtins.ts` (`document` key), `happyvibe-bridge.ts` (registration beside the browser block ~1707; `read` hint in `tool_call` beside the `bash &` refusal ~1045; `documentReply` beside `terminalReply` ~138).
- `src/main/pi/spawn.ts:60,216` (`document` key), `src/main/config.ts:324-345`, `src/main/ipc.ts` (`parseDocumentReq`, dispatch, `hv:pick-document`, `hv:reveal-document`, `hv:documents-available`, `hv:prompt-session` `documents` param, `hv:builtins-set` type), `src/main/files.ts` (no change to `buildMentionBlocks`; documents are partitioned out before it).
- `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/renderer/src/composer.ts`, `src/renderer/src/mentions.ts:109`, `src/renderer/src/tabs.ts:530`, `src/renderer/src/toolLabel.ts` (~265), `src/renderer/src/components/ChatView.tsx` (row ~1275, drop ~1138, shelf ~1188, send ~640), `App.tsx` (~2019/2036 `promptSession` calls, `onSend` type), `Transcript.tsx` (`UserBubble` ~310), `ToolCard.tsx` (`PathActions` ~415), `BuiltinToolsBlock.tsx` (row + `Builtins` type), `electron.vite.config.ts:19-23` (pins line).
- `tests/hv-builtins.test.ts` (every expected object gains `document: true`), `tests/builtins-contract.test.ts` (one probe), `tests/tabs.test.ts`, the existing `mentions`/`toolLabel` test files (find with `grep -l stripInjectedBlocks tests/*.ts` and `grep -l toolLabel tests/*.ts`).
- `CLAUDE.md` (one pins entry), `docs/validation/d1.md` (the `hv.document-read` wire shape).

---

### Task 0: Spike — pick the pin, measure the sidecar, write `docs/validation/ad1.md`

Throwaway code lives in the scratchpad; the deliverables are the doc, the pin and the fixtures.

**Files:**
- Create: `docs/validation/ad1.md`
- Create: `tests/fixtures/documents/{sample.docx, sample.xlsx, sample.pptx, sample.odt, sample.rtf, text.pdf, mixed.pdf, notes.txt, table.csv}` (plus `encrypted.docx` if upstream ships one)

**Interfaces:**
- Produces: the pinned version string (`0.2.3` or `0.2.4`), used verbatim by Task 2; `PAGE_COUNT_AVAILABLE: boolean` (whether any anydoc API yields a PDF/PPTX page count) used by Task 1's facts line; the measured spawn+convert wall time recorded in `ad1.md`.

- [ ] **Step 1: Scratch install of both candidate versions**

```bash
S=/private/tmp/claude-501/-Users-guilhemduche--superset-worktrees-HappyVibe-anydoc/3c18e8be-b270-400c-8a8f-dd6d4f74edb6/scratchpad
mkdir -p $S/ad1-023 $S/ad1-024
(cd $S/ad1-023 && npm init -y >/dev/null && npm i @firecrawl/anydoc@0.2.3)
(cd $S/ad1-024 && npm init -y >/dev/null && npm i @firecrawl/anydoc@0.2.4)
cat $S/ad1-024/node_modules/@firecrawl/anydoc/index.d.ts
```

Record the exported functions and the exact error class/`code` field names from `index.d.ts` — Task 1's `DocumentErrorCode` union and Task 2's sidecar are written against what this prints, not against the proposal's summary of the README.

- [ ] **Step 2: Fixtures**

Clone upstream shallowly and look for its test corpus (`git clone --depth 1 https://github.com/firecrawl/anydoc $S/anydoc-src; find $S/anydoc-src -name "*.docx" -o -name "*.pdf" | head`). Copy ONE small file per family into `tests/fixtures/documents/` under the names above (MIT, note the origin in `ad1.md`). If upstream has no mixed PDF (one image-only page + one text page), build one: any PDF library is fine for a throwaway (`pip install reportlab` in a venv, or `python3 -c` with `fpdf2`), one page with a JPEG and no text, one page with text. Write `notes.txt` and `table.csv` by hand (three lines each). Each fixture under 200 KB.

- [ ] **Step 3: Convert every fixture under both versions and record**

```js
// $S/probe.mjs — run as: node probe.mjs <anydoc-dir> <fixtures-dir>
import { readdirSync } from "node:fs";
import path from "node:path";
const mod = await import(path.join(process.argv[2], "node_modules/@firecrawl/anydoc/index.js"));
for (const f of readdirSync(process.argv[3])) {
  const p = path.join(process.argv[3], f);
  const t0 = performance.now();
  try {
    const md = await mod.toMarkdown(p);
    console.log(JSON.stringify({ f, ms: +(performance.now() - t0).toFixed(1), lines: md.split("\n").length, bytes: Buffer.byteLength(md) }));
  } catch (e) {
    console.log(JSON.stringify({ f, error: e.code, pages: e.pages, pageCount: e.pageCount, message: String(e.message).slice(0, 120) }));
  }
}
```

Run: `node $S/probe.mjs $S/ad1-023 tests/fixtures/documents` and the same for `ad1-024`. The pin is whichever version returns the TEXT page of `mixed.pdf` plus a `needsOcr` page list, or — if neither does — the one whose `needsOcr` error carries `pages` so the sentence can name them. Also record: does `toMarkdown` on `table.csv` succeed (it should; the exclusion is ours, not upstream's), does anything expose a page count (`toDocument` model for pptx/docx; PDF is documented as unsupported for `toDocument`).

- [ ] **Step 4: The addon under the bundled Electron helper**

```bash
E="$(ls -d node_modules/electron/dist/Electron.app 2>/dev/null)/Contents/Frameworks/Electron Helper (Plugin).app/Contents/MacOS/Electron Helper (Plugin)"
ELECTRON_RUN_AS_NODE=1 "$E" $S/probe.mjs $S/ad1-024 tests/fixtures/documents
```

Expected: identical output to system Node. If the `.node` fails to load under the helper, that is the finding that changes the design — stop and report before Task 2.

- [ ] **Step 5: Spawn cost and parent RSS**

Time `spawn(helper, [probe.mjs, ...])` from a tiny Node parent 10× and record median wall time (the accepted ~150 ms). Convert the largest xlsx you can find or generate (aim ≥ 20 MB; a Python `openpyxl` loop writing 300k rows is fine, throwaway) inside a child and print `process.memoryUsage().rss` of the PARENT before and after: it must be flat.

- [ ] **Step 6: WASM loads under Node (recorded, not wired)**

`npm i @firecrawl/anydoc-wasm@<same pin>` in a third scratch dir, convert `sample.docx`, record ok/fail in one line. No further work.

- [ ] **Step 7: Write `docs/validation/ad1.md`**

Title line exactly: `# ad1 — Documents (§31): what was measured, on the machine`. Sections: the pin and why (with the mixed-PDF table per version); the fixture inventory with origin; ms/lines/bytes per fixture; helper-load result; spawn median; RSS before/after; WASM line; the `index.d.ts` error codes verbatim; whether a page count is obtainable and how. Every number dated 2026-09-03 and machine-labelled.

- [ ] **Step 8: Commit**

```bash
git add docs/validation/ad1.md tests/fixtures/documents
git commit -m "docs(validation): ad1 — anydoc pin, fixtures and sidecar numbers for §31

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: The pure module `hv-document.ts` and the gate placements

**Files:**
- Create: `pi-runtime/extensions/hv-document.ts`
- Modify: `pi-runtime/extensions/hv-rules.ts:65`, `pi-runtime/extensions/hv-plan.ts:176-195`, `pi-runtime/extensions/hv-builtins.ts`
- Modify: `tests/hv-builtins.test.ts` (all expected objects)
- Test: `tests/hv-document.test.ts`

**Interfaces:**
- Produces (imported by the bridge, main, renderer and tests):

```ts
export const DOCUMENT_TOOL = "document_read";
export const DOCUMENT_FAMILIES: ReadonlyArray<{ label: string; ext: readonly string[] }>; // 7 entries, order = display order
export const DOCUMENT_EXTENSIONS: readonly string[];            // 13, lower-case, no dot
export const DOCUMENT_FAMILY_LIST: string;                       // "Word, PowerPoint, Excel, PDF, OpenDocument, RTF, EPUB"
export function documentExtension(p: string): string | null;    // lower-cased ext without dot, or null
export function isDocumentPath(p: string): boolean;
export function documentFamily(ext: string): string;             // "Word" for docx…
export const DOCUMENT_TOOL_DESCRIPTIONS: Record<string, string>; // { document_read: … }
export type DocumentErrorCode = "unsupported" | "needsOcr" | "malformed" | "encrypted" | "resourceLimit" | "missingPart" | "io" | "hosted" | "timeout" | "crash" | "notDocument" | "disabled" | "unavailable";
export interface DocumentError { code: DocumentErrorCode; message?: string; pages?: number[]; pageCount?: number; detail?: string }
export function documentErrorSentence(err: DocumentError, opts: { hasVision: boolean; name?: string }): string;
export function documentReadRefusal(tool: string, input: Record<string, unknown>, enabled: boolean): string | null;
export interface DocumentFacts { format: string; pages?: number; totalLines: number; totalBytes: number; from: number; to: number }
export function documentFactsLine(f: DocumentFacts): string;   // "Word · 12 pages · 1 240 lines · 88 KB · showing 1–2000"
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/hv-document.test.ts
import { describe, it, expect } from "vitest";
import {
  DOCUMENT_TOOL, DOCUMENT_EXTENSIONS, DOCUMENT_FAMILIES, DOCUMENT_FAMILY_LIST, DOCUMENT_TOOL_DESCRIPTIONS,
  isDocumentPath, documentExtension, documentFamily, documentErrorSentence, documentReadRefusal, documentFactsLine,
} from "../pi-runtime/extensions/hv-document";
import { SAFE_TOOLS } from "../pi-runtime/extensions/hv-rules";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("hv-document pure module (§31)", () => {
  it("names 13 extensions in 7 families, and CSV is not one of them (decision K)", () => {
    expect(DOCUMENT_EXTENSIONS).toHaveLength(13);
    expect(new Set(DOCUMENT_EXTENSIONS).size).toBe(13);
    expect(DOCUMENT_FAMILIES).toHaveLength(7);
    expect(DOCUMENT_EXTENSIONS).not.toContain("csv");
    expect(DOCUMENT_EXTENSIONS).not.toContain("txt");
    expect(DOCUMENT_EXTENSIONS.every((e) => e === e.toLowerCase() && !e.startsWith("."))).toBe(true);
  });

  it("derives the family list the + row shows from the same constant (Principle 11)", () => {
    expect(DOCUMENT_FAMILY_LIST).toBe(DOCUMENT_FAMILIES.map((f) => f.label).join(", "));
    expect(DOCUMENT_FAMILY_LIST).not.toMatch(/CSV/);
    expect(DOCUMENT_TOOL_DESCRIPTIONS[DOCUMENT_TOOL]).toContain(DOCUMENT_FAMILY_LIST);
    expect(DOCUMENT_TOOL_DESCRIPTIONS[DOCUMENT_TOOL]).not.toMatch(/\bAI\b/);
  });

  it("recognises document paths case-insensitively and refuses text files", () => {
    expect(isDocumentPath("/Users/x/Downloads/Report.DOCX")).toBe(true);
    expect(isDocumentPath("deck.pptx")).toBe(true);
    expect(isDocumentPath("notes.txt")).toBe(false);
    expect(isDocumentPath("table.csv")).toBe(false);
    expect(isDocumentPath("archive.docx.zip")).toBe(false);
    expect(documentExtension("a/b.Xlsx")).toBe("xlsx");
    expect(documentExtension("noext")).toBeNull();
    expect(documentFamily("odp")).toBe("OpenDocument");
  });

  it("turns needsOcr into a sentence that names the pages, and knows about vision (decision H)", () => {
    const withVision = documentErrorSentence({ code: "needsOcr", pages: [1, 7], pageCount: 31 }, { hasVision: true });
    expect(withVision).toContain("31 pages");
    expect(withVision).toContain("pages 1, 7");
    expect(withVision).toMatch(/screenshots/);
    const noVision = documentErrorSentence({ code: "needsOcr", pages: [1], pageCount: 1 }, { hasVision: false });
    expect(noVision).toMatch(/no vision/);
    expect(noVision).toMatch(/text export/);
    expect(documentErrorSentence({ code: "encrypted" }, { hasVision: true })).toMatch(/Encrypted/);
    expect(documentErrorSentence({ code: "notDocument" }, { hasVision: true })).toMatch(/use `?read`?/);
    expect(documentErrorSentence({ code: "disabled" }, { hasVision: true })).toMatch(/Built-in tools/);
  });

  it("refuses `read` on a document path with the document_read hint, and only then", () => {
    expect(documentReadRefusal("read", { path: "spec.docx" }, true)).toMatch(/document_read/);
    expect(documentReadRefusal("read", { path: "spec.docx" }, false)).toMatch(/off in Built-in tools/);
    expect(documentReadRefusal("read", { path: "spec.csv" }, true)).toBeNull();
    expect(documentReadRefusal("read", { path: "notes.txt" }, true)).toBeNull();
    expect(documentReadRefusal("bash", { command: "cat spec.docx" }, true)).toBeNull();
    expect(documentReadRefusal("read", {}, true)).toBeNull();
  });

  it("formats the facts line, with and without pages", () => {
    expect(documentFactsLine({ format: "docx", pages: 12, totalLines: 1240, totalBytes: 90112, from: 1, to: 2000 }))
      .toBe("Word · 12 pages · 1 240 lines · 88 KB · showing 1–2000");
    expect(documentFactsLine({ format: "rtf", totalLines: 40, totalBytes: 512, from: 1, to: 40 }))
      .toBe("RTF · 40 lines · 512 B · showing 1–40");
  });
});

describe("§31 gate placements — read's class", () => {
  it("is safe-default and passes the plan gate (decision D)", () => {
    expect(SAFE_TOOLS.has(DOCUMENT_TOOL)).toBe(true);
    expect(gatePlanCall(DOCUMENT_TOOL, { path: "x.docx" }).kind).toBe("pass");
  });
  it("is a fail-open HV_BUILTINS key", () => {
    expect(parseBuiltins(undefined).document).toBe(true);
    expect(parseBuiltins(JSON.stringify({ document: false })).document).toBe(false);
    expect(parseBuiltins("{not json").document).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest.log; npx vitest run tests/hv-document.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — cannot resolve `../pi-runtime/extensions/hv-document`.

- [ ] **Step 3: Write `hv-document.ts`**

```ts
/**
 * §31 Documents — PURE module, zero imports (the hv-rules.ts / hv-browser.ts contract).
 * Shared by the bridge (registration + the `read` hint), by src/main (conversion,
 * picker filter, prompt blocks) and by the renderer (the `+` row subtext, chips,
 * tool-card label). One constant for the extension set, because the picker, the
 * subtext, the `read` hint and the description must never disagree (Principle 11).
 */
export const DOCUMENT_TOOL = "document_read";

/** Display order = the `+` row's subtext order. CSV is deliberately absent (PRD §31 decision K). */
export const DOCUMENT_FAMILIES = [
  { label: "Word", ext: ["doc", "docx", "docm"] },
  { label: "PowerPoint", ext: ["ppt", "pps", "pot", "pptx", "pptm", "ppsx", "ppsm"] },
  { label: "Excel", ext: ["xls", "xlsx", "xlsm", "xlsb"] },
  { label: "PDF", ext: ["pdf"] },
  { label: "OpenDocument", ext: ["odt", "ods", "odp"] },
  { label: "RTF", ext: ["rtf"] },
  { label: "EPUB", ext: ["epub"] },
] as const satisfies ReadonlyArray<{ label: string; ext: readonly string[] }>;

export const DOCUMENT_EXTENSIONS: readonly string[] = DOCUMENT_FAMILIES.flatMap((f) => [...f.ext]);
export const DOCUMENT_FAMILY_LIST = DOCUMENT_FAMILIES.map((f) => f.label).join(", ");

export function documentExtension(p: string): string | null {
  const base = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return null;
  return base.slice(i + 1).toLowerCase();
}
export function isDocumentPath(p: string): boolean {
  const ext = documentExtension(p);
  return ext !== null && DOCUMENT_EXTENSIONS.includes(ext);
}
export function documentFamily(ext: string): string {
  const e = ext.toLowerCase();
  return DOCUMENT_FAMILIES.find((f) => (f.ext as readonly string[]).includes(e))?.label ?? e.toUpperCase();
}

export const DOCUMENT_TOOL_DESCRIPTIONS: Record<string, string> = {
  [DOCUMENT_TOOL]:
    `Read a ${DOCUMENT_FAMILY_LIST} file as Markdown, converted locally on this machine. ` +
    "Same contract as read: output is truncated to 2000 lines or 50KB (whichever is hit first); use offset/limit " +
    "(1-indexed lines) to continue. Plain text and CSV files are not documents — use read for those. " +
    "Scanned (image-only) PDF pages cannot be read locally; the result names them.",
};

export type DocumentErrorCode =
  | "unsupported" | "needsOcr" | "malformed" | "encrypted" | "resourceLimit" | "missingPart" | "io" | "hosted"
  | "timeout" | "crash" | "notDocument" | "disabled" | "unavailable";

export interface DocumentError {
  code: DocumentErrorCode;
  message?: string;
  pages?: number[];
  pageCount?: number;
  /** stderr tail on a crash. */
  detail?: string;
}

/** The sentence the model (and the chip) gets for a failed or partial conversion. */
export function documentErrorSentence(err: DocumentError, opts: { hasVision: boolean; name?: string }): string {
  const who = opts.name ? `${opts.name}` : "This document";
  switch (err.code) {
    case "needsOcr": {
      const n = err.pageCount ?? err.pages?.length ?? 0;
      const list = (err.pages ?? []).join(", ");
      const head = n ? `This PDF has ${n} page${n === 1 ? "" : "s"}; ` : "";
      const which = err.pages?.length === n || !list ? "all of its pages are" : `pages ${list} are`;
      const next = opts.hasVision
        ? "Ask the user to attach screenshots of those pages."
        : "This model has no vision, so screenshots will not help either — ask the user for a text export.";
      return `${head}${which} scanned images and could not be read locally. ${next}`;
    }
    case "encrypted": return `Encrypted — ${who} is password-protected and cannot be opened locally.`;
    case "resourceLimit": return `${who} exceeds the converter's built-in size or nesting limits and was refused.`;
    case "malformed": return `${who} is malformed and could not be parsed.`;
    case "missingPart": return `${who} is missing an internal part and could not be parsed.`;
    case "unsupported": return `${who} is not a supported document format.`;
    case "notDocument": return `Not a document format — use read for text and CSV files (documents are ${DOCUMENT_FAMILY_LIST}).`;
    case "disabled": return "The Documents tool is off in Built-in tools.";
    case "unavailable": return "Document conversion is not available on this platform.";
    case "timeout": return `Converting ${who} took longer than 30 seconds and was stopped.`;
    case "crash": return `Conversion failed${err.detail ? `: ${err.detail}` : "."}`;
    case "io": return `${who} could not be read${err.message ? ` (${err.message})` : "."}`;
    case "hosted": return "Hosted conversion is not enabled.";
  }
}

/**
 * §13 round 19's `read` hint: a `read` on a document path returns zip bytes and
 * the model burns a turn discovering it. Null ⇒ not our business (any other tool,
 * any non-document path, including .csv/.txt which read handles fine).
 */
export function documentReadRefusal(tool: string, input: Record<string, unknown>, enabled: boolean): string | null {
  if (tool !== "read") return null;
  const p = input.path;
  if (typeof p !== "string" || !isDocumentPath(p)) return null;
  return enabled
    ? `${p} is a binary document — call ${DOCUMENT_TOOL} with the same path to read it as Markdown.`
    : `${p} is a binary document, and the Documents tool is off in Built-in tools, so it cannot be read in this session.`;
}

export interface DocumentFacts { format: string; pages?: number; totalLines: number; totalBytes: number; from: number; to: number }

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
const thin = (n: number): string => n.toLocaleString("en-US").replace(/,/g, " ");

export function documentFactsLine(f: DocumentFacts): string {
  const parts = [documentFamily(f.format)];
  if (f.pages) parts.push(`${f.pages} page${f.pages === 1 ? "" : "s"}`);
  parts.push(`${thin(f.totalLines)} lines`, fmtBytes(f.totalBytes), `showing ${f.from}–${f.to}`);
  return parts.join(" · ");
}
```

Note `thin` uses a narrow no-break space so `1 240` renders as the PRD writes it; the test string must use the same character (` `). Adjust `88 KB` rounding to `Math.round` as above (90112 / 1024 = 88).

- [ ] **Step 4: Gate placements**

`hv-rules.ts:65` — add `"document_read"` to the `SAFE_TOOLS` set (spell the literal; hv-rules is zero-import by contract, so do not import the constant here — add a one-line comment `// §31: read's class`).

`hv-plan.ts` `PLAN_PASS_TOOLS` — append after the browser line:
```ts
  // §31: a document read is a read. Named for the same reason as the browser
  // reads — an unnamed tool floor-asks on every call in plan mode.
  "document_read",
```

`hv-builtins.ts` — add to `BuiltinToggles`:
```ts
  /** §31: the Documents entry — one tool, `document_read`, plus the `read` hint. */
  document: boolean;
```
Default `document: true` in `parseBuiltins`'s `out`, `if (p.document === false) out.document = false;` beside the others, and `document` in the `Partial<…>` cast.

`tests/hv-builtins.test.ts` — every `toEqual({ … browser: true })` object gains `, document: true`.

- [ ] **Step 5: Run both test files**

```bash
L=/tmp/vitest.log; npx vitest run tests/hv-document.test.ts tests/hv-builtins.test.ts tests/hv-browser.test.ts > $L 2>&1; echo "EXIT=$?"; tail -15 $L
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pi-runtime/extensions/hv-document.ts pi-runtime/extensions/hv-rules.ts pi-runtime/extensions/hv-plan.ts pi-runtime/extensions/hv-builtins.ts tests/hv-document.test.ts tests/hv-builtins.test.ts
git commit -m "feat(documents): the pure module — 13 extensions, read's class, the sentences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The sidecar `anydoc-bridge.mjs`, the pin, and the contract test

**Files:**
- Modify: `pi-runtime/package.json` (dependency, exact pin from `ad1.md`)
- Create: `pi-runtime/bin/anydoc-bridge.mjs`
- Test: `tests/anydoc-contract.test.ts`

**Interfaces:**
- Produces (the wire main consumes):
  - argv: `anydoc-bridge.mjs --probe` → `{"ok":true,"probe":true,"version":"0.2.x"}` or `{"ok":false,"code":"unavailable","message":…}`.
  - argv: `anydoc-bridge.mjs <absPath> [offset] [limit]` → ONE JSON line on stdout, last line wins:
    `{"ok":true,"format":"docx","pages":12,"totalLines":1240,"totalBytes":90112,"from":1,"to":2000,"text":"…","truncated":true}` — `pages` present only when Task 0 found a way to get it; or
    `{"ok":false,"code":"needsOcr","message":"…","pages":[1,7],"pageCount":31}` with `code` one of anydoc's codes verbatim.
  - exit 0 on both `ok` shapes; non-zero exit + stderr only on an unexpected crash (main maps that to `crash`).

- [ ] **Step 1: Pin the dependency**

```bash
cd pi-runtime && npm install --save-exact @firecrawl/anydoc@<PIN FROM ad1.md> && cd ..
git diff pi-runtime/package.json
```
Expected: one new line under `dependencies`, an exact version, and `package-lock.json` grows by the darwin optional packages (the other platforms are listed as optional and not installed — fine).

- [ ] **Step 2: Write the failing contract test**

```ts
// tests/anydoc-contract.test.ts
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DOCUMENT_EXTENSIONS } from "../pi-runtime/extensions/hv-document";

const runtime = path.join(process.cwd(), "pi-runtime");
const BRIDGE = path.join(runtime, "bin/anydoc-bridge.mjs");
const FIX = path.join(process.cwd(), "tests/fixtures/documents");
const ANYDOC_DIR = path.join(runtime, "node_modules/@firecrawl/anydoc");

/** Run the sidecar the way main does: process.execPath as node, cwd = runtime, last stdout line is the reply. */
function run(...args: string[]): { code: number | null; reply: Record<string, unknown> | null; stderr: string } {
  const r = spawnSync(process.execPath, [BRIDGE, ...args], {
    cwd: runtime, encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 30_000,
  });
  const line = r.stdout.trim().split("\n").pop() ?? "";
  let reply: Record<string, unknown> | null = null;
  try { reply = JSON.parse(line); } catch { /* crash path */ }
  return { code: r.status, reply, stderr: r.stderr };
}

describe("anydoc sidecar (§31) — the pin-bump gate", () => {
  it("the pin is exact and matches what is installed", () => {
    const declared = (JSON.parse(fs.readFileSync(path.join(runtime, "package.json"), "utf8")) as { dependencies: Record<string, string> })
      .dependencies["@firecrawl/anydoc"];
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
    const installed = (JSON.parse(fs.readFileSync(path.join(ANYDOC_DIR, "package.json"), "utf8")) as { version: string }).version;
    expect(installed).toBe(declared);
  });

  it("probes ok on this platform", () => {
    const { reply, code } = run("--probe");
    expect(code).toBe(0);
    expect(reply?.ok).toBe(true);
    expect(reply?.probe).toBe(true);
  });

  it("every extension we expose is one anydoc accepts", async () => {
    const mod = await import(path.join(ANYDOC_DIR, "index.js")) as { formatFromExtension: (e: string) => unknown };
    for (const ext of DOCUMENT_EXTENSIONS) {
      expect(mod.formatFromExtension(ext), ext).toBeTruthy();
    }
  });

  it("converts each fixture family and reports the read-contract fields", () => {
    for (const f of ["sample.docx", "sample.xlsx", "sample.pptx", "sample.odt", "sample.rtf", "text.pdf"]) {
      const { reply, code } = run(path.join(FIX, f));
      expect(code, f).toBe(0);
      expect(reply?.ok, `${f}: ${JSON.stringify(reply)}`).toBe(true);
      expect(typeof reply?.text).toBe("string");
      expect((reply?.text as string).length).toBeGreaterThan(0);
      expect(reply?.totalLines).toBeGreaterThan(0);
      expect(reply?.from).toBe(1);
      expect(reply?.format).toBeTruthy();
    }
  });

  it("slices exactly like Pi's read: offset/limit are 1-indexed lines, then truncateHead", async () => {
    const full = run(path.join(FIX, "sample.docx"));
    const text = full.reply?.text as string;
    const lines = text.split("\n");
    if (lines.length < 4) return; // fixture too small to slice — acceptable, the docx fixture should have ≥ 4 lines
    const part = run(path.join(FIX, "sample.docx"), "2", "2");
    expect(part.reply?.from).toBe(2);
    expect(part.reply?.to).toBe(3);
    expect(part.reply?.text).toBe(lines.slice(1, 3).join("\n"));
    // The truncation bound is Pi's, not ours: import the same function and compare.
    const { truncateHead, DEFAULT_MAX_LINES } = await import(
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/core/tools/truncate.js")
    ) as { truncateHead: (s: string) => { content: string }; DEFAULT_MAX_LINES: number };
    expect(DEFAULT_MAX_LINES).toBe(2000);
    expect(truncateHead(text).content).toBe(text.length > 50 * 1024 ? full.reply?.text : text);
  });

  it("names scanned pages on the mixed PDF (the pin's whole reason)", () => {
    const { reply } = run(path.join(FIX, "mixed.pdf"));
    // Either the text page came through with the image page listed, or the whole
    // file rejected with the page list — both give the sentence something to name.
    if (reply?.ok) {
      expect((reply.text as string).length).toBeGreaterThan(0);
    } else {
      expect(reply?.code).toBe("needsOcr");
      expect(Array.isArray(reply?.pages)).toBe(true);
    }
  });

  it("reports anydoc's own error codes, not a stack trace", () => {
    const { reply, code } = run(path.join(FIX, "notes.txt"));
    // anydoc detects format from CONTENT; a .txt is `unsupported` upstream. The
    // .csv/.txt refusal with "use read" is MAIN's (documents.ts), before spawning.
    expect(code).toBe(0);
    expect(reply?.ok).toBe(false);
    expect(typeof reply?.code).toBe("string");
    const { reply: missing } = run(path.join(FIX, "does-not-exist.docx"));
    expect(missing?.ok).toBe(false);
    expect(missing?.code).toBe("io");
  });

  it("has no network path: no `ocr` option, no Firecrawl reference (§31 privacy)", () => {
    const src = fs.readFileSync(BRIDGE, "utf8");
    expect(src).not.toMatch(/\bocr\b/i);
    expect(src).not.toMatch(/firecrawl\.dev|FIRECRAWL|apiKey/i);
    // and the only anydoc import is the local package, never a CDN/URL import
    expect(src).not.toMatch(/https?:\/\//);
  });

  it("is named in the runtime pins line the Changelog page shows (§30)", () => {
    const cfg = fs.readFileSync(path.join(process.cwd(), "electron.vite.config.ts"), "utf8");
    expect(cfg).toContain("pins['@firecrawl/anydoc']");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
L=/tmp/vitest.log; npx vitest run tests/anydoc-contract.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: FAIL — `--probe` spawn has no script (ENOENT on the bridge path), pins line missing.

- [ ] **Step 4: Write the sidecar**

```js
#!/usr/bin/env node
// pi-runtime/bin/anydoc-bridge.mjs — §31 Documents: the ONLY place anydoc runs.
//
// One-shot: `node anydoc-bridge.mjs <absPath> [offset] [limit]` or `--probe`.
// Prints exactly ONE JSON line on stdout and exits 0 for both ok:true and
// ok:false. Non-zero exit is reserved for a real crash (main maps it to
// "crash" with the stderr tail). It runs under the bundled Electron helper as
// Node (ELECTRON_RUN_AS_NODE) in the app and under system Node in dev/tests.
//
// Why a child process and not a require() in main: the Node binding keeps a
// large workbook's RSS high-water in the CALLING process (upstream #155), and a
// parser panic must not take the app. Why not inside the Pi child: the `+`
// attach path converts before any session exists.
//
// Privacy (PRD §31): there is deliberately no option pass-through. Hosted
// conversion would send the file to a third party; this file must never grow a
// way to ask for it. tests/anydoc-contract.test.ts scans this source for that.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); };

let anydoc;
try {
  anydoc = await import(path.join(here, "..", "node_modules", "@firecrawl", "anydoc", "index.js"));
} catch (e) {
  out({ ok: false, code: "unavailable", message: String(e && e.message || e) });
  process.exit(0);
}

const [, , arg, offsetArg, limitArg] = process.argv;
if (arg === "--probe") {
  let version = null;
  try {
    const { readFileSync } = await import("node:fs");
    version = JSON.parse(readFileSync(path.join(here, "..", "node_modules", "@firecrawl", "anydoc", "package.json"), "utf8")).version;
  } catch { /* version is informational */ }
  out({ ok: true, probe: true, version });
  process.exit(0);
}
if (!arg) { out({ ok: false, code: "io", message: "no path given" }); process.exit(0); }

// Pi's own truncation, so the slice contract is read's by construction.
const { truncateHead } = await import(
  path.join(here, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "tools", "truncate.js")
);

let markdown;
try {
  markdown = await anydoc.toMarkdown(arg);
} catch (e) {
  // anydoc errors carry `code` (unsupported · needsOcr · malformed · encrypted ·
  // resourceLimit · missingPart · io · hosted); an ENOENT from the fs layer
  // arrives as `io` upstream — if a pin ever changes that, map it here.
  const code = typeof e?.code === "string" ? e.code : (e?.code === "ENOENT" ? "io" : "malformed");
  out({ ok: false, code, message: String(e?.message ?? e).slice(0, 300), pages: e?.pages, pageCount: e?.pageCount });
  process.exit(0);
}

// Mirror dist/core/tools/read.js: 1-indexed offset, limit in lines, then truncateHead.
const lines = markdown.split("\n");
const totalLines = lines.length;
const totalBytes = Buffer.byteLength(markdown, "utf8");
const start = Math.max(1, Number.parseInt(offsetArg ?? "1", 10) || 1);
const limit = limitArg !== undefined ? Math.max(1, Number.parseInt(limitArg, 10) || 1) : undefined;
const end = limit !== undefined ? Math.min(totalLines, start + limit - 1) : totalLines;
const sliced = lines.slice(start - 1, end).join("\n");
const t = truncateHead(sliced);
const shownLines = t.content.length === sliced.length ? end - start + 1 : t.content.split("\n").length;

let pages;
// Task 0 decides: if ad1.md records a page-count route (e.g. toDocument for pptx),
// set `pages` here for those formats only. Leave undefined otherwise — the facts
// line omits it rather than guessing.

out({
  ok: true,
  format: (() => { try { return String(anydoc.formatFromPath(arg)); } catch { return path.extname(arg).slice(1).toLowerCase(); } })(),
  ...(pages ? { pages } : {}),
  totalLines,
  totalBytes,
  from: start,
  to: start + shownLines - 1,
  text: t.content,
  truncated: t.truncated || end < totalLines,
});
```

Check `anydoc.formatFromPath`'s return shape in the `index.d.ts` you recorded in Task 0 and normalise it to the lower-case extension-like string the renderer's `documentFamily` expects (`"docx"`, `"pdf"`, …). If it returns an enum object, map it; write the mapping in the sidecar, not in main.

`chmod +x pi-runtime/bin/anydoc-bridge.mjs`. Add the pins line in `electron.vite.config.ts`:
```ts
const runtimePins =
  `Pi ${pins['@earendil-works/pi-coding-agent']}` +
  ` · sub-agents ${pins['pi-subagents']}` +
  ` · MCP adapter ${pins['pi-mcp-adapter']}` +
  ` · anydoc ${pins['@firecrawl/anydoc']}`
```

- [ ] **Step 5: Run the contract test**

```bash
L=/tmp/vitest.log; npx vitest run tests/anydoc-contract.test.ts > $L 2>&1; echo "EXIT=$?"; tail -25 $L
```
Expected: PASS. If `formatFromExtension` is not exported under that name, use what `index.d.ts` exports and update the test's import accordingly — the assertion ("every extension we expose is one anydoc accepts") is the contract, the function name is not.

- [ ] **Step 6: Commit**

```bash
git add pi-runtime/package.json pi-runtime/package-lock.json pi-runtime/bin/anydoc-bridge.mjs electron.vite.config.ts tests/anydoc-contract.test.ts
git commit -m "feat(documents): anydoc pinned and run as a one-shot sidecar with read's slice contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `src/main/documents.ts` — conversion, probe, prompt blocks

**Files:**
- Create: `src/main/documents.ts`
- Test: `tests/documents.test.ts`

**Interfaces:**
- Consumes: the sidecar wire (Task 2); `nodeExecPath` from `./pi/spawn`; `MAX_FILE_BYTES`, `MENTION_CONTEXT_CAP` from `./files`; the pure module.
- Produces:

```ts
export interface DocumentSlice { ok: true; path: string; name: string; format: string; pages?: number; totalLines: number; totalBytes: number; from: number; to: number; text: string; truncated: boolean }
export interface DocumentFailure { ok: false; path: string; name: string; error: DocumentError }   // DocumentError from hv-document
export type DocumentResult = DocumentSlice | DocumentFailure;
export interface ConvertOpts { runtimeDir: string; execPath?: string; offset?: number; limit?: number; timeoutMs?: number }
export function convertDocument(absPath: string, opts: ConvertOpts): Promise<DocumentResult>;
export function probeDocuments(runtimeDir: string, execPath?: string): Promise<boolean>;     // memoised per process
export interface DocumentChip { path: string; name: string; format: string; pages?: number; lines: number; bytes: number; error?: string }
export interface DocumentBlocks { blocks: string; warnings: string[]; chips: DocumentChip[] }
export function buildDocumentBlocks(absPaths: string[], opts: { runtimeDir: string; execPath?: string; hasVision: boolean; cap?: number; used?: number; maxItemBytes?: number }): Promise<DocumentBlocks>;
export function parseDocumentHeaders(text: string): Array<{ path: string; format: string; pages?: number }>;  // for the renderer's restore chips — exported here so one regex is the truth, re-exported via mentions.ts
export const DOCUMENT_BLOCK_MARK = "\n\n<document ";
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/documents.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { convertDocument, buildDocumentBlocks, parseDocumentHeaders, probeDocuments, DOCUMENT_BLOCK_MARK } from "../src/main/documents";

const runtimeDir = path.join(process.cwd(), "pi-runtime");
const FIX = path.join(process.cwd(), "tests/fixtures/documents");
const opts = { runtimeDir, execPath: process.execPath };

describe("documents.ts (§31) — main's side of the sidecar", () => {
  it("probes true here", async () => {
    expect(await probeDocuments(runtimeDir, process.execPath)).toBe(true);
  });

  it("converts a docx into a slice with facts", async () => {
    const r = await convertDocument(path.join(FIX, "sample.docx"), opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("sample.docx");
    expect(r.format).toBe("docx");
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.from).toBe(1);
  });

  it("refuses text and CSV before spawning — those are read's (decision K)", async () => {
    const r = await convertDocument(path.join(FIX, "table.csv"), opts);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("notDocument");
  });

  it("maps a missing file to io and a bogus sidecar to crash", async () => {
    const r = await convertDocument(path.join(FIX, "nope.docx"), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("io");
    const c = await convertDocument(path.join(FIX, "sample.docx"), { ...opts, execPath: "/usr/bin/false" });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.code).toBe("crash");
  });

  it("builds <document> blocks under the @file caps and a chip per document", async () => {
    const { blocks, chips, warnings } = await buildDocumentBlocks(
      [path.join(FIX, "sample.docx"), path.join(FIX, "table.csv")],
      { ...opts, hasVision: true },
    );
    expect(blocks.startsWith(DOCUMENT_BLOCK_MARK.trimStart())).toBe(true);
    expect(blocks).toMatch(/^<document path="[^"]+sample\.docx" format="docx"( pages="\d+")?>\n/);
    expect(blocks).toMatch(/\n<\/document>$/);
    expect(chips).toHaveLength(2);
    expect(chips[0].error).toBeUndefined();
    expect(chips[1].error).toMatch(/use read/);
    expect(warnings.some((w) => w.includes("table.csv"))).toBe(true);
  });

  it("truncates at the cap and points at document_read with the next offset", async () => {
    const { blocks } = await buildDocumentBlocks([path.join(FIX, "sample.docx")], { ...opts, hasVision: true, cap: 200 });
    expect(blocks).toMatch(/\[truncated at 200 chars — call document_read with offset=\d+ to continue\]\n<\/document>$/);
  });

  it("a scanned PDF attaches its sentence, vision-aware (decision H)", async () => {
    const withV = await buildDocumentBlocks([path.join(FIX, "mixed.pdf")], { ...opts, hasVision: true });
    const noV = await buildDocumentBlocks([path.join(FIX, "mixed.pdf")], { ...opts, hasVision: false });
    // Either the text page converted (then both are equal, sentence-free) or the
    // sentence is inside the block and differs by the vision clause.
    if (withV.chips[0].error) {
      expect(withV.blocks).toMatch(/scanned images/);
      expect(noV.blocks).toMatch(/no vision/);
      expect(withV.blocks).not.toMatch(/no vision/);
    }
  });

  it("parses block headers back for restore chips", () => {
    const text = 'hello\n\n<document path="/a/b.docx" format="docx" pages="3">\n# x\n</document>\n\n<document path="/c.pdf" format="pdf">\nz\n</document>';
    expect(parseDocumentHeaders(text)).toEqual([
      { path: "/a/b.docx", format: "docx", pages: 3 },
      { path: "/c.pdf", format: "pdf" },
    ]);
    expect(parseDocumentHeaders("plain")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest.log; npx vitest run tests/documents.test.ts > $L 2>&1; echo "EXIT=$?"; tail -10 $L
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `documents.ts`**

```ts
// src/main/documents.ts — §31 Documents. Electron-free (vitest-importable), the
// mcpAdapterStore.ts sidecar pattern: spawn, capture BOTH streams, deadline,
// idempotent settle, last stdout line is the reply.
import { spawn } from "node:child_process";
import path from "node:path";
import { nodeExecPath } from "./pi/spawn";
import { MAX_FILE_BYTES, MENTION_CONTEXT_CAP } from "./files";
import {
  DOCUMENT_TOOL, documentErrorSentence, isDocumentPath, type DocumentError,
} from "../../pi-runtime/extensions/hv-document";

export const ANYDOC_BRIDGE_RELPATH = "bin/anydoc-bridge.mjs";
const SIDECAR_TIMEOUT_MS = 30_000;
export const DOCUMENT_BLOCK_MARK = "\n\n<document ";

export interface DocumentSlice { ok: true; path: string; name: string; format: string; pages?: number; totalLines: number; totalBytes: number; from: number; to: number; text: string; truncated: boolean }
export interface DocumentFailure { ok: false; path: string; name: string; error: DocumentError }
export type DocumentResult = DocumentSlice | DocumentFailure;
export interface ConvertOpts { runtimeDir: string; execPath?: string; offset?: number; limit?: number; timeoutMs?: number }

function runSidecar(args: string[], o: { runtimeDir: string; execPath?: string; timeoutMs?: number }): Promise<{ reply: Record<string, unknown> | null; code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(o.execPath ?? nodeExecPath(), [path.join(o.runtimeDir, ANYDOC_BRIDGE_RELPATH), ...args], {
      cwd: o.runtimeDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let out = ""; let err = ""; let settled = false; let timedOut = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const line = out.trim().split("\n").pop() ?? "";
      let reply: Record<string, unknown> | null = null;
      try { reply = line ? (JSON.parse(line) as Record<string, unknown>) : null; } catch { reply = null; }
      resolve({ reply, code, stderr: err, timedOut });
    };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); finish(null); }, o.timeoutMs ?? SIDECAR_TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

export async function convertDocument(absPath: string, opts: ConvertOpts): Promise<DocumentResult> {
  const name = path.basename(absPath);
  if (!isDocumentPath(absPath)) return { ok: false, path: absPath, name, error: { code: "notDocument" } };
  const args = [absPath];
  if (opts.offset !== undefined || opts.limit !== undefined) args.push(String(opts.offset ?? 1));
  if (opts.limit !== undefined) args.push(String(opts.limit));
  const r = await runSidecar(args, opts);
  if (r.timedOut) return { ok: false, path: absPath, name, error: { code: "timeout" } };
  if (!r.reply) {
    const detail = r.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
    return { ok: false, path: absPath, name, error: { code: "crash", detail: detail || `sidecar exited ${r.code} with no output` } };
  }
  if (r.reply.ok === true) {
    const s = r.reply as { format: string; pages?: number; totalLines: number; totalBytes: number; from: number; to: number; text: string; truncated: boolean };
    return { ok: true, path: absPath, name, format: s.format, pages: s.pages, totalLines: s.totalLines, totalBytes: s.totalBytes, from: s.from, to: s.to, text: s.text, truncated: !!s.truncated };
  }
  const e = r.reply as { code?: string; message?: string; pages?: number[]; pageCount?: number };
  return { ok: false, path: absPath, name, error: { code: (e.code as DocumentError["code"]) ?? "malformed", message: e.message, pages: e.pages, pageCount: e.pageCount } };
}

let probed: Promise<boolean> | null = null;
/** Once per process: does the addon load here? Drives "not available on this platform". */
export function probeDocuments(runtimeDir: string, execPath?: string): Promise<boolean> {
  probed ??= runSidecar(["--probe"], { runtimeDir, execPath, timeoutMs: 15_000 }).then((r) => r.reply?.ok === true);
  return probed;
}

export interface DocumentChip { path: string; name: string; format: string; pages?: number; lines: number; bytes: number; error?: string }
export interface DocumentBlocks { blocks: string; warnings: string[]; chips: DocumentChip[] }

const header = (p: string, format: string, pages?: number): string =>
  `<document path="${p.replace(/"/g, "'")}" format="${format}"${pages ? ` pages="${pages}"` : ""}>`;

/**
 * The `<document>` blocks for attached / mentioned documents, under the @file
 * caps (shared: `used` is what the mention blocks already spent). A failed
 * conversion still produces a block carrying the SENTENCE (decision H), so the
 * model's next move is to ask rather than to guess why the file is silent.
 */
export async function buildDocumentBlocks(
  absPaths: string[],
  opts: { runtimeDir: string; execPath?: string; hasVision: boolean; cap?: number; used?: number; maxItemBytes?: number },
): Promise<DocumentBlocks> {
  const cap = opts.cap ?? MENTION_CONTEXT_CAP;
  const maxItem = opts.maxItemBytes ?? MAX_FILE_BYTES;
  let total = opts.used ?? 0;
  const parts: string[] = []; const warnings: string[] = []; const chips: DocumentChip[] = [];
  for (const p of absPaths) {
    const r = await convertDocument(p, { runtimeDir: opts.runtimeDir, execPath: opts.execPath });
    if (!r.ok) {
      const sentence = documentErrorSentence(r.error, { hasVision: opts.hasVision, name: r.name });
      chips.push({ path: p, name: r.name, format: documentExt(p), lines: 0, bytes: 0, error: sentence });
      warnings.push(`${r.name}: ${sentence}`);
      // A document the user picked still gets a block, so the model knows it was
      // there and why it is empty — except a non-document, which is read's job.
      if (r.error.code !== "notDocument") parts.push(`${header(p, documentExt(p))}\n${sentence}\n</document>`);
      continue;
    }
    let body = r.text;
    if (r.totalBytes > maxItem) {
      body = body.slice(0, maxItem);
    }
    const room = cap - total - header(p, r.format, r.pages).length - 20;
    if (body.length > room) {
      const cut = Math.max(0, room);
      const shown = body.slice(0, cut);
      const nextLine = shown.split("\n").length; // the first line NOT shown, 1-indexed
      body = `${shown}\n[truncated at ${cut} chars — call ${DOCUMENT_TOOL} with offset=${nextLine} to continue]`;
    }
    const block = `${header(p, r.format, r.pages)}\n${body}\n</document>`;
    parts.push(block); total += block.length + 2;
    chips.push({ path: p, name: r.name, format: r.format, pages: r.pages, lines: r.totalLines, bytes: r.totalBytes });
  }
  return { blocks: parts.join("\n\n"), warnings, chips };
}

function documentExt(p: string): string { return path.extname(p).slice(1).toLowerCase(); }

const HEADER_RE = /^<document path="([^"]*)" format="([^"]*)"(?: pages="(\d+)")?>$/m;
/** Restore path: the chips are rebuilt from the block headers, because the user typed nothing. */
export function parseDocumentHeaders(text: string): Array<{ path: string; format: string; pages?: number }> {
  const out: Array<{ path: string; format: string; pages?: number }> = [];
  const re = new RegExp(HEADER_RE.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ path: m[1], format: m[2], ...(m[3] ? { pages: Number(m[3]) } : {}) });
  }
  return out;
}
```

Note on the truncation test: with `cap: 200`, `room` is ~140, so the footer reads `[truncated at 1xx chars …]`, not `200`. Change the test's regex to `\[truncated at \d+ chars — call document_read with offset=\d+ to continue\]` — the contract is the shape and the offset, not the number. (The proposal's "truncated at N chars" is N = the chars shown.)

- [ ] **Step 4: Run the test**

```bash
L=/tmp/vitest.log; npx vitest run tests/documents.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: PASS. `renderer` may not resolve `../../pi-runtime/extensions/hv-document` from `src/main` under `tsconfig.node.json` — `src/main` already imports `hv-browser.ts` the same way (grep `hv-browser` in `src/main/*.ts` to copy the exact specifier form).

- [ ] **Step 5: Commit**

```bash
git add src/main/documents.ts tests/documents.test.ts
git commit -m "feat(documents): main converts through the sidecar and builds <document> blocks under the @file caps

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The bridge — register `document_read`, the `read` hint, the reply shape

**Files:**
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (import ~line 15; `documentReply` beside `terminalReply` ~138; `tool_call` hint beside the `bash &` refusal ~1045; registration after the `builtins.browser` block ~1856)
- Modify: `tests/builtins-contract.test.ts` (one probe case)

**Interfaces:**
- Consumes: `DOCUMENT_TOOL`, `DOCUMENT_TOOL_DESCRIPTIONS`, `documentReadRefusal`, `documentFactsLine` (Task 1); `builtins.document` (Task 1).
- Produces: the blocking envelope `ctx.ui.input(JSON.stringify({ kind: "hv.document-read", path, offset, limit }), "")` — payload in `title`. Main replies (Task 5) `{ ok: true, text, facts: DocumentFacts, name, path }` or `{ ok: false, text }` where `text` is already the sentence.

- [ ] **Step 1: Extend the key-free contract test**

In `tests/builtins-contract.test.ts`, beside the existing terminal/browser probes (find `probe(JSON.stringify({ browser: false }))` or equivalent), add:

```ts
test("§31: document:false unregisters document_read; default registers it", async () => {
  const off = await probe(JSON.stringify({ document: false }));
  expect(off.tools).not.toContain("document_read");
  const on = await probe(undefined);
  expect(on.tools).toContain("document_read");
});
```

Run: `L=/tmp/vitest.log; npx vitest run tests/builtins-contract.test.ts > $L 2>&1; echo "EXIT=$?"; tail -10 $L` — Expected: the new test FAILS on `on.tools` (tool not registered yet).

- [ ] **Step 2: Bridge changes**

Import (beside the hv-browser import at line 15):
```ts
import { DOCUMENT_TOOL, DOCUMENT_TOOL_DESCRIPTIONS, documentFactsLine, documentReadRefusal } from "./hv-document";
```

`documentReply`, beside `terminalReply` (~line 138), same contract:
```ts
/**
 * §31: main ALWAYS answers a hv.document-read input. `text` is already the
 * Markdown slice (ok) or the sentence (not ok); `facts` feeds the card's
 * facts line via `details`. Same never-hang contract as terminalReply.
 */
function documentReply(raw: unknown): { content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> } {
  let p: { ok?: boolean; text?: string; facts?: Parameters<typeof documentFactsLine>[0]; name?: string; path?: string } = {};
  try { p = JSON.parse(String((raw as { value?: string })?.value ?? raw ?? "")) as typeof p; } catch { /* not JSON */ }
  if (p.ok === true && typeof p.text === "string") {
    const line = p.facts ? documentFactsLine(p.facts) : "";
    return {
      content: [{ type: "text", text: line ? `${p.name ?? "document"} — ${line}\n\n${p.text}` : p.text }],
      details: { path: p.path, facts: p.facts, factsLine: line },
    };
  }
  return { content: [{ type: "text", text: p.text ?? "The document could not be read." }], details: { path: p.path, error: true } };
}
```
Copy `terminalReply`'s exact raw-unwrapping (how it reads `value`) rather than trusting the sketch above.

`tool_call` hint — insert immediately AFTER the `bash &` refusal block (~line 1057) and BEFORE the plan clamp:
```ts
    // §13 round 19: a `read` on a document path returns zip bytes and the model
    // burns a turn finding out. Point it at document_read (or say the tool is off).
    // Not gated on builtins.document: with the group OFF the refusal still saves
    // the wasted turn — it just names a different reason.
    {
      const hint = documentReadRefusal(tool, input, builtins.document);
      if (hint) {
        audit(ctx.ui, { tool, summary, decision: "deny", source: "document" });
        return { block: true, reason: hint };
      }
    }
```
Check `audit`'s `source` type (grep `source:` in the audit payload type near `hv.audit`) — add `"document"` to the union where `"terminal"` is listed, in the bridge and in the renderer's `AuditView` source label map if it enumerates sources.

Registration — after the `} // builtins.browser` line:
```ts
  // §31 Documents: ONE tool over ONE blocking envelope. Main owns conversion (the
  // sidecar), the path resolution and the audit row; this is a thin shell exactly
  // like browser_get_text. Payload rides `title` (blocking input), never `message`.
  if (builtins.document) {
    pi.registerTool({
      name: DOCUMENT_TOOL,
      label: "Read document",
      description: DOCUMENT_TOOL_DESCRIPTIONS[DOCUMENT_TOOL],
      parameters: Type.Object({
        path: Type.String({ description: "Path to the document (workspace-relative or absolute)." }),
        offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed), like read." })),
        limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read, like read." })),
        intent: Type.String({ description: "REQUIRED. One short customer-facing sentence: what you are looking for in this document." }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const { path, offset, limit } = params as { path: string; offset?: number; limit?: number };
        const raw = await ctx.ui.input(JSON.stringify({ kind: "hv.document-read", path, offset, limit }), "");
        return documentReply(raw);
      },
    });
  } // builtins.document
```

- [ ] **Step 3: Run the contract test and the extensions typecheck's test**

```bash
L=/tmp/vitest.log; npx vitest run tests/builtins-contract.test.ts tests/extensions-typecheck.test.ts tests/hv-document.test.ts > $L 2>&1; echo "EXIT=$?"; tail -15 $L
```
Expected: PASS (extensions-typecheck runs `tsc -p tsconfig.extensions.json` over the whole directory, so the bridge's new import is type-checked here).

- [ ] **Step 4: Commit**

```bash
git add pi-runtime/extensions/happyvibe-bridge.ts tests/builtins-contract.test.ts
git commit -m "feat(documents): document_read registered under builtins.document, and read gets a hint on a .docx

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Main — the `hv.document-read` handler, the picker, the toggle plumbing

**Files:**
- Modify: `src/main/pi/spawn.ts:60` (type) and `:216-223` (key list)
- Modify: `src/main/config.ts:324-345` (`document` in get/set)
- Modify: `src/main/ipc.ts` — `parseDocumentReq` beside `parseTerminalReq` (~207); dispatch beside the browser block (~1374); `hv:pick-document`, `hv:reveal-document`, `hv:documents-available` beside `hv:pick-image` (~3421); `hv:builtins-set` type (~2924)
- Modify: `src/preload/index.ts` (~66), `src/renderer/src/hv.d.ts` (~582, ~776)
- Test: `tests/hv-builtins.test.ts` (spawn env assertion) — add a test that `resolvePiSpawn` emits `document` in `HV_BUILTINS` (find the existing spawn-env test for `browser` with `grep -n "HV_BUILTINS" tests/*.ts`; if none exists, add one to `tests/mcp-spawn.test.ts` using the same `resolvePiSpawn(...)` call shape that file already uses)

**Interfaces:**
- Consumes: `convertDocument`, `probeDocuments` (Task 3); `sessionCanSeeImages(workspace, sessionId)` (`ipc.ts:692`, already exists); the bridge envelope (Task 4).
- Produces:
  - IPC `hv:pick-document` → `Promise<DocumentChip | null>` (converted at pick; `error` set on failure).
  - IPC `hv:reveal-document(absPath)` → `void` (only if `isDocumentPath`, `shell.showItemInFolder`).
  - IPC `hv:documents-available` → `Promise<boolean>`.
  - `hv:builtins-get/set` carry `document`.
  - Audit row `{ type: "document.read", sessionId, data: { path, format, bytes, shown, ok } }` — never content.

- [ ] **Step 1: The spawn-env test**

```ts
// in the test file that already exercises resolvePiSpawn's env (grep -ln "HV_BUILTINS" tests/*.ts), add:
test("§31: HV_BUILTINS names the document key — an unlisted key never reaches the bridge", () => {
  const r = resolvePiSpawn({ ...baseOpts, builtinTools: { plan: true, askUser: true, planAppend: "", terminal: true, intent: true, browser: true, document: false } });
  expect(JSON.parse(r.env.HV_BUILTINS).document).toBe(false);
});
```
Use that file's existing `baseOpts`/call shape verbatim. Run it; expected FAIL on a type error or `undefined`.

- [ ] **Step 2: Plumbing**

`spawn.ts:60` — add `document: boolean` to the `builtinTools` type; `:216` — add `document: opts.builtinTools.document,` to the JSON.

`config.ts` — add `document?: boolean` to the `builtinTools` type (line 50), `document: t?.document ?? true` to `getBuiltinTools`'s return and type, `document?: boolean` to `setBuiltinTools`'s param type. `ipc.ts:2924` handler param type gains `document?: boolean`.

`hv.d.ts:776-777` — both `builtinsGet`/`builtinsSet` types gain `document`. Add:
```ts
  /** §31: pick a document; main converts it at pick time and returns the chip, or null on cancel. */
  pickDocument(): Promise<{ path: string; name: string; format: string; pages?: number; lines: number; bytes: number; error?: string } | null>;
  revealDocument(absPath: string): Promise<void>;
  documentsAvailable(): Promise<boolean>;
```
and `promptSession` gains a 7th param `documents?: string[]` (absolute paths). `preload/index.ts`: the three `ipcRenderer.invoke` lines and the 7th arg on `hv:prompt-session`.

- [ ] **Step 3: `parseDocumentReq` and the dispatch in ipc.ts**

Beside `parseTerminalReq`:
```ts
/** §31: the blocking document-read input. Main ALWAYS answers one. */
function parseDocumentReq(r: { method?: string; title?: string }): { path: string; offset?: number; limit?: number } | null {
  if (r.method !== "input") return null;
  try {
    const p = JSON.parse(r.title ?? "") as Record<string, unknown>;
    if (p.kind !== "hv.document-read" || typeof p.path !== "string") return null;
    return {
      path: p.path,
      offset: typeof p.offset === "number" ? p.offset : undefined,
      limit: typeof p.limit === "number" ? p.limit : undefined,
    };
  } catch {
    return null;
  }
}
```

Dispatch — right after the browser block (`if (br) { … return; }`), same idempotent-reply pattern:
```ts
      // §31: the blocking document read. Main resolves the path (absolute allowed,
      // like read; relative against the workspace), converts through the sidecar,
      // and ALWAYS answers — the deadline lives inside convertDocument.
      const dr = parseDocumentReq(r as { method?: string; title?: string });
      if (dr) {
        void (async () => {
          const rid = r.id;
          let answered = false;
          const reply = (v: unknown): void => { if (answered) return; answered = true; client.respondUi(rid, { value: JSON.stringify(v) }); };
          const wsRoot = meta?.workspaceId ? workspaces.rootOf(meta.workspaceId) : null; // use whatever helper resolves a workspace id to its path here (grep "workspaces\." for the accessor other handlers use)
          const abs = path.isAbsolute(dr.path) ? dr.path : wsRoot ? path.join(wsRoot, dr.path) : dr.path;
          if (!getBuiltinTools().document) {
            reply({ ok: false, text: documentErrorSentence({ code: "disabled" }, { hasVision: false }), path: abs });
            return;
          }
          const hasVision = await sessionCanSeeImages(wsRoot ?? undefined, sessionId);
          const res = await convertDocument(abs, { runtimeDir, offset: dr.offset, limit: dr.limit });
          void log.append({
            type: "document.read", sessionId, workspaceId: meta?.workspaceId,
            data: { path: abs, ok: res.ok, format: res.ok ? res.format : undefined, bytes: res.ok ? res.totalBytes : 0, shown: res.ok ? res.to - res.from + 1 : 0, code: res.ok ? undefined : res.error.code },
          });
          if (!res.ok) { reply({ ok: false, text: documentErrorSentence(res.error, { hasVision, name: res.name }), path: abs, name: res.name }); return; }
          reply({ ok: true, text: res.text, name: res.name, path: abs, facts: { format: res.format, pages: res.pages, totalLines: res.totalLines, totalBytes: res.totalBytes, from: res.from, to: res.to } });
        })();
        return;
      }
```
`runtimeDir` is whatever the file already calls the resolved `pi-runtime` path (grep `runtimeDir` in ipc.ts). Add the imports (`convertDocument`, `probeDocuments`, `buildDocumentBlocks` from `./documents`; `documentErrorSentence`, `isDocumentPath`, `DOCUMENT_EXTENSIONS`, `DOCUMENT_FAMILY_LIST` from the extensions path used for `hv-browser`).

- [ ] **Step 4: Picker, reveal, probe IPC — beside `hv:pick-image`**

```ts
  // §31: pick a document — main converts it AT PICK TIME so the chip can show
  // the Markdown size (and the token estimate) before anything is sent.
  ipcMain.handle("hv:pick-document", async (_e, sessionId?: string) => {
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Documents", extensions: [...DOCUMENT_EXTENSIONS] }],
    });
    const file = r.canceled ? null : r.filePaths[0];
    if (!file) return null;
    const meta = sessionId ? index.get(sessionId) : undefined;
    const hasVision = await sessionCanSeeImages(meta?.workspaceId ? workspaces.rootOf(meta.workspaceId) : undefined, sessionId);
    const { chips } = await buildDocumentBlocks([file], { runtimeDir, hasVision });
    return chips[0] ?? null;
  });
  ipcMain.handle("hv:reveal-document", (_e, absPath: string) => {
    if (typeof absPath === "string" && path.isAbsolute(absPath) && isDocumentPath(absPath)) shell.showItemInFolder(absPath);
  });
  ipcMain.handle("hv:documents-available", () => probeDocuments(runtimeDir));
```
`hv:pick-document` takes the session id so the vision clause is right for THAT session; the preload passes it through (`pickDocument: (sessionId?: string) => ipcRenderer.invoke("hv:pick-document", sessionId)`; update the `hv.d.ts` signature to match).

- [ ] **Step 5: Run the touched tests**

```bash
L=/tmp/vitest.log; npx vitest run tests/hv-builtins.test.ts tests/mcp-spawn.test.ts tests/documents.test.ts > $L 2>&1; echo "EXIT=$?"; tail -15 $L
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/pi/spawn.ts src/main/config.ts src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts tests/
git commit -m "feat(documents): main answers hv.document-read, picks and converts at pick time, and the toggle reaches the bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Prompt injection — `documents` on `hv:prompt-session`, mentions convert, `stripInjectedBlocks`

**Files:**
- Modify: `src/main/ipc.ts:2297-2360` (`hv:prompt-session`)
- Modify: `src/renderer/src/mentions.ts:109` (`stripInjectedBlocks` marker) and re-export `parseDocumentHeaders`-equivalent for the renderer (the renderer cannot import `src/main`; copy the ONE regex into `mentions.ts` as `parseDocumentChips(text)` and pin equality in the test by asserting both parse the same fixture string)
- Test: the existing mentions test file (`grep -l stripInjectedBlocks tests/*.ts`), `tests/documents.test.ts`

**Interfaces:**
- Consumes: `buildDocumentBlocks` (Task 3), `buildMentionBlocks` (`files.ts:177`).
- Produces: `hv:prompt-session(sessionId, msg, behavior, images, mentions, openFiles, documents?: string[])`; the outgoing text gains `\n\n<document …>…</document>` blocks after the mention blocks; `stripInjectedBlocks` cuts at `\n\n<document `.

- [ ] **Step 1: Failing tests**

In the mentions test file:
```ts
it("§31: strips <document> blocks like <file> blocks, live and restored", () => {
  const t = 'read this\n\n<document path="/x/a.docx" format="docx" pages="2">\n# A\n</document>';
  expect(stripInjectedBlocks(t)).toBe("read this");
  expect(parseDocumentChips(t)).toEqual([{ path: "/x/a.docx", format: "docx", pages: 2 }]);
});
```
Run it: FAIL (`parseDocumentChips` missing; strip returns the whole string).

- [ ] **Step 2: `mentions.ts`**

Add `"\n\n<document "` to the marker array at line 109. Add:
```ts
/** §31 restore path: chips are rebuilt from the block headers (the user typed nothing). Same regex as main's parseDocumentHeaders. */
export function parseDocumentChips(text: string): Array<{ path: string; format: string; pages?: number }> {
  const out: Array<{ path: string; format: string; pages?: number }> = [];
  const re = /^<document path="([^"]*)" format="([^"]*)"(?: pages="(\d+)")?>$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ path: m[1], format: m[2], ...(m[3] ? { pages: Number(m[3]) } : {}) });
  return out;
}
```

- [ ] **Step 3: `hv:prompt-session`**

Add the 7th param `documents?: string[]` with the same validation as `mentions`. Then, inside the `mentions && mentions.length && meta?.workspaceId` branch's non-template arm AND for documents alone:

```ts
    // §31: documents — attached (absolute paths from the chip) and MENTIONED
    // (@report.docx, tree drag) — are partitioned OUT of buildMentionBlocks, which
    // is sync and would report them as "binary", and converted through the
    // sidecar under the SAME shared cap. Mentioned ones get no chip cost preview
    // (decision I: that is how @file behaves for text today).
    const docMentions = (mentions ?? []).filter(isDocumentPath);
    const textMentions = (mentions ?? []).filter((m) => !isDocumentPath(m));
    // …use textMentions where the existing code used mentions…
    const docPaths = [
      ...(documents ?? []),
      ...(meta?.workspaceId ? docMentions.map((rel) => resolveInWorkspace(workspaces.list(), meta.workspaceId!, rel)) : []),
    ];
    if (docPaths.length && !expanding) {   // `expanding` = the willExpand() result the branch already computes
      const hasVision = await sessionCanSeeImages(wsRoot, sessionId);
      const used = outgoing.length - msg.length;
      const d = await buildDocumentBlocks(docPaths, { runtimeDir, hasVision, used });
      if (d.blocks) outgoing = `${outgoing}\n\n${d.blocks}`;
      warnings = [...warnings, ...d.warnings];
    }
```
Documents ride the prompt-template path too? No: a template expansion cannot carry inline blocks (the existing comment explains why), so when `willExpand` is true, add a warning `Documents are not attached to a prompt-template command — send them in a plain message.` and skip. Keep `resolveInWorkspace` for mentioned documents (path-confined, as every mention is); attached documents are absolute and unconfined by decision D.

- [ ] **Step 4: Run**

```bash
L=/tmp/vitest.log; npx vitest run tests/mentions.test.ts tests/documents.test.ts tests/prompt-templates-reserved.test.ts > $L 2>&1; echo "EXIT=$?"; tail -12 $L
```
(Substitute the real mentions test filename.) Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/renderer/src/mentions.ts tests/
git commit -m "feat(documents): attached and @mentioned documents ride the @file seam as <document> blocks, stripped from the bubble

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Composer — `+ → Attach document`, chips with cost, drop, disabled-with-reason

**Files:**
- Modify: `src/renderer/src/composer.ts` (types + `filesToDocumentPaths`)
- Modify: `src/renderer/src/components/ChatView.tsx` (row ~1275-1283; `attachImage` ~572; `addFiles` ~580; shelf ~1188; send ~664; `onSend` type ~199; state ~475)
- Modify: `src/renderer/src/App.tsx` (~2019, ~2036 `promptSession` calls; the `onSend` prop)
- Test: `tests/composer.test.ts` if it exists (`grep -l isAttachableImage tests/*.ts`), else a new `tests/composer-documents.test.ts`

**Interfaces:**
- Consumes: `window.hv.pickDocument(sessionId)`, `window.hv.documentsAvailable()`, `window.hv.builtinsGet()`, `window.hv.getPathForFile(file)` (preload:28), `DOCUMENT_EXTENSIONS`, `DOCUMENT_FAMILY_LIST`, `isDocumentPath` from `../../../pi-runtime/extensions/hv-document` (the renderer already imports `hv-rules`/`hv-browser` this way — copy the exact specifier from `agents.ts` or wherever `WAIT_TOOLS` is imported).
- Produces:

```ts
// composer.ts
export interface DocumentAttachment { path: string; name: string; format: string; pages?: number; lines: number; bytes: number; error?: string }
export function documentChipLabel(d: DocumentAttachment): string;    // "report.docx · Word · 12 pages · 88 KB as Markdown (~22k tokens)" | "report.pdf · Scanned — 12 of 12 pages are images"
export function estimateTokens(chars: number): number;               // Math.ceil(chars / 4) — the app's rule (context.ts:232)
export function filesToDocumentPaths(files: ArrayLike<File>, pathOf: (f: File) => string): string[];  // drop/paste: document files only
```
`onSend(msg, behavior?, images?, mentions?, documents?: string[])` — App passes `documents` as the 7th `promptSession` arg.

- [ ] **Step 1: Failing test**

```ts
// tests/composer-documents.test.ts
import { describe, it, expect } from "vitest";
import { documentChipLabel, estimateTokens, filesToDocumentPaths } from "../src/renderer/src/composer";
import { DOCUMENT_FAMILY_LIST } from "../pi-runtime/extensions/hv-document";
import fs from "node:fs";

describe("§31 composer chips", () => {
  it("shows the Markdown cost before send", () => {
    expect(documentChipLabel({ path: "/x/report.docx", name: "report.docx", format: "docx", pages: 12, lines: 1240, bytes: 90112 }))
      .toBe("report.docx · Word · 12 pages · 88 KB as Markdown (~23k tokens)");
    expect(estimateTokens(90112)).toBe(22528);
  });
  it("shows the sentence instead when conversion failed", () => {
    expect(documentChipLabel({ path: "/x/a.pdf", name: "a.pdf", format: "pdf", lines: 0, bytes: 0, error: "Scanned — all of its pages are images" }))
      .toBe("a.pdf · Scanned — all of its pages are images");
  });
  it("keeps document files from a drop and ignores the rest", () => {
    const files = [{ name: "a.docx" }, { name: "b.png" }, { name: "c.csv" }] as unknown as File[];
    expect(filesToDocumentPaths(files, (f) => `/d/${f.name}`)).toEqual(["/d/a.docx"]);
  });
  it("the + row subtext is derived, never re-typed (Principle 11)", () => {
    const src = fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
    expect(src).toContain("DOCUMENT_FAMILY_LIST");
    expect(src).not.toMatch(/Word, PowerPoint, Excel/);   // the literal must not appear
    expect(src).not.toMatch(/coming soon/);                // the dead row is gone
    expect(DOCUMENT_FAMILY_LIST).not.toMatch(/CSV/);
  });
});
```
(`~23k`: round 22 528 up with `Math.ceil(tokens / 1000)` — write the label helper to match; if you prefer `~22k`, use `Math.round` in both.) Run: FAIL.

- [ ] **Step 2: `composer.ts`**

```ts
export interface DocumentAttachment { path: string; name: string; format: string; pages?: number; lines: number; bytes: number; error?: string }
/** The app's chars→tokens rule (context.ts, agents.ts): ceil(chars / 4). */
export function estimateTokens(chars: number): number { return Math.ceil(chars / 4); }
function kb(n: number): string { return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`; }
export function documentChipLabel(d: DocumentAttachment): string {
  if (d.error) return `${d.name} · ${d.error}`;
  const parts = [d.name, documentFamily(d.format)];
  if (d.pages) parts.push(`${d.pages} page${d.pages === 1 ? "" : "s"}`);
  parts.push(`${kb(d.bytes)} as Markdown (~${Math.ceil(estimateTokens(d.bytes) / 1000)}k tokens)`);
  return parts.join(" · ");
}
/** Drop/paste: the document files, as OS paths (preload's getPathForFile). Images go through filesToAttachments. */
export function filesToDocumentPaths(files: ArrayLike<File>, pathOf: (f: File) => string): string[] {
  return Array.from(files).filter((f) => isDocumentPath(f.name)).map(pathOf);
}
```
Import `documentFamily`, `isDocumentPath` from the pure module.

- [ ] **Step 3: `ChatView.tsx`**

State: `const [documents, setDocuments] = useState<DocumentAttachment[]>([]);` cleared on session switch (~504) and after send (~675). `const [documentsOn, setDocumentsOn] = useState(true); const [documentsAvailable, setDocumentsAvailable] = useState(true);` fetched once on mount:
```ts
useEffect(() => {
  void window.hv.builtinsGet().then((b) => setDocumentsOn(b.document));
  void window.hv.documentsAvailable().then(setDocumentsAvailable);
}, []);
```

Replace the dead row (~1275-1283) with:
```tsx
                  <button
                    type="button"
                    disabled={!documentsOn || !documentsAvailable}
                    onClick={attachDocument}
                    title={!documentsAvailable ? "Document conversion is not available on this platform" : documentsOn ? `Attach a ${DOCUMENT_FAMILY_LIST} file — converted on this machine` : "Turn Documents on in Built-in tools to attach one"}
                    className="w-full text-left px-3 py-2 enabled:hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40"
                  >
                    Attach document
                    <span className="block text-[10px] font-medium text-ink-soft">
                      {!documentsAvailable ? "not available on this platform" : documentsOn ? DOCUMENT_FAMILY_LIST : "off in Built-in tools"}
                    </span>
                  </button>
```
`attachDocument`:
```ts
  const attachDocument = async (): Promise<void> => {
    setAttachMenuOpen(false);
    const d = await window.hv.pickDocument(sessionId);
    if (d) setDocuments((p) => [...p, d]);
  };
```
(`sessionId` — use whatever the component calls the current session id.)

Drop (~1138) and paste (~1466): after `addFiles`, also
```ts
          const docPaths = documentsOn ? filesToDocumentPaths(ev.dataTransfer.files, (f) => window.hv.getPathForFile(f)) : [];
          if (docPaths.length) void attachDocumentPaths(docPaths);
```
where `attachDocumentPaths` converts each through a new IPC or — simpler and sufficient — creates a provisional chip `{ path, name, format, lines: 0, bytes: 0 }` and lets main convert at send. **Decide for the simple route only if the chip still shows cost:** it does not, so add `hv:describe-document(absPath, sessionId)` to Task 5's IPC trio (same body as `hv:pick-document` minus the dialog) and call it here. Update Task 5's preload/hv.d.ts accordingly (`describeDocument(absPath, sessionId?)`).

Shelf (~1188): render document chips beside the image chips:
```tsx
            {documents.map((d, i) => (
              <span key={d.path} className={`flex items-center gap-1.5 rounded-xl border-2 border-line-strong bg-card px-2 py-1 shadow-sticker text-xs font-semibold ${d.error ? "text-berry" : ""}`} title={d.path}>
                <span className="max-w-96 truncate">{documentChipLabel(d)}</span>
                <button type="button" aria-label={`Remove ${d.name}`} onClick={() => setDocuments((p) => p.filter((_, j) => j !== i))} className="text-ink-soft hover:text-berry font-bold text-sm leading-none cursor-pointer">×</button>
              </span>
            ))}
```

Send (~640): allow sending with documents and no text (`if (!input.trim() && !(pageRefs?.length ?? 0) && !documents.length) return;`), pass `documents.map((d) => d.path)` as the 5th `onSend` arg; `onSend`'s type gains `documents?: string[]`.

`App.tsx`: the `onSend` handler threads `documents` to both `promptSession` calls as the 7th argument.

- [ ] **Step 4: Run**

```bash
L=/tmp/vitest.log; npx vitest run tests/composer-documents.test.ts tests/tabs.test.ts > $L 2>&1; echo "EXIT=$?"; tail -12 $L
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/composer.ts src/renderer/src/components/ChatView.tsx src/renderer/src/App.tsx src/main/ipc.ts src/preload/index.ts src/renderer/src/hv.d.ts tests/composer-documents.test.ts
git commit -m "feat(composer): Attach document — converted at pick, cost on the chip before send, drop attaches too

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Transcript and tool card — restore chips, the label, the path chip

**Files:**
- Modify: `src/renderer/src/components/Transcript.tsx` (`UserBubble` ~310-345)
- Modify: `src/renderer/src/toolLabel.ts` (~265, beside `browser_get_text`)
- Modify: `src/renderer/src/tabs.ts:530` (`resolveCardPath`)
- Modify: `src/renderer/src/components/ToolCard.tsx` (`PathActions` ~415; facts line under the label from `details.factsLine`)
- Test: `tests/tabs.test.ts`, the toolLabel test file (`grep -l toolLabel tests/*.ts`)

**Interfaces:**
- Consumes: `parseDocumentChips` (Task 6), `isDocumentPath`, `documentFamily`, `window.hv.revealDocument`.
- Produces: `toolLabel("document_read", args)` → `{ icon: "eye", label: intent ?? "Reading <basename>", path }`; `resolveCardPath(ws, "<anything>.docx")` → `null`.

- [ ] **Step 1: Failing tests**

```ts
// tests/tabs.test.ts — add
it("§31: a document path is never an editor path (the chip reveals, never opens)", () => {
  expect(resolveCardPath("/ws", "/ws/spec.docx")).toBeNull();
  expect(resolveCardPath("/ws", "notes/deck.PPTX")).toBeNull();
  expect(resolveCardPath("/ws", "notes/readme.md")).toBe("notes/readme.md");
});
// toolLabel test file — add
it("§31: document_read labels from intent, falls back to the file name", () => {
  expect(toolLabel("document_read", { path: "/x/report.docx", intent: "Looking for the pricing table" }).label).toBe("Looking for the pricing table");
  const l = toolLabel("document_read", { path: "/x/report.docx" });
  expect(l.label).toBe("Reading report.docx");
  expect(l.icon).toBe("eye");
  expect(l.path).toBe("/x/report.docx");
});
```
Run: FAIL.

- [ ] **Step 2: Implement**

`tabs.ts:538` — after the URL guard: `if (isDocumentPath(raw)) return null; // §31: a .docx in CodeMirror is garbage; the card reveals it instead`.

`toolLabel.ts` — beside `browser_get_text`:
```ts
    case "document_read": {
      const p = str("path");
      return { icon: "eye", label: intent ?? (p ? `Reading ${basename(p)}` : "Reading a document"), path: p ?? undefined };
    }
```

`ToolCard.tsx` `PathActions`: when `!rel` and `isDocumentPath(raw)` and `raw` is absolute, render the raw path with ONE hover action, the existing Reveal-in-Finder SVG, calling `window.hv.revealDocument(raw)`; otherwise keep the inert span. Under the label, when `card.details?.factsLine` is a string, render it as the card's facts line in the same muted style the browser card uses for its URL (`text-[11px] text-ink-soft`).

`Transcript.tsx` `UserBubble`: `const docChips = parseDocumentChips("text" in it ? it.text : "");` and, above the text, beside the image row:
```tsx
        {docChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {docChips.map((d) => (
              <span key={d.path} className="rounded-md bg-paper/25 px-1.5 py-0.5 text-xs font-semibold" title={d.path}>
                {basename(d.path)} · {documentFamily(d.format)}{d.pages ? ` · ${d.pages} pages` : ""}
              </span>
            ))}
          </div>
        )}
```
This runs on the raw text BEFORE `stripInjectedBlocks`, live and restored alike — one code path, which is the point.

- [ ] **Step 3: Run**

```bash
L=/tmp/vitest.log; npx vitest run tests/tabs.test.ts tests/tool-label.test.ts tests/modal-layer.test.ts > $L 2>&1; echo "EXIT=$?"; tail -12 $L
```
(Substitute the real toolLabel test filename.) Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Transcript.tsx src/renderer/src/toolLabel.ts src/renderer/src/tabs.ts src/renderer/src/components/ToolCard.tsx tests/
git commit -m "feat(transcript): document chips on the bubble, a Read-document card with facts, and a path chip that reveals instead of opening

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Settings — the `Documents — 1 tool` row

**Files:**
- Modify: `src/renderer/src/components/BuiltinToolsBlock.tsx` (`Builtins` interface ~15; a `DocumentsRow` after `BrowserRow`; mount after `<BrowserRow …/>`)
- Test: `tests/sidebar-groups.test.ts` (unchanged count — run it), plus a source scan in `tests/hv-document.test.ts`

**Interfaces:**
- Consumes: `window.hv.builtinsSet({ document })`, `DOCUMENT_FAMILY_LIST`, `RESPAWN_NOTE`.

- [ ] **Step 1: Failing source-scan test** (append to `tests/hv-document.test.ts`)

```ts
import fs from "node:fs";
it("the settings row exists, says Documents — 1 tool, and derives its family list", () => {
  const src = fs.readFileSync("src/renderer/src/components/BuiltinToolsBlock.tsx", "utf8");
  expect(src).toContain("Documents — 1 tool");
  expect(src).not.toContain("Agent documents");
  expect(src).toContain("DOCUMENT_FAMILY_LIST");
  expect(src).toContain("builtinsSet({ document: on })");
});
```
Run: FAIL.

- [ ] **Step 2: Implement**

`Builtins` gains `/** §31: the Documents entry — document_read plus the read hint. */ document: boolean;`.

```tsx
/**
 * §31 — ONE entry for one tool, and the row is "Documents", not "Agent documents":
 * the `Agent …` prefix on the two rows above exists to dodge a nav collision
 * (Terminal is a page), and there is no Documents page to collide with.
 * Off unregisters document_read at the next spawn, disables the composer's
 * Attach document row (with the reason), and stops the `read` hint.
 */
function DocumentsRow({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): React.JSX.Element {
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">Documents — 1 tool</span>
        <span className="text-xs text-ink-soft">
          Lets the agent read {DOCUMENT_FAMILY_LIST} files as Markdown, converted on this machine — nothing is sent
          anywhere. Also enables <span className="font-semibold">Attach document</span> in the composer. Scanned PDF
          pages cannot be read; the agent is told which ones. Saves the context cost of one tool schema.
        </span>
        <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>
      </div>
      <TogglePill on={on} onClick={() => onChange(!on)} />
    </div>
  );
}
```
Mount after `<BrowserRow …/>` with the same `builtinsSet({ document: on })` / `patch({ document: on })` / error pattern the browser row uses.

- [ ] **Step 3: Run**

```bash
L=/tmp/vitest.log; npx vitest run tests/hv-document.test.ts tests/sidebar-groups.test.ts > $L 2>&1; echo "EXIT=$?"; tail -10 $L
```
Expected: PASS, and the nav count stays 17.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/BuiltinToolsBlock.tsx tests/hv-document.test.ts
git commit -m "feat(settings): Built-in tools gains Documents — 1 tool

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The live bridge test

**Files:**
- Create: `tests/document-bridge.test.ts`

**Interfaces:**
- Consumes: `KEY, MODEL, PROVIDER_ENV` from `./liveModel`; `askUntil` from `./reask`; the `hv.document-read` envelope (Task 4); a fake main answering it the way `ipc.ts` does (Task 5's reply shape).

- [ ] **Step 1: Write it**, modelled line for line on `tests/browser-bridge.test.ts` (`start()` harness, `skipIf(!KEY)`, `askUntil`):

```ts
import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";

let client: PiClient;
afterEach(() => client?.stop());

/** One Pi with the bridge, and a fake main answering hv.document-read with a fixed slice. */
function start(): { requests: Record<string, unknown>[]; starts: Array<{ tool: string; args: Record<string, unknown> }> } {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-doc-"));
  fs.copyFileSync(path.join(process.cwd(), "tests/fixtures/documents/sample.docx"), path.join(tmp, "report.docx"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: { ...process.env, ...PROVIDER_ENV } as Record<string, string>,
    cwd: tmp,
  });
  const h = { requests: [] as Record<string, unknown>[], starts: [] as Array<{ tool: string; args: Record<string, unknown> }> };
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string };
    if (r.method !== "input") return;
    let t: Record<string, unknown> | null = null;
    try { t = JSON.parse(r.title ?? "") as Record<string, unknown>; } catch { return; }
    if (t?.kind !== "hv.document-read") return;
    h.requests.push(t);
    client.respondUi(r.id, { value: JSON.stringify({
      ok: true, name: "report.docx", path: String(t.path), text: "# Q3 report\n\nRevenue grew 12%.",
      facts: { format: "docx", pages: 1, totalLines: 3, totalBytes: 34, from: 1, to: 3 },
    }) });
  });
  client.on("event", (e) => {
    const ev = e as { type?: string; toolName?: string; args?: Record<string, unknown> };
    if (ev.type === "tool_execution_start" && ev.toolName) h.starts.push({ tool: ev.toolName, args: ev.args ?? {} });
  });
  return h;
}

test.skipIf(!KEY)("§31: the model calls document_read on a .docx, carries intent, and gets the facts header back", async () => {
  const h = start();
  client.start();
  await askUntil(client, "Use the document_read tool to read ./report.docx and tell me the revenue growth figure.",
    () => h.requests.length > 0, { tries: 4 });
  expect(h.requests[0].path).toMatch(/report\.docx$/);
  const call = h.starts.find((s) => s.tool === "document_read");
  expect(call?.args.intent, "intent is required (decision F)").toBeTruthy();
}, 120_000);

test.skipIf(!KEY)("§31: a `read` on the .docx is refused with the document_read hint", async () => {
  const h = start();
  client.start();
  const audits: Array<{ source?: string; decision?: string }> = [];
  client.on("ui-request", (m) => {
    const r = m as { method?: string; message?: string };
    if (r.method !== "notify") return;
    try { const p = JSON.parse(r.message ?? ""); if (p.kind === "hv.audit") audits.push(p); } catch { /* */ }
  });
  await askUntil(client, "Use the plain `read` tool (not document_read) on ./report.docx.",
    () => audits.some((a) => a.source === "document"), { tries: 4 });
  expect(audits.some((a) => a.source === "document" && a.decision === "deny")).toBe(true);
  expect(h.requests.length).toBeGreaterThanOrEqual(0);
}, 120_000);
```
Read `tests/reask.ts` for `askUntil`'s real signature and match it (the `{ tries }` shape above is illustrative). Check how `PiClient` exposes events (`client.on("event", …)` vs a typed name) in `browser-bridge.test.ts` and copy that.

- [ ] **Step 2: Run it alone, with the key linked**

```bash
ln -sf ~/Documents/Github/HappyVibe/.env .env; git check-ignore -v .env
L=/tmp/vitest.log; npx vitest run tests/document-bridge.test.ts > $L 2>&1; echo "EXIT=$?"; tail -20 $L
```
Expected: PASS in ~30-90 s. If it says `skipped`, the key did not load. If the model never calls the tool, re-ask (that is what `askUntil` is for) — do not raise the timeout.

- [ ] **Step 3: Commit**

```bash
git add tests/document-bridge.test.ts
git commit -m "test(documents): live bridge test — the model reads a .docx through document_read with intent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Docs — CLAUDE.md pin entry, d1.md wire shape, PRD cross-check

**Files:**
- Modify: `CLAUDE.md` (one bullet in §Tests beside the typebox/yaml pin entries), `docs/validation/d1.md` (one subsection)

- [ ] **Step 1: CLAUDE.md** — add after the `yaml` pin bullet:

```
- **`@firecrawl/anydoc` is the fifth runtime pin (§31), exact in `pi-runtime/package.json`, gated by
  `tests/anydoc-contract.test.ts` over `tests/fixtures/documents/`.** It runs ONLY in
  `pi-runtime/bin/anydoc-bridge.mjs` (a one-shot sidecar via `nodeExecPath()`), never in main and
  never in the Pi child — #155 keeps a workbook's RSS in the caller. The pin was chosen by the mixed-PDF
  fixture, not by "latest" (#144/#162: one image page rejects the whole file in some versions); a bump
  must keep that test green. CSV is deliberately NOT a document (decision K). Measurements:
  docs/validation/ad1.md.
```

- [ ] **Step 2: d1.md** — add a subsection `## §31 hv.document-read` recording: the envelope (`title` JSON `{kind, path, offset?, limit?}`), the reply `{ok, text, name, path, facts}` / `{ok:false, text}`, the audit row `document.read {path, format, bytes, shown, ok, code}`, and the block header `<document path format pages?>`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/validation/d1.md
git commit -m "docs: anydoc pin entry and the hv.document-read wire shape

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Gate, live batch, GUI pass

- [ ] **Step 1: Full gate**

```bash
L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -30 $L
```
Expected: build green (all three typechecks), non-live suite green, `tests/anydoc-contract.test.ts` and friends included. If `typecheck:web` fails on the renderer importing `hv-document.ts`, copy the specifier form the renderer already uses for `hv-rules` (`grep -rn "hv-rules" src/renderer/src | head -3`).

- [ ] **Step 2: Live batch — `live:why` WILL print (extensions + pi-runtime/package.json + a live test changed)**

```bash
npm run live:why
L=/tmp/live.log; npm run test:live > $L 2>&1; echo "EXIT=$?"; grep -E "Duration|Test Files|Tests " $L
```
Run it in the background (`run_in_background: true`) and do not touch `src/` or `pi-runtime/` while it runs. Expected: ~6 min, green. A 5 s green run means the key did not load. One red live file ⇒ rerun that file alone before calling it a regression, and check the account has balance first.

- [ ] **Step 3: GUI pass — `npm run dev`, then observe every claim below; each names the page it is seen on**

Composer (ChatView):
- `+` menu: the row reads **Attach document** with subtext exactly `Word, PowerPoint, Excel, PDF, OpenDocument, RTF, EPUB`. **Absence:** the word `CSV` and the phrase `coming soon` appear nowhere in the menu.
- Pick `tests/fixtures/documents/sample.docx` → a chip appears **before send** reading `sample.docx · Word · … KB as Markdown (~Nk tokens)` (pages present only if Task 0 found a route).
- Pick `mixed.pdf` → the chip is red and reads the scanned-pages sentence; with a model that has no vision selected, the chip's sentence includes `no vision`.
- Drop `sample.pptx` from Finder onto the composer → a chip appears, same shape. Drop a `.png` → an image thumbnail chip, unchanged. Drop a `.csv` → **nothing** attaches (absence).
- Send with a chip and no text → the message goes.

Transcript (Transcript / restore):
- The sent bubble shows a small chip `sample.docx · Word` and the typed text. **Absence:** no `<document` markup, no Markdown dump, in the bubble. Close and reopen the session → same bubble, same chip, same absence.
- Ask *"what does the attached document say?"* → the agent answers from the content without calling any tool (the block was inline).
- Ask *"use document_read to read ./tests/fixtures/documents/sample.docx"* → a card titled by the model's intent sentence, a facts line `Word · … lines · … KB · showing 1–…`, the Markdown in the expanded body. Hover the path → the only action is **Reveal in Finder**; **absence:** no *Open in editor*. Clicking Reveal selects the file in Finder.
- Ask *"use the plain read tool on ./tests/fixtures/documents/sample.docx"* → a denied card whose reason names `document_read`; the Audit log (Audit page) shows a `deny` row with source `document`.

Plan mode (chat, plan pill on):
- `document_read` on the fixture runs with **no permission modal** (the floor-ask regression).

Built-in tools page (Settings › Abilities › Built-in tools):
- A row **Documents — 1 tool** sits under *Agent browser — 10 tools*, with the respawn note. **Absence:** no row reads *Agent documents*.
- Switch it off → the Agent tools page (Settings › Rules › Agent tools) no longer lists `document_read` after the respawn; back in the chat, `+` shows *Attach document* **disabled** with subtext `off in Built-in tools`; the composer's existing chips (if any) still send and the block still injects; asking the model to `document_read` the tail makes it say the tool is unavailable; a `read` on the `.docx` is refused with the *off in Built-in tools* wording.
- Switch it back on → the row on Agent tools returns; the `+` row re-enables.

Changelog page (Settings › Record › Changelog):
- The header pins line ends with `· anydoc <version>` and the version equals `pi-runtime/package.json`'s.

Regression sequence: attach `sample.docx`, then in another tab switch Documents **off**, return, send → the bubble still shows the chip and the agent still answers from the content (the switch governs the tool, not a chip already on screen). Then open `+` → the row is disabled with the reason.

- [ ] **Step 4: Record the pass**

Append the observed results (with anything that differed) to `docs/validation/ad1.md` under `## GUI pass (2026-09-xx)`. Commit:

```bash
git add docs/validation/ad1.md
git commit -m "docs(validation): ad1 GUI pass for §31

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Then stop for `/land`.

---

## Self-review against the spec

- **Spec coverage:** decision A (Task 2, 3) · B (Task 5, 6, 7, 8) · C+H (Task 1 sentence, Task 3 blocks, Task 5 vision) · D (Task 1 gates, Task 12 plan-mode assertion) · E (Task 3 caps) · F (Task 4 schema, Task 10 asserts intent) · G (no banner anywhere — nothing to build; Task 12's card shows raw Markdown, and the contract test's "no ocr/FIRECRAWL" scan is the privacy half) · I (Task 6 partitions mentions) · J (Task 9) · K (Task 1 constant, Task 3 `notDocument`, Task 7 drop filter) · L (Task 0) · §30 pin line (Task 2 + contract assertion) · §6/§7/§13 folds already in the PRD · CLAUDE.md + d1 (Task 11).
- **Known open point for the executor:** the vision clause in the `hv:pick-document` chip uses the SESSION's model; a chip picked before a model is chosen defaults to `hasVision:false` — the honest default, same as `browser_screenshot`.
- **Type consistency:** `DocumentChip` (main) and `DocumentAttachment` (renderer) are the same shape by construction — the IPC returns the former, the renderer types it as the latter; keep the field names identical (`path, name, format, pages?, lines, bytes, error?`). `DocumentFacts` is the one facts shape across sidecar → main → bridge `details` → card.
- **Placeholders:** none — the two "find the real filename" instructions (`grep -l stripInjectedBlocks tests/*.ts`, `grep -l toolLabel tests/*.ts`) are lookups, not deferrals.
