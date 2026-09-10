import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  HV_SKILLS_SENTENCE,
  PI_SKILLS_SENTENCE,
  replaceSkillsSentence,
} from "../pi-runtime/extensions/hv-skills";

/**
 * A4 / F3 (Improve-prompts round, 2026-09-10) — the ONE upstream string we edit.
 *
 * Pi tells the model to `read` a skill's file; HappyVibe wants `use_skill`, so
 * the call carries a customer-facing intent and cards distinctly (§14). We used
 * to append a block saying the opposite of Pi's sentence and let the model pick
 * a winner. Now the sentence itself is replaced.
 *
 * The whole risk of that is a pin bump rewording Pi's sentence, after which the
 * replace() silently does nothing and the contradiction comes back with no test
 * failing. So the literal is pinned against Pi's own dist — the same shape as
 * how-it-works.test.ts pins resource-loader.js (§20 Principle 11).
 */
describe("A4 — Pi's skills sentence is replaced, and the literal is pinned to Pi's source", () => {
  const skillsJs = fs.readFileSync(
    path.resolve(
      __dirname,
      "../pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js",
    ),
    "utf8",
  );

  it("Pi still emits the exact sentence we replace", () => {
    // If this fails, upstream reworded it: update PI_SKILLS_SENTENCE to match,
    // or the replacement becomes a no-op and Pi's instruction wins again.
    expect(skillsJs).toContain(JSON.stringify(PI_SKILLS_SENTENCE));
  });

  it("Pi's other branch is the no-`read` one, which never applies to us", () => {
    // formatSkillsForPrompt picks by fileReadTool; HappyVibe always ships `read`,
    // so there is exactly one literal to replace, not two.
    expect(skillsJs).toContain("Use bash to load a skill's file when the task matches its description.");
  });

  it("replaces it, and leaves a prompt without it untouched", () => {
    const sp = `intro\n${PI_SKILLS_SENTENCE}\n<available_skills>x</available_skills>`;
    expect(replaceSkillsSentence(sp)).toBe(
      `intro\n${HV_SKILLS_SENTENCE}\n<available_skills>x</available_skills>`,
    );
    expect(replaceSkillsSentence("no skills block here")).toBe("no skills block here");
  });

  it("our sentence names use_skill and never tells the model to read a SKILL.md", () => {
    expect(HV_SKILLS_SENTENCE).toMatch(/use_skill/);
    expect(HV_SKILLS_SENTENCE).not.toMatch(/do NOT|SKILL\.md/i);
    // Shorter than the block it replaces, which was ~240 chars.
    expect(HV_SKILLS_SENTENCE.length).toBeLessThan(120);
  });
});

/**
 * F1 (Improve-prompts round, 2026-09-10) — the injection is returned whenever it
 * differs from Pi's prompt, not when a hand-listed set of sections is non-empty.
 *
 * The old condition named five sections and omitted terminalSection and
 * webSection, so with every agent disabled and memory, skills and plan off,
 * both steer lines were computed and then silently never sent. A comparison
 * cannot forget a section — and it also covers A4, which changes the base
 * prompt itself rather than appending to it.
 */
describe("F1 — no section can be silently dropped from the injection", () => {
  const bridge = fs.readFileSync(
    path.resolve(__dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"),
    "utf8",
  );
  it("returns on a difference, never on a hand-list", () => {
    expect(bridge).toMatch(/if \(injected !== base\) return \{ systemPrompt: injected \};/);
    expect(bridge).not.toMatch(/if \(section \|\| agentsSection/);
  });
  it("every computed section is still concatenated into the injection", () => {
    const line = bridge.match(/const injected = sp \+ [^;]+;/)?.[0] ?? "";
    for (const name of ["section", "agentsSection", "planSection", "terminalSection", "webSection", "memorySection"]) {
      expect(line, name).toContain(name);
    }
  });
});
