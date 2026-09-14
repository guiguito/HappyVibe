#!/usr/bin/env node
// §31 Documents — the ONLY place @firecrawl/anydoc runs.
//
// Usage:  anydoc-bridge.mjs --probe
//         anydoc-bridge.mjs <absPath> [offsetLine] [limitLines]
//
// Prints exactly ONE JSON line on stdout and exits 0 for BOTH outcomes:
//   { ok: true,  format, totalLines, totalBytes, from, to, text, truncated }
//   { ok: false, code, message, pages?, pageCount? }
// A non-zero exit is reserved for a real crash; main maps that to `crash` with
// the tail of stderr, so a panic is a sentence rather than a hang.
//
// WHY A CHILD PROCESS, not a require() in main (PRD §31 decision A, measured in
// docs/validation/ad1.md): a 200k-row workbook takes the CONVERTING process to
// 848 MB RSS and produces 4.1 MB of Markdown. In Electron main that is
// permanent high-water for the session; in a one-shot child it is reclaimed at
// exit, and the parent stays flat. Upstream #155 is the same observation.
// It also cannot live inside the Pi child: the `+` attach path converts before
// any session exists.
//
// WHY `index.js` AND NOT THE PACKAGE NAME (privacy, §31): the package's `main`
// is `anydoc.js`, a JS wrapper that carries the hosted-OCR path and
// `https://api.firecrawl.dev` in its own source. `index.js` beside it is the
// napi-rs binding and exports the same full surface with NO network code at
// all. Importing the binding directly means the code that could send a
// document off this machine is never loaded into the process — a stronger
// claim than "we never pass the ocr option", and the one §31 makes.
// tests/anydoc-contract.test.ts pins this import, because a pin that renames
// the file would silently restore the wrapper.
//
// There is deliberately NO options pass-through. This file must never grow a
// way to ask for hosted conversion; the contract test scans its source.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, "..", "node_modules", "@firecrawl", "anydoc");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

let anydoc;
try {
  // pathToFileURL, not a bare path: on Windows the ESM loader refuses an absolute
  // path outright — "absolute paths must be valid file:// URLs. Received protocol
  // 'c:'" — and the catch below would have reported that as this platform having no
  // anydoc build at all, which is a different and wrong diagnosis.
  anydoc = await import(pathToFileURL(path.join(pkgDir, "index.js")).href);
} catch (e) {
  // Windows arm64 has no prebuilt (ad1.md §5). Answer, never throw: the row
  // and the `+` menu say "not available on this platform" off this reply.
  out({ ok: false, code: "unavailable", message: String((e && e.message) || e).slice(0, 300) });
  process.exit(0);
}

const [, , arg, offsetArg, limitArg] = process.argv;

if (arg === "--probe") {
  let version = null;
  try {
    const { readFileSync } = await import("node:fs");
    version = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
  } catch {
    /* informational only */
  }
  out({ ok: true, probe: true, version });
  process.exit(0);
}

if (!arg) {
  out({ ok: false, code: "io", message: "no path given" });
  process.exit(0);
}

// Pi's OWN truncation, imported from the vendored tree, so the slice contract
// is `read`'s by construction rather than by imitation (Principle 11).
const { truncateHead } = await import(
  pathToFileURL(
    path.join(here, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "tools", "truncate.js"),
  ).href,
);

let markdown;
try {
  markdown = await anydoc.toMarkdown(arg);
} catch (e) {
  // anydoc puts a ConvertErrorCode on `code`: unsupported · needsOcr ·
  // malformed · encrypted · resourceLimit · missingPart · io · hosted.
  // A missing file and a directory both arrive as `io` (measured, ad1.md §2).
  // needsOcr additionally carries pages[] and pageCount — the ONLY page count
  // this API ever gives, and what lets the sentence name the scanned pages.
  out({
    ok: false,
    code: typeof e?.code === "string" ? e.code : "malformed",
    message: String(e?.message ?? e).slice(0, 300),
    ...(Array.isArray(e?.pages) ? { pages: e.pages } : {}),
    ...(typeof e?.pageCount === "number" ? { pageCount: e.pageCount } : {}),
  });
  process.exit(0);
}

// Mirror dist/core/tools/read.js: `offset` is a 1-indexed line, `limit` a count
// of lines, and truncateHead applies its 2000-line / 50KB bound to the slice.
const lines = markdown.split("\n");
const totalLines = lines.length;
const totalBytes = Buffer.byteLength(markdown, "utf8");
const start = Math.min(Math.max(1, Number.parseInt(offsetArg ?? "1", 10) || 1), Math.max(1, totalLines));
const limit = limitArg !== undefined ? Math.max(1, Number.parseInt(limitArg, 10) || 1) : undefined;
const end = limit !== undefined ? Math.min(totalLines, start + limit - 1) : totalLines;
const sliced = lines.slice(start - 1, end).join("\n");
const t = truncateHead(sliced);
const shown = t.content === sliced ? end - start + 1 : t.content.split("\n").length;

out({
  ok: true,
  // formatFromPath returns the PARSER FAMILY as a plain lower-case string, so a
  // .xls reports "xlsx" (measured). documentFamily maps both to "Excel".
  format: (() => {
    try {
      return String(anydoc.formatFromPath(arg) ?? path.extname(arg).slice(1).toLowerCase());
    } catch {
      return path.extname(arg).slice(1).toLowerCase();
    }
  })(),
  totalLines,
  totalBytes,
  from: start,
  to: start + shown - 1,
  text: t.content,
  truncated: t.content !== sliced || end < totalLines,
});
