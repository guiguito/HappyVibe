/**
 * PRD §33 — the memory store. Electron-free, dirs as parameters (the src/main/skills/ shape),
 * so vitest drives it directly.
 *
 * MAIN IS THE ONE WRITER. Agent saves arrive as blocking `hv.memory-*` envelopes and human
 * edits arrive over IPC; both land here, on one serialized queue, so a page edit and a tool
 * call cannot interleave and leave a torn index.
 *
 * THE INDEX IS GENERATED, never model-edited. Claude Code lets the model maintain MEMORY.md by
 * hand and then polices its size with reminders; regenerating it from the files' frontmatter
 * means it cannot drift, a forgotten memory leaves no dangling pointer, and its size is bounded
 * by construction (CAPS.perScope lines).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MEMORY_TYPES, parseMemoryFile, serializeMemoryFile, type MemoryDoc, type MemoryType } from "./frontmatter";
import { findSecret } from "./secretScan";

/** Bounded by construction, refused with a reason when exceeded. Claude-Code-derived starting
 *  points; the context panel makes the real cost visible, so they can move. */
export const CAPS = { body: 4096, description: 150, perScope: 100 } as const;

const INDEX = "MEMORY.md";

export function memoryRoot(agentDir: string): string {
  return path.join(agentDir, "memory");
}

export function workspaceMemoryDir(agentDir: string, key: string): string {
  return path.join(memoryRoot(agentDir), "workspaces", key);
}

/**
 * The per-workspace folder name.
 *
 * A repo keys by the PARENT OF ITS GIT COMMON DIR, so every worktree of one clone shares one
 * memory folder — which is what Claude Code does (measured: a session run inside a superset
 * worktree writes to the main checkout's memory dir). A folder that is not a repo keys by its
 * normalized path.
 *
 * Never the workspace id: removing and re-adding a workspace must find its memory again.
 * Two different CLONES of one repo do not share — each has its own common dir, recorded as the
 * limit. Moving a folder into or out of git changes its key, and the old folder then shows up
 * on the Memory page's housekeeping line rather than vanishing.
 */
export function workspaceMemoryKey(
  wsPath: string,
  gitCommonDir: string | null,
  plat: NodeJS.Platform = process.platform,
): string {
  const basis = gitCommonDir ? path.dirname(path.resolve(gitCommonDir)) : path.resolve(wsPath);
  const trimmed = basis.replace(/[\\/]+$/, "");
  // win32: the filesystem is case-insensitive and git answers forward slashes, so
  // `C:\ws` and `c:/ws` must hash to ONE memory folder. The slug below already
  // lower-cased; the key did not, which would have split a project's memory in two
  // depending on how the folder was opened (PRD §4, Windows round).
  const folded = plat === "win32" ? trimmed.replace(/\//g, "\\").toLowerCase() : trimmed;
  return crypto.createHash("sha256").update(folded).digest("hex").slice(0, 16);
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The model supplies a NAME, never a path — main derives the slug. That is what makes the
 * traversal question not arise: `../../etc/passwd` slugs to `etc-passwd` or to null, and
 * either way nothing leaves the scope dir.
 */
export function slugify(name: string): string | null {
  const s = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return SLUG.test(s) ? s : null;
}

export interface MemorySummary {
  slug: string;
  name: string;
  description: string;
  type: MemoryType;
  modified?: string;
  originSessionId?: string;
  bytes: number;
}

/**
 * Containment, belt and braces on top of slugify: realpath the directory and the file's parent
 * and demand they are the same. Equality rather than a bare `startsWith`, which would let
 * `/tmp/ws-evil` read as inside `/tmp/ws` (the hv-child-guard rule).
 */
function fileFor(dir: string, slug: string): string {
  const p = path.join(dir, `${slug}.md`);
  const realDir = fs.realpathSync(dir);
  const realParent = fs.realpathSync(path.dirname(p));
  if (realParent !== realDir) throw new Error("memory path escapes its scope");
  return path.join(realParent, path.basename(p));
}

export function listMemories(dir: string): MemorySummary[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // scope not created yet — an empty scope, not an error
  }
  const out: MemorySummary[] = [];
  for (const n of names) {
    if (!n.endsWith(".md") || n === INDEX) continue;
    const slug = n.slice(0, -3);
    if (!SLUG.test(slug)) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, n), "utf8");
    } catch {
      continue;
    }
    const doc = parseMemoryFile(text);
    if (!doc) continue; // a file without usable frontmatter is not a memory
    out.push({
      slug,
      name: doc.name,
      description: doc.description,
      type: doc.type,
      modified: doc.modified,
      originSessionId: doc.originSessionId,
      bytes: Buffer.byteLength(text),
    });
  }
  return out.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? "") || a.name.localeCompare(b.name));
}

export function readMemory(dir: string, slug: string): MemoryDoc | null {
  if (!SLUG.test(slug)) return null;
  try {
    return parseMemoryFile(fs.readFileSync(fileFor(dir, slug), "utf8"));
  } catch {
    return null;
  }
}

/** One `- slug — description` line per memory, grouped by type in MEMORY_TYPES order. This is
 *  what the model sees every turn; the bodies open on demand. */
export function regenerateIndex(dir: string): void {
  const all = listMemories(dir);
  const parts: string[] = [];
  for (const t of MEMORY_TYPES) {
    const rows = all.filter((m) => m.type === t).sort((a, b) => a.slug.localeCompare(b.slug));
    if (rows.length === 0) continue;
    parts.push(`## ${t}\n` + rows.map((m) => `- ${m.slug} — ${m.description}`).join("\n"));
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(path.join(dir, INDEX), parts.join("\n\n") + (parts.length ? "\n" : ""));
  } catch {
    /* a scope we cannot write is a scope with no index — fail soft, the tools report the error */
  }
}

export function indexText(dir: string): string {
  try {
    return fs.readFileSync(path.join(dir, INDEX), "utf8");
  } catch {
    return "";
  }
}

/** ≈chars/4, the app's convention everywhere Pi does not report real token weight. */
export function estimateTokens(dir: string): { count: number; tokens: number; items: { name: string; tokens: number }[] } {
  const items = listMemories(dir).map((m) => ({
    name: m.slug,
    tokens: Math.ceil(`- ${m.slug} — ${m.description}`.length / 4),
  }));
  return { count: items.length, tokens: items.reduce((a, b) => a + b.tokens, 0), items };
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ponytail: one global write queue, the plans.ts idiom. Fine at human + agent save rates;
// per-directory queues if it ever contends.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => T): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export type SaveResult = { ok: true; slug: string; replaced: boolean } | { ok: false; reason: string };

export interface SaveInput {
  name: string;
  description: string;
  type: string;
  content: string;
  /** The HappyVibe session that saved it. Omitted for a human edit or an import. */
  originSessionId?: string;
  now?: Date;
}

/**
 * Upsert by slug: the same name REPLACES. This is how "update the existing memory instead of
 * duplicating" is enforced rather than requested. The model sends the whole body — at 4 KB a
 * str_replace buys nothing.
 *
 * Order matters: validate → caps → secret scan → write → regenerate. Nothing reaches disk that
 * failed a check, and the index is never regenerated from a half-written scope.
 */
export function saveMemory(dir: string, input: SaveInput): Promise<SaveResult> {
  return serialize(() => {
    const slug = slugify(input.name ?? "");
    if (!slug) {
      return { ok: false as const, reason: `"${input.name}" cannot be a memory name — use letters, digits and spaces.` };
    }
    if (!(MEMORY_TYPES as readonly string[]).includes(input.type)) {
      return { ok: false as const, reason: `type must be one of ${MEMORY_TYPES.join(", ")}.` };
    }
    const description = (input.description ?? "").trim();
    if (!description) return { ok: false as const, reason: "description is required — one line the agent can scan every turn." };
    if (description.length > CAPS.description) {
      return { ok: false as const, reason: `description is ${description.length} characters; the limit is ${CAPS.description}.` };
    }
    const body = (input.content ?? "").trim();
    if (!body) return { ok: false as const, reason: "content is required." };
    const bytes = Buffer.byteLength(body);
    if (bytes > CAPS.body) {
      return { ok: false as const, reason: `content is ${bytes} bytes; the limit is 4 KB (${CAPS.body}). A memory is a durable fact, not a document.` };
    }
    const secret = findSecret(`${description}\n${body}`);
    if (secret) {
      return {
        ok: false as const,
        reason: `refused: that looks like it contains ${secret.label}. Memories are plain files on disk — keep secrets in .env or the keychain.`,
      };
    }
    let file: string;
    try {
      fs.mkdirSync(dir, { recursive: true });
      file = fileFor(dir, slug);
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message : String(e) };
    }
    const replaced = fs.existsSync(file);
    // The cap gates NEW memories only: an upsert at the cap is how the model consolidates,
    // and refusing it would leave a full scope with no way out but the human.
    if (!replaced && listMemories(dir).length >= CAPS.perScope) {
      return { ok: false as const, reason: `memory is full (${CAPS.perScope}). Forget or merge existing memories first.` };
    }
    const doc: MemoryDoc = {
      name: slug,
      description,
      type: input.type as MemoryType,
      body,
      modified: (input.now ?? new Date()).toISOString(),
    };
    if (input.originSessionId) doc.originSessionId = input.originSessionId;
    try {
      writeAtomic(file, serializeMemoryFile(doc));
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message : String(e) };
    }
    regenerateIndex(dir);
    return { ok: true as const, slug, replaced };
  });
}

export function forgetMemory(dir: string, slug: string): Promise<boolean> {
  return serialize(() => {
    if (!SLUG.test(slug)) return false;
    let file: string;
    try {
      file = fileFor(dir, slug);
    } catch {
      return false;
    }
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    regenerateIndex(dir);
    return true;
  });
}

/** Forget every memory in one scope. Returns how many went. */
export function forgetAll(dir: string): Promise<number> {
  return serialize(() => {
    const all = listMemories(dir);
    let n = 0;
    for (const m of all) {
      try {
        fs.rmSync(fileFor(dir, m.slug));
        n++;
      } catch {
        /* already gone */
      }
    }
    regenerateIndex(dir);
    return n;
  });
}
