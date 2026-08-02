import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCommandFile, type CommandSource, type DiscoveredCommand } from "../src/main/commands/discovery";
import { CommandRegistry } from "../src/main/commands/registry";
import { isShadowed, RESERVED_COMMAND_NAMES, toCommandView } from "../src/main/commands/view";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmdview-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function mk(name: string, content = `---\ndescription: Ok.\n---\nbody`, source: CommandSource = "managed"): DiscoveredCommand {
  const abs = path.join(root, `${name}.md`);
  fs.writeFileSync(abs, content);
  return readCommandFile(abs, source);
}
const NOW = "2026-08-02T00:00:00.000Z";
const reg = (): CommandRegistry => new CommandRegistry(path.join(root, "r.jsonl"));

test("status: new command → needs-review (not changed)", () => {
  const v = toCommandView(mk("b"), reg());
  expect(v.status).toBe("needs-review");
  expect(v.changed).toBe(false);
});

test("status: approved+enabled → active (global view); disable → disabled", () => {
  const c = mk("c");
  const r = reg();
  r.approve(c, NOW);
  expect(toCommandView(c, r).status).toBe("active");
  r.setEnabled(c.id, false, NOW);
  expect(toCommandView(c, r).status).toBe("disabled");
});

test("changed=true only when a previously approved command's content moved", () => {
  const c = mk("d", `---\ndescription: V1.\n---\nv1 body`);
  const r = reg();
  r.approve(c, NOW);
  fs.writeFileSync(c.id, `---\ndescription: V2.\n---\nv2 body`);
  const v = toCommandView(readCommandFile(c.id, "managed"), r);
  expect(v.status).toBe("needs-review");
  expect(v.changed).toBe(true);
  // a never-approved command is new, not changed — the UI offers no diff for it
  expect(toCommandView(mk("d2"), r).changed).toBe(false);
});

test("workspace activation view: opt-out drops an approved command to disabled", () => {
  const c = mk("e");
  const r = reg();
  r.approve(c, NOW);
  expect(toCommandView(c, r, {}).status).toBe("active"); // default on
  expect(toCommandView(c, r, { [c.id]: false }).status).toBe("disabled");
});

test("bundled approved command shows disabled until globally enabled", () => {
  const c = mk("f", `---\ndescription: Bundled.\n---\nbody`, "bundled");
  const r = reg();
  r.approve(c, NOW, { enabled: false });
  expect(toCommandView(c, r).status).toBe("disabled");
  r.setEnabled(c.id, true, NOW);
  expect(toCommandView(c, r).status).toBe("active");
});

test("a name colliding with a bridge command is shadowed, whatever its approval state", () => {
  const c = mk("hv-plan");
  const r = reg();
  expect(toCommandView(c, r).status).toBe("shadowed"); // outranks needs-review
  r.approve(c, NOW);
  expect(toCommandView(c, r).status).toBe("shadowed"); // outranks active
  r.setEnabled(c.id, false, NOW);
  expect(toCommandView(c, r).status).toBe("shadowed"); // outranks disabled
  expect(toCommandView(c, r, { [c.id]: false }).status).toBe("shadowed");
});

test("isShadowed only matches the bridge's own commands", () => {
  expect(isShadowed("hv-tools")).toBe(true);
  expect(isShadowed("review")).toBe(false);
  expect(isShadowed("/hv-tools")).toBe(false); // names are bare, the slash is not part of them
  expect(RESERVED_COMMAND_NAMES.has("hv-dangerous")).toBe(true);
});

test("the view carries the row's risk pill and inspector fields", () => {
  const c = mk("g", `---\ndescription: Risky.\nargument-hint: "[file]"\n---\nContext: !\`git status\``, "claude");
  const v = toCommandView(c, reg());
  expect(v).toMatchObject({
    id: c.id,
    name: "g",
    description: "Risky.",
    argumentHint: "[file]",
    source: "claude",
    hasBashInjection: true,
    estTokens: c.estTokens,
  });
});

test("provenance survives into the view", () => {
  const c = mk("h");
  const r = reg();
  r.approve(c, NOW, { provenance: { source: "git", sourceUrl: "https://example.test/x.git" } });
  expect(toCommandView(c, r).provenance?.sourceUrl).toBe("https://example.test/x.git");
});
