import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  DOCUMENT_TOOL, DOCUMENT_EXTENSIONS, DOCUMENT_FAMILIES, DOCUMENT_FAMILY_LIST, DOCUMENT_TOOL_DESCRIPTIONS,
  isDocumentPath, documentExtension, documentFamily, documentErrorSentence, documentReadRefusal, documentFactsLine,
} from "../pi-runtime/extensions/hv-document";
import { SAFE_TOOLS } from "../pi-runtime/extensions/hv-rules";
import { gatePlanCall } from "../pi-runtime/extensions/hv-plan";
import { parseBuiltins } from "../pi-runtime/extensions/hv-builtins";

describe("hv-document pure module (§31)", () => {
  it("names 20 extensions in 7 families, and CSV is not one of them (decision K)", () => {
    // 20, not the 13 the proposal claimed: that number came from its own
    // mis-count (its list is 21 entries with csv, not 14). Pinned as a canary —
    // the SET is what matters, and it is derived from DOCUMENT_FAMILIES.
    expect(DOCUMENT_EXTENSIONS).toHaveLength(20);
    expect(new Set(DOCUMENT_EXTENSIONS).size).toBe(20);
    expect([...DOCUMENT_EXTENSIONS]).toEqual(DOCUMENT_FAMILIES.flatMap((f) => [...f.ext]));
    expect(DOCUMENT_FAMILIES).toHaveLength(7);
    // CSV converts perfectly well upstream (measured, ad1.md) — the exclusion is
    // OURS: a CSV is a text file, `read` handles it, and a Markdown table costs
    // more tokens than the raw rows.
    expect(DOCUMENT_EXTENSIONS).not.toContain("csv");
    expect(DOCUMENT_EXTENSIONS).not.toContain("txt");
    expect(DOCUMENT_EXTENSIONS.every((e) => e === e.toLowerCase() && !e.startsWith("."))).toBe(true);
  });

  it("derives the family list the + row shows from the same constant (Principle 11)", () => {
    expect(DOCUMENT_FAMILY_LIST).toBe(DOCUMENT_FAMILIES.map((f) => f.label).join(", "));
    expect(DOCUMENT_FAMILY_LIST).not.toMatch(/CSV/);
    expect(DOCUMENT_TOOL_DESCRIPTIONS[DOCUMENT_TOOL]).toContain(DOCUMENT_FAMILY_LIST);
    // §19 round 18 pins the app's count of the word "AI" at one, and it is not here.
    expect(DOCUMENT_TOOL_DESCRIPTIONS[DOCUMENT_TOOL]).not.toMatch(/\bAI\b/);
  });

  it("recognises document paths case-insensitively and refuses text files", () => {
    expect(isDocumentPath("/Users/x/Downloads/Report.DOCX")).toBe(true);
    expect(isDocumentPath("deck.pptx")).toBe(true);
    expect(isDocumentPath("notes.txt")).toBe(false);
    expect(isDocumentPath("table.csv")).toBe(false);
    expect(isDocumentPath("archive.docx.zip")).toBe(false);
    expect(isDocumentPath("no-extension")).toBe(false);
    expect(isDocumentPath(".docx")).toBe(false); // a dotfile NAMED .docx is not a document
    expect(documentExtension("a/b.Xlsx")).toBe("xlsx");
    expect(documentExtension("noext")).toBeNull();
    expect(documentFamily("odp")).toBe("OpenDocument");
    // formatFromPath answers "xlsx" for a .xls (container variants share a parser,
    // measured in ad1.md), so the family lookup must accept what the sidecar reports.
    expect(documentFamily("xlsx")).toBe("Excel");
  });

  it("turns needsOcr into a sentence that names the pages, and knows about vision (decision H)", () => {
    const withVision = documentErrorSentence({ code: "needsOcr", pages: [1, 7], pageCount: 31 }, { hasVision: true });
    expect(withVision).toContain("31 pages");
    expect(withVision).toContain("pages 1, 7");
    expect(withVision).toMatch(/screenshots/);
    const noVision = documentErrorSentence({ code: "needsOcr", pages: [1], pageCount: 1 }, { hasVision: false });
    expect(noVision).toMatch(/no vision/);
    expect(noVision).toMatch(/text export/);
    expect(noVision).not.toMatch(/attach screenshots/i);
    // Every page scanned reads as "all of its pages", never "pages 1, 2".
    const all = documentErrorSentence({ code: "needsOcr", pages: [1, 2], pageCount: 2 }, { hasVision: true });
    expect(all).toMatch(/all of its pages/);
  });

  it("has a sentence for every error code it declares — a bare code must never reach the user", () => {
    const codes = ["unsupported", "needsOcr", "malformed", "encrypted", "resourceLimit",
      "missingPart", "io", "hosted", "timeout", "crash", "notDocument", "disabled", "unavailable"] as const;
    for (const code of codes) {
      const s = documentErrorSentence({ code }, { hasVision: true, name: "report.docx" });
      expect(s, code).toBeTruthy();
      expect(s, code).not.toMatch(/undefined/);
    }
    expect(documentErrorSentence({ code: "encrypted" }, { hasVision: true, name: "a.odt" })).toMatch(/Encrypted/);
    expect(documentErrorSentence({ code: "notDocument" }, { hasVision: true })).toMatch(/use `read`/);
    expect(documentErrorSentence({ code: "disabled" }, { hasVision: true })).toMatch(/Built-in tools/);
    expect(documentErrorSentence({ code: "unavailable" }, { hasVision: true })).toMatch(/not available on this platform/);
  });

  it("refuses `read` on a document path with the document_read hint, and only then", () => {
    expect(documentReadRefusal("read", { path: "spec.docx" }, true)).toMatch(/document_read/);
    expect(documentReadRefusal("read", { path: "spec.docx" }, false)).toMatch(/off in Built-in tools/);
    // read handles these fine — refusing them would take away a working tool.
    expect(documentReadRefusal("read", { path: "spec.csv" }, true)).toBeNull();
    expect(documentReadRefusal("read", { path: "notes.txt" }, true)).toBeNull();
    expect(documentReadRefusal("bash", { command: "cat spec.docx" }, true)).toBeNull();
    expect(documentReadRefusal("document_read", { path: "spec.docx" }, true)).toBeNull();
    expect(documentReadRefusal("read", {}, true)).toBeNull();
    expect(documentReadRefusal("read", { path: 42 as unknown as string }, true)).toBeNull();
  });

  it("formats the facts line, and never claims a page count (Task 0: none exists)", () => {
    expect(documentFactsLine({ format: "docx", totalLines: 1240, totalBytes: 90112, from: 1, to: 2000 }))
      .toBe("Word · 1 240 lines · 88 KB · showing 1–2000");
    expect(documentFactsLine({ format: "rtf", totalLines: 40, totalBytes: 512, from: 1, to: 40 }))
      .toBe("RTF · 40 lines · 512 B · showing 1–40");
    expect(documentFactsLine({ format: "pdf", totalLines: 1, totalBytes: 2_200_000, from: 1, to: 1 }))
      .toBe("PDF · 1 line · 2.1 MB · showing 1–1");
  });

  it("keeps the facts line free of a page count — the field does not exist to be set", () => {
    const line = documentFactsLine({ format: "pdf", totalLines: 9, totalBytes: 100, from: 1, to: 9 });
    expect(line).not.toMatch(/page/i);
    // and the module never promises one
    expect(fs.readFileSync("pi-runtime/extensions/hv-document.ts", "utf8"))
      .not.toMatch(/pages\?: number;\s*\n\s*totalLines/);
  });
});

describe("§31 gate placements — read's class (decision D)", () => {
  it("is safe-default: it never raises a permission prompt", () => {
    expect(SAFE_TOOLS.has(DOCUMENT_TOOL)).toBe(true);
  });

  it("passes the plan gate rather than floor-asking on every call", () => {
    expect(gatePlanCall(DOCUMENT_TOOL, { path: "x.docx" }).kind).toBe("pass");
  });

  it("is a fail-open HV_BUILTINS key", () => {
    expect(parseBuiltins(undefined).document).toBe(true);
    expect(parseBuiltins(JSON.stringify({ document: false })).document).toBe(false);
    expect(parseBuiltins(JSON.stringify({ document: "nonsense" })).document).toBe(true);
    expect(parseBuiltins("{not json").document).toBe(true);
  });
});
