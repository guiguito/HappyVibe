import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  convertDocument, buildDocumentBlocks, parseDocumentHeaders, probeDocuments, DOCUMENT_BLOCK_MARK,
} from "../src/main/documents";

const runtimeDir = path.join(process.cwd(), "pi-runtime");
const FIX = path.join(process.cwd(), "tests/fixtures/documents");
const opts = { runtimeDir, execPath: process.execPath };
const fix = (f: string): string => path.join(FIX, f);

describe("documents.ts (§31) — main's side of the sidecar", () => {
  it("probes true on this platform", async () => {
    expect(await probeDocuments(runtimeDir, process.execPath)).toBe(true);
  });

  it("converts a document into a slice carrying the read-contract facts", async () => {
    const r = await convertDocument(fix("sample.docx"), opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("sample.docx");
    expect(r.format).toBe("docx");
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.from).toBe(1);
    expect(r.totalLines).toBeGreaterThan(1);
  });

  it("refuses text and CSV BEFORE spawning — those are read's job (decision K)", async () => {
    for (const f of ["table.csv", "notes.txt"]) {
      const r = await convertDocument(fix(f), opts);
      expect(r.ok, f).toBe(false);
      if (r.ok) continue;
      // `notDocument`, not anydoc's `unsupported`: the sidecar is never spawned,
      // so this is our decision speaking, and the sentence says "use read".
      expect(r.error.code, f).toBe("notDocument");
    }
  });

  it("maps a missing file to io and a dead sidecar to crash, never to a hang", async () => {
    const missing = await convertDocument(fix("nope.docx"), opts);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("io");

    const crashed = await convertDocument(fix("sample.docx"), { ...opts, execPath: "/usr/bin/false" });
    expect(crashed.ok).toBe(false);
    if (!crashed.ok) expect(crashed.error.code).toBe("crash");
  });

  it("carries the scanned page list through to the error, for the sentence to name", async () => {
    const r = await convertDocument(fix("mixed.pdf"), opts);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("needsOcr");
    expect(r.error.pages).toEqual([2]);
    expect(r.error.pageCount).toBe(2);
  });

  it("slices with offset/limit like read", async () => {
    const full = await convertDocument(fix("sample.docx"), opts);
    if (!full.ok) throw new Error("fixture should convert");
    const lines = full.text.split("\n");
    const part = await convertDocument(fix("sample.docx"), { ...opts, offset: 2, limit: 2 });
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    expect(part.from).toBe(2);
    expect(part.to).toBe(3);
    expect(part.text).toBe(lines.slice(1, 3).join("\n"));
  });
});

describe("buildDocumentBlocks (§31) — what reaches the model and the chip", () => {
  it("builds one <document> block per document", async () => {
    const { blocks, warnings } = await buildDocumentBlocks([fix("sample.docx")], {
      ...opts,
      hasVision: true,
    });
    expect(blocks).toMatch(/^<document path="[^"]+sample\.docx" format="docx">\n/);
    expect(blocks).toMatch(/\n<\/document>$/);
    // No page count is claimed: none exists on a success (ad1.md §3.1).
    expect(blocks).not.toMatch(/pages="/);
    expect(warnings).toEqual([]);
    // The marker stripInjectedBlocks cuts on must be exactly what a prompt
    // carrying these blocks contains — that join is the whole contract.
    expect(blocks.startsWith("<document ")).toBe(true);
    expect(`the user's message\n\n${blocks}`).toContain(DOCUMENT_BLOCK_MARK);
  });

  it("a CSV warns but injects NO block — read's job, so the model is told nothing", async () => {
    const { blocks, warnings } = await buildDocumentBlocks([fix("table.csv")], {
      ...opts,
      hasVision: true,
    });
    expect(blocks).toBe("");
    expect(warnings.some((w) => w.includes("table.csv"))).toBe(true);
    // A warning becomes a transcript notice, so it is the USER's copy: it must
    // never tell them to call a tool.
    expect(warnings.join(" ")).not.toMatch(/`read`|document_read/);
    expect(warnings.join(" ")).toMatch(/can be opened in the editor/);
  });

  it("a scanned PDF still attaches, carrying its sentence, and the sentence knows about vision", async () => {
    const withV = await buildDocumentBlocks([fix("scanned.pdf")], { ...opts, hasVision: true });
    const noV = await buildDocumentBlocks([fix("scanned.pdf")], { ...opts, hasVision: false });
    // Decision H: attach the sentence rather than refusing, so the model's next
    // move is to ask the user — and don't send a text-only model after images.
    expect(withV.blocks).toMatch(/scanned images/);
    // The BLOCK is the model's copy: it is told to ask the user.
    expect(withV.blocks).toMatch(/Ask the user to attach screenshots/);
    expect(noV.blocks).toMatch(/no vision/);
    expect(withV.blocks).not.toMatch(/no vision/);
    // The WARNING is the user's copy, and must not tell them to ask themselves.
    expect(withV.warnings.join(" ")).toMatch(/Attach screenshots of those pages instead/);
    expect(withV.warnings.join(" ")).not.toMatch(/ask the user/i);
    expect(noV.warnings.join(" ")).toMatch(/cannot read images either/);
  });

  it("truncates at the shared cap and says where to continue from", async () => {
    const { blocks } = await buildDocumentBlocks([fix("sample.docx")], { ...opts, hasVision: true, cap: 400 });
    expect(blocks).toMatch(/\[truncated at \d+ chars — call document_read with offset=\d+ to continue\]\n<\/document>$/);
    const offset = Number(/offset=(\d+)/.exec(blocks)![1]);
    expect(offset).toBeGreaterThan(1);
  });

  it("shares the cap with the mention blocks already spent (decision E)", async () => {
    const roomy = await buildDocumentBlocks([fix("sample.docx")], { ...opts, hasVision: true });
    const starved = await buildDocumentBlocks([fix("sample.docx")], { ...opts, hasVision: true, used: 199_950 });
    expect(starved.blocks.length).toBeLessThan(roomy.blocks.length);
    expect(starved.blocks).toMatch(/truncated at/);
  });

  it("keeps several documents in the order they were given", async () => {
    const { blocks } = await buildDocumentBlocks([fix("sample.docx"), fix("sample.rtf")], {
      ...opts,
      hasVision: true,
    });
    expect(blocks.indexOf("sample.docx")).toBeLessThan(blocks.indexOf("sample.rtf"));
  });
});

describe("parseDocumentHeaders (§31) — rebuilding chips on restore", () => {
  it("reads the block headers back out", () => {
    const text =
      'hello\n\n<document path="/a/b.docx" format="docx">\n# x\n</document>\n\n' +
      '<document path="/c.pdf" format="pdf">\nz\n</document>';
    expect(parseDocumentHeaders(text)).toEqual([
      { path: "/a/b.docx", format: "docx" },
      { path: "/c.pdf", format: "pdf" },
    ]);
  });

  it("finds nothing in ordinary text, and is not fooled by the word in prose", () => {
    expect(parseDocumentHeaders("plain")).toEqual([]);
    expect(parseDocumentHeaders("I opened a <document> yesterday")).toEqual([]);
  });

  it("round-trips what buildDocumentBlocks emits", async () => {
    const { blocks } = await buildDocumentBlocks([fix("sample.docx")], { ...opts, hasVision: true });
    const parsed = parseDocumentHeaders(blocks);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toContain("sample.docx");
    expect(parsed[0].format).toBe("docx");
  });
});
