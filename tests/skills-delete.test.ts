import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findLinkedRoot, planSkillRemoval, removeSkillDir } from "../src/main/skills/remove";


describe("planSkillRemoval", () => {
  it("deletes a managed (imported global) skill", () => {
    expect(planSkillRemoval({ id: "a", source: "managed", dir: "/app/skills/pdf" }).kind).toBe("delete");
  });

  it("deletes a workspace skill", () => {
    expect(planSkillRemoval({ id: "b", source: "workspace", dir: "/ws/proj/.agents/skills/x" }).kind).toBe("delete");
  });

  it("refuses to delete a bundled skill — the runtime reinstalls it at startup", () => {
    const p = planSkillRemoval({ id: "c", source: "bundled", dir: "/runtime/skills/skill-creator" });
    expect(p.kind).toBe("refused");
    expect(p.reason).toMatch(/bundled/i);
  });

  it("unlinks a linked directory rather than deleting someone else's files", () => {
    expect(planSkillRemoval({ id: "d", source: "linked", dir: "/Users/me/.claude/skills/x" }).kind).toBe("unlink");
  });
});

describe("removeSkillDir", () => {
  it("removes a directory inside an allowed root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-"));
    const dir = path.join(root, "skill");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "SKILL.md"), "x");
    removeSkillDir(dir, [root]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("refuses a path outside every allowed root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-"));
    expect(() => removeSkillDir(path.join(root, "..", "elsewhere"), [root])).toThrow(/outside/i);
  });

  it("refuses an allowed root itself (never delete the whole skills dir)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-"));
    expect(() => removeSkillDir(root, [root])).toThrow(/outside|root/i);
  });
});

describe("findLinkedRoot", () => {
  const ROOTS = ["/Users/me/.claude/skills", "/Users/me/other"];

  it("finds the configured root a skill subfolder lives under", () => {
    expect(findLinkedRoot("/Users/me/.claude/skills/pdf-tools", ROOTS)).toBe("/Users/me/.claude/skills");
  });

  it("matches the root itself", () => {
    expect(findLinkedRoot("/Users/me/other", ROOTS)).toBe("/Users/me/other");
  });

  it("does not match a sibling sharing a string prefix", () => {
    expect(findLinkedRoot("/Users/me/.claude/skills-evil/x", ROOTS)).toBeUndefined();
  });

  it("returns undefined when no root matches", () => {
    expect(findLinkedRoot("/elsewhere/x", ROOTS)).toBeUndefined();
  });
});

describe("removeSkillDir — symlink confinement (the one escape the review found)", () => {
  it("refuses a target reached through a symlinked path prefix", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-link-"));
    const root = path.join(tmp, "managed");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(outside, "precious"), { recursive: true });
    fs.writeFileSync(path.join(outside, "precious", "keep.txt"), "do not delete");
    // An imported skill archive could plant exactly this.
    fs.symlinkSync(outside, path.join(root, "evil"));

    expect(() => removeSkillDir(path.join(root, "evil", "precious"), [root])).toThrow(/outside/i);
    expect(fs.existsSync(path.join(outside, "precious", "keep.txt"))).toBe(true);
  });

  it("still deletes a real directory inside the root when a sibling symlink exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-link2-"));
    const root = path.join(tmp, "managed");
    const real = path.join(root, "pdf-tools");
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, "SKILL.md"), "x");
    fs.symlinkSync(tmp, path.join(root, "link"));

    removeSkillDir(real, [root]);
    expect(fs.existsSync(real)).toBe(false);
  });

  it("fails closed for a path that does not exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-del-missing-"));
    expect(() => removeSkillDir(path.join(tmp, "nope"), [tmp])).toThrow(/outside/i);
  });
});
