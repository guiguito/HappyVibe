import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { INTENT_DESCRIPTION } from "../pi-runtime/extensions/happyvibe-bridge";

/**
 * X1 (Improve-prompts round, 2026-09-10) — ONE description for every `intent`.
 *
 * Thirty copies of a 100-250-char explanation of what an intent is used to ride
 * every turn (~600-900 tokens, the largest HappyVibe-authored cost in the
 * window). The convention now lives once in the identity paragraph
 * (src/main/appendSystem.ts, pinned by tests/identity-prompt.test.ts) and each
 * schema carries one short line.
 *
 * This is a SOURCE SCAN as well as a value check, because the thing that must
 * stay true is an ABSENCE — no tool may grow its own copy back — and an absence
 * cannot be asserted by registering tools and reading them.
 */
const bridge = fs.readFileSync(
  path.resolve(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"),
  "utf8",
);

describe("X1 — one intent description, stated once", () => {
  it("stays one short line and does not shout", () => {
    // The bound is a guard against a per-tool paragraph growing back, not a
    // magic number: the descriptions this replaced were 100-250 chars each.
    expect(INTENT_DESCRIPTION.length).toBeLessThanOrEqual(90);
    // The schema's own `required` array already says it is required; saying it
    // again in prose costs a token on every tool and every turn.
    expect(INTENT_DESCRIPTION).not.toMatch(/REQUIRED/);
  });

  it("says what the sentence is for, so the identity paragraph is the only other home", () => {
    expect(INTENT_DESCRIPTION).toMatch(/customer-facing/);
    expect(INTENT_DESCRIPTION).toMatch(/headline/);
  });

  it("no tool carries its own intent description any more", () => {
    // Every `intent:` in a schema must reference the shared constant, never an
    // inline string literal.
    expect(bridge.match(/intent: Type\.String\(\{\s*description:\s*"/g) ?? []).toEqual([]);
    // The old wording, in all three variants that existed.
    expect(bridge).not.toMatch(/One short customer-facing sentence/);
    expect(bridge).not.toMatch(/REQUIRED on every call/);
    expect(bridge).not.toMatch(/Optional but recommended/);
  });

  it("the per-tool web intent helper is gone — it was the fourth copy", () => {
    expect(bridge).not.toMatch(/webIntent/);
  });
});
