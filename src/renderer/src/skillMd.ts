/**
 * §14 — SKILL.md presentation helpers for the inspector.
 *
 * A SKILL.md opens with YAML front-matter (`name`, `description`, `license`, …).
 * ReactMarkdown has no notion of it, so rendering the raw file turned those keys
 * into one bold run-on paragraph above the real content. The inspector already
 * shows name + description as its own header, so the front-matter is pure noise
 * there — strip it before rendering.
 */

/** Strip a leading `---` front-matter block. Returns the body unchanged if absent. */
export function stripSkillFrontMatter(md: string): string {
  // Must be the very first thing in the file (allowing a UTF-8 BOM / blank lines),
  // and the closing fence must be its own line — otherwise a horizontal rule or a
  // `---` inside the body would eat real content.
  const m = /^﻿?\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(md);
  return m ? md.slice(m[0].length).replace(/^(\r?\n)+/, "") : md;
}
