/**
 * W1.1 — human headlines for tool cards (PRD "Chat experience": tool calls
 * never show raw technical calls by default).
 *
 * Pure (toolName, args) → {icon, label}; unit-tested in tests/tool-label.test.ts.
 * Registered tools carry a model-written required `intent` param (wired in
 * happyvibe-bridge.ts) which always wins; Pi's built-in tools can't gain one
 * (hard-coded schemas — unknown params are stripped/rejected before tool_call),
 * so their labels are derived here from tool + args.
 * Arg names verified against pi-coding-agent dist/core/tools/*.js.
 */

export type IconKind =
  | "terminal"
  | "edit"
  | "file-plus"
  | "eye"
  | "search"
  | "folder"
  | "robot"
  | "wrench";

export interface ToolLabel {
  icon: IconKind;
  label: string;
  /** W2.2: file the call touches (edit/write/read) — makes the card path clickable. */
  path?: string;
}

const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;

/** Collapse whitespace and cap at `n` chars with an ellipsis. */
const truncate = (s: string, n = 60): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** "fetch_url-fast" → "Fetch url fast" */
const prettify = (name: string): string => {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function toolLabel(toolName: string, args: unknown): ToolLabel {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const str = (k: string): string | null =>
    typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string) : null;
  const intent = str("intent");

  switch (toolName) {
    case "bash": {
      const cmd = str("command");
      return { icon: "terminal", label: cmd ? `Running: ${truncate(cmd)}` : "Running a command" };
    }
    case "edit": {
      const p = str("path");
      // W2.2: the path itself moved out of the label into the card's
      // interactive path chip (ToolCard PathActions) — label keeps the basename.
      return { icon: "edit", label: p ? `Editing ${basename(p)}` : "Editing a file", path: p ?? undefined };
    }
    case "write": {
      const p = str("path");
      return { icon: "file-plus", label: p ? `Creating ${basename(p)}` : "Creating a file", path: p ?? undefined };
    }
    case "read": {
      const p = str("path");
      return { icon: "eye", label: p ? `Reading ${basename(p)}` : "Reading a file", path: p ?? undefined };
    }
    case "grep":
    case "find": {
      const pattern = str("pattern");
      return { icon: "search", label: pattern ? `Searching for ${truncate(pattern)}` : "Searching" };
    }
    case "ls": {
      const p = str("path");
      return { icon: "folder", label: `Listing ${p ? basename(p) : "the current directory"}` };
    }
    case "subagent":
      return { icon: "robot", label: intent ?? `Delegating to ${str("agent") ?? "a subagent"}` };
    default:
      // Unknown/registered tool: the intent it carries, else a prettified name.
      return { icon: "wrench", label: intent ?? prettify(toolName) };
  }
}
