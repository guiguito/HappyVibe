/**
 * §31 Documents — PURE module, zero imports (the hv-rules.ts / hv-browser.ts contract).
 *
 * Shared by the bridge (tool registration + the `read` hint), by src/main (the
 * sidecar, the picker filter, the prompt blocks) and by the renderer (the `+`
 * row's subtext, the chips, the tool-card label). ONE constant for the extension
 * set, because the OS picker filter, the `+` subtext, the `read` refusal and the
 * tool description must never disagree about what a document is — the drift
 * Principle 11 exists to stop.
 */

/** The one tool. Not a family: §26/§28's "separate tools, no action enum" rule
 *  separates CAPABILITIES, and reading is one. */
export const DOCUMENT_TOOL = "document_read";

/**
 * Display order = the order the `+` row's subtext lists them.
 *
 * CSV is deliberately ABSENT though anydoc converts it perfectly well (measured,
 * docs/validation/ad1.md): a CSV is a text file, Pi's `read` already handles it,
 * a Markdown table costs more tokens than the raw rows, and admitting it would
 * contradict §31's own out-of-scope line on text files via `+`. PRD decision K.
 */
export const DOCUMENT_FAMILIES = [
  { label: "Word", ext: ["doc", "docx", "docm"] },
  { label: "PowerPoint", ext: ["ppt", "pps", "pot", "pptx", "pptm", "ppsx", "ppsm"] },
  { label: "Excel", ext: ["xls", "xlsx", "xlsm", "xlsb"] },
  { label: "PDF", ext: ["pdf"] },
  { label: "OpenDocument", ext: ["odt", "ods", "odp"] },
  { label: "RTF", ext: ["rtf"] },
  { label: "EPUB", ext: ["epub"] },
] as const satisfies ReadonlyArray<{ label: string; ext: readonly string[] }>;

/** All 20, lower-case, no leading dot. The picker filter and the `read` hint both read this. */
export const DOCUMENT_EXTENSIONS: readonly string[] = DOCUMENT_FAMILIES.flatMap((f) => [...f.ext]);

/** "Word, PowerPoint, Excel, PDF, OpenDocument, RTF, EPUB" — never re-typed anywhere. */
export const DOCUMENT_FAMILY_LIST = DOCUMENT_FAMILIES.map((f) => f.label).join(", ");

/** Lower-cased extension without the dot, or null. A leading-dot name (`.docx`)
 *  is a dotfile, not a document — hence `i <= 0` rather than `i < 0`. */
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

/**
 * The family label for a card or chip. Takes what the converter REPORTS, which
 * is the parser family rather than the file's own extension — a `.xls` comes
 * back as `xlsx` (measured, ad1.md), and "Excel" is the right word for both.
 */
export function documentFamily(ext: string): string {
  const e = ext.toLowerCase();
  return DOCUMENT_FAMILIES.find((f) => (f.ext as readonly string[]).includes(e))?.label ?? e.toUpperCase();
}

/** The All Tools page renders this read-only, so it lives here rather than
 *  inline in the bridge — "read-only" means nothing if the page renders a
 *  second copy that can drift from what the model is told. */
export const DOCUMENT_TOOL_DESCRIPTIONS: Record<string, string> = {
  [DOCUMENT_TOOL]:
    `Read a ${DOCUMENT_FAMILY_LIST} file as Markdown, converted locally on this machine. ` +
    "Same contract as read: output is truncated to 2000 lines or 50KB (whichever is hit first); use " +
    "offset/limit (1-indexed lines) to continue until you have what you need. Plain text and CSV files " +
    "are NOT documents — use read for those. Scanned (image-only) PDF pages cannot be read locally; the " +
    "result says which ones they are.",
};

/**
 * `code` on a failure. The first eight are anydoc's own `ConvertErrorCode`
 * verbatim (its index.d.ts); the last five are ours, for the failures that
 * happen around the converter rather than inside it.
 */
export type DocumentErrorCode =
  | "unsupported" | "needsOcr" | "malformed" | "encrypted" | "resourceLimit" | "missingPart" | "io" | "hosted"
  | "timeout" | "crash" | "notDocument" | "disabled" | "unavailable";

export interface DocumentError {
  code: DocumentErrorCode;
  message?: string;
  /** needsOcr only: 1-indexed pages that are images. */
  pages?: number[];
  /** needsOcr only: pages in the document. The ONLY page count the API ever
   *  gives us — there is none on a successful conversion (ad1.md §3.1). */
  pageCount?: number;
  /** crash only: the tail of the sidecar's stderr. */
  detail?: string;
}

/**
 * What went wrong, in words — the half that is the same whoever is reading.
 *
 * Split from the next-step deliberately: the model and the user need the same
 * DESCRIPTION and different INSTRUCTIONS. §31 decision C said the chip shows
 * "the same" sentence, which produced "Ask the user to attach screenshots" ON
 * the user's own screen. One description, two next-steps, is what that decision
 * actually wanted.
 */
function documentProblem(err: DocumentError, name: string): string {
  switch (err.code) {
    case "needsOcr": {
      const n = err.pageCount ?? err.pages?.length ?? 0;
      const listed = err.pages ?? [];
      const head = n ? `This PDF has ${n} page${n === 1 ? "" : "s"}; ` : "";
      // The noun has to agree as well as the verb: an earlier version produced
      // "page 2 is scanned images", which the app's own GUI pass caught.
      const clause = !listed.length || listed.length === n
        ? "all of its pages are scanned images"
        : listed.length === 1
          ? `page ${listed[0]} is a scanned image`
          : `pages ${listed.join(", ")} are scanned images`;
      return `${head}${clause} and could not be read locally.`;
    }
    case "encrypted":
      return `${name} is password-protected, so it cannot be opened.`;
    case "resourceLimit":
      return `${name} crosses the converter's built-in safety limits (decompression, nesting or node count) and was refused.`;
    case "malformed":
      return `${name} could not be parsed — there is no readable content in it.`;
    case "missingPart":
      return `${name} is missing an internal part it needs for any readable output.`;
    case "unsupported":
      return `${name} is not a document format this can convert.`;
    case "notDocument":
      return `${name} is not a document.`;
    case "disabled":
      return "The Documents tool is off in Built-in tools.";
    case "unavailable":
      return "Reading documents is not available on this platform.";
    case "timeout":
      return `Converting ${name} took longer than 30 seconds and was stopped.`;
    case "crash":
      return `Converting ${name} failed${err.detail ? `: ${err.detail}` : "."}`;
    case "io":
      return `${name} could not be read${err.message ? ` (${err.message})` : "."}`;
    case "hosted":
      return "Hosted conversion was needed and is not enabled.";
  }
}

/**
 * The sentence the MODEL gets on a failed or partial conversion.
 *
 * `hasVision` is load-bearing rather than decorative: telling a text-only
 * session to ask for screenshots sends it down a path that cannot work, which
 * is the one thing §20's "don't show what cannot work" forbids.
 */
export function documentErrorSentence(err: DocumentError, opts: { hasVision: boolean; name?: string }): string {
  const name = opts.name ?? "This document";
  const problem = documentProblem(err, name);
  switch (err.code) {
    case "needsOcr":
      return `${problem} ${
        opts.hasVision
          ? "Ask the user to attach screenshots of those pages."
          : "This model has no vision, so screenshots will not help either — ask the user for a text export."
      }`;
    case "notDocument":
      return `${problem} Use \`read\` for text and CSV files; documents are ${DOCUMENT_FAMILY_LIST}.`;
    case "disabled":
      return `${problem} It cannot be read in this session.`;
    case "hosted":
      return "Hosted conversion is not enabled — this app converts documents locally only.";
    default:
      return problem;
  }
}

/**
 * The same failure, addressed to the PERSON who just attached the file.
 *
 * Shown in full on the composer's notice line rather than inside a chip: the
 * chip truncates at a fixed width, so a red pill with an unreadable sentence in
 * it told the user only that something was wrong (reported 2026-09-04).
 */
export function documentErrorUserMessage(err: DocumentError, opts: { hasVision: boolean; name?: string }): string {
  const name = opts.name ?? "That file";
  const problem = documentProblem(err, name);
  switch (err.code) {
    case "needsOcr":
      return `${problem} ${
        opts.hasVision
          ? "Attach screenshots of those pages instead, or export the PDF as text."
          : "This model cannot read images either, so export the PDF as text and attach that."
      }`;
    case "encrypted":
      return `${problem} Remove the password, or export an unprotected copy.`;
    case "notDocument":
      return `${problem} ${DOCUMENT_FAMILY_LIST} files convert to Markdown here; text and CSV files can be opened in the editor instead.`;
    case "disabled":
      return `${problem} Turn it back on to attach documents.`;
    case "unavailable":
      return problem;
    case "hosted":
      return "This app converts documents locally only.";
    default:
      return problem;
  }
}

/**
 * §13 round 19's `read` hint. A `read` on a `.docx` hands the model zip bytes
 * and it burns a turn discovering that; point it at the right tool instead.
 *
 * Returns null for anything that is not our business — any other tool, and any
 * path `read` genuinely handles (`.csv`, `.txt`). NOT gated on the toggle: with
 * Documents off the refusal still saves the wasted turn, it just names a
 * different reason.
 */
export function documentReadRefusal(tool: string, input: Record<string, unknown>, enabled: boolean): string | null {
  if (tool !== "read") return null;
  const p = input.path;
  if (typeof p !== "string" || !isDocumentPath(p)) return null;
  return enabled
    ? `${p} is a binary document, not text — call ${DOCUMENT_TOOL} with the same path to read it as Markdown.`
    : `${p} is a binary document, and the Documents tool is off in Built-in tools, so it cannot be read in this session.`;
}

/**
 * The card's facts line.
 *
 * There is NO page count, and its absence is a measurement rather than an
 * omission: `toMarkdown` returns a bare string, `toDocument` is unsupported for
 * PDF, and `pageCount` exists only on the needsOcr rejection (ad1.md §3.1).
 * §9's rule is to label what is unmeasured, never to invent it.
 */
export interface DocumentFacts {
  format: string;
  totalLines: number;
  totalBytes: number;
  from: number;
  to: number;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Spaces, not commas, so a big line count reads as one number. A PLAIN
 *  space: an invisible U+2009 here cost a test failure and would cost a
 *  copy-paste bug later. */
const groupDigits = (n: number): string => n.toLocaleString("en-US").replace(/,/g, " ");

export function documentFactsLine(f: DocumentFacts): string {
  return [
    documentFamily(f.format),
    `${groupDigits(f.totalLines)} line${f.totalLines === 1 ? "" : "s"}`,
    fmtBytes(f.totalBytes),
    `showing ${f.from}–${f.to}`,
  ].join(" · ");
}
