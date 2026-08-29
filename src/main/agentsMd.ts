import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PI_CLI_RELPATH, nodeExecPath } from "./pi/spawn";

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

/** Facts handed to the draft prompt — the model inspects nothing itself. */
export function workspaceFacts(workspace: string): string {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(workspace).filter((n) => !n.startsWith(".")).slice(0, 60);
  } catch {
    /* unreadable dir — facts stay minimal */
  }
  let pkg = "";
  try {
    const p = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    pkg = `\npackage.json name: ${p.name ?? "(unnamed)"}\nnpm scripts: ${JSON.stringify(p.scripts ?? {})}`;
  } catch {
    /* no package.json */
  }
  return `Project folder: ${path.basename(workspace)}\nTop-level entries: ${entries.join(", ") || "(empty)"}${pkg}`;
}

/**
 * One-shot `pi -p` draft generation — same pattern as titles.ts generateTitle:
 * `--no-tools --no-extensions --no-session` keeps it pure text, stdin "ignore"
 * (one-shot Pi hangs if stdin stays open). Resolves null on any failure.
 */
export function proposeAgentsMd(
  runtimeDir: string,
  registeredWorkspaces: string[],
  workspaceId: string,
  opts: {
    model?: { provider: string; modelId: string } | null;
    env?: Record<string, string>;
    /** Round 15: report the call so main can audit it (see oneShotLog.ts). */
    onDone?: (o: { model: { provider: string; modelId: string }; promptChars: number; outputChars: number; ok: boolean }) => void;
  } = {}
): Promise<string | null> {
  resolveAgentsMd(registeredWorkspaces, workspaceId); // confinement gate before any spawn
  const workspace = path.resolve(workspaceId);
  // §16 finding 7 (2026-08-29): no configured model means NO call. This used
  // to fall back to a hardcoded deepseek/deepseek-v4-flash, so a user with no
  // DeepSeek key got a silent failure — and one WITH a key was billed for a
  // provider they had not chosen for this. Callers already treat null as
  // "no draft", which is the honest answer when nothing is set up.
  const model = opts.model;
  if (!model) return Promise.resolve(null);
  const prompt =
    "Draft an AGENTS.md file (context notes for a coding agent) for this project. " +
    "Do NOT inspect, read, or list any files — use ONLY the facts below. " +
    "Keep it under 30 lines: a one-line project description, key commands, and 2-3 working conventions. " +
    "Reply with ONLY the raw markdown content, no code fences.\n\n" +
    workspaceFacts(workspace);
  return new Promise((resolve) => {
    const child = spawn(
      nodeExecPath(),
      [
        path.join(runtimeDir, PI_CLI_RELPATH),
        "-p", "--no-session", "--no-tools", "--no-extensions",
        "--provider", model.provider,
        "--model", model.modelId,
        prompt,
      ],
      {
        cwd: workspace,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(opts.env ?? {}) },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60_000,
      }
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    const done = (ok: boolean): void =>
      opts.onDone?.({ model, promptChars: prompt.length, outputChars: out.length, ok });
    child.on("error", () => {
      done(false);
      resolve(null);
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        done(false);
        return resolve(null);
      }
      const draft = out.trim().replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "").trim();
      done(!!draft);
      resolve(draft || null);
    });
  });
}
