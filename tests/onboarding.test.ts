import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
