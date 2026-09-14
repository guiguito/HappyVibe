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
  doneTitle: "You're in.",
  doneBody: "Opening your first session…",

  noticeTools: "Each card is a tool the agent ran — expand one to see exactly what it did.",
  noticeContext:
    "Everything the model knows is in the context gauge at the top — open it to see, and prune, what it holds.",
} as const;

export type OnboardingCopyKey = keyof typeof ONBOARDING_COPY;

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
