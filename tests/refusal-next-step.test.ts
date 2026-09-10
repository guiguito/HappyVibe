import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * X7 + X3 (Improve-prompts round, 2026-09-10).
 *
 * Two refusals said only that something was blocked. A current model handed a
 * bare "blocked" retries the same call with small variations — which is what
 * the audit log then fills up with — so both now name an alternative, the way
 * every other refusal in the app already did.
 *
 * And the wait intercept drops its shouted "Do NOT": emphasis makes current
 * models over-apply a rule elsewhere, and a model told "NEVER wait" in capitals
 * also hesitates over legitimate blocking calls. The tool NAME in it stays
 * derived from the call, never written as a literal (upstream has renamed that
 * tool twice).
 *
 * Source scan, because what must stay true is a property of strings the tests
 * cannot otherwise reach without a live Pi.
 */
const bridge = fs.readFileSync(
  path.resolve(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"),
  "utf8",
);

describe("X7 — every refusal ends with a next step", () => {
  it("declares the next-step sentence once, and uses it in both bare refusals", () => {
    expect(bridge).toMatch(/const NEXT_STEP = "Do not retry the same call\./);
    expect(bridge).toMatch(/Blocked by HappyVibe permission rule \(\$\{v\.rule\?\.layer\}: \$\{v\.rule\?\.pattern\}\)\. \$\{NEXT_STEP\}/);
    expect(bridge).toMatch(/User denied this action in HappyVibe\. \$\{NEXT_STEP\}/);
  });

  it("neither refusal is left bare", () => {
    expect(bridge).not.toMatch(/reason: "User denied this action in HappyVibe"/);
    expect(bridge).not.toMatch(/pattern\}\)`/);
  });
});

describe("X3 — the wait intercept is calm and still derives the tool name", () => {
  const raw = bridge.slice(bridge.indexOf("if (isWaitTool(tool))"), bridge.indexOf("if (isWaitTool(tool))") + 900);
  // What must be calm is what the MODEL reads. The comment above the refusal
  // quotes the old shout to explain why it went, so comments are stripped.
  const block = raw
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("does not shout", () => {
    expect(block).not.toMatch(/Do NOT|NEVER/);
  });

  it("names the tool from the call, never as a literal", () => {
    expect(block).toContain("${tool}()");
    for (const w of ["wait", "subagent_wait", "bg_wait"]) {
      expect(block, w).not.toContain(`\`${w}\``);
    }
  });

  it("still says the two things the model needs: nothing to wait for, end the turn", () => {
    expect(block).toMatch(/nothing to wait for/);
    expect(block).toMatch(/running in the background/);
  });
});
