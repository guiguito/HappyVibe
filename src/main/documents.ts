/**
 * §31 Documents — main's side of the converter.
 *
 * Electron-free on purpose (vitest imports it directly, like spawn.ts). It owns
 * three things and nothing else: running the sidecar, turning its wire into a
 * result or a SENTENCE, and assembling the `<document>` blocks a prompt carries.
 *
 * The sidecar shape follows mcpAdapterStore.ts: spawn, capture BOTH streams, a
 * deadline that SIGKILLs, an idempotent settle, and the last stdout line as the
 * reply. Its stderr is captured rather than ignored — a sidecar that dies
 * silently is how that file's every-spawn hang went undiagnosed.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { nodeExecPath } from "./pi/spawn";
import { MAX_FILE_BYTES, MENTION_CONTEXT_CAP } from "./files";
import {
  DOCUMENT_TOOL, documentErrorSentence, documentErrorUserMessage, documentExtension, isDocumentPath,
  type DocumentError,
} from "../../pi-runtime/extensions/hv-document";

export const ANYDOC_BRIDGE_RELPATH = "bin/anydoc-bridge.mjs";

/**
 * §31: how long one conversion may take before main answers anyway. Generous —
 * the slowest fixture is 6 ms and a 200k-row workbook is 781 ms (ad1.md §4) —
 * because the point is to make a wedged turn impossible, not to police slow
 * files. Same reasoning and same number as BROWSER_OP_TIMEOUT_MS.
 */
const CONVERT_TIMEOUT_MS = 30_000;

/** The marker `stripInjectedBlocks` cuts on. Exported so the two cannot drift. */
export const DOCUMENT_BLOCK_MARK = "\n\n<document ";

export interface DocumentSlice {
  ok: true;
  path: string;
  name: string;
  /** The PARSER family the converter reports (a .xls comes back "xlsx"). */
  format: string;
  totalLines: number;
  totalBytes: number;
  from: number;
  to: number;
  text: string;
  truncated: boolean;
}

export interface DocumentFailure {
  ok: false;
  path: string;
  name: string;
  error: DocumentError;
}

export type DocumentResult = DocumentSlice | DocumentFailure;

export interface ConvertOpts {
  runtimeDir: string;
  /** Tests pass process.execPath; the app lets nodeExecPath() choose the helper. */
  execPath?: string;
  offset?: number;
  limit?: number;
  timeoutMs?: number;
}

interface SidecarRun {
  reply: Record<string, unknown> | null;
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

function runSidecar(
  args: string[],
  o: { runtimeDir: string; execPath?: string; timeoutMs?: number },
): Promise<SidecarRun> {
  return new Promise((resolve) => {
    const child = spawn(o.execPath ?? nodeExecPath(), [path.join(o.runtimeDir, ANYDOC_BRIDGE_RELPATH), ...args], {
      cwd: o.runtimeDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let out = "";
    let err = "";
    let settled = false;
    let timedOut = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const line = out.trim().split("\n").pop() ?? "";
      let reply: Record<string, unknown> | null = null;
      try {
        reply = line ? (JSON.parse(line) as Record<string, unknown>) : null;
      } catch {
        reply = null; // a crash; the caller turns that into a sentence
      }
      resolve({ reply, code, stderr: err, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      // SIGKILL, not SIGTERM: a child inside a native parse loop does not
      // check signals, and a lingering one holds a file handle open.
      child.kill("SIGKILL");
      finish(null);
    }, o.timeoutMs ?? CONVERT_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

/**
 * Convert one document, or say why not.
 *
 * A non-document is refused HERE, before any spawn: `read` already handles text
 * and CSV, and the sentence says so (decision K). Everything else is the
 * sidecar's answer, mapped onto a result.
 */
export async function convertDocument(absPath: string, opts: ConvertOpts): Promise<DocumentResult> {
  const name = path.basename(absPath);
  if (!isDocumentPath(absPath)) {
    return { ok: false, path: absPath, name, error: { code: "notDocument" } };
  }
  const args = [absPath];
  if (opts.offset !== undefined || opts.limit !== undefined) args.push(String(opts.offset ?? 1));
  if (opts.limit !== undefined) args.push(String(opts.limit));

  const r = await runSidecar(args, opts);
  if (r.timedOut) return { ok: false, path: absPath, name, error: { code: "timeout" } };
  if (!r.reply) {
    const detail = r.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
    return {
      ok: false,
      path: absPath,
      name,
      error: { code: "crash", detail: detail || `the converter exited ${r.code} with no output` },
    };
  }
  if (r.reply.ok === true) {
    const s = r.reply as unknown as Omit<DocumentSlice, "ok" | "path" | "name">;
    return {
      ok: true,
      path: absPath,
      name,
      format: s.format,
      totalLines: s.totalLines,
      totalBytes: s.totalBytes,
      from: s.from,
      to: s.to,
      text: s.text,
      truncated: !!s.truncated,
    };
  }
  const e = r.reply as { code?: string; message?: string; pages?: number[]; pageCount?: number };
  return {
    ok: false,
    path: absPath,
    name,
    error: {
      code: (e.code as DocumentError["code"]) ?? "malformed",
      message: e.message,
      pages: e.pages,
      pageCount: e.pageCount,
    },
  };
}

let probed: Promise<boolean> | null = null;
/**
 * Once per process: does the addon load here?
 *
 * Drives "not available on this platform" on the settings row and the `+` menu,
 * so the user is told rather than finding out on first use ("don't show what
 * cannot work"). Dormant on macOS; load-bearing the day a Windows arm64 build
 * exists, which has no prebuilt (ad1.md §5).
 */
export function probeDocuments(runtimeDir: string, execPath?: string): Promise<boolean> {
  probed ??= runSidecar(["--probe"], { runtimeDir, execPath, timeoutMs: 15_000 }).then((r) => r.reply?.ok === true);
  return probed;
}

export interface DocumentBlocks {
  blocks: string;
  /**
   * What the USER is told, in their own voice — these become transcript
   * notices. The block above carries the model's version of the same failure;
   * one description, two next-steps (hv-document's documentProblem).
   */
  warnings: string[];
}

const header = (p: string, format: string): string =>
  `<document path="${p.replace(/"/g, "'")}" format="${format}">`;

/**
 * The `<document>` blocks for attached and mentioned documents.
 *
 * Caps are the `@file` caps and the budget is SHARED with the mention blocks
 * (`used`), per decision E: one large workbook can starve the mentions beside
 * it, which is accepted because the chip showed that cost before send.
 *
 * A failed conversion still yields a block carrying the sentence — the model
 * must know the document was there and why it is empty, or it invents a reason.
 * The one exception is a non-document: `read` handles those, so injecting a
 * block would be telling the model about a file it can simply open.
 */
export async function buildDocumentBlocks(
  absPaths: string[],
  opts: {
    runtimeDir: string;
    execPath?: string;
    hasVision: boolean;
    cap?: number;
    used?: number;
    maxItemBytes?: number;
  },
): Promise<DocumentBlocks> {
  const cap = opts.cap ?? MENTION_CONTEXT_CAP;
  const maxItem = opts.maxItemBytes ?? MAX_FILE_BYTES;
  let total = opts.used ?? 0;
  const parts: string[] = [];
  const warnings: string[] = [];

  for (const p of absPaths) {
    const r = await convertDocument(p, { runtimeDir: opts.runtimeDir, execPath: opts.execPath });
    const ext = documentExtension(p) ?? "";
    if (!r.ok) {
      // The BLOCK gets the model's sentence (it tells the model what to do next);
      // the WARNING gets the user's, because a warning becomes a transcript
      // notice that the person reads. Handing the model's copy to both is how
      // "Ask the user to attach screenshots" ended up on the user's own screen.
      const forModel = documentErrorSentence(r.error, { hasVision: opts.hasVision, name: r.name });
      warnings.push(documentErrorUserMessage(r.error, { hasVision: opts.hasVision, name: r.name }));
      if (r.error.code !== "notDocument") {
        const block = `${header(p, ext)}\n${forModel}\n</document>`;
        parts.push(block);
        total += block.length + 2;
      }
      continue;
    }

    let body = r.text;
    // Per-item ceiling first, then the shared budget — the same order @file uses.
    if (body.length > maxItem) body = body.slice(0, maxItem);
    const room = cap - total - header(p, r.format).length - "\n\n</document>".length;
    if (body.length > room) {
      const cut = Math.max(0, room);
      const shown = body.slice(0, cut);
      // The line the model should continue FROM: 1-indexed, so the number of
      // whole lines shown plus one.
      const nextLine = shown.split("\n").length;
      body = `${shown}\n[truncated at ${cut} chars — call ${DOCUMENT_TOOL} with offset=${nextLine} to continue]`;
    }
    const block = `${header(p, r.format)}\n${body}\n</document>`;
    parts.push(block);
    total += block.length + 2;
  }

  return { blocks: parts.join("\n\n"), warnings };
}

/**
 * Read the block headers back out.
 *
 * The restore path needs this because the user typed nothing: the chip on a
 * reopened session is rebuilt from the block the prompt carried. The renderer
 * has its own copy of this regex (mentions.ts) since it cannot import from
 * src/main; tests/documents.test.ts and the mentions test pin them together.
 */
export function parseDocumentHeaders(text: string): Array<{ path: string; format: string }> {
  const out: Array<{ path: string; format: string }> = [];
  const re = /^<document path="([^"]*)" format="([^"]*)">$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ path: m[1], format: m[2] });
  return out;
}
