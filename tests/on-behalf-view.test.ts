/**
 * §19 (2026-08-30) — the "On your behalf" page: the three model calls HappyVibe
 * makes without a session, and the first surface anywhere in the app that says
 * they exist.
 *
 * The renderer suite has no DOM, so the contract is pinned as exported DATA
 * (`TASK_COPY`, `NAV`) plus source scans for the absences. The absences are the
 * load-bearing half here: this page's design is as much about the fourth row it
 * does NOT have as about the three it does.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { NAV } from "../src/renderer/src/components/Sidebar";
import { TASK_COPY } from "../src/renderer/src/components/OnBehalfView";

const read = (rel: string): string => readFileSync(path.join(__dirname, "..", rel), "utf8");

/** The file with its comments removed — i.e. roughly what can reach the screen. */
const rendered = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("it sits after System prompt — both answer 'what does this app tell a model that I never typed'", () => {
  const ids = NAV.map((n) => n.view);
  expect(ids).toContain("onBehalf");
  expect(ids.indexOf("onBehalf")).toBe(ids.indexOf("sysprompt") + 1);
});

test("three tasks, and the AGENTS.md draft is NOT one of them (PRD §15)", () => {
  expect(Object.keys(TASK_COPY).sort()).toEqual(["commit-message", "pr-draft", "title"]);
  // The draft is a delegation governed by the Agents page — it runs on the
  // session's own model, enters the transcript, and already has its system
  // prompt and an agent-tier model override there. A second home would mean two
  // pages disagreeing about one thing's model.
  // Scanned with comments STRIPPED: the file's header explains at length why
  // there is no fourth row, and that explanation is the useful part. What must
  // not exist is a rendered mention — a row, a label, a line of copy.
  expect(rendered("src/renderer/src/components/OnBehalfView.tsx")).not.toMatch(/AGENTS\.md/);
  expect(rendered("src/renderer/src/components/OnBehalfView.tsx")).not.toMatch(/agents-md/);
});

test("every row says when it fires and what turning it off means", () => {
  for (const [id, c] of Object.entries(TASK_COPY)) {
    expect(c.when.length, `${id}.when`).toBeGreaterThan(20);
    expect(c.offMeans.length, `${id}.offMeans`).toBeGreaterThan(20);
  }
});

test("the PR row's 'off' does not claim the button disappears", () => {
  // The one switch of the three that gates the DRAFT rather than the button:
  // the forge still opens, the body falls back to the commit list. Saying
  // otherwise would be the page describing behaviour main does not implement.
  expect(TASK_COPY["pr-draft"].offMeans).toMatch(/still/i);
  expect(TASK_COPY["commit-message"].offMeans).toMatch(/gone|removed|disappear/i);
});

test("the page keeps the ledger honest — estimates, never a session's cost", () => {
  // §19 ruling 3: these calls run `pi -p --no-session`, so there IS no usage
  // record and a dollar figure would have to be invented. Tokens, never dollars.
  const src = read("src/renderer/src/components/OnBehalfView.tsx");
  expect(src).toMatch(/estimate/i);
  expect(src).not.toMatch(/\$\d/);
});
