/**
 * §12 (2026-08-29, the fleet round): a sub-agent's own work, read on demand.
 *
 * pi-subagents 0.58 exposes the child's transcript path on both routes
 * (`results[].transcriptPath` on a foreground delegation, `steps[].transcriptPath`
 * in status.json for a detached one), and that JSONL is an ORDERED stream: one
 * assistant record carries its `thinking` block and the `toolCall` blocks that
 * thought produced, in that order (measured — see docs/validation/d1.md). So the
 * card can show *thought → did → thought → did* rather than a pile of reasoning
 * detached from the actions it explains.
 *
 * We keep thinking and tool CALLS, never tool RESULTS: results are ~95% of the
 * bytes (a single file read was 18,614 chars) and the card is a progress view,
 * not a full transcript. That is also what makes re-reading cheap enough to do
 * live — measured 0.3-2.7 ms across real transcripts from 7 KB to 674 KB.
 *
 * CONFINEMENT: against the app's SESSIONS dir, NOT os.tmpdir(). pi-subagents
 * writes `subagent-artifacts/` flat into our own session directory
 * (store.ts ARTIFACT_DIR), a different root from the one subagentStatus.ts
 * guards — reusing that guard here returns nothing, silently, which looks
 * exactly like a run that did no thinking.
 *
 * Electron-free so vitest can import it.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface TraceRow {
  kind: "thinking" | "call";
  /** thinking: the reasoning text. call: a short argument summary, may be "". */
  text: string;
  /** call only: the tool name. */
  name?: string;
}

/**
 * Bound on rows returned. A long autonomous run produced 100 rows; this is far
 * above that and exists so a pathological transcript cannot flood the renderer.
 * The TAIL is kept — the newest work is what someone watching a live run wants.
 */
const MAX_ROWS = 400;

/** A compact one-line summary of a tool call's arguments, or "" when there is nothing useful. */
function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  // The keys that identify WHAT a call touched, in the order they read best.
  for (const key of ["path", "file", "filePath", "pattern", "query", "command", "url"]) {
    const v = a[key];
    if (typeof v === "string" && v.trim()) return v.length > 120 ? v.slice(0, 119) + "…" : v;
  }
  return "";
}

export function readChildTrace(sessionsRoot: string, transcriptPath: string): TraceRow[] {
  const root = path.resolve(sessionsRoot);
  const file = path.resolve(transcriptPath);
  // `startsWith(root)` alone would accept a sibling like `<root>-evil`; the
  // separator is what makes this containment rather than a prefix match.
  if (file !== root && !file.startsWith(root + path.sep)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: TraceRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec: { content?: unknown; message?: { content?: unknown; role?: unknown } };
    try {
      rec = JSON.parse(line) as typeof rec;
    } catch {
      continue; // a half-written last line is normal while the child works
    }
    const content = rec.message?.content ?? rec.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      const block = b as { type?: unknown; thinking?: unknown; text?: unknown; name?: unknown; arguments?: unknown };
      if (block.type === "thinking") {
        const text = typeof block.thinking === "string" ? block.thinking : typeof block.text === "string" ? block.text : "";
        if (text.trim()) out.push({ kind: "thinking", text });
      } else if (block.type === "toolCall" && typeof block.name === "string") {
        out.push({ kind: "call", name: block.name, text: summarizeArgs(block.arguments) });
      }
    }
  }
  return out.length > MAX_ROWS ? out.slice(-MAX_ROWS) : out;
}
