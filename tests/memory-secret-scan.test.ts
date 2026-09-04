/** PRD §33 — the save path's secret refusal. Positives AND negatives: a scanner that refuses a
 *  sentence about a key teaches the user to turn memory off. */
import { describe, expect, it } from "vitest";
import { findSecret, SECRET_PATTERNS } from "../src/main/memory/secretScan";

describe("findSecret flags real credentials", () => {
  it.each([
    ["sk-abcdefghijklmnopqrstuvwxyz0123456789", "openai-style key"],
    ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab", "GitHub token"],
    ["AKIAIOSFODNN7EXAMPLE", "AWS access key"],
    ["Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij.klmnopqrst", "bearer token"],
    ["-----BEGIN RSA PRIVATE KEY-----", "private key"],
    ["xoxb-1234567890-abcdefghij", "Slack token"],
  ])("flags %s (%s)", (text) => {
    const hit = findSecret(`note: ${text}`);
    expect(hit).not.toBeNull();
    expect(hit!.label.length).toBeGreaterThan(3);
  });
});

describe("findSecret leaves prose about credentials alone", () => {
  it.each([
    "The OpenRouter key lives in .env, not here",
    "Use `sk-REPLACE` placeholders in tests",
    "Bearer of bad news",
    "AKIA is not an airport code",
    "prefer `ghp` over `gh pr`",
    "the private key is in the keychain, never in a file",
  ])("does not flag: %s", (text) => {
    expect(findSecret(text)).toBeNull();
  });
});

it("every pattern carries a human label the refusal can print", () => {
  expect(SECRET_PATTERNS.length).toBeGreaterThan(3);
  for (const p of SECRET_PATTERNS) {
    expect(p.label.length, p.id).toBeGreaterThan(3);
    expect(p.label, p.id).not.toMatch(/[\\^$*]/); // a label is prose, never the regex
  }
});
