import fs from "node:fs";
import path from "node:path";

/**
 * AGENTS.md support (B2). Pi loads context files at session start (cwd upward,
 * plus the CLAUDE.md alias) — NOT live, hence the "applies to new or restarted
 * sessions" note in the UI.
 *
 * File access is STRICTLY confined to `<workspace>/AGENTS.md` for a registered
 * workspace: the renderer-supplied workspaceId is a trust boundary.
 */
function resolveWorkspaceFile(registeredWorkspaces: string[], workspaceId: string, name: string): string {
  const ws = path.resolve(workspaceId);
  if (!registeredWorkspaces.some((w) => path.resolve(w) === ws)) {
    throw new Error("Unknown workspace");
  }
  const file = path.resolve(ws, name);
  // Belt-and-braces: the result must be exactly <workspace>/<name>.
  if (file !== path.join(ws, name) || path.dirname(file) !== ws) {
    throw new Error("Path escapes workspace");
  }
  return file;
}

export function resolveAgentsMd(registeredWorkspaces: string[], workspaceId: string): string {
  return resolveWorkspaceFile(registeredWorkspaces, workspaceId, "AGENTS.md");
}

// ── W2.3 missing-file flow: CLAUDE.md copy (same trust boundary) ────────────

export function hasClaudeMd(registeredWorkspaces: string[], workspaceId: string): boolean {
  return fs.existsSync(resolveWorkspaceFile(registeredWorkspaces, workspaceId, "CLAUDE.md"));
}

/**
 * Copies <workspace>/CLAUDE.md → <workspace>/AGENTS.md (explicit user action —
 * the ONE write this flow performs). Returns the copied content for the editor.
 */
export function copyClaudeMdToAgentsMd(registeredWorkspaces: string[], workspaceId: string): string {
  const content = fs.readFileSync(resolveWorkspaceFile(registeredWorkspaces, workspaceId, "CLAUDE.md"), "utf8");
  fs.writeFileSync(resolveAgentsMd(registeredWorkspaces, workspaceId), content, "utf8");
  return content;
}

export function readAgentsMd(registeredWorkspaces: string[], workspaceId: string): string | null {
  const file = resolveAgentsMd(registeredWorkspaces, workspaceId);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null; // missing file — UI offers "propose one"
  }
}

export function writeAgentsMd(registeredWorkspaces: string[], workspaceId: string, content: string): void {
  fs.writeFileSync(resolveAgentsMd(registeredWorkspaces, workspaceId), content, "utf8");
}

/**
 * WS5: resolve a NESTED AGENTS.md path confined to the workspace. Unlike
 * resolveWorkspaceFile (root only), this allows subdirectories but still
 * requires the file to stay inside the workspace and be named AGENTS.md.
 */
function resolveNestedAgentsMd(registeredWorkspaces: string[], workspaceId: string, relPath: string): string {
  const ws = path.resolve(workspaceId);
  if (!registeredWorkspaces.some((w) => path.resolve(w) === ws)) throw new Error("Unknown workspace");
  if (path.basename(relPath) !== "AGENTS.md") throw new Error("Only AGENTS.md files may be written");
  const file = path.resolve(ws, relPath);
  const rel = path.relative(ws, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Path escapes workspace");
  return file;
}

/**
 * WS5: write the agents-md-maker's structured draft — root + nested AGENTS.md —
 * each path-confined. Returns the workspace-relative paths written (for the
 * "Saved N files" notice + audit). The sub-agent never writes; the app does.
 */
export function writeAgentsMdFiles(
  registeredWorkspaces: string[],
  workspaceId: string,
  files: Record<string, string>,
): string[] {
  const written: string[] = [];
  const ws = path.resolve(workspaceId);
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolveNestedAgentsMd(registeredWorkspaces, workspaceId, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    written.push(path.relative(ws, abs));
  }
  return written;
}

/**
 * WS5: parse the agents-md-maker subagent's structured output into a
 * {relPath → content} map (root + nested AGENTS.md). The agent stays read-only
 * (§15); the app writes the files.
 *
 * MOVED here from the renderer in §15 round 21. It lived there while the
 * renderer was the writer — and the renderer's copy had exactly ONE caller, a
 * dialog, which is why a draft asked for in chat was parsed by nobody and
 * written by nobody.
 *
 * Contract: exactly one fenced block tagged `json agents-md` whose body is
 * {"files": {"AGENTS.md": "...", "pkg/AGENTS.md": "..."}}. Malformed → null.
 * Lenient about surrounding prose, strict about paths — and
 * `writeAgentsMdFiles` confines them again, so this is the first of two gates
 * rather than the only one.
 */
const AGENTS_MD_FENCE = /```json\s+agents-md\s*\n([\s\S]*?)\n?```/;

export function parseAgentsMdOutput(finalOutput: string): Record<string, string> | null {
  const m = AGENTS_MD_FENCE.exec(finalOutput ?? "");
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const files = (parsed as { files?: unknown })?.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return null;
  const out: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files as Record<string, unknown>)) {
    if (typeof content !== "string") continue;
    const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "");
    if (norm.startsWith("/") || norm.split("/").includes("..")) continue;
    if (norm.split("/").pop() !== "AGENTS.md") continue;
    out[norm] = content;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * A child sub-agent's final answer, out of its own Pi session file.
 *
 * This is the UNTRUNCATED source, and that matters: upstream caps the
 * completion payload at 1,000 chars, the bridge caps the notify's summary at
 * 500, and pi-subagents' inspect RPC caps `finalOutput` at 8,000 — a real
 * multi-file draft exceeds all three. Pi's own session record has no such cap.
 *
 * The LAST assistant message WITH TEXT wins, not simply the last one: a child
 * whose final turn was pure tool calls still gave its answer a message earlier.
 *
 * Tolerant by design, the same contract as `parseCalls`: the file is appended
 * live, so the last line can be torn mid-write. A bad line is skipped, never
 * thrown.
 */
export function finalTextFromSessionFile(jsonl: string | null | undefined): string {
  if (!jsonl) return "";
  const texts: string[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) continue;
    let entry: { type?: string; message?: { role?: unknown; content?: unknown } };
    try {
      entry = JSON.parse(raw) as typeof entry;
    } catch {
      continue;
    }
    const m = entry.type === "message" ? entry.message : undefined;
    if (!m || m.role !== "assistant") continue;
    if (typeof m.content === "string") {
      if (m.content.trim()) texts.push(m.content);
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    const text = m.content
      .map((b) => b as { type?: unknown; text?: unknown })
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (text.trim()) texts.push(text);
  }
  return texts.length ? texts[texts.length - 1] : "";
}
