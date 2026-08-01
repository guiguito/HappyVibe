import fs from "node:fs";
import path from "node:path";

/**
 * APPEND_SYSTEM.md editing (W1.4, PRD "Settings → System Prompt").
 *
 * Pi reads APPEND_SYSTEM.md at session load only — edits apply to NEW or
 * RESTARTED sessions (same note as the AGENTS.md editor).
 *
 * Round 8 removed the per-workspace tier from the UI: it was the same idea as
 * AGENTS.md told twice, and the two could disagree. Pi still DISCOVERS
 * `<workspace>/.pi/APPEND_SYSTEM.md` by itself, and such a file still REPLACES
 * the global additions rather than adding to them — so a workspace that already
 * had one keeps being affected by it with no UI showing it. Accepted in beta
 * (PRD §16 round 8) rather than writing migration code for a feature nobody
 * used. What remains here is the global file only.
 */

export function globalAppendFile(agentDir: string): string {
  return path.join(agentDir, "APPEND_SYSTEM.md");
}

export function readAppend(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null; // missing file — no additions layer
  }
}

/** Blank content removes the file, so the layer stops applying (a workspace file
 *  overrides the global one even when empty — deleting is the honest "off"). */
export function writeAppend(file: string, content: string): void {
  if (!content.trim()) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}
