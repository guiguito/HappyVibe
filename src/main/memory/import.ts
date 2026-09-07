/**
 * PRD §33 — import from Claude Code.
 *
 * COPY-IN, NEVER LINK. A linked directory would let another tool write into what our system
 * prompt injects every turn, which is the one thing memory must not allow.
 *
 * The three on-disk frontmatter variants all read (frontmatter.ts); the copy re-serialises to
 * our shape, drops the foreign `originSessionId` (it names a Claude Code session, not one of
 * ours) and gets a fresh `modified`. Collisions are SKIPPED AND NAMED, never overwritten — the
 * plugin catalog's rule, for the same reason: an import that silently replaced a memory the
 * user had edited would be indistinguishable from data loss.
 */
import fs from "node:fs";
import path from "node:path";
import { parseMemoryFile } from "./frontmatter";
import { listMemories, saveMemory, slugify } from "./store";

export interface ClaudeMemoryFile {
  file: string;
  slug: string;
  name: string;
  description: string;
  type: string;
}

export interface ClaudeMemoryProject {
  /** Claude Code's own project folder name — a path-derived slug. */
  key: string;
  dir: string;
  /** The workspace path that key most likely came from, used only to pre-select a destination. */
  guessedPath: string;
  memories: ClaudeMemoryFile[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * Claude Code names a project folder by replacing every path separator with `-`, so
 * `/Users/me/Documents/Github/Foo` becomes `-Users-me-Documents-Github-Foo`.
 *
 * That mapping is LOSSY — a real directory containing a hyphen is indistinguishable from a
 * separator — which is exactly why the result is called a GUESS and is used only to pre-select
 * a destination the user can change. Nothing is written on the strength of it.
 */
export function guessPathFromKey(key: string): string {
  return key.startsWith("-") ? key.replace(/-/g, "/") : key;
}

export function scanClaudeCodeMemory(home: string): { projects: ClaudeMemoryProject[] } {
  const root = path.join(home, ".claude", "projects");
  let keys: string[];
  try {
    keys = fs.readdirSync(root);
  } catch {
    return { projects: [] }; // Claude Code not installed here — an empty list, not an error
  }
  const projects: ClaudeMemoryProject[] = [];
  for (const key of keys.sort()) {
    const dir = path.join(root, key, "memory");
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // that project has no memory folder
    }
    const memories: ClaudeMemoryFile[] = [];
    const skipped: Array<{ file: string; reason: string }> = [];
    for (const n of names.sort()) {
      // MEMORY.md is Claude Code's own generated index. Ours is regenerated from the files, so
      // copying theirs would be importing a second, immediately-stale copy of the same thing.
      if (n === "MEMORY.md" || !n.endsWith(".md")) continue;
      let text: string;
      try {
        text = fs.readFileSync(path.join(dir, n), "utf8");
      } catch {
        skipped.push({ file: n, reason: "could not be read" });
        continue;
      }
      const doc = parseMemoryFile(text);
      if (!doc) {
        skipped.push({ file: n, reason: "no usable frontmatter (needs name, description and metadata.type)" });
        continue;
      }
      const slug = slugify(doc.name) ?? slugify(n.slice(0, -3));
      if (!slug) {
        skipped.push({ file: n, reason: "its name cannot become a filename" });
        continue;
      }
      memories.push({ file: path.join(dir, n), slug, name: doc.name, description: doc.description, type: doc.type });
    }
    if (memories.length > 0 || skipped.length > 0) {
      projects.push({ key, dir, guessedPath: guessPathFromKey(key), memories, skipped });
    }
  }
  return { projects };
}

export interface ImportResult {
  imported: string[];
  skipped: Array<{ file: string; reason: string }>;
}

/** Copies the chosen files into one destination scope. The secret scan and every cap run here
 *  too, because this goes through `saveMemory` like any other write — an imported memory is not
 *  a trusted one. */
export async function importMemories(files: string[], destDir: string): Promise<ImportResult> {
  const imported: string[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  const existing = new Set(listMemories(destDir).map((m) => m.slug));
  for (const file of files) {
    const base = path.basename(file);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      skipped.push({ file: base, reason: "could not be read" });
      continue;
    }
    const doc = parseMemoryFile(text);
    if (!doc) {
      skipped.push({ file: base, reason: "no usable frontmatter" });
      continue;
    }
    const slug = slugify(doc.name);
    if (slug && existing.has(slug)) {
      skipped.push({ file: base, reason: "a memory with that name is already here" });
      continue;
    }
    const res = await saveMemory(destDir, {
      name: doc.name,
      description: doc.description,
      type: doc.type,
      content: doc.body,
      // No originSessionId: it named a Claude Code session, which means nothing in this app, and
      // carrying it would make the inspector claim one of OUR sessions saved this.
    });
    if (res.ok) {
      imported.push(res.slug);
      existing.add(res.slug);
    } else {
      skipped.push({ file: base, reason: res.reason });
    }
  }
  return { imported, skipped };
}
