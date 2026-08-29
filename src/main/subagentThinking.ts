/**
 * §12 (2026-08-29, the fleet round): a sub-agent's own reasoning, read on demand.
 *
 * pi-subagents 0.58 exposes the child's transcript path on both routes
 * (`results[].transcriptPath` on a foreground delegation, `steps[].transcriptPath`
 * in status.json for a detached one), and that JSONL carries real
 * `type: "thinking"` content blocks — the child's own reasoning, not a copy of
 * the parent's (measured: docs/validation/d1.md, Probe 2). The compact
 * `toolCalls` projection the card already renders does NOT include them, so
 * this file read is the only route to them.
 *
 * This is the app's FIRST thinking surface — the main agent's own reasoning is
 * not rendered anywhere — which is why the card's toggle is off by default:
 * nothing is read until someone asks.
 *
 * CONFINEMENT: against the app's SESSIONS dir, NOT os.tmpdir(). pi-subagents
 * writes `subagent-artifacts/` flat into our own session directory
 * (store.ts ARTIFACT_DIR), a different root from the one subagentStatus.ts
 * guards — reusing that guard here returns nothing, silently, which looks
 * exactly like a run that did no thinking.
 *
 * ponytail: reads the whole file per expand. A child transcript is a handful of
 * records; stream it only if a run ever produces one big enough to notice.
 *
 * Electron-free so vitest can import it.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function readChildThinking(sessionsRoot: string, transcriptPath: string): string[] {
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
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec: { content?: unknown; message?: { content?: unknown } };
    try {
      rec = JSON.parse(line) as typeof rec;
    } catch {
      continue; // a half-written last line is normal while the child works
    }
    const content = rec.message?.content ?? rec.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      const block = b as { type?: unknown; thinking?: unknown; text?: unknown };
      if (block.type !== "thinking") continue;
      const text = typeof block.thinking === "string" ? block.thinking : typeof block.text === "string" ? block.text : "";
      if (text.trim()) out.push(text);
    }
  }
  return out;
}
