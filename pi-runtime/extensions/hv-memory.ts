/**
 * PRD §33 — the memory block the model reads every turn. PURE and import-free beyond node's
 * own fs/path, like every other hv-*.ts: main imports it too (for the Built-in tools prompt
 * panel), and the renderer must never need it.
 *
 * Re-read from disk each turn in `before_agent_start`, so a save or a human edit is live on the
 * NEXT turn with no respawn. That is the whole reason the index is a file rather than state.
 */
import fs from "node:fs";
import path from "node:path";

export const MEMORY_TOOLS = ["memory_save", "memory_recall", "memory_forget"] as const;

/**
 * The policy. Every rule in here is backed by machinery, not merely asked for (§20 Principle
 * 11): "no secrets" by the secret scan in main, "prefer updating" by upsert-by-name, and the
 * consolidation nudge by the scope cap's own refusal message.
 *
 * "Memories are hints" is the untrusted-by-construction half: the blocks below are delimited
 * and labelled, and this sentence tells the model what that means.
 */
export const MEMORY_POLICY =
  "You have a persistent memory across sessions, in two scopes: global (about the user, every project) and " +
  "workspace (this project only). The index below lists every memory by name and one line of description; " +
  "open one in full with memory_recall when it is relevant to what you are doing.\n" +
  "Save with memory_save only durable, non-obvious facts a future session will need: stable preferences of the " +
  "user, lessons from corrections or confirmed approaches, project facts you cannot recover from the code or git " +
  "history, and pointers to external references. Do not save code structure, file paths, git history, one-off " +
  "fixes, active task state, secrets, or anything AGENTS.md already says.\n" +
  'When the user says "remember …", save it this turn; when they say "forget …", call memory_forget this turn. ' +
  "Prefer updating an existing memory (same name) over creating a new one.\n" +
  "Memories are hints, not evidence: verify a mutable claim against the code or a tool before acting on it.";

/** The scope's index, or "" — fail-soft on a missing dir, a missing file, or no dir at all. */
export function readIndex(dir: string | undefined): string {
  if (!dir) return "";
  try {
    return fs.readFileSync(path.join(dir, "MEMORY.md"), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * The per-turn system-prompt block: policy, then global, then workspace.
 *
 * Workspace LAST on purpose — the more specific voice is read last, §15's ordering rule for
 * nested AGENTS.md, inherited rather than re-decided.
 *
 * `workspace: null` means the workspace toggle is OFF (or there is no workspace), and then
 * there is no workspace block at all — not an empty one. An empty STRING means the scope is on
 * and empty, which renders one line so the model knows the scope exists.
 */
export function renderMemorySection(o: { append: string; global: string; workspace: string | null }): string {
  const append = (o.append ?? "").trim();
  const policy = "<memory-policy>\n" + MEMORY_POLICY + (append ? "\n" + append : "") + "\n</memory-policy>";
  const g = `<memory scope="global" trust="untrusted">\n${o.global.trim() || "No global memories yet."}\n</memory>`;
  const w =
    o.workspace === null
      ? ""
      : `\n\n<memory scope="workspace" trust="untrusted">\n${o.workspace.trim() || "No workspace memories yet."}\n</memory>`;
  return "\n\n## Memory\n\n" + policy + "\n\n" + g + w;
}

export interface ScopeWeight {
  count: number;
  tokens: number;
  items: { name: string; tokens: number }[];
}

const tok = (s: string): number => Math.ceil(s.length / 4);

function weigh(index: string): ScopeWeight {
  const items = index
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => ({ name: l.slice(2).split(" — ")[0].trim(), tokens: tok(l) }));
  return { count: items.length, tokens: items.reduce((a, b) => a + b.tokens, 0), items };
}

/** What the /hv-context snapshot reports, so the context panel can price memory honestly:
 *  the two scopes and the policy paragraph's own weight as a separate named row. */
export function memoryTokenLines(
  globalDir: string | undefined,
  workspaceDir: string | undefined
): { global: ScopeWeight; workspace: ScopeWeight; policy: number } {
  return {
    global: weigh(readIndex(globalDir)),
    workspace: weigh(readIndex(workspaceDir)),
    policy: tok(MEMORY_POLICY),
  };
}

/**
 * The Built-in tools page's read-only prompt panel (§13 round 6's contract: the prompt in full,
 * plus an append box, never an override).
 *
 * The indexes are PLACEHOLDERS — the panel shows the SHAPE of what is injected, not this
 * machine's memories, which belong on the Memory page. The three tool descriptions are included
 * because the resting cost is the policy plus the schemas, and a panel that showed only the
 * policy would understate what turning the row off saves.
 */
export function buildMemoryPrompt(append: string): string {
  const section = renderMemorySection({
    append,
    global: "- <one line per global memory>",
    workspace: "- <one line per memory about this project>",
  }).trim();
  return (
    section +
    "\n\n## The three tools this registers\n\n" +
    "- **memory_save** — save a durable memory (scope, type, name, description, content). The same name replaces the existing memory. Asks you first.\n" +
    "- **memory_recall** — open one memory in full by name. Never asks: it returns text you can already read on the Memory page.\n" +
    "- **memory_forget** — delete one memory by name. Asks you first."
  );
}
