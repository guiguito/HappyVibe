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
  // X3 (2026-09-10): the fact, not the shout — the `tools:` allowlist below is
  // what enforces it (there is no `write` to refuse).
  expect(md).toMatch(/cannot create or modify files; the app writes them/i);
  expect(md).toMatch(/^tools:\s*read,\s*grep,\s*find,\s*ls\s*$/m);
  for (const forbidden of ["write", "edit", "bash"]) {
    expect(md.match(/^tools:.*$/m)?.[0]).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
  }
});

test("the + menu no longer opens the AGENTS.md editor", () => {
  const src = read("src/renderer/src/components/ChatView.tsx");
  const menu = src.slice(src.indexOf("attachMenuOpen && ("), src.indexOf("§23: plan-mode toggle — read-only"));
  expect(menu).not.toContain("Edit AGENTS.md");
  expect(menu).not.toContain("project context for the agent");
});

test("but the editor is still reachable — the banner and the file tree both open it", () => {
  // Removing the menu row must not orphan the panel. These are the two
  // surviving routes and they are both source-pinned, because the no-DOM suite
  // cannot click either one.
  const chat = read("src/renderer/src/components/ChatView.tsx");
  // The "no AGENTS.md here" banner's Generate one button.
  expect(chat).toMatch(/setOfferAgentsMd\(false\); onOpenAgentsMd\(\)/);
  // Clicking any AGENTS.md in the file tree opens the dialog, not a plain tab.
  const app = read("src/renderer/src/App.tsx");
  expect(app).toMatch(/tabBasename\(rel\) === "AGENTS\.md"/);
  expect(app).toMatch(/setAgentsMd\(rel\)/);
});
