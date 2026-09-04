/**
 * §9 × §31 — what the composer gets back when you rewind.
 *
 * Rewinding returns the message to the composer for edit and resend. On a LIVE
 * message that text is what the user typed, so handing it back raw looked
 * correct for as long as anyone tested it live.
 *
 * A RESTORED message is different: `restore.ts`'s stripInjectedContext removes
 * only `open-files` / `open-terminals` / `open-browser`, so a reopened
 * session's `<file>` and `<document>` blocks are still in `it.text`. Rewinding
 * there filled the composer with markup and, for a document, an entire
 * converted file. The bubble above it had been stripping for display all along,
 * which is exactly why the composer's copy went unnoticed.
 */
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import { parseDocumentChips, stripInjectedBlocks } from "../src/renderer/src/mentions";
import { stripInjectedContext } from "../src/main/restore";

/** What restore.ts actually hands the renderer as `it.text`. */
const asRestored = (stored: string): string => stripInjectedContext(stored).trim();

const chatView = (): string => fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");

describe("the rewound message that reaches the composer", () => {
  test("a restored document message still carries its block — this is the premise", () => {
    const stored =
      'summarise this\n\n<document path="/a/report.docx" format="docx">\n# Q3\nRevenue grew.\n</document>';
    // If this ever becomes false, restore started stripping documents — which
    // would also delete the bubble's chip (tests/restore.test.ts pins that).
    expect(asRestored(stored)).toContain('<document path=');
  });

  test("stripping gives back exactly what the user typed", () => {
    const stored =
      'summarise this\n\n<document path="/a/report.docx" format="docx">\n# Q3\nRevenue grew.\n</document>';
    expect(stripInjectedBlocks(asRestored(stored))).toBe("summarise this");
  });

  test("the same holds for an @file mention, which had the bug first", () => {
    const stored = 'check this\n\n<file path="src/a.ts">\nconst x = 1\n</file>';
    expect(asRestored(stored)).toContain("<file path=");
    expect(stripInjectedBlocks(asRestored(stored))).toBe("check this");
  });

  test("the documents are recoverable from the same text, so the attachment survives", () => {
    const stored =
      'compare them\n\n<document path="/a/one.docx" format="docx">\nx\n</document>\n\n' +
      '<document path="/b/two.pdf" format="pdf">\ny\n</document>';
    expect(stripInjectedBlocks(asRestored(stored))).toBe("compare them");
    expect(parseDocumentChips(asRestored(stored)).map((d) => d.path)).toEqual(["/a/one.docx", "/b/two.pdf"]);
  });

  test("a message with no blocks is returned untouched", () => {
    expect(stripInjectedBlocks(asRestored("just a question"))).toBe("just a question");
    expect(parseDocumentChips(asRestored("just a question"))).toEqual([]);
  });
});

describe("the rewind button does both halves", () => {
  const src = chatView();

  test("strips the blocks rather than pasting raw it.text", () => {
    expect(src).toMatch(/setInput\(stripInjectedBlocks\(raw\)\)/);
    // The raw form is what shipped and what this replaces.
    expect(src).not.toMatch(/setInput\("text" in it && typeof it\.text === "string" \? it\.text : ""\)/);
  });

  test("re-attaches the documents by path, through the ordinary attach flow", () => {
    // Going through attachDocumentPaths rather than rebuilding chips means a
    // file that has since moved reports that, instead of coming back as a chip
    // whose size is a lie.
    expect(src).toMatch(/parseDocumentChips\(raw\)[\s\S]{0,160}attachDocumentPaths\(docs\)/);
  });

  test("does neither for the files-only scope, which leaves the message in place", () => {
    expect(src).toMatch(/if \(rewindScope !== "files"\) \{/);
  });
});
