/**
 * F3: @file mention parsing (pure, vitest-importable).
 *
 * The composer holds a plain-text `@<label>` token plus a label→relPath map.
 * On send, mentions are resolved to workspace-relative paths and the main
 * process assembles the hidden context blocks (files.ts buildMentionBlocks).
 * The transcript strips those blocks and renders each @token as a chip.
 *
 * ponytail: tokens are whitespace-delimited (`@\S+`), so a file name containing
 * a space isn't cleanly mentionable — the token stops at the first space.
 * Filenames with spaces are rare in code trees; upgrade path is a richer
 * token/quoting scheme if it ever matters.
 */

export interface MentionEntry {
  /** Workspace-relative path (OS separators, as returned by fs-list-recursive). */
  rel: string;
  kind: "dir" | "file";
}

export interface MentionSegment {
  kind: "text" | "mention";
  value: string;
}

const basename = (rel: string): string => rel.split(/[\\/]/).pop() ?? rel;

/**
 * If the caret sits inside an `@token` being typed, return its start index and
 * the query text after the `@`. The `@` must be at the start of the text or
 * follow whitespace. Returns null otherwise.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0 && !/\s/.test(text[i]) && text[i] !== "@") i--;
  if (i < 0 || text[i] !== "@") return null;
  if (i > 0 && !/\s/.test(text[i - 1])) return null; // e.g. an email's "foo@bar"
  return { start: i, query: text.slice(i + 1, caret) };
}

/** Case-insensitive basename-substring filter; prefix matches first, then shorter paths. */
export function filterEntries(entries: MentionEntry[], query: string, limit = 50): MentionEntry[] {
  const q = query.toLowerCase();
  return entries
    .map((e) => {
      const b = basename(e.rel).toLowerCase();
      return { e, idx: q === "" ? 0 : b.indexOf(q), blen: b.length };
    })
    .filter((s) => s.idx >= 0)
    .sort((a, b) =>
      a.idx !== b.idx ? a.idx - b.idx : a.blen !== b.blen ? a.blen - b.blen : a.e.rel.localeCompare(b.e.rel),
    )
    .slice(0, limit)
    .map((s) => s.e);
}

/**
 * Label for a picked path: the basename, unless that basename already maps to a
 * *different* path among existing mentions — then the full relPath disambiguates.
 */
export function mentionLabel(relPath: string, existing: Map<string, string>): string {
  const b = basename(relPath);
  const prior = existing.get(b);
  return prior !== undefined && prior !== relPath ? relPath : b;
}

/** Replace the `@query` under the caret with `@label ` (trailing space). */
export function completeMention(
  text: string,
  start: number,
  caret: number,
  label: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const insert = `@${label} `;
  return { text: before + insert + text.slice(caret), caret: before.length + insert.length };
}

/** relPaths for every `@token` still present in the text (order-preserving, deduped). */
export function extractMentions(text: string, map: Map<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)@(\S+)/g)) {
    const rel = map.get(m[1]);
    if (rel && !seen.has(rel)) {
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

/** Cut the injected `<file>`/`<file-listing>` blocks off a stored/echoed message. */
export function stripInjectedBlocks(text: string): string {
  let cut = -1;
  for (const mk of ['\n\n<file path="', '\n\n<file-listing path="']) {
    const i = text.indexOf(mk);
    if (i >= 0 && (cut < 0 || i < cut)) cut = i;
  }
  return cut < 0 ? text : text.slice(0, cut);
}

/** Split display text into plain and `@mention` segments for chip rendering. */
export function splitMentionSegments(text: string): MentionSegment[] {
  const segs: MentionSegment[] = [];
  const re = /(^|\s)(@\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + m[1].length;
    if (tokenStart > last) segs.push({ kind: "text", value: text.slice(last, tokenStart) });
    segs.push({ kind: "mention", value: m[2] });
    last = tokenStart + m[2].length;
  }
  if (last < text.length) segs.push({ kind: "text", value: text.slice(last) });
  return segs;
}

// ── §14 round 6: slash-command autocomplete ─────────────────────────────────
// Pi registers a `/skill:<name>` command per loaded skill and lists them via
// get_commands, so the composer only needs discovery — typing already worked.
// Same shape as the @-mention helpers above so ChatView reuses one dropdown.

/**
 * The `/command` being typed, or null. A slash command is only meaningful as the
 * WHOLE message, so this matches only at offset 0 and bails once the token ends
 * (a space means the user moved on to arguments).
 */
export function activeCommandQuery(text: string, caret: number): { start: number; query: string } | null {
  if (!text.startsWith("/")) return null;
  const head = text.slice(0, caret);
  if (/\s/.test(head)) return null;
  return { start: 0, query: head.slice(1) };
}

/** Case-insensitive substring filter over command names; prefix matches first, then shorter. */
export function filterCommands(names: string[], query: string, limit = 20): string[] {
  const q = query.toLowerCase();
  return names
    .map((name) => ({ name, idx: q === "" ? 0 : name.toLowerCase().indexOf(q) }))
    .filter((s) => s.idx >= 0)
    .sort((a, b) => (a.idx !== b.idx ? a.idx - b.idx : a.name.length !== b.name.length ? a.name.length - b.name.length : a.name.localeCompare(b.name)))
    .slice(0, limit)
    .map((s) => s.name);
}

/** Replace the typed `/query` with the picked command, leaving the caret after it. */
export function completeCommand(text: string, caret: number, name: string): { text: string; caret: number } {
  const insert = `/${name} `;
  return { text: insert + text.slice(caret), caret: insert.length };
}
