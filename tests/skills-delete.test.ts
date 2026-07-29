import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { planSkillRemoval, removeSkillDir } from "../src/main/skills/remove";

const ROOTS = { managed: "/app/skills", bundled: "/runtime/skills", workspaces: ["/ws/proj"] };

describe("planSkillRemoval", () => {
  it("deletes a managed (imported global) skill", () => {
    expect(planSkillRemoval({ id: "a", source: "managed", dir: "/app/skills/pdf" }, ROOTS).kind).toBe("delete");
  });

  it("deletes a workspace skill", () => {
    expect(planSkillRemoval({ id: "b", source: "workspace", dir: "/ws/proj/.agents/skills/x" }, ROOTS).kind).toBe("delete");
  });

  it("refuses to delete a bundled skill — the runtime reinstalls it at startup", () => {
    const p = planSkillRemoval({ id: "c", source: "bundled", dir: "/runtime/skills/skill-creator" }, ROOTS);
    expect(p.kind).toBe("refused");
    expect(p.reason).toMatch(/bundled/i);
  });

  it("unlinks a linked directory rather than deleting someone else's files", () => {
    expect(planSkillRemoval({ id: "d", source: "linked", dir: "/Users/me/.claude/skills/x" }, ROOTS).kind).toBe("unlink");
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
