/**
 * HappyVibe skills bridge helpers (§14) — PURE module, zero non-node imports.
 * Lives next to the bridge (Pi's loader resolves it at runtime) and is imported
 * by vitest. Main writes the per-session manifest to HV_SKILLS_FILE; the bridge
 * reads it here to serve `use_skill`, detect raw SKILL.md reads, steer the model
 * toward use_skill, and report skill context weight.
 *
 * The manifest is the session's ACTUALLY-LOADED skills (main already resolved
 * approved ∩ enabled ∩ active-for-workspace and passed the same dirs as --skill),
 * so the bridge never re-derives trust — it only reflects what Pi loaded.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface SkillManifestEntry {
  name: string;
  dir: string;
  skillMdPath: string;
  scope: "global" | "workspace";
  estTokens: { card: number; body: number };
}
export interface SkillManifest {
  skills: SkillManifestEntry[];
}

const EMPTY: SkillManifest = { skills: [] };

export function loadManifest(file: string | undefined = process.env.HV_SKILLS_FILE): SkillManifest {
  if (!file) return EMPTY;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SkillManifest;
    return Array.isArray(parsed?.skills) ? { skills: parsed.skills } : EMPTY;
  } catch {
    return EMPTY; // absent/corrupt — no skills this session
  }
}

export function findByName(m: SkillManifest, name: string): SkillManifestEntry | undefined {
  return m.skills.find((s) => s.name === name);
}

/** Input keys carrying file paths across Pi's built-in file tools (mirrors hv-rules PATH_KEYS). */
const PATH_KEYS = /^(path|file_?path|file)$/i;

/**
 * When a `read` targets an active skill's SKILL.md, return that skill — the
 * raw-read fallback (model loaded a skill without use_skill). Matches absolute
 * paths and paths relative to cwd.
 */
export function matchReadPath(
  m: SkillManifest,
  input: Record<string, unknown>,
  cwd: string,
): SkillManifestEntry | undefined {
  const args: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (PATH_KEYS.test(k) && typeof v === "string" && v) args.push(v);
  }
  for (const p of args) {
    const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
    const hit = m.skills.find((s) => s.skillMdPath === p || s.skillMdPath === abs);
    if (hit) return hit;
  }
  return undefined;
}

export interface SkillScopeWeight {
  tokens: number;
  count: number;
  /** §9 round 6: per-skill names so the context panel can drill in. */
  items: { name: string; tokens: number }[];
}

/** Skill system-prompt weight per scope (chars/4 card estimate + count + names). */
export function skillTokenLines(m: SkillManifest): { global: SkillScopeWeight; workspace: SkillScopeWeight } {
  const acc = {
    global: { tokens: 0, count: 0, items: [] as { name: string; tokens: number }[] },
    workspace: { tokens: 0, count: 0, items: [] as { name: string; tokens: number }[] },
  };
  for (const s of m.skills) {
    const bucket = s.scope === "workspace" ? acc.workspace : acc.global;
    const tokens = s.estTokens?.card ?? 0;
    bucket.tokens += tokens;
    bucket.count += 1;
    bucket.items.push({ name: s.name, tokens });
  }
  for (const b of [acc.global, acc.workspace]) b.items.sort((x, y) => y.tokens - x.tokens);
  return acc;
}

/**
 * A4 / F3 (Improve-prompts round, 2026-09-10) — REPLACE Pi's sentence rather
 * than argue with it.
 *
 * Pi's own skills block says "Use the read tool to load a skill's file" a few
 * hundred tokens before we used to say "do NOT read the SKILL.md file
 * directly". One prompt, two opposite instructions, every turn — and the
 * bridge's raw-SKILL.md-read fallback existed only to mop up whichever one
 * lost. before_agent_start already rewrites the whole system prompt, so the
 * one upstream sentence is swapped in place and our separate block goes away.
 *
 * This is the ONE piece of upstream text HappyVibe edits, so it is pinned:
 * tests/pi-skills-sentence.test.ts reads Pi's own skills.js and fails if the
 * literal ever moves, rather than letting a pin bump silently restore the
 * contradiction. Pi's other branch ("Use bash to load…") fires only when the
 * `read` tool is absent, which is never our case.
 */
export const PI_SKILLS_SENTENCE =
  "Use the read tool to load a skill's file when the task matches its description.";
export const HV_SKILLS_SENTENCE =
  "Load a skill with `use_skill(name, intent)`; it returns the skill's instructions.";

/** Pi's system prompt with its skills instruction swapped for ours. A prompt without it is returned unchanged. */
export function replaceSkillsSentence(systemPrompt: string): string {
  return systemPrompt.replace(PI_SKILLS_SENTENCE, HV_SKILLS_SENTENCE);
}
