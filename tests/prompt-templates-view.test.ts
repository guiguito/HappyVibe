import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPromptTemplateFile, type PromptTemplateSource, type DiscoveredPromptTemplate } from "../src/main/promptTemplates/discovery";
import { PromptTemplateRegistry } from "../src/main/promptTemplates/registry";
import { isShadowed, RESERVED_SLASH_COMMANDS, toPromptTemplateView } from "../src/main/promptTemplates/view";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmdview-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function mk(name: string, content = `---\ndescription: Ok.\n---\nbody`, source: PromptTemplateSource = "managed"): DiscoveredPromptTemplate {
  const abs = path.join(root, `${name}.md`);
  fs.writeFileSync(abs, content);
  return readPromptTemplateFile(abs, source);
}
const NOW = "2026-08-02T00:00:00.000Z";
const reg = (): PromptTemplateRegistry => new PromptTemplateRegistry(path.join(root, "r.jsonl"));

test("status: new command → needs-review (not changed)", () => {
  const v = toPromptTemplateView(mk("b"), reg());
  expect(v.status).toBe("needs-review");
  expect(v.changed).toBe(false);
});

test("status: approved+enabled → active (global view); disable → disabled", () => {
  const c = mk("c");
  const r = reg();
  r.approve(c, NOW);
  expect(toPromptTemplateView(c, r).status).toBe("active");
  r.setEnabled(c.id, false, NOW);
  expect(toPromptTemplateView(c, r).status).toBe("disabled");
});

test("changed=true only when a previously approved command's content moved", () => {
  const c = mk("d", `---\ndescription: V1.\n---\nv1 body`);
  const r = reg();
  r.approve(c, NOW);
  fs.writeFileSync(c.id, `---\ndescription: V2.\n---\nv2 body`);
  const v = toPromptTemplateView(readPromptTemplateFile(c.id, "managed"), r);
  expect(v.status).toBe("needs-review");
  expect(v.changed).toBe(true);
  // a never-approved command is new, not changed — the UI offers no diff for it
  expect(toPromptTemplateView(mk("d2"), r).changed).toBe(false);
});

test("workspace activation view: opt-out drops an approved command to disabled", () => {
  const c = mk("e");
  const r = reg();
  r.approve(c, NOW);
  expect(toPromptTemplateView(c, r, {}).status).toBe("active"); // default on
  expect(toPromptTemplateView(c, r, { [c.id]: false }).status).toBe("disabled");
});

test("bundled approved command shows disabled until globally enabled", () => {
  const c = mk("f", `---\ndescription: Bundled.\n---\nbody`, "bundled");
  const r = reg();
  r.approve(c, NOW, { enabled: false });
  expect(toPromptTemplateView(c, r).status).toBe("disabled");
  r.setEnabled(c.id, true, NOW);
  expect(toPromptTemplateView(c, r).status).toBe("active");
});

test("a name colliding with a bridge command is shadowed, whatever its approval state", () => {
  const c = mk("hv-plan");
  const r = reg();
  expect(toPromptTemplateView(c, r).status).toBe("shadowed"); // outranks needs-review
  r.approve(c, NOW);
  expect(toPromptTemplateView(c, r).status).toBe("shadowed"); // outranks active
  r.setEnabled(c.id, false, NOW);
  expect(toPromptTemplateView(c, r).status).toBe("shadowed"); // outranks disabled
  expect(toPromptTemplateView(c, r, { [c.id]: false }).status).toBe("shadowed");
});

test("isShadowed only matches the bridge's own commands", () => {
  expect(isShadowed("hv-tools")).toBe(true);
  expect(isShadowed("review")).toBe(false);
  expect(isShadowed("/hv-tools")).toBe(false); // names are bare, the slash is not part of them
  expect(RESERVED_SLASH_COMMANDS.has("hv-dangerous")).toBe(true);
});

test("the view carries the row's risk pill and inspector fields", () => {
  const c = mk("g", `---\ndescription: Risky.\nargument-hint: "[file]"\n---\nContext: !\`git status\``, "workspace");
  const v = toPromptTemplateView(c, reg());
  expect(v).toMatchObject({
    id: c.id,
    name: "g",
    description: "Risky.",
    argumentHint: "[file]",
    source: "workspace",
    hasBashInjection: true,
    estTokens: c.estTokens,
  });
});

test("provenance survives into the view", () => {
  const c = mk("h");
  const r = reg();
  r.approve(c, NOW, { provenance: { source: "git", sourceUrl: "https://example.test/x.git" } });
  expect(toPromptTemplateView(c, r).provenance?.sourceUrl).toBe("https://example.test/x.git");
});
