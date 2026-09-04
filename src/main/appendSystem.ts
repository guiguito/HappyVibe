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

/**
 * PRD §16 round 21: the paragraph that makes the agent HappyVibe.
 *
 * Pi's base prompt opens "You are an expert coding assistant operating inside
 * pi, a coding agent harness", so with nothing appended the agent introduces
 * itself as pi. This lands AFTER the base prompt and is therefore the last
 * word, which is all an identity needs — the base prompt itself is not
 * replaced, because it is tool-aware (its guidelines vary with which tools are
 * switched on) and replacing it means inheriting a prompt Pi keeps improving.
 *
 * Fixed app copy, deliberately not editable: the user's own additions layer is
 * the editable one, and both already show up in the read-only "Resolved prompt"
 * readout, so making this visible costs no new surface.
 *
 * It does NOT disown pi. Pi's own documentation block in the base prompt stays
 * the right answer for questions about extensions, skills or the SDK, because
 * that block describes the RUNTIME, which really is pi.
 */
export const HV_IDENTITY = [
  "You are the coding agent inside HappyVibe, a desktop app for coding with an agent.",
  "When you name yourself, you are HappyVibe — pi is the runtime you happen to run on, not what you are.",
  "The pi documentation this prompt points at is still the right source for questions about the runtime itself (extensions, skills, prompt templates, the SDK); it does not describe HappyVibe's own product surface.",
].join(" ");
