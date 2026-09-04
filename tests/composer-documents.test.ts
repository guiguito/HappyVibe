import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { documentChipLabel, estimateTokens, filesToDocumentPaths } from "../src/renderer/src/composer";
import { DOCUMENT_FAMILY_LIST, documentErrorSentence, documentErrorUserMessage } from "../pi-runtime/extensions/hv-document";

describe("§31 composer chips", () => {
  it("shows what the document costs in context, before send", () => {
    const label = documentChipLabel({
      path: "/x/report.docx", name: "report.docx", format: "docx", lines: 1240, bytes: 90112,
    });
    expect(label).toBe("report.docx · Word · 88 KB as Markdown (~23k tokens)");
    // The app's own chars→tokens rule, not a second one.
    expect(estimateTokens(90112)).toBe(22528);
  });

  it("never claims a page count — none exists on a success (ad1.md §3.1)", () => {
    const label = documentChipLabel({ path: "/x/a.pdf", name: "a.pdf", format: "pdf", lines: 40, bytes: 2048 });
    expect(label).not.toMatch(/page/i);
    expect(label).toBe("a.pdf · PDF · 2 KB as Markdown (~1k tokens)");
  });

  it("shows only the name while the conversion is still running", () => {
    // The spinner beside it carries "working", so the label must not invent a
    // size to fill the space.
    const label = documentChipLabel({ path: "/x/big.xlsx", name: "big.xlsx", format: "", lines: 0, bytes: 0, pending: true });
    expect(label).toBe("big.xlsx");
    expect(label).not.toMatch(/0 KB|tokens/);
  });

  it("uses the family the CONVERTER reports, so a .xls still reads as Excel", () => {
    // formatFromPath answers "xlsx" for a .xls (measured) — the chip must not
    // contradict the card, which reads the same field.
    expect(documentChipLabel({ path: "/x/old.xls", name: "old.xls", format: "xlsx", lines: 9, bytes: 1024 }))
      .toBe("old.xls · Excel · 1 KB as Markdown (~0k tokens)");
  });

  it("keeps document files from a drop and ignores everything else", () => {
    const files = [{ name: "a.docx" }, { name: "b.png" }, { name: "c.csv" }, { name: "d.txt" }, { name: "e.pptx" }] as unknown as File[];
    expect(filesToDocumentPaths(files, (f) => `/d/${f.name}`)).toEqual(["/d/a.docx", "/d/e.pptx"]);
    // A browser that hands back no path must not produce an empty attachment.
    expect(filesToDocumentPaths([{ name: "a.docx" }] as unknown as File[], () => "")).toEqual([]);
  });
});

/**
 * ChatView's CODE, comments stripped.
 *
 * Scanning the raw file would forbid the comment that records WHAT this row
 * replaced, which is the one place a future reader learns the history. The
 * claim under test is about what renders, so that is what gets scanned.
 */
function chatViewCode(): string {
  return fs
    .readFileSync("src/renderer/src/components/ChatView.tsx", "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

describe("§31 composer copy is derived, never re-typed (Principle 11)", () => {
  const src = chatViewCode();

  it("builds the + row's subtext from the one constant", () => {
    expect(src).toContain("DOCUMENT_FAMILY_LIST");
    // The literal must not appear — that is the copy that would drift.
    expect(src).not.toMatch(/Word, PowerPoint, Excel/);
  });

  it("has retired the dead 'Attach file — coming soon' row", () => {
    expect(src).not.toMatch(/coming soon/);
    expect(src).toContain("Attach document");
  });

  it("never offers CSV, on any surface (decision K)", () => {
    expect(DOCUMENT_FAMILY_LIST).not.toMatch(/CSV/);
    // and the row's own subtext is that constant, so neither does it
    expect(src).not.toMatch(/RTF, EPUB, CSV/);
  });

  it("disables the row WITH A REASON rather than hiding it", () => {
    // A disabled row with a reason is how the user learns the setting exists —
    // the house style 'Attach image — model has no vision' already set.
    expect(src).toContain("off in Built-in tools");
    expect(src).toContain("not available on this platform");
  });
});

describe("§31 the + row reads the toggle when it OPENS, not once at mount", () => {
  const src = chatViewCode();

  it("refreshes availability from the menu's own open handler", () => {
    // Caught in the GUI pass: ChatView stays mounted while the user walks to
    // Built-in tools and back, so a mount-only fetch left the row ENABLED after
    // the switch was turned off — inviting a click on a tool that no longer
    // existed. Fetching where the value is READ is correct and needs no state
    // pushed down from App.
    expect(src).toContain("refreshDocumentAvailability");
    // the open handler calls it, guarded so closing does not
    expect(src).toMatch(/setAttachMenuOpen\(\(o\) => \{[\s\S]{0,200}refreshDocumentAvailability\(\)/);
  });
});

describe("§31 the documents argument survives the whole IPC chain", () => {
  it("preload forwards it — a dropped argument typechecks perfectly and does nothing", () => {
    // This exact bug shipped for an hour: `documents` was declared in hv.d.ts,
    // accepted in main, and threaded through App — but preload still invoked
    // hv:prompt-session with six arguments, so the seventh was silently lost and
    // the block never injected. Nothing failed; the agent simply never saw the
    // document. Only the GUI pass caught it, so this is the cheap guard.
    const preload = fs.readFileSync("src/preload/index.ts", "utf8");
    const call = /ipcRenderer\.invoke\("hv:prompt-session"[^)]*\)/.exec(preload);
    expect(call, "hv:prompt-session invoke not found").toBeTruthy();
    expect(call![0]).toContain("documents");

    // And the parameter list that feeds it declares the same thing.
    expect(preload).toMatch(/documents\?: string\[\]/);
  });

  it("main accepts and validates it", () => {
    const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
    expect(ipc).toMatch(/documents\?: string\[\],/);
    expect(ipc).toContain("Invalid documents payload");
  });
});

describe("§31 a failed document is a message, not a red pill", () => {
  const src = chatViewCode();

  it("removes the chip and raises a readable notice instead", () => {
    // Reported 2026-09-04: a red chip truncates at a fixed width, so the
    // sentence telling the user what to do was unreadable — and there was
    // nothing to send anyway.
    expect(src).toContain("setDocumentErrors");
    expect(src).toMatch(/chip\?\.error[\s\S]{0,200}setDocuments\(\(p\) => p\.filter/);
    // …rendered on the composer's own notice line, beside "No model configured"
    expect(src).toMatch(/documentErrors\.map/);
    // …and no longer styled as an error chip
    expect(src).not.toMatch(/d\.error \? "text-berry"/);
  });

  it("shows a spinner in the chip while a document converts", () => {
    expect(src).toContain("animate-spin");
    expect(src).toMatch(/d\.pending && \(/);
  });

  it("puts a chip up before the conversion starts, keyed by path", () => {
    // Two documents can convert at once and they do not finish in order, so
    // each answer has to replace its OWN chip.
    expect(src).toMatch(/pending: true/);
    expect(src).toMatch(/d\.path === abs/);
  });
});

describe("§31 the error text is written for whoever is reading it", () => {
  it("tells the model to ask the user, and the user to do it themselves", () => {
    const err = { code: "needsOcr" as const, pages: [1, 7], pageCount: 31 };
    const toModel = documentErrorSentence(err, { hasVision: true, name: "report.pdf" });
    const toUser = documentErrorUserMessage(err, { hasVision: true, name: "report.pdf" });
    // Same description…
    for (const s of [toModel, toUser]) {
      expect(s).toContain("31 pages");
      expect(s).toContain("pages 1, 7 are scanned images");
    }
    // …different instruction. "Ask the user" on the user's own screen is the
    // bug this split exists to fix.
    expect(toModel).toMatch(/Ask the user to attach screenshots/);
    expect(toUser).not.toMatch(/ask the user/i);
    expect(toUser).toMatch(/Attach screenshots of those pages instead/);
  });

  it("never tells the user to call a tool", () => {
    for (const code of ["notDocument", "encrypted", "malformed", "unsupported", "timeout", "crash", "io", "resourceLimit", "missingPart", "hosted", "disabled", "unavailable"] as const) {
      const msg = documentErrorUserMessage({ code }, { hasVision: true, name: "a.docx" });
      expect(msg, code).toBeTruthy();
      expect(msg, code).not.toMatch(/`read`|document_read|Ask the user/);
      expect(msg, code).not.toMatch(/undefined/);
    }
  });

  it("gives the no-vision case a next step that can actually work", () => {
    const msg = documentErrorUserMessage({ code: "needsOcr", pages: [1], pageCount: 1 }, { hasVision: false, name: "scan.pdf" });
    expect(msg).toMatch(/cannot read images either/);
    expect(msg).toMatch(/export the PDF as text/);
  });
});
