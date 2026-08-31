import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { chipsFor, folderHasCode, ONBOARDING_COPY, shouldShowOnboarding } from "../src/renderer/src/onboarding";

/**
 * §22 onboarding round (2026-09-01).
 *
 * The renderer suite has no DOM (vitest.config.ts includes `tests/**\/*.test.ts`
 * only), so a visual/wiring contract is pinned in two halves: the copy and the
 * predicates ship as pure exports and are asserted directly, and the FACTS about
 * the components are comment-stripped, whitespace-collapsed source scans — the
 * tests/modal-layer.test.ts idiom, which survives JSX line-wrapping.
 */

const R = path.resolve(__dirname, "../src/renderer/src");
const read = (rel: string): string => fs.readFileSync(path.join(R, rel), "utf8");

/** Comments stripped and whitespace collapsed, so line-wrapping cannot hide a match. */
export const flat = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*/gm, "")
    .replace(/\s+/g, " ");

const APP = read("App.tsx");

/**
 * Assert a substring WITHOUT feeding vitest the haystack: `expect(src).toContain(x)`
 * on a 3,000-line file prints the whole file on failure, which buries the one
 * line that matters. The boolean carries the needle as its message instead.
 */
export const has = (src: string, needle: string): boolean => src.includes(needle);

describe("credential state is pushed, not pulled once", () => {
  it("App re-reads the gate when main says providers changed", () => {
    // hv:providers-changed already existed (ipc.ts) and ONLY ChatView consumed
    // it, so a sign-in completed anywhere else left App's keyState stale — and
    // the wizard's step-1 checkmark derives from exactly that state.
    const src = flat(APP);
    expect(has(src, "window.hv.onProvidersChanged"), "onProvidersChanged").toBe(true);
    expect(has(src, "refreshKeyState"), "refreshKeyState").toBe(true);
  });

  it("the subscription re-reads the gate rather than only refreshing models", () => {
    const src = flat(APP);
    const reader = src.slice(src.indexOf("const refreshKeyState"), src.indexOf("const refreshKeyState") + 240);
    expect(has(reader, "window.hv.hasAnyProvider()"), "the reader calls the gate").toBe(true);
  });
});

describe("shouldShowOnboarding", () => {
  it("shows only on a truly untouched install", () => {
    expect(shouldShowOnboarding({ seen: false, workspaces: 0, sessions: 0 })).toBe(true);
  });

  it("never shows once the flag is set", () => {
    expect(shouldShowOnboarding({ seen: true, workspaces: 0, sessions: 0 })).toBe(false);
  });

  it("never shows to an install with history — the flag alone is NOT the migration", () => {
    // onboardingSeen was only ever written when the OLD overlay was dismissed,
    // and that overlay only appeared at first-session creation. Everyone past
    // that moment still reads false.
    expect(shouldShowOnboarding({ seen: false, workspaces: 1, sessions: 0 })).toBe(false);
    expect(shouldShowOnboarding({ seen: false, workspaces: 0, sessions: 1 })).toBe(false);
    expect(shouldShowOnboarding({ seen: false, workspaces: 2, sessions: 9 })).toBe(false);
  });
});

describe("chipsFor", () => {
  it("offers a tour when the folder has code and a build when it does not", () => {
    expect(chipsFor(true)).toHaveLength(3);
    expect(chipsFor(false)).toHaveLength(3);
    expect(chipsFor(true)).not.toEqual(chipsFor(false));
    expect(chipsFor(true).join(" ")).toContain("tour");
  });

  it("the empty branch asks the agent to CREATE something — that is why no sample project ships", () => {
    expect(chipsFor(false).join(" ")).toMatch(/Build|Make|Start/);
  });
});

describe("folderHasCode", () => {
  it("ignores dotfiles — a folder holding only .git is empty to a beginner", () => {
    expect(folderHasCode([])).toBe(false);
    expect(folderHasCode([{ name: ".git" }, { name: ".DS_Store" }])).toBe(false);
    expect(folderHasCode([{ name: ".git" }, { name: "index.html" }])).toBe(true);
  });
});

describe("ONBOARDING_COPY", () => {
  it("carries the locked tagline verbatim", () => {
    expect(ONBOARDING_COPY.tagline).toBe("Good vibes, real code.");
  });

  it("does not promise the agent stays inside the folder — bash is not path-inspected", () => {
    // §10 asks before FILE access outside the workspace root; it does not
    // confine bash. "asks first" is the honest clause; "nowhere else" is not.
    expect(ONBOARDING_COPY.step2Body).toContain("asks first");
    expect(ONBOARDING_COPY.step2Body).not.toMatch(/never leaves|nowhere else|only inside|can't touch/i);
  });

  it("every entry is a non-empty string", () => {
    for (const [k, v] of Object.entries(ONBOARDING_COPY)) {
      expect(typeof v, k).toBe("string");
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });
});
