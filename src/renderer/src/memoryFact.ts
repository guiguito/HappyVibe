/**
 * PRD §33 — how a memory renders in the permission prompt, as DATA.
 *
 * The renderer suite has no DOM (vitest includes only `tests/**\/*.test.ts`, no jsdom), so the
 * contract is pinned the way every other visual rule here is: the mapping is exported as data
 * and tested, and the component only lays it out.
 *
 * The prompt shows the memory as the FACT it is — scope, type, name, description, body — never
 * the raw JSON args. The user is being asked to approve a durable change to what every future
 * session is told; `{"scope":"global","type":"user",…}` is not that question.
 */
export interface MemoryFact {
  scope: "global" | "workspace";
  type?: string;
  name: string;
  description?: string;
  content?: string;
}

const SCOPE_WORD: Record<"global" | "workspace", string> = {
  global: "About you, in every project",
  workspace: "About this project only",
};

/** Human labels for Claude Code's four types, in the app's own voice. */
export const MEMORY_TYPE_LABEL: Record<string, string> = {
  user: "About you",
  feedback: "Something you corrected",
  project: "About this project",
  reference: "A pointer to something",
};

export function memoryFactFrom(tool: string, args: unknown): MemoryFact | null {
  if (!tool.startsWith("memory_")) return null;
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined);
  const name = str("name");
  if (!name) return null;
  const scope = a.scope === "workspace" ? "workspace" : "global";
  return { scope, name, type: str("type"), description: str("description"), content: str("content") };
}

/** The label/value rows the prompt lists above the body. Order is fixed: what it is, then where
 *  it applies, then what it says. */
export function memoryFactRows(f: MemoryFact): Array<[string, string]> {
  const rows: Array<[string, string]> = [["Name", f.name]];
  if (f.type) rows.push(["Kind", MEMORY_TYPE_LABEL[f.type] ?? f.type]);
  rows.push(["Scope", SCOPE_WORD[f.scope]]);
  if (f.description) rows.push(["Summary", f.description]);
  return rows;
}

/**
 * The prompt's own headline verb. A save over an EXISTING name is an update, and saying
 * "Remember" there would hide the fact that something is being overwritten — which is the whole
 * reason the diff is shown.
 */
export function memoryPromptTitle(tool: string, replacing: boolean): string {
  if (tool === "memory_forget") return "The agent wants to forget this";
  if (tool === "memory_save") return replacing ? "The agent wants to REPLACE this memory" : "The agent wants to remember this";
  return "The agent wants to open a memory";
}
