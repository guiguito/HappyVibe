/**
 * Contract tests — every pi-subagents behaviour HappyVibe is pin-coupled to
 * (the pin-bump gate). Three groups, all key-free (no Pi spawn, no model):
 *
 *   1. the active-run inventory behind /hv-subagent-list       (the deep import)
 *   2. the parent-blocking wait tool                            (PRD §12 guard)
 *   3. bundled agents' `tools:` allowlist                       (delegation works)
 *   4. rpc mode is UI-ful, disarming the auto-drain              (PRD §12 guard)
 *
 * Groups 2-4 exist because the 0.34.0 → 0.40.0 bump broke or endangered all three
 * SILENTLY — no test failed, and each defeats the same locked decision ("delegate
 * without blocking the turn"). A literal tool-name match, a tool list that was
 * never validated, and an upstream hook gated on one boolean are exactly the
 * things a pin bump changes without telling anyone.
 *
 * Group 1 detail — the active-run inventory:
 *
 * `/hv-subagent-list` resyncs the subagent cards after a respawn, and it needs
 * three fields per run: `runId` (to interrupt), `agent` (to label the card) and
 * `asyncDir` (src/main/subagentStatus.ts tails `<asyncDir>/status.json` for live
 * progress). NOTHING on pi-subagents' public surface returns them:
 *
 *   - `snapshotBackgroundWork()` — a `BackgroundWorkItem` is only {id, sessionId},
 *     and pi-subagents never registers itself as a provider, so it comes back empty.
 *     It is an API for OTHER extensions to declare work TO pi-subagents.
 *   - the `status` RPC's `fleet` field (0.40.0) IS structured, but its entry key is
 *     documented "Opaque key for client-side reconciliation; never a run or async
 *     identifier" (pi-subagents/src/extension/rpc.ts:76) — no runId, no asyncDir.
 *
 * So the bridge reads `listAsyncRuns` + `ASYNC_DIR` straight out of the package's
 * internals. From 0.35.0 pi-subagents ships an `exports` map that does not list
 * either file, which makes the BARE specifier unresolvable — hence the RELATIVE
 * path (an exports map only gates bare specifiers). This test pins that route:
 * a future pin that moves or renames either file fails HERE, loudly, instead of
 * silently degrading the card resync.
 *
 * Key-free: no Pi spawn, no model. Stays in the non-live suite.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The exact specifiers happyvibe-bridge.ts uses, re-rooted from tests/ to
// pi-runtime/. If these two imports break, so does the bridge — at load time,
// taking every Pi-spawning test with it.
import { listAsyncRuns } from "../pi-runtime/node_modules/pi-subagents/src/runs/background/async-status.ts";
import { ASYNC_DIR } from "../pi-runtime/node_modules/pi-subagents/src/shared/types.ts";
import { drainOutstandingWork } from "../pi-runtime/node_modules/pi-subagents/src/runs/background/auto-drain.ts";
import { WAIT_TOOLS, isWaitTool } from "../pi-runtime/extensions/hv-rules";

const BRIDGE = path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts");
const PKG = path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "package.json");

describe("pi-subagents active-run inventory contract", () => {
  it("reaches the internals by relative path — a bare specifier the exports map blocks", () => {
    const src = readFileSync(BRIDGE, "utf8");
    // The regression this guards: someone "tidies" the relative path back into a
    // bare `pi-subagents/src/...` specifier. That throws at extension load
    // ("Missing ... specifier in pi-subagents package") and takes ~18 tests red.
    expect(src).not.toMatch(/from\s+"pi-subagents\/src\//);
    expect(src).toContain('from "../node_modules/pi-subagents/src/runs/background/async-status.ts"');
    expect(src).toContain('from "../node_modules/pi-subagents/src/shared/types.ts"');
  });

  it("still ships an exports map that omits both files (why the relative path exists)", () => {
    const exports = (JSON.parse(readFileSync(PKG, "utf8")) as { exports?: Record<string, string> }).exports;
    // If a future pin DROPS the exports map this assertion goes stale, not wrong:
    // the relative path keeps working either way. It documents the constraint.
    expect(exports).toBeDefined();
    expect(Object.keys(exports ?? {})).not.toContain("./src/runs/background/async-status.ts");
  });

  it("ASYNC_DIR is a tmpdir-confined async-subagent-runs root", () => {
    // subagentStatus.ts refuses any asyncDir outside os.tmpdir() — that guard is
    // only meaningful while pi-subagents actually roots its runs there.
    expect(ASYNC_DIR.startsWith(os.tmpdir())).toBe(true);
    expect(path.basename(ASYNC_DIR)).toBe("async-subagent-runs");
  });

  it("listAsyncRuns yields {id, asyncDir, steps[].agent} for an active run", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "hv-async-runs-"));
    const runId = "run-contract-fixture";
    const dir = path.join(root, runId);
    mkdirSync(dir);
    // No `pid`: the stale-run reconciler short-circuits on a non-running or
    // pid-less status, so the fixture is read back verbatim.
    writeFileSync(path.join(dir, "status.json"), JSON.stringify({
      runId,
      sessionId: "session-under-test",
      state: "queued",
      mode: "single",
      startedAt: 1,
      lastUpdate: 1,
      steps: [{ index: 0, agent: "researcher", status: "pending" }],
    }));

    // Called exactly as the bridge calls it (happyvibe-bridge.ts /hv-subagent-list).
    const runs = listAsyncRuns(root, { states: ["queued", "running"], sessionId: "session-under-test" });
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(runId);
    expect(runs[0].asyncDir).toBe(dir);
    expect(runs[0].steps?.[0]?.agent).toBe("researcher");

    // The filters the bridge relies on must actually filter.
    expect(listAsyncRuns(root, { states: ["queued"], sessionId: "another-session" })).toHaveLength(0);
    expect(listAsyncRuns(root, { states: ["complete"], sessionId: "session-under-test" })).toHaveLength(0);
  });

  it("returns empty rather than throwing when the runs root does not exist", () => {
    // The bridge wraps the call in try/catch, but an absent root is the normal
    // "no delegation has ever run" case and must not be an error path.
    expect(listAsyncRuns(path.join(os.tmpdir(), "hv-async-runs-does-not-exist"))).toEqual([]);
  });
});

describe("pi-subagents parent-blocking wait tool contract", () => {
  // PRD §12 ("never block on the result"): pi-subagents tells the model to call
  // its wait tool when it has nothing else to do, which re-blocks the turn and
  // defeats "keep chatting while sub-agents run". The bridge blocks that call and
  // hands back guidance instead. That guard matches on the TOOL NAME, so a rename
  // disarms it silently — which is exactly what 0.35+ did (`wait` →
  // `subagent_wait`, no alias). This test is the tripwire.
  it("registers a tool name the bridge's guard actually covers", () => {
    const src = readFileSync(
      path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "runs", "background", "wait-tool.ts"),
      "utf8",
    );
    const names = [...src.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(names.length, "wait-tool.ts should register exactly one tool").toBe(1);
    // The whole point: whatever upstream calls it, WAIT_TOOLS must contain it.
    expect(WAIT_TOOLS.has(names[0])).toBe(true);
  });

  it("keeps the pre-0.35 name too, so the guard spans both pins", () => {
    expect(isWaitTool("wait")).toBe(true);
    expect(isWaitTool("subagent_wait")).toBe(true);
    expect(isWaitTool("subagent")).toBe(false);
    expect(isWaitTool(undefined)).toBe(false);
  });

  it("is matched via isWaitTool in the bridge and the renderer, never a literal", () => {
    // Two call sites, two different layers: the bridge BLOCKS the call, the
    // renderer HIDES the tool card. A literal in either one is the bug.
    const bridge = readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts"), "utf8");
    const app = readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "App.tsx"), "utf8");
    expect(bridge).toMatch(/isWaitTool\(/);
    expect(bridge).not.toMatch(/tool === "wait"/);
    expect(app).toMatch(/isWaitTool\(/);
    expect(app).not.toMatch(/toolName === "wait"/);
  });
});

describe("bundled agent definitions declare only child tools that exist", () => {
  // pi-subagents 0.40.0 added tool-availability.ts: `tools:` is now a STRICT
  // allowlist, and an unknown name FAILS THE WHOLE RUN
  //   "Agent 'code-explorer' requested unavailable child tools: glob, list."
  // 0.34 had no such file and silently ignored unknown names, so both bundled
  // agents shipped asking for `glob` and `list` — which Pi has NEVER had (its
  // builtins are bash, edit, find, grep, ls, read, write). The agents worked
  // anyway, minus two tools they were told in their prompt that they had.
  //
  // Derived from Pi's OWN registrations rather than hardcoded, so a Pi rename
  // fails here instead of at delegation time in front of a user.
  const piBuiltins = (): Set<string> => {
    const dir = path.join(__dirname, "..", "pi-runtime", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "tools");
    const names = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
      for (const m of readFileSync(path.join(dir, f), "utf8").matchAll(/^\s*name: "([a-z_]+)"/gm)) names.add(m[1]);
    }
    return names;
  };

  it("Pi still registers the builtin set these agents rely on", () => {
    const names = piBuiltins();
    for (const t of ["read", "grep", "find", "ls"]) expect(names, `Pi builtin ${t}`).toContain(t);
  });

  it("no bundled agent asks for a tool that does not exist", () => {
    const names = piBuiltins();
    const dir = path.join(__dirname, "..", "pi-runtime", "agents");
    const agents = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(agents.length, "bundled agents present").toBeGreaterThan(0);
    for (const file of agents) {
      const src = readFileSync(path.join(dir, file), "utf8");
      const line = /^tools:\s*(.+)$/m.exec(src);
      if (!line) continue; // no tools: line = inherits, nothing to check
      for (const tool of line[1].split(",").map((t) => t.trim()).filter(Boolean)) {
        // An EXTENSION tool would need more than a name here (subagentOnlyExtensions
        // or a path-like entry), so this deliberately fails and forces the decision.
        expect(names, `${file} declares "${tool}"`).toContain(tool);
      }
    }
  });

  it("no bundled agent's prompt tells the agent to use a tool it lacks", () => {
    // The prose matters as much as the frontmatter: an agent told to "glob the
    // tree" will try, fail, and burn turns. This is what actually confused
    // code-explorer even at 0.34, where the frontmatter error was silent.
    const dir = path.join(__dirname, "..", "pi-runtime", "agents");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const body = readFileSync(path.join(dir, file), "utf8");
      expect(body, `${file} prompt mentions glob`).not.toMatch(/\bglob\b/i);
      expect(body, `${file} prompt mentions the list tool`).not.toMatch(/\blist\/|\/list\b|`list`/i);
    }
  });
});

describe("RPC mode is UI-ful, which is what disarms the headless auto-drain", () => {
  // pi-subagents >=0.40 ends every turn with, and offers NO opt-out for:
  //   pi.on("agent_end", async (_e, ctx) => { if (ctx.hasUI) return;
  //                                           await drainOutstandingWork(...) })
  //   (pi-subagents/src/extension/index.ts:462)
  // That drain waits for every queued/running async run owned by the session —
  // exactly what `asyncByDefault` creates — and Pi awaits handlers serially
  // (pi-coding-agent runner.js:585). If it ever ran for us it would block each
  // turn on its own delegation: the inverse of PRD §12.
  //
  // It does NOT run, because `hasUI` is TRUE under `--mode rpc`: rpc-mode.js binds
  // a real `uiContext` (the same channel the bridge's permission prompts ride) and
  // `hasUI()` is just `uiContext !== noOpUIContext`. Upstream's docs say "headless
  // sessions auto-drain", but Pi's notion of headless is print-mode, NOT rpc.
  // MEASURED 2026-08-02 with a probe extension in real `--mode rpc`:
  //   {"where":"session_start","hasUI":true}  {"where":"agent_end","hasUI":true}
  //
  // So this pins the three links that keep the drain dormant. If a pin bump breaks
  // ANY of them, we inherit a turn-blocking regression that no other test would
  // catch — and this failing is the signal to re-measure `hasUI`, not to relax it.
  const readVendored = (...rel: string[]): string =>
    readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", ...rel), "utf8");

  it("Pi's rpc mode binds a real extension uiContext", () => {
    const src = readVendored("@earendil-works", "pi-coding-agent", "dist", "modes", "rpc", "rpc-mode.js");
    expect(src).toMatch(/uiContext:\s*createExtensionUIContext\(\)/);
  });

  it("hasUI is true for any non-noOp uiContext", () => {
    const src = readVendored("@earendil-works", "pi-coding-agent", "dist", "core", "extensions", "runner.js");
    expect(src).toMatch(/hasUI\(\)\s*\{\s*return this\.uiContext !== noOpUIContext;/);
  });

  it("pi-subagents still gates its drain on hasUI (rather than on the mode)", () => {
    const src = readVendored("pi-subagents", "src", "extension", "index.ts");
    // Anchor on the drain call site: the guard must remain a hasUI early-return.
    const hook = /pi\.on\("agent_end",[\s\S]{0,200}?if \(ctx\.hasUI\) return;[\s\S]{0,120}?drainOutstandingWork/;
    expect(src).toMatch(hook);
    // And the function is genuinely blocking, so the guard is load-bearing.
    expect(typeof drainOutstandingWork).toBe("function");
  });
});
