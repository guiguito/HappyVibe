import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NAV } from "../src/renderer/src/components/Sidebar";
import { TASK_COPY } from "../src/renderer/src/components/OnBehalfView";

/** docs-round #31/#32/#21 — the Changes panel, pinned as source scans (no DOM in this suite). */
const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const panel = read("src/renderer/src/components/ChangesPanel.tsx");
const save = panel.slice(panel.indexOf("const doSave = async"), panel.indexOf("const doSwitch = async"));

describe("docs-round #31: the junk-files dialog", () => {
  it("offers Save anyway — §29: declining the .gitignore still saves, it is their repo", () => {
    expect(save).toContain('confirmLabel: "Add to .gitignore and save"');
    expect(save).toContain('secondary: { label: "Save anyway", onPick: () => { setConfirm(null); commit(); } }');
  });
});

describe("docs-round #32: the command line prints what saveVersion runs", () => {
  it("add -A unless only the staged files go in — amend or not", () => {
    expect(save).toContain('`${stagedOnly ? "" : "git add -A && "}git commit${opts.amend ? " --amend" : ""} -m "${text}"`');
    expect(save).not.toContain('"add -A && git commit"');
  });

  it("…which is git.ts's own rule", () => {
    const git = read("src/main/git.ts");
    const sv = git.slice(git.indexOf("export async function saveVersion"), git.indexOf("export async function stageFile"));
    expect(sv).toMatch(/if \(!opts\.stagedOnly\) \{\s*const add = await run\(state\.root, \["add", "-A"/);
    expect(sv).toContain('if (opts.amend) args.push("--amend");');
  });
});

describe("docs-round #21: the wand's tooltip", () => {
  const at = panel.indexOf('aria-label="Write it for me"');
  const wand = panel.slice(at - 600, at);

  it("promises no price — the model is whichever one AI autofill picks", () => {
    expect(wand).not.toMatch(/\$\d/);
    expect(wand).not.toContain("cheap");
  });

  it("names the setting that picks the model, in the words that page and the sidebar use", () => {
    const page = NAV.find((n) => n.view === "onBehalf")!.label;
    expect(wand).toContain(`using the model picked for ${TASK_COPY["commit-message"].title} in ${page}`);
    expect(wand).toContain("Not counted in session costs.");
  });
});
