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

/**
 * One entry of Pi's `get_commands`, enriched by main. `source` is Pi's own
 * ("skill" | "prompt" | "extension" | …); description/argumentHint exist only
 * for prompt templates and are joined in by NAME in main, because get_commands
 * does not carry them (rpc-types.d.ts:135-144).
 */
export interface SlashCommand {
  name: string;
  source: string;
  description?: string;
  argumentHint?: string;
}

/**
 * §24: which of Pi's commands the composer offers. Skills (`/skill:<name>`) and
 * user prompt templates are HappyVibe surfaces the user approved; `extension`
 * commands are the bridge's own `/hv-*` control plane and stay out of the menu.
 */
export function composerCommands(all: SlashCommand[]): SlashCommand[] {
  return all.filter((c) => c.source === "skill" || c.source === "prompt");
}

/** Dropdown second line. A skill row says what picking it does; a prompt shows its own hint + description. */
export function commandSubtitle(c: SlashCommand): string {
  if (c.source === "skill") return "Load this skill";
  return [c.argumentHint, c.description].filter(Boolean).join(" · ") || "Prompt command";
}

/** Case-insensitive substring filter over command names; prefix matches first, then shorter. */
export function filterCommands<T extends { name: string }>(items: T[], query: string, limit = 20): T[] {
  const q = query.toLowerCase();
  return items
    .map((item) => ({ item, idx: q === "" ? 0 : item.name.toLowerCase().indexOf(q) }))
    .filter((s) => s.idx >= 0)
    .sort((a, b) =>
      a.idx !== b.idx
        ? a.idx - b.idx
        : a.item.name.length !== b.item.name.length
          ? a.item.name.length - b.item.name.length
          : a.item.name.localeCompare(b.item.name),
    )
    .slice(0, limit)
    .map((s) => s.item);
}

/**
 * Replace the typed `/query` span with the picked command, leaving the caret after
 * it. Takes the query's END (from activeCommandQuery at match time) rather than
 * the live caret: the caret can move after the dropdown opened, and replacing
 * "everything before the caret" then mangled the text (`/graph` + ArrowLeft×3 →
 * `/graphify aph`). Mirrors completeMention's start..end span handling.
 */
export function completeCommand(text: string, queryEnd: number, name: string): { text: string; caret: number } {
  const insert = `/${name} `;
  const rest = text.slice(queryEnd).replace(/^ /, ""); // don't double the space we just added
  return { text: insert + rest, caret: insert.length };
}
