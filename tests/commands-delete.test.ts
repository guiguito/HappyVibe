import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { planCommandRemoval, removeCommandFile } from "../src/main/commands/remove";

describe("planCommandRemoval", () => {
  it("deletes a managed (imported global) command", () => {
    const p = planCommandRemoval({ id: "/app/prompts/review.md", source: "managed" });
    expect(p.action).toBe("delete");
    expect(p.path).toBe("/app/prompts/review.md");
  });

  it("deletes a workspace command, warning it is probably git-tracked", () => {
    const p = planCommandRemoval({ id: "/ws/proj/.agents/prompts/x.md", source: "workspace" });
    expect(p.action).toBe("delete");
    expect(p.reason).toMatch(/git-tracked/i);
  });

  it("deletes a .claude/commands file, warning it is probably git-tracked and team-owned", () => {
    const p = planCommandRemoval({ id: "/ws/proj/.claude/commands/team.md", source: "claude" });
    expect(p.action).toBe("delete");
    expect(p.reason).toMatch(/git-tracked/i);
  });

  it("refuses to delete a bundled command — the runtime reinstalls it at startup", () => {
    const p = planCommandRemoval({ id: "/runtime/prompts/review.md", source: "bundled" });
    expect(p.action).toBe("refused");
    expect(p.reason).toMatch(/bundled/i);
  });

  it("unlinks the linked directory rather than deleting someone else's file", () => {
    const p = planCommandRemoval({ id: "/Users/me/.claude/commands/x.md", source: "linked" });
    expect(p.action).toBe("unlink");
    expect(p.path).toBe("/Users/me/.claude/commands"); // the ROOT, not the file
  });
});

describe("removeCommandFile", () => {
  it("removes a file sitting directly in an allowed root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmd-del-"));
    const file = path.join(root, "review.md");
    fs.writeFileSync(file, "x");
    removeCommandFile(file, [root]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("refuses a traversal out of every allowed root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmd-del-"));
    expect(() => removeCommandFile(path.join(root, "..", "..", "etc", "passwd"), [root])).toThrow(/outside/i);
  });

  it("refuses an allowed root itself (never rm the whole prompts dir)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmd-del-"));
    expect(() => removeCommandFile(root, [root])).toThrow(/outside|root/i);
  });

  it("refuses a target reached through a symlinked path prefix", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmd-del-link-"));
    const root = path.join(tmp, "prompts");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "keep.md"), "do not delete");
    // A git-imported command pack could plant exactly this.
    fs.symlinkSync(outside, path.join(root, "evil"));

    expect(() => removeCommandFile(path.join(root, "evil", "keep.md"), [root])).toThrow(/outside/i);
    expect(fs.existsSync(path.join(outside, "keep.md"))).toBe(true);
  });

  it("fails closed for a path that does not exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-cmd-del-missing-"));
    expect(() => removeCommandFile(path.join(tmp, "nope.md"), [tmp])).toThrow(/outside/i);
  });
});
