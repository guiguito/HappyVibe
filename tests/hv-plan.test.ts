import { describe, expect, test } from "vitest";
import {
  buildPlanFile,
  buildPlanPrompt,
  gatePlanCall,
  isSafeCommand,
  parsePlanFile,
  planSlug,
  PLAN_STATE_TYPE,
  PLAN_SAFE_SUBCOMMANDS,
  restorePlanState,
  shouldReconcilePlanOff,
  shouldForcePlanOff,
  withPlanStatus,
  type PlanSessionEntry,
} from "../pi-runtime/extensions/hv-plan";

// ── Bash allowlist (ported policy — verbatim accept/reject cases) ────────────

describe("isSafeCommand — accepts read-only forms", () => {
  const accepted = [
    "ls -la",
    "cat package.json",
    "grep -r foo src",
    "rg TODO",
    "find . -name '*.ts'",
    "head -20 README.md",
    "wc -l src/index.ts",
    "git status",
    "git log --no-textconv",
    "git diff --no-ext-diff --no-textconv",
    "git diff --check",
    "git branch --list",
    "git rev-parse --show-toplevel",
    "git blame --no-textconv -- src/x.ts",
    "cat a.txt | grep foo | sort",
    "npm test",
    "npm run typecheck",
    "npm ls",
    "tsc --noEmit",
    "node --version",
  ];
  for (const cmd of accepted) {
    test(cmd, () => expect(isSafeCommand(cmd, PLAN_SAFE_SUBCOMMANDS)).toBe(true));
  }
  test("gh read with --json (opt-in default)", () =>
    expect(isSafeCommand("gh pr view 1 --json number,title", PLAN_SAFE_SUBCOMMANDS)).toBe(true));
});

describe("isSafeCommand — rejects mutation / escape hatches", () => {
  const rejected = [
    "touch forbidden.txt",
    "rm -rf /",
    "echo hi > out.txt", // redirect
    "cat $(whoami)", // substitution
    "cat `id`", // backtick
    "ls & sleep 1", // background
    "git status && rm x", // unsafe segment in chain
    "npm install lodash", // mutating npm
    "npm run build", // not a test/check script
    "git blame -- src/x.ts", // missing --no-textconv
    "git diff", // missing guards
    "sed -i 's/a/b/' f", // in-place
    "find . -exec rm {} ;", // -exec
    "gh pr merge 1", // not a read path
    "gh pr view 1", // missing --json
    "python evil.py", // arbitrary program
    "curl http://x", // unknown command
    "vim file", // editor
    "FOO=bar ls", // env assignment
  ];
  for (const cmd of rejected) {
    test(cmd, () => expect(isSafeCommand(cmd, PLAN_SAFE_SUBCOMMANDS)).toBe(false));
  }
  test("empty command rejected", () => expect(isSafeCommand("")).toBe(false));
});

// ── Gate decision ────────────────────────────────────────────────────────────

describe("gatePlanCall", () => {
  test("blocks mutating builtins + subagent", () => {
    for (const t of ["edit", "write", "multi_edit", "subagent"]) {
      expect(gatePlanCall(t, {}).kind).toBe("block");
    }
  });
  test("passes read-only builtins + plan tools", () => {
    for (const t of ["read", "grep", "glob", "list", "ls", "ask_user", "plan_complete", "plan_start", "plan_status_update"]) {
      expect(gatePlanCall(t, {}).kind).toBe("pass");
    }
  });
  test("bash passes when allowlisted, blocks otherwise", () => {
    expect(gatePlanCall("bash", { command: "git status" }).kind).toBe("pass");
    expect(gatePlanCall("bash", { command: "touch x" }).kind).toBe("block");
  });
  test("unknown/MCP tools get floor-ask", () => {
    expect(gatePlanCall("mcp", {}).kind).toBe("floor-ask");
    expect(gatePlanCall("some_extension_tool", {}).kind).toBe("floor-ask");
  });
  test("block wins regardless of input shape (self-escalation guard)", () => {
    // The gate is a pure function of tool name + input; nothing about a
    // dangerous/bypass flag can flip a block — the bridge calls this BEFORE
    // the dangerous check, so a blocked tool stays blocked under bypass.
    expect(gatePlanCall("write", { path: "x", dangerous: true }).kind).toBe("block");
  });
});

// ── Plan-file parser + builder ───────────────────────────────────────────────

describe("parsePlanFile", () => {
  test("reads status front-matter + checkbox progress", () => {
    const md = [
      "---",
      "status: implementing",
      "createdAt: 2026-07-20T10:00:00.000Z",
      "---",
      "# Add auth",
      "## Tasks",
      "- [x] scaffold",
      "- [x] wire login",
      "- [ ] tests",
      "## Verification",
      "- run npm test",
    ].join("\n");
    expect(parsePlanFile(md)).toMatchObject({ status: "implementing", done: 2, total: 3, createdAt: "2026-07-20T10:00:00.000Z" });
  });
  test("defaults to draft when front-matter/status missing or invalid", () => {
    expect(parsePlanFile("# no front matter\n- [ ] a").status).toBe("draft");
    expect(parsePlanFile("---\nstatus: bogus\n---\nbody").status).toBe("draft");
  });
  test("zero tasks", () => expect(parsePlanFile("# x\nno tasks")).toMatchObject({ done: 0, total: 0 }));
});

describe("buildPlanFile / withPlanStatus", () => {
  const NOW = "2026-07-20T12:00:00.000Z";
  test("seeds createdAt on first write, strips any body front-matter", () => {
    const out = buildPlanFile("---\nstatus: whatever\n---\n# Plan\nbody", "draft", NOW);
    expect(out).toContain("status: draft");
    expect(out).toContain(`createdAt: ${NOW}`);
    expect(out).toContain("# Plan");
    expect(out.match(/^---/gm)?.length).toBe(2); // exactly one front-matter block
  });
  test("preserves createdAt across a status rewrite", () => {
    const first = buildPlanFile("# Plan\nbody", "draft", "2026-07-20T10:00:00.000Z");
    const later = withPlanStatus(first, "implemented", NOW);
    expect(later).toContain("createdAt: 2026-07-20T10:00:00.000Z");
    expect(later).toContain("status: implemented");
    expect(later).toContain(`updatedAt: ${NOW}`);
    expect(parsePlanFile(later).status).toBe("implemented");
  });
});

describe("planSlug", () => {
  test("derives from heading", () => expect(planSlug("# Add User Auth!\nbody")).toBe("add-user-auth"));
  test("falls back when no heading", () => expect(planSlug("no heading here")).toBe("plan"));
});

// ── State round-trip ─────────────────────────────────────────────────────────

describe("restorePlanState", () => {
  test("newest snapshot wins", () => {
    const entries: PlanSessionEntry[] = [
      { type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: true } },
      { type: "custom", customType: PLAN_STATE_TYPE, data: { enabled: true, planPath: ".agents/plans/001-x.md" } },
    ];
    expect(restorePlanState(entries)).toEqual({ enabled: true, planPath: ".agents/plans/001-x.md" });
  });
  test("defaults to disabled when no entry", () => {
    expect(restorePlanState([{ type: "message" }])).toEqual({ enabled: false });
  });
});

describe("buildPlanPrompt", () => {
  test("requires Tasks + Verification and forbids implementing", () => {
    const p = buildPlanPrompt();
    expect(p).toContain("Tasks");
    expect(p).toContain("Verification");
    expect(p).toContain("plan_complete");
    expect(p.toLowerCase()).toContain("read-only");
  });

  test("appends the user's addition after the built-in body, keeping the marker first", () => {
    const base = buildPlanPrompt();
    const withAppend = buildPlanPrompt("Prefer small diffs.");
    expect(withAppend.startsWith(base)).toBe(true);
    expect(withAppend.endsWith("Prefer small diffs.")).toBe(true);
    expect(buildPlanPrompt("   ")).toBe(base); // whitespace-only adds nothing
  });
});

describe("shouldReconcilePlanOff — self-heal a wedged respawn (§23 mid-turn-toggle fix)", () => {
  // The bug: clicking Plan mid-implementation persisted enabled:true; a respawn
  // restored plan mode ON over an implementing plan, wedging the session
  // read-only. Main forces off only on a RESTORED notify whose plan file is no
  // longer a draft.
  test("forces off: restored + enabled over a non-draft plan", () => {
    expect(shouldReconcilePlanOff(true, true, "implementing")).toBe(true);
    expect(shouldReconcilePlanOff(true, true, "implemented")).toBe(true);
    expect(shouldReconcilePlanOff(true, true, "cancelled")).toBe(true);
  });
  test("forces off: restored + enabled over a missing plan file (status null)", () => {
    expect(shouldReconcilePlanOff(true, true, null)).toBe(true);
  });
  test("keeps on: restored + enabled while the plan is still a draft (legit plan mode)", () => {
    expect(shouldReconcilePlanOff(true, true, "draft")).toBe(false);
  });
  test("never reconciles a LIVE toggle (restored=false) — re-planning after implementing is honored", () => {
    expect(shouldReconcilePlanOff(false, true, "implementing")).toBe(false);
    expect(shouldReconcilePlanOff(false, true, null)).toBe(false);
  });
  test("never reconciles when plan mode is already off", () => {
    expect(shouldReconcilePlanOff(true, false, "implementing")).toBe(false);
  });
});

describe("shouldForcePlanOff — Plan Mode disabled globally must not strand a clamped session (§13 round 6)", () => {
  test("forces off a session that was mid-plan when the feature is disabled", () => {
    expect(shouldForcePlanOff(false, { enabled: true })).toBe(true);
    expect(shouldForcePlanOff(false, { enabled: true, planPath: "/ws/.agents/plans/001-x.md" })).toBe(true);
  });

  test("forces off a session carrying only a planPath (exited plan, path still recorded)", () => {
    expect(shouldForcePlanOff(false, { enabled: false, planPath: "/ws/.agents/plans/001-x.md" })).toBe(true);
  });

  test("leaves plan state alone while the feature is enabled", () => {
    expect(shouldForcePlanOff(true, { enabled: true })).toBe(false);
    expect(shouldForcePlanOff(true, { enabled: true, planPath: "/p.md" })).toBe(false);
  });

  test("is a no-op for a session with no plan state either way", () => {
    expect(shouldForcePlanOff(false, { enabled: false })).toBe(false);
    expect(shouldForcePlanOff(true, { enabled: false })).toBe(false);
  });
});
