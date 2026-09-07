/**
 * PRD §33 — a memory file's frontmatter.
 *
 * The shape is Claude Code's REAL one, not the one the proposal first drew: `name`,
 * `description`, then a NESTED `metadata` block. Measured on 124 memories across three
 * projects — zero use a flat `type:` / `modified:`, three nested variants do (metadata.type
 * alone · plus node_type + originSessionId · plus modified). We read all three and write one,
 * so an import is a copy and an export would be too.
 *
 * A flat `type:` is deliberately REFUSED rather than accepted-and-normalised: accepting it
 * would make a second shape that then has to be kept working forever.
 *
 * Parsing is `yaml.parse`, like Pi's own frontmatter reader and like skills/discovery.ts — a
 * hand-rolled `key: value` scan reads any multi-line scalar as empty, which for a description
 * is not cosmetic (it is the whole index line).
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryDoc {
  /** The slug. Claude Code stores the slug here too (`name: user-goals`). */
  name: string;
  description: string;
  type: MemoryType;
  /** The HappyVibe session that saved it. Absent on a human edit or an import. */
  originSessionId?: string;
  /** ISO 8601, stamped by main on every write. */
  modified?: string;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Every on-disk shape → MemoryDoc, or null. Malformed YAML degrades to null rather than
 *  throwing (Pi's own rule for frontmatter, mirrored in skills/discovery.ts). */
export function parseMemoryFile(text: string): MemoryDoc | null {
  const m = FENCE.exec(text);
  if (!m) return null;
  let fm: unknown;
  try {
    fm = parseYaml(m[1]);
  } catch {
    return null;
  }
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) return null;
  const f = fm as Record<string, unknown>;
  const meta = f.metadata && typeof f.metadata === "object" ? (f.metadata as Record<string, unknown>) : null;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  const description = typeof f.description === "string" ? f.description.trim() : "";
  const type = meta && typeof meta.type === "string" ? meta.type : "";
  if (!name || !description || !(MEMORY_TYPES as readonly string[]).includes(type)) return null;
  const doc: MemoryDoc = {
    name,
    description,
    type: type as MemoryType,
    body: m[2].replace(/^\r?\n/, "").trimEnd(),
  };
  if (meta && typeof meta.originSessionId === "string") doc.originSessionId = meta.originSessionId;
  // yaml resolves an unquoted ISO timestamp to a Date; both forms exist on disk.
  if (meta && typeof meta.modified === "string") doc.modified = meta.modified;
  else if (meta && meta.modified instanceof Date) doc.modified = meta.modified.toISOString();
  return doc;
}

/** MemoryDoc → the file we write. `yaml.stringify` owns the quoting: a description with a
 *  colon or a leading symbol is what a hand-rolled writer gets wrong. */
export function serializeMemoryFile(doc: MemoryDoc): string {
  const metadata: Record<string, string> = { type: doc.type };
  if (doc.originSessionId) metadata.originSessionId = doc.originSessionId;
  if (doc.modified) metadata.modified = doc.modified;
  const head = stringifyYaml({ name: doc.name, description: doc.description, metadata }).trimEnd();
  return `---\n${head}\n---\n\n${doc.body.trimEnd()}\n`;
}
