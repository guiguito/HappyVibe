import { TOOL_WEIGHTS } from "../../main/toolWeights.generated";
import { parseBuiltins } from "../../../pi-runtime/extensions/hv-builtins";
import { fmtNum } from "./analytics-format";
import { KIT_FAMILIES, type KitFamily } from "./toolSwitches";
import { THIS_COMPUTER, YOUR_COMPUTER } from "./platformCopy";
/**
 * §22 onboarding round (2026-09-01). Every first-run string in one place, plus
 * the two predicates the dialog derives from.
 *
 * Nothing here touches React, which is the point: the renderer suite has no DOM,
 * so the whole contract — the locked tagline, the honesty of the confinement
 * line, which chips a folder gets — is assertable as data. Same shape as
 * EMPTY_COPY (§20 round 17), including its rule that a key with no call site is
 * a FAILURE: unreferenced copy is exactly the drift these records exist to end.
 */

export const ONBOARDING_COPY = {
  tagline: "Good vibes, real code.",

  step1Title: "Connect a model",
  step1Body:
    `The brain. Sign in with a plan you already pay for, run a free one on ${THIS_COMPUTER}, or paste an API key.`,
  // The three rungs of §16's ladder, as the choice that opens step 1. Picking
  // one is what reveals its providers — showing all three lists at once was
  // what pushed step 2 below the fold.
  step1SignIn: "Sign in with a plan",
  step1Local: `Free, on ${THIS_COMPUTER}`,
  step1Key: "Paste an API key",
  step1KeySave: "Save key",
  step1KeyUnverified: "Saved — couldn't verify this key.",
  step1PickProvider: "Choose a provider",
  step1Search: "Search providers…",
  step1Popular: "Popular",
  step1AllProviders: "All providers",
  step1NoProvider: "No provider matches that.",
  // Split so the DESTINATION word stays derived from the sidebar's own NAV
  // (GOTO_LABELS) rather than being re-typed here — §20 round 17 Principle 11.
  step1EscapeLead: "Every option lives on the",
  step1EscapeTail: "page.",

  step2Title: "Pick a project",
  // Honesty-checked: §10 asks before FILE access outside the workspace root. It
  // does NOT confine bash, so this says "asks first" and never "nowhere else".
  step2Body:
    `A folder on ${YOUR_COMPUTER}. The agent works in there — and asks first before touching anything outside it.`,
  step2Open: "Open a folder…",
  step2Fresh: "Start fresh…",
  step2FreshLabel: "Name your project",
  step2FreshCreate: "Create it",
  step2FreshWhere: "Created in your Documents folder, under HappyVibe.",
  /**
   * §4 Windows round. Shown ONLY when the shell probe answers "powershell" — i.e. a
   * Windows machine with no Git Bash. One line, no persistence, no nag, and never a
   * Banner: §34's pulse decision already settled that a row like this is not one.
   * It names sub-agents explicitly because that is the part that does not degrade —
   * the bundled agents ask for `bash` in frontmatter, and that allowlist is
   * upstream's to enforce, not ours to rewrite per platform.
   */
  gitForWindows:
    "Install Git for Windows for the best experience — HappyVibe will use its shell automatically, and sub-agents need it.",

  skip: "I'll set up myself",
  // Docs in the app (2026-09-29): opens first-launch in the SYSTEM browser — setup is a modal.
  guideLink: "Read the setup guide ↗",
  doneTitle: "You're in.",

  kitHeadline: "Your agent comes fully loaded.",
  kitSubline: "Untick anything you don't want.",
  // + the page names, rendered from GOTO_LABELS (builtinTools, skills, agents), never typed here.
  kitLaterLead: "You can change all of it later on",
  kitLaterAnd: " and ",
  kitLoading: "Loading…",
  kitConsent: "Anything that changes your files or runs a command asks you first.",
  kitFooter: "Want your agent to reach GitHub, Linear, Notion…? Add plugins and MCP servers later — a few clicks each.",
  kitStart: "Start my first session",
  kitBasics: "Just the basics",
  kitLoadAll: "Load everything anyway",
  kitTotalTail: "tokens on every message",
  kitMoreRoom: "Give your model more room ↗",
  noticeExtend: "Want your agent to reach GitHub, Linear or Notion? Add a plugin or an MCP server — a few clicks.",

  noticeTools: "Each card is a tool the agent ran — expand one to see exactly what it did.",
  noticeContext:
    "Everything the model knows is in the context gauge at the top — open it to see, and prune, what it holds.",
} as const;

export type OnboardingCopyKey = keyof typeof ONBOARDING_COPY;

/**
 * docs-round #9: what the provider said about a key it refused, in ONE sentence for
 * both screens. The setup window showed only the raw reason ("HTTP 401"); the Models
 * page had this sentence inline.
 */
export function keyRejectedNote(provider: string, reason: string): string {
  return `Saved, but ${provider} rejected this key (${reason}).`;
}

/**
 * docs-round #9: what the setup window's key note becomes when the user edits or
 * re-picks in the key box. A refusal survives: it is what holds step 1 open (and this
 * box mounted), so clearing it on the first keystroke would tick the step and unmount
 * the box with the replacement key half-typed. Only a save result, a working sign-in
 * or a local runner clears it. An informational note still clears on edit.
 */
export function noteAfterEdit<T extends { rejected: boolean }>(note: T | null): T | null {
  return note?.rejected ? note : null;
}

/**
 * `onboardingSeen` alone is NOT the migration it looks like.
 *
 * The flag is only written when the OLD bottom-right overlay was dismissed, and
 * that overlay only ever appeared at the instant of first-session creation
 * (App's `firstEver`). Every user already past that moment — or who quit without
 * clicking "Got it" — still reads `false`, and would meet a brand-new wizard on
 * an install they have been using for months. Any history at all means this is
 * not a first run, which needs no migration code and cannot misfire.
 */
export function shouldShowOnboarding(s: {
  seen: boolean;
  workspaces: number;
  sessions: number;
}): boolean {
  return !s.seen && s.workspaces === 0 && s.sessions === 0;
}

const CHIPS_CODE = [
  "Give me a tour of this codebase",
  "What does this project do?",
  "Find one small thing to improve — explain it before changing anything",
] as const;

const CHIPS_EMPTY = [
  "Build a tiny homepage about me",
  "Make a snake game I can open in my browser",
  "Start a blank web project and explain every file you create",
] as const;

/**
 * The empty-folder branch is why no sample project is bundled: the first prompt
 * CREATES the codebase a tour would have needed.
 */
export function chipsFor(hasCode: boolean): readonly string[] {
  return hasCode ? CHIPS_CODE : CHIPS_EMPTY;
}

/**
 * "Does this folder hold anything?" from a top-level listing.
 *
 * Dotfiles do not count on purpose — a folder holding only `.git` or `.DS_Store`
 * is empty to a beginner, and offering "give me a tour" of it is the chip
 * failing in the one case the branch exists for.
 */
export function folderHasCode(entries: { name: string }[]): boolean {
  return entries.some((e) => !e.name.startsWith("."));
}

/**
 * Order the API-key providers for the picker: popular first, then everything
 * else A–Z, filtered by what was typed.
 *
 * "Popular" is the catalog's own `featured` flag — the five cards §16 already
 * surfaces (DeepSeek, Anthropic, OpenAI, Google, OpenRouter). It is deliberately
 * NOT a second popularity list invented here: the catalog is generated from
 * Pi's registry precisely so nobody hand-maintains provider rankings, and one
 * sanctioned hand-list is enough.
 */
export function rankProviders<T extends { id: string; label: string; featured: boolean }>(
  rows: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return rows
    .filter((r) => !q || `${r.label} ${r.id}`.toLowerCase().includes(q))
    .sort((a, b) => (a.featured !== b.featured ? (a.featured ? -1 : 1) : a.label.localeCompare(b.label)));
}

export const KIT_SERVICES = ["GitHub", "Linear", "Notion"] as const;

export type KitSwitches = Record<KitFamily, boolean> & { coreOff: string[] };
export interface KitItem { id: string; name: string; tokens: number }
/** `core` only names the shell for the no-tools line — the kit never switches a core tool. */
export interface KitItems { skills: KitItem[]; agents: KitItem[]; imagesAvailable: boolean; core: string[] }
export interface KitDraft { switches: KitSwitches; skillsOff: string[]; agentsOff: string[] }
export interface KitTile { key: KitFamily; items: "skills" | "agents" | null }
/** Structural, not `typeof TOOL_WEIGHTS` (whose `as const` literals would reject any other figures). */
type Weights = { total: number; compactionReserve: number; families: Record<string, number>; core: Record<string, number> };

const { plan, askUser, terminal, browser, web, memory, schedules, document, subagents, workflows, skills } = parseBuiltins(undefined);
/** A fresh install's switches: hv-builtins.ts's own defaults (derived, never retyped) + images on. */
export const DEFAULT_SWITCHES: KitSwitches = { plan, askUser, terminal, browser, web, memory, schedules, document, images: true, subagents, workflows, skills, coreOff: [] };

/** Just the basics: every kit family off. MCP, intent, core tools and items are never touched. */
export function basicsPatch(): Record<KitFamily, false> {
  return Object.fromEntries(KIT_FAMILIES.map((k) => [k, false])) as Record<KitFamily, false>;
}

export function setFamily(d: KitDraft, k: KitFamily, on: boolean): KitDraft {
  return { ...d, switches: { ...d.switches, [k]: on } };
}

const SHELL: Record<string, string> = { powershell: "bash" };

/** Tokens on every message for this draft — the measured total, minus what is off, plus what is on that ships off. */
export function kitTotal(d: KitDraft, items: KitItems, w: Weights = TOOL_WEIGHTS): number {
  const s = d.switches;
  const f = w.families;
  let t = w.total;
  for (const k of KIT_FAMILIES) {
    if (k === "workflows" || k === "images") continue;
    if (!s[k]) t -= f[k];
  }
  if (s.subagents && s.workflows) t += f.workflows;
  if (items.imagesAvailable && s.images) t += f.images;
  // normalizeCoreOff stores BOTH shell names when either is off — count the shell once.
  for (const name of new Set(s.coreOff.map((n) => SHELL[n] ?? n))) t -= w.core[name] ?? 0;
  if (s.skills) t -= items.skills.filter((i) => d.skillsOff.includes(i.id)).reduce((n, i) => n + i.tokens, 0);
  if (s.subagents) t -= items.agents.filter((i) => d.agentsOff.includes(i.id)).reduce((n, i) => n + i.tokens, 0);
  return t;
}

export function fullTotal(imagesAvailable: boolean, w: Weights = TOOL_WEIGHTS): number {
  return w.total + (imagesAvailable ? w.families.images : 0);
}

export function basicsTotal(items: KitItems, w: Weights = TOOL_WEIGHTS): number {
  return kitTotal({ switches: { ...DEFAULT_SWITCHES, ...basicsPatch(), coreOff: [] }, skillsOff: [], agentsOff: [] }, items, w);
}

/** More than a quarter of the window ⇒ basics. Unknown (null/0) counts as large, like Pi's own fallback. */
export function kitPreset(ctx: number | null, full: number): "full" | "basics" {
  return ctx && ctx > 0 && full > ctx / 4 ? "basics" : "full";
}

/** At or under Pi's compaction reserve, the window is past Pi's summarise line from the first message. */
export function tooSmall(ctx: number | null, reserve: number = TOOL_WEIGHTS.compactionReserve): boolean {
  return !!ctx && ctx > 0 && ctx <= reserve;
}

export function smallModelLine(ctx: number, full: number): string {
  return `Your model reads ${ctx.toLocaleString("en-US")} tokens at a time and the full kit takes about ${fmtNum(full)}, so you're starting with just the basics.`;
}

export function tooSmallLine(basics: number, ctx: number): string {
  const pct = Math.round((100 * basics) / ctx);
  return pct >= 100
    ? "Even the basics don't fit in it — too little room for real work."
    : `Even the basics fill about ${pct}% of it — too little room for real work.`;
}

export function kitShape(d: KitDraft): "full" | "basics" | "custom" {
  const s = d.switches;
  const itemsTouched = d.skillsOff.length + d.agentsOff.length + s.coreOff.length > 0;
  if (itemsTouched) return "custom";
  if (KIT_FAMILIES.every((k) => s[k] === DEFAULT_SWITCHES[k])) return "full";
  if (KIT_FAMILIES.every((k) => !s[k])) return "basics";
  return "custom";
}

/**
 * Built-in tools' order, minus what the kit doesn't show (2026-10-10): Workflows ships off and
 * isn't in context, and Images needs an OpenRouter credential. Core tools are always there and
 * Prompts weigh nothing, so neither is a tile. `basicsPatch` still switches Workflows off.
 */
export function kitTiles(imagesAvailable: boolean): KitTile[] {
  return KIT_FAMILIES.filter((k) => k !== "workflows" && (k !== "images" || imagesAvailable)).map((k) => ({
    key: k,
    items: k === "subagents" ? "agents" : k === "skills" ? "skills" : null,
  }));
}
