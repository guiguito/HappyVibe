import { structuredPatch } from "diff";

/**
 * Client-side diff rendering for edit/write tool cards.
 *
 * Pi tool events carry no structured diff — `tool_execution_start.args` echoes
 * the tool input. The edit tool's args are `{path, edits: [{oldText, newText}]}`
 * (or legacy top-level `{path, oldText, newText}`); write is `{path, content}`.
 * Shapes verified against pi-coding-agent dist/core/tools/{edit,write}.js.
 */

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
}

export interface ToolDiff {
  kind: "edit" | "write";
  path: string;
  lines: DiffLine[];
}

function hunkLines(oldText: string, newText: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const hunk of structuredPatch("a", "b", oldText, newText, "", "", { context: 2 }).hunks) {
    for (const l of hunk.lines) {
      if (l.startsWith("\\")) continue; // "\ No newline at end of file"
      out.push({ type: l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx", text: l.slice(1) });
    }
  }
  return out;
}

/** Unified-diff lines for an edit/write tool call, or null when args don't match. */
export function toolDiff(toolName: string, args: unknown): ToolDiff | null {
  const a = args as {
    path?: unknown;
    content?: unknown;
    edits?: unknown;
    oldText?: unknown;
    newText?: unknown;
  } | null;
  if (!a || typeof a.path !== "string") return null;

  if (toolName === "write") {
    if (typeof a.content !== "string") return null;
    return { kind: "write", path: a.path, lines: a.content.split("\n").map((text) => ({ type: "add", text })) };
  }

  if (toolName !== "edit") return null;
  const edits = Array.isArray(a.edits)
    ? (a.edits as { oldText?: unknown; newText?: unknown }[])
    : typeof a.oldText === "string" && typeof a.newText === "string"
      ? [{ oldText: a.oldText, newText: a.newText }]
      : null;
  if (!edits?.length || !edits.every((e) => typeof e?.oldText === "string" && typeof e?.newText === "string")) {
    return null;
  }
  const lines: DiffLine[] = [];
  edits.forEach((e, i) => {
    if (i > 0) lines.push({ type: "ctx", text: "···" }); // separator between distinct edits
    lines.push(...hunkLines(e.oldText as string, e.newText as string));
  });
  return { kind: "edit", path: a.path, lines };
}
