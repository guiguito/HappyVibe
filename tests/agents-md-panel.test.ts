/**
 * PRD §15 (2026-08-30) — the AGENTS.md draft stays an AGENT, so the Agents page
 * governs it: its system prompt, its agent-tier model, and its on/off switch
 * all live there rather than on §19's "On your behalf" page.
 *
 * That leaves exactly one gap, and this is it. Switching `agents-md-maker` off
 * on the Agents page left "Draft it for me" sitting in the AGENTS.md panel,
 * looking available — and pressing it burned a whole turn to arrive at "No
 * draft was produced this turn", which names neither the cause nor the cure.
 *
 * Source scan: the renderer suite has no DOM, and what is pinned here is a
 * sentence and where it points.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the draft button knows whether agents-md-maker is switched on", () => {
  const src = read("src/renderer/src/components/AgentsMdPanel.tsx");
  // Not merely "the name appears" — it already appeared, in the delegation
  // prompt this panel has always sent, which is what made the first version of
  // this assertion pass vacuously. Pin the LOOKUP and the FLAG.
  expect(src).toMatch(/agents\?\.find\(\(a\) => a\.name === "agents-md-maker"\)/);
  expect(src).toMatch(/\.enabled === false/);
  // And it reads the Agents page's own inventory rather than asking a second
  // way — two sources for one fact is how the two surfaces come to disagree.
  expect(src).toMatch(/agents\?: AgentInfo\[\] \| null/);
});

test("it says the agent is off, and where the switch is", () => {
  const src = read("src/renderer/src/components/AgentsMdPanel.tsx");
  expect(src).toMatch(/turned off|switched off/i);
  // A message that names the cause but not the cure is half a message.
  expect(src).toMatch(/Settings/);
});

test("the agent still declares it never writes — the app does", () => {
  // The constraint the "On your behalf" round nearly duplicated into a renderer
  // string lives HERE, in the agent's own file, and is enforced by its tools
  // allowlist (strict from pi-subagents 0.40 — an unknown name fails the run).
  const md = read("pi-runtime/agents/agents-md-maker.md");
  expect(md).toMatch(/NEVER create or modify any file/);
  expect(md).toMatch(/^tools:\s*read,\s*grep,\s*find,\s*ls\s*$/m);
  for (const forbidden of ["write", "edit", "bash"]) {
    expect(md.match(/^tools:.*$/m)?.[0]).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
  }
});
