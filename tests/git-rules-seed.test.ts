import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GIT_RULES, seedDefaultGitRules } from "../src/main/gitRules";
import { evaluate, parseRulesFile } from "../pi-runtime/extensions/hv-rules";

/**
 * §4 — the shipped git rules.
 *
 * They are SUGGESTIONS, not policy: seeded once, then ordinary user rules that
 * can be edited or deleted in the Permissions UI like any other. The seed-once
 * flag is the whole mechanism that makes a deletion stick, so it is what these
 * tests are mostly about.
 */

let dir: string;
let rulesPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-gitrules-"));
  rulesPath = path.join(dir, "permission-rules.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = (): ReturnType<typeof parseRulesFile> => parseRulesFile(fs.readFileSync(rulesPath, "utf8"));

describe("seedDefaultGitRules", () => {
  it("writes the shipped rules on a first run", () => {
    expect(seedDefaultGitRules(rulesPath, false)).toBe(true);
    const patterns = read().global.map((r) => `${r.action} ${r.pattern}`);
    expect(patterns).toContain("ask git push*");
    expect(patterns).toContain("ask git reset --hard*");
    expect(patterns).toContain("ask git checkout -- *");
    expect(patterns).toContain("ask git clean*");
    expect(patterns).toContain("ask git rebase*");
    expect(patterns).toContain("deny git push --force*");
    expect(patterns).toContain("ask git worktree remove --force*");
  });

  it("does nothing at all when already seeded", () => {
    expect(seedDefaultGitRules(rulesPath, true)).toBe(false);
    expect(fs.existsSync(rulesPath)).toBe(false);
  });

  it("keeps a DELETED rule deleted — the point of the flag", () => {
    seedDefaultGitRules(rulesPath, false);

    // The user removes the force-push deny in the Permissions UI.
    const after = read();
    after.global = after.global.filter((r) => r.pattern !== "git push --force*");
    fs.writeFileSync(rulesPath, JSON.stringify(after));

    // A later launch must NOT resurrect it: they are suggestions, and a
    // suggestion that comes back after you delete it is policy wearing a hat.
    expect(seedDefaultGitRules(rulesPath, true)).toBe(false);
    expect(read().global.some((r) => r.pattern === "git push --force*")).toBe(false);
  });

  it("preserves the user's own rules verbatim", () => {
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({
        global: [{ layer: "command", pattern: "npm test*", action: "allow" }],
        workspaces: { "/some/ws": [{ layer: "tool", pattern: "edit", action: "deny" }] },
      })
    );
    seedDefaultGitRules(rulesPath, false);

    const r = read();
    expect(r.global).toContainEqual({ layer: "command", pattern: "npm test*", action: "allow" });
    expect(r.workspaces["/some/ws"]).toEqual([{ layer: "tool", pattern: "edit", action: "deny" }]);
    expect(r.global.length).toBe(1 + DEFAULT_GIT_RULES.length);
  });

  it("never duplicates a rule the user already wrote by hand", () => {
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({ global: [{ layer: "command", pattern: "git push*", action: "ask" }], workspaces: {} })
    );
    seedDefaultGitRules(rulesPath, false);
    expect(read().global.filter((r) => r.pattern === "git push*")).toHaveLength(1);
  });

  it("survives a corrupt rules file rather than throwing at startup", () => {
    fs.writeFileSync(rulesPath, "{ not json at all");
    expect(() => seedDefaultGitRules(rulesPath, false)).not.toThrow();
    expect(read().global.length).toBe(DEFAULT_GIT_RULES.length);
  });
});

describe("what the rules actually do in the engine", () => {
  it("keeps the destructive verbs asking THROUGH a broad user allow", () => {
    seedDefaultGitRules(rulesPath, false);
    const rules = read();
    // The reason these rules exist at all: the day the user adds `git *` as an
    // allow to kill prompt fatigue, most-restrictive-wins must keep the
    // dangerous verbs gated.
    rules.global.unshift({ layer: "command", pattern: "git *", action: "allow" });

    const call = (command: string): string =>
      evaluate(rules, { tool: "bash", input: { command }, workspace: "/ws" }).action;

    expect(call("git status")).toBe("allow");
    expect(call("git log --oneline")).toBe("allow");
    expect(call("git push origin main")).toBe("ask");
    expect(call("git reset --hard HEAD~1")).toBe("ask");
    expect(call("git clean -fd")).toBe("ask");
    expect(call("git rebase -i main")).toBe("ask");
    expect(call("git push --force origin main")).toBe("deny");
  });

  it("is best-effort steering, NOT a security boundary — and fails safe", () => {
    seedDefaultGitRules(rulesPath, false);
    const rules = read();
    const call = (command: string): string =>
      evaluate(rules, { tool: "bash", input: { command }, workspace: "/ws" }).action;

    // Round 29: every part of a chain is checked, so a `cd` in front no longer
    // slips past the deny. A spelling the pattern does not name still does —
    // recorded deliberately: it falls back to ask, so the default fails safe,
    // and the docs must not claim more than that.
    expect(call("cd x && git push --force")).toBe("deny");
    expect(call("git -C repo push -f")).toBe("ask");
  });

  it("with no allow, a read-only git query runs and anything that changes the repo asks", () => {
    seedDefaultGitRules(rulesPath, false);
    const rules = read();
    // Round 29: a read-only git query (`git status`) is a safe default; anything that changes the repo asks.
    expect(evaluate(rules, { tool: "bash", input: { command: "git status" }, workspace: "/ws", workspaceHasGit: true }).action).toBe("allow");
    expect(evaluate(rules, { tool: "bash", input: { command: "git commit -m x" }, workspace: "/ws" }).action).toBe("ask");
  });
});

describe("the seeded git rules hold for a chained command (round 29)", () => {
  it("cd … && git push asks, and --force is denied", () => {
    const rules = { global: [...DEFAULT_GIT_RULES], workspaces: {} };
    const at = (command: string) => evaluate(rules, { tool: "bash", input: { command }, workspace: "/ws" }).action;
    expect(at("cd /ws && git push origin main")).toBe("ask");
    expect(at("cd /ws && git push --force")).toBe("deny");
  });
});
