import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildPlanFile,
  buildPlanPrompt,
  gatePlanCall,
  resolvePlanVerdict,
  isSafeCommand,
  parsePlanFile,
  planSlug,
  PLAN_STATE_TYPE,
  PLAN_SAFE_SUBCOMMANDS,
  restorePlanState,
  shouldReconcilePlanOff,
  shouldForcePlanOff,
  forcedPlanOffState,
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
  test("blocks mutating builtins; subagent now defers to its boundary", () => {
    for (const t of ["edit", "write", "multi_edit"]) {
      expect(gatePlanCall(t, {}).kind).toBe("block");
    }
    // §23 (2026-08-21): `subagent` left this set on purpose. It is NOT a pass —
    // the bridge must resolve the child's toolset and block anything wider than
    // read-only. Asserted here so the change reads as deliberate rather than as
    // a tool that fell out of the blocked list.
    expect(gatePlanCall("subagent", { agent: "code-explorer" }).kind).toBe("needs-boundary");
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

  test("forcedPlanOffState clears the clamp but KEEPS the plan file reference", () => {
    // Regression guard: returning a bare {enabled:false} here loses the user's
    // plan file, and main's restore-reconcile then skips the session (it requires
    // a planPath), so re-enabling Plan mode restored a clamped session silently.
    expect(forcedPlanOffState({ enabled: true, planPath: "/ws/.agents/plans/001-x.md" })).toEqual({
      enabled: false,
      planPath: "/ws/.agents/plans/001-x.md",
    });
    expect(forcedPlanOffState({ enabled: true })).toEqual({ enabled: false });
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

/**
 * §23 round 16 — the "second plan in one session" regressions, measured on a live
 * session (2026-08-16, Test3DGames). Both are ABSENCES, so they are source scans:
 * the repo's established shape for pinning what must no longer be there
 * (tests/modal-layer.test.ts).
 */
describe("re-entering Plan Mode for a SECOND plan", () => {
  const read = (p: string): string => fs.readFileSync(p, "utf8");

  test("main never falls back to the previous planPath", () => {
    // The bridge clears planPath on every entry into a NEW plan and is
    // authoritative. Falling back to the finished plan's path made plan #2's
    // plan_complete pass it as writePlanFile's `existingRelPath`, so the second
    // plan OVERWROTE the first file instead of creating NNN+1 — and the renderer
    // deduped the repeated path away, leaving plan #2 with no card and no
    // Implement button.
    expect(read("src/main/ipc.ts")).not.toMatch(/\?\?\s*prev\?\.planPath/);
  });

  test("the bridge does not hide tools while planning — the gate refuses with a reason", () => {
    // setActiveTools is real (agent-session.js:1880-1882), so hiding `edit` made
    // the model's call die in agent-loop.js:398 as the bare `Tool edit not found`
    // — no reason, no mention of Plan Mode. It read that as a whitespace mismatch
    // and only learned it was planning when a bash call hit gatePlanCall's
    // explanatory refusal.
    expect(read("pi-runtime/extensions/happyvibe-bridge.ts")).not.toMatch(/^\s*[^/*\n].*setActiveTools/m);
  });

  test("the Implement hand-off states the work, never the mode", () => {
    // It lives in the conversation forever; mode changes underneath it. Reading
    // "Plan mode is off, full tools restored" one round later, the model reasoned
    // "I'm in normal mode now, not plan mode" and started editing.
    expect(read("src/main/ipc.ts")).not.toMatch(/Plan mode is off/);
  });
});

/**
 * §23 (2026-08-21) — a read-only delegation is allowed while planning.
 *
 * The original clamp blocked `subagent` outright, for one stated reason: a child
 * carried its own tool set and nothing on our side could bound it. §12's
 * capability ceiling removes that reason, and blocking exploration during the
 * phase that exists for exploration was cost without benefit.
 *
 * The verdict depends on the child's RESOLVED toolset, which this pure module
 * cannot see (preflight is async and lives in the bridge), so the answer is
 * deferred rather than guessed — as a distinct variant, so a caller that forgets
 * to resolve it fails the TYPECHECK instead of silently allowing an unbounded
 * child during a read-only mode.
 */
describe("plan mode and delegation", () => {
  test("subagent defers to the boundary instead of being blocked outright", () => {
    expect(gatePlanCall("subagent", { agent: "code-explorer" }).kind).toBe("needs-boundary");
  });

  test("defers even with no agent named — the bridge decides, not this module", () => {
    // A malformed call must not accidentally take the `pass` path.
    expect(gatePlanCall("subagent", {}).kind).toBe("needs-boundary");
  });

  test("every OTHER blocked tool is still blocked", () => {
    for (const t of ["edit", "write", "multi_edit", "terminal_run", "browser_click", "browser_type", "browser_evaluate"]) {
      expect(gatePlanCall(t, {}).kind, t).toBe("block");
    }
  });

  test("the read-only builtins still pass and unknown tools still floor-ask", () => {
    for (const t of ["read", "grep", "ls", "find"]) expect(gatePlanCall(t, {}).kind, t).toBe("pass");
    expect(gatePlanCall("some_extension_tool", {}).kind).toBe("floor-ask");
  });

  test("subagent is NOT in the blocked set any more, and nothing else left it", () => {
    // Guards the edit itself: removing `subagent` from BLOCKED_PLAN_TOOLS must not
    // have removed anything else with it.
    const src = fs.readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "hv-plan.ts"), "utf8");
    const line = src.split("\n").find((l) => l.includes("BLOCKED_PLAN_TOOLS = new Set"))!;
    expect(line).not.toMatch(/"subagent"/);
    for (const t of ["edit", "write", "multi_edit", "terminal_run"]) expect(line).toContain(`"${t}"`);
  });

  test("the bridge delegates the verdict to the typechecked module", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts"), "utf8");
    // The decision lives in hv-plan.ts because happyvibe-bridge.ts is in NEITHER
    // tsconfig — an exhaustiveness check written there is decorative (verified by
    // deleting a branch and watching the typecheck stay green).
    expect(src).toContain("resolvePlanVerdict(gatePlanCall(tool, input), boundary)");
  });
});

describe("resolvePlanVerdict", () => {
  const ro = { agent: "code-explorer", tools: ["read", "grep", "find", "ls"] };
  const rw = { agent: "writer", tools: ["read", "write"] };
  const needs = { kind: "needs-boundary" } as const;

  test("a read-only delegation becomes floor-ask — allowed, but still prompts", () => {
    // floor-ask rather than pass on purpose: planning must never SILENTLY spawn a
    // child. The user sees the boundary and clicks.
    expect(resolvePlanVerdict(needs, ro)).toEqual({ kind: "floor-ask" });
  });

  test("a write-capable delegation is blocked, naming the offending tools", () => {
    const v = resolvePlanVerdict(needs, rw);
    expect(v.kind).toBe("block");
    expect(v.kind === "block" && v.reason).toContain("write");
    expect(v.kind === "block" && v.reason).toMatch(/read-only/i);
  });

  test("an unresolvable boundary is blocked, not waved through", () => {
    const v = resolvePlanVerdict(needs, undefined);
    expect(v.kind).toBe("block");
    expect(v.kind === "block" && v.reason).toMatch(/could not be resolved/i);
  });

  test("a fan-out-capable child is blocked even though subagent is not a write", () => {
    // It can reach further than read-only by delegating onwards, so it is not
    // read-only for plan-mode purposes.
    expect(resolvePlanVerdict(needs, { agent: "a", tools: ["read", "subagent"] }).kind).toBe("block");
  });

  test("an unknown tool in the boundary blocks — unknown is not safe", () => {
    expect(resolvePlanVerdict(needs, { agent: "a", tools: ["read", "some_mcp_tool"] }).kind).toBe("block");
  });

  test("passes every other gate through untouched", () => {
    expect(resolvePlanVerdict({ kind: "pass" }, undefined)).toEqual({ kind: "pass" });
    expect(resolvePlanVerdict({ kind: "floor-ask" }, undefined)).toEqual({ kind: "floor-ask" });
    const b = { kind: "block", reason: "nope" } as const;
    expect(resolvePlanVerdict(b, undefined)).toEqual(b);
  });

  test("the boundary is IGNORED for non-delegation gates", () => {
    // A boundary should never turn a blocked edit into something else.
    expect(resolvePlanVerdict({ kind: "block", reason: "x" }, ro).kind).toBe("block");
  });
});
