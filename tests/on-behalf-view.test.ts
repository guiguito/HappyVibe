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

/**
 * Round 18 supersedes §19's "sits after System prompt".
 *
 * That pairing was argued from the QUESTION the two pages answer ("what does
 * this app tell a model, that I never typed?"), which is true but is not how
 * the nav is grouped. The pages differ in KIND: System prompt is a standing
 * instruction that shapes every session, while this page carries a per-task
 * `(model, append, on/off)` record — you turn each call OFF here. That makes
 * it app behaviour you configure, so it sits in "App features" beside
 * Terminal, Voice and Keyboard shortcuts, and NOT in "The record", whose three
 * pages are read-only.
 */
test("it is an app feature you configure, not a record you read", () => {
  const n = NAV.find((x) => x.view === "onBehalf");
  expect(n?.group).toBe("app");
  // The read-only block must not acquire a page with switches on it.
  expect(NAV.filter((x) => x.group === "record").map((x) => x.view)).toEqual([
    "stats",
    "audit",
    "changelog",
  ]);
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

test("the pr-draft switch gates the DRAFT, never the URL", () => {
  /*
   * The one switch of the three whose "off" is not "the button disappears":
   * the forge still opens, the description falls back to the commit list.
   *
   * Pinned as a source scan because the GUI cannot show it without a repo on a
   * PR-eligible branch, and because the shape is what protects it: `enabled`
   * must appear ONLY in the condition guarding the draft, while the title, the
   * body and the URL are computed after that block and outside it. Move the
   * url line inside and the button silently vanishes when the switch is off.
   */
  const src = read("src/main/ipc.ts");
  const handler = src.slice(src.indexOf('ipcMain.handle("hv:git-pr-url"'));
  const body = handler.slice(0, handler.indexOf("\n  });"));

  const guard = body.indexOf("if (draft && task.enabled)");
  const closeOfGuard = body.indexOf("\n    }", guard);
  const urlLine = body.indexOf("const url = pullRequestUrl(");
  const titleLine = body.indexOf("const title = drafted?.title ||");

  expect(guard).toBeGreaterThan(-1);
  // Everything that decides whether the button EXISTS is after the guard closes.
  expect(titleLine).toBeGreaterThan(closeOfGuard);
  expect(urlLine).toBeGreaterThan(closeOfGuard);
  // And the switch is consulted nowhere else in this handler.
  expect(body.match(/task\.enabled/g)).toHaveLength(1);
});

