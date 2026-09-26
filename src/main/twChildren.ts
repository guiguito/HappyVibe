/**
 * tintinweb's child sessions, on the main side (PRD §12/§17/§19, 2026-09-26).
 *
 * Children run in the parent's own Pi process and persist to a FLAT
 * `<sessionsDir>/subagents/` (spawn.ts sets PI_CODING_AGENT_SESSION_DIR there), and each
 * child's first line names its parent (`parentSession`, written by Pi's own
 * SessionManager). That header is the one link between a session and its children —
 * for the cost ledger, delete, the sweep, the live card and the expanded card.
 *
 * Every read is confined to that directory. Import-light on purpose (fs/path/os only)
 * so store.ts and the ledger can call it without a cycle.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SubagentStatus } from "./subagentStatus";
import type { InspectMessage, InspectReply } from "./subagentInspect";

export const TW_CHILD_DIR = "subagents";

const inside = (root: string, file: string): boolean => {
  const r = path.resolve(root);
  const f = path.resolve(file);
  return f.startsWith(r + path.sep);
};

/** The first line of a session file, parsed — enough to read `id` and `parentSession`. */
function headerOf(file: string): { id?: string; parentSession?: string } | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const first = buf.subarray(0, n).toString("utf8").split("\n")[0];
    const h = JSON.parse(first) as { type?: string; id?: string; parentSession?: string };
    return h?.type === "session" ? h : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const childDir = (sessionDirPath: string): string => path.join(path.resolve(sessionDirPath), TW_CHILD_DIR);

function childFiles(sessionDirPath: string): string[] {
  try {
    return fs.readdirSync(childDir(sessionDirPath)).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(childDir(sessionDirPath), f));
  } catch {
    return [];
  }
}

/**
 * A session's own tintinweb children. `// ponytail: an O(children) header scan per call;
 * index parent → children in a sidecar file if a sessions dir ever holds thousands.`
 */
export function twChildSessionFiles(sessionDirPath: string, parentSessionFile: string | undefined): string[] {
  if (!parentSessionFile || !inside(sessionDirPath, parentSessionFile)) return [];
  const parent = path.resolve(parentSessionFile);
  return childFiles(sessionDirPath).filter((f) => {
    const p = headerOf(f)?.parentSession;
    return typeof p === "string" && path.resolve(p) === parent;
  });
}

interface Entry { type?: string; message?: { role?: string; content?: unknown; toolCallId?: string } }

function entriesOf(file: string): Entry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const l of raw.split("\n")) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l) as Entry); } catch { /* a half-written last line while the child works */ }
  }
  return out;
}

type Block = { type?: string; id?: string; name?: string; text?: string; arguments?: unknown };
const blocks = (m: Entry["message"]): Block[] => (Array.isArray(m?.content) ? (m!.content as Block[]) : []);
const argsLine = (a: unknown): string | undefined => {
  if (a === undefined) return undefined;
  const s = typeof a === "string" ? a : JSON.stringify(a);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
};

/**
 * The live card's status, in the SAME shape the nicobailon status.json poller produces,
 * so `hv:subagent-status` and the card need nothing new. No `context`: a child's file
 * names its model, not the model's window, and §19's rule is no gauge rather than a
 * guessed one.
 */
export function twChildStatus(sessionDirPath: string, file: string, agent?: string): SubagentStatus | null {
  if (!inside(childDir(sessionDirPath), file)) return null;
  const msgs = entriesOf(file).filter((e) => e.type === "message" && e.message).map((e) => e.message!);
  const calls: Array<{ id?: string; tool: string; args?: string }> = [];
  const answered = new Set<string>();
  let turnCount = 0;
  for (const m of msgs) {
    if (m.role === "assistant") {
      turnCount++;
      for (const b of blocks(m)) if (b.type === "toolCall" && b.name) calls.push({ id: b.id, tool: b.name, args: argsLine(b.arguments) });
    } else if (m.role === "toolResult" && m.toolCallId) {
      answered.add(m.toolCallId);
    }
  }
  const last = calls.at(-1);
  const inFlight = last && last.id && !answered.has(last.id) ? last.tool : undefined;
  return {
    children: [{ sessionFile: file, ...(agent ? { agent } : {}) }],
    steps: [{ ...(agent ? { agent } : {}), transcriptPath: file }],
    turnCount,
    toolCount: calls.length,
    ...(inFlight ? { currentTool: inFlight } : {}),
    recentTools: calls.slice(-5).map(({ tool, args }) => ({ tool, ...(args ? { args } : {}) })),
  };
}

/** The expanded card's reply — the `InspectReply` shape the renderer already maps. */
export function twInspect(sessionDirPath: string, file: string): InspectReply {
  if (!inside(childDir(sessionDirPath), file)) return { requestId: "", error: { code: "outside", message: "not a sub-agent session of this app" } };
  const messages: InspectMessage[] = [];
  let finalOutput: string | undefined;
  for (const e of entriesOf(file)) {
    const m = e.type === "message" ? e.message : undefined;
    if (!m?.role) continue;
    if (m.role === "toolResult") {
      const text = blocks(m).map((b) => b.text ?? "").join("").slice(0, 2000);
      messages.push({ role: "toolResult", kind: "toolResult", text });
      continue;
    }
    for (const b of blocks(m)) {
      if (b.type === "text" && b.text?.trim()) {
        messages.push({ role: m.role, kind: "text", text: b.text });
        if (m.role === "assistant") finalOutput = b.text;
      } else if (b.type === "toolCall" && b.name) {
        messages.push({ role: m.role, kind: "toolCall", name: b.name, text: argsLine(b.arguments) ?? "" });
      }
    }
  }
  return { requestId: "", messages, ...(finalOutput ? { finalOutput } : {}) };
}

/**
 * Where tintinweb writes a session's workflow scripts and journals:
 * `<os.tmpdir()>/pi-subagents-<uid>/<cwd-slug>/<parent Pi session id>/` (measured, tw1.md).
 */
export const twTmpRoot = (): string => path.join(os.tmpdir(), `pi-subagents-${typeof process.getuid === "function" ? process.getuid() : "user"}`);

/**
 * §17: deleting a session takes its tintinweb children and its workflow temp dir with it.
 * The temp dir is matched by the parent's EXACT session id as a directory name — never a
 * prefix — because other Pi sessions (the user's own CLI, other tools) share that root.
 */
export function twDeleteChildren(sessionDirPath: string, parentSessionFile: string | undefined, tmpRoot = twTmpRoot()): void {
  for (const f of twChildSessionFiles(sessionDirPath, parentSessionFile)) {
    try { fs.rmSync(f, { force: true }); } catch { /* best effort */ }
  }
  const id = parentSessionFile && inside(sessionDirPath, parentSessionFile) ? headerOf(parentSessionFile)?.id : undefined;
  if (!id || !/^[A-Za-z0-9-]{8,128}$/.test(id)) return;
  let slugs: string[] = [];
  try { slugs = fs.readdirSync(tmpRoot); } catch { return; }
  for (const slug of slugs) {
    const d = path.join(tmpRoot, slug, id);
    try { if (fs.statSync(d).isDirectory()) fs.rmSync(d, { recursive: true, force: true }); } catch { /* absent */ }
  }
}

/**
 * Children whose parent session file is gone. Only OUR directory is swept: the shared
 * temp root is left to delete, which knows the exact id — a sweep there could not tell
 * our dead sessions from another tool's live ones.
 */
export function twSweepOrphans(sessionDirPath: string): number {
  let n = 0;
  for (const f of childFiles(sessionDirPath)) {
    const p = headerOf(f)?.parentSession;
    if (typeof p !== "string" || !inside(sessionDirPath, p) || fs.existsSync(p)) continue;
    try { fs.rmSync(f, { force: true }); n++; } catch { /* locked — next start */ }
  }
  return n;
}

/**
 * A workflow's live progress (P6-progress entries) folded into the SAME `steps` the run
 * card lists for a fan-out. Entries arrive in batches and repeat an agent's index as it
 * moves on, so the fold keeps the latest per index. Statuses are "working"/"done"/"failed"
 * — deliberately NOT "running", because the card offers a per-child STOP for a running
 * child and upstream refuses to stop a workflow's children one at a time.
 */
export function foldWorkflowProgress(
  acc: Map<number, { agent?: string; label?: string; state?: string; toolCalls?: number }>,
  entries: unknown[],
): SubagentStatus {
  for (const raw of entries) {
    const e = raw as { type?: string; index?: number; agentType?: string; label?: string; state?: string; toolCalls?: number };
    if (e?.type !== "workflow_agent" || typeof e.index !== "number") continue;
    acc.set(e.index, { ...acc.get(e.index), agent: e.agentType ?? acc.get(e.index)?.agent, label: e.label, state: e.state, toolCalls: e.toolCalls });
  }
  const rows = [...acc.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
  const status = (s?: string) => (s === "done" ? "done" : s === "error" ? "failed" : "working");
  return {
    steps: rows.map((r) => ({ ...(r.agent ? { agent: r.agent } : {}), status: status(r.state) })),
    toolCount: rows.reduce((n, r) => n + (r.toolCalls ?? 0), 0),
    ...(rows.some((r) => r.state === "start" || r.state === "progress")
      ? { currentTool: rows.find((r) => r.state === "start" || r.state === "progress")?.label }
      : {}),
  };
}
