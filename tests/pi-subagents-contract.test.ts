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
import { REDACTED_PROMPT, WAIT_TOOLS, displayableTask, isRedactedPrompt, isWaitTool } from "../pi-runtime/extensions/hv-rules";

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

  /** A run dir with a verbatim-readable status.json (no `pid`: the stale-run
   *  reconciler short-circuits on a pid-less status). Returns its asyncDir. */
  const writeRun = (root: string, runId: string, over: Record<string, unknown> = {}): string => {
    const dir = path.join(root, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "status.json"), JSON.stringify({
      runId,
      sessionId: "session-under-test",
      state: "queued",
      mode: "single",
      startedAt: 1,
      lastUpdate: 1,
      steps: [{ index: 0, agent: "researcher", status: "pending" }],
      ...over,
    }));
    return dir;
  };

  /** The `.active-runs/<runId>` marker pi-subagents >=0.49 writes for an active
   *  run (`active-run-index.ts` markerPath: an EMPTY file, index dir at the
   *  runs-root). Active-state queries read ONLY this — see the next test. */
  const writeMarker = (root: string, runId: string): void => {
    mkdirSync(path.join(root, ".active-runs"), { recursive: true });
    writeFileSync(path.join(root, ".active-runs", runId), "");
  };

  it("listAsyncRuns yields {id, asyncDir, steps[].agent} for an active run", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "hv-async-runs-"));
    const runId = "run-contract-fixture";
    const dir = writeRun(root, runId);
    writeMarker(root, runId);

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

  it("active-state queries read the marker index and do NOT fall back to a scan", () => {
    // THE 0.50 UPGRADE HOLE, pinned deliberately (Decision 2026-08-17: accepted,
    // no migrator). From 0.49 an active-state query — the exact shape
    // /hv-subagent-list uses (states all-active, no runId, no entryLimit) — is
    // `readActiveRunIndex(root) ?? []` with no directory scan behind it
    // (async-status.ts). A detached run started under 0.40 wrote no marker, so
    // after the app upgrade it keeps executing with its card gone. It still
    // COMPLETES and still delivers (completion is file-watch, not index), which
    // is what makes one missing card cheaper than a backfill migration.
    const root = mkdtempSync(path.join(os.tmpdir(), "hv-async-noindex-"));
    writeRun(root, "run-without-marker", { sessionId: "s", state: "running" });
    expect(listAsyncRuns(root, { states: ["queued", "running"], sessionId: "s" })).toHaveLength(0);

    // Same run, now indexed — found. (Two assertions, one test: the hole and its
    // shape are the same fact, and splitting them lets one rot without the other.)
    writeMarker(root, "run-without-marker");
    expect(listAsyncRuns(root, { states: ["queued", "running"], sessionId: "s" })).toHaveLength(1);
  });

  it("a runId-TARGETED query still scans, so interrupt survives the upgrade hole", () => {
    // The consolation the hole rests on: `/hv-subagent-interrupt <runId>` and any
    // other targeted lookup take the `options.runId` branch, which resolves or
    // scans by prefix rather than reading the index. So an unindexed 0.40-era run
    // is invisible to the LIST but still addressable by id.
    const root = mkdtempSync(path.join(os.tmpdir(), "hv-async-targeted-"));
    writeRun(root, "run-without-marker", { sessionId: "s", state: "running" });
    expect(listAsyncRuns(root, { runId: "run-without-marker", sessionId: "s" })).toHaveLength(1);
  });

  it("returns empty rather than throwing when the runs root does not exist", () => {
    // The bridge wraps the call in try/catch, but an absent root is the normal
    // "no delegation has ever run" case and must not be an error path.
    expect(listAsyncRuns(path.join(os.tmpdir(), "hv-async-runs-does-not-exist"))).toEqual([]);
  });
});

describe("pi-subagents 0.50 lifecycle payload contract", () => {
  // The 0.40 → 0.50 bump changed WHAT the lifecycle events say, not their names.
  // Each assertion below is a thing the bridge or the renderer reads; upstream
  // moving any of them would otherwise show up as a wrong caption or a card that
  // never appears, with no test failing.
  const subagentsSrc = (...rel: string[]): string =>
    readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", ...rel), "utf8");

  it("redacts task/goal on async-started, using the literal our UI screens for", () => {
    // THE load-bearing pin. REDACTED_PROMPT is duplicated in hv-rules.ts because
    // the renderer cannot import a vendored runtime package; this asserts the two
    // still agree, so a reworded redaction fails HERE and not as a card captioned
    // "[prompt redacted]" in front of a user.
    expect(subagentsSrc("src", "shared", "utils.ts")).toContain(`PROMPT_REDACTED = "${REDACTED_PROMPT}"`);

    // …and that the started event really does substitute it for the task.
    const emit = subagentsSrc("src", "runs", "background", "async-execution.ts");
    expect(emit).toMatch(/task:\s*task\?\.trim\(\)\s*\?\s*PROMPT_REDACTED/);
    expect(isRedactedPrompt(REDACTED_PROMPT)).toBe(true);
    expect(displayableTask(REDACTED_PROMPT)).toBeUndefined();
    expect(displayableTask("map the repo")).toBe("map the repo");
  });

  it("still identifies an async run by `id` + carries asyncDir and a lifecycle version", () => {
    // The bridge relays `id → runId` (0.40 renamed it away from `runId`) and tails
    // `<asyncDir>/status.json`; lifecycleArtifactVersion is pinned so the NEXT
    // payload revision announces itself instead of arriving silently.
    const emit = subagentsSrc("src", "runs", "background", "async-execution.ts");
    const started = emit.slice(emit.indexOf("SUBAGENT_ASYNC_STARTED_EVENT, {"));
    for (const field of ["lifecycleArtifactVersion", "id,", "agent", "asyncDir", "sessionId"]) {
      expect(started, `async-started carries ${field}`).toContain(field);
    }
  });

  it("still puts asyncId on the dispatch tool result — the renderer's async/foreground switch", () => {
    // asyncResultInfo() (renderer agents.ts) reads result.details.asyncId to know
    // a delegation went async and the foreground card must be discarded. Without
    // it the user would see two cards for one delegation. Both emit sites checked:
    // a bare `grep asyncId` would pass on the type declaration alone.
    const emit = subagentsSrc("src", "runs", "background", "async-execution.ts");
    const sites = [...emit.matchAll(/details:\s*\{[^\n]*asyncId:\s*id/g)];
    expect(sites.length, "asyncId present on the async dispatch result").toBeGreaterThanOrEqual(2);
  });

  it("exposes waitTool.enabled — the sanctioned off-switch we set (PRD §12, 2026-08-17)", () => {
    // writeSubagentConfig writes { waitTool: { enabled: false } }. A config key that
    // upstream renames fails SILENT, which is exactly why the WAIT_TOOLS name guard
    // stays on top of it; this pin is the loud half.
    expect(subagentsSrc("src", "shared", "types.ts")).toMatch(/waitTool\?*:/);
    expect(subagentsSrc("src", "runs", "background", "wait-tool.ts")).toMatch(/enabled/);
  });

  it("keeps ASYNC_DIR out of every public subpath, which is why the import is relative", () => {
    // Re-derived, never hand-listed. 0.50 ships 11 subpaths and `./shared-types`
    // looked like the home for ASYNC_DIR — it re-exports TYPES only, so the deep
    // relative import stays and upstream ask A (export ./async-status) stays open.
    const map = (JSON.parse(readFileSync(PKG, "utf8")) as { exports?: Record<string, string> }).exports ?? {};
    expect(Object.keys(map).length).toBeGreaterThan(1);
    const publicSrc = Object.values(map)
      .map((target) => {
        try { return subagentsSrc(...target.replace(/^\.\//, "").split("/")); } catch { return ""; }
      })
      .join("\n");
    // Non-vacuity arm: the negative below is only meaningful if we actually read
    // the public surface. A subpath target that stops resolving would otherwise
    // turn this test into a tautology. Measured 2026-08-17: 11 files, ~43.7k chars.
    expect(publicSrc.length, "public subpath sources were readable").toBeGreaterThan(10_000);
    expect(publicSrc, "no public subpath re-exports ASYNC_DIR").not.toMatch(/\bASYNC_DIR\b/);
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

describe("the bridge builds tool schemas with the SAME typebox Pi consumes them with", () => {
  // happyvibe-bridge.ts does `import { Type } from "typebox"` — a BARE specifier,
  // so it resolves to whatever pi-runtime/node_modules hoists. typebox was not a
  // direct dependency at all, so bumping pi-subagents 0.34→0.40 silently moved the
  // bridge's schema library 1.1.24 → 1.1.38: every registered tool's schema built
  // by a library nobody chose.
  //
  // The right pin is not "newest" but "whatever pi-coding-agent uses" — the bridge
  // BUILDS these schemas and Pi CONSUMES them, so aligning builder with consumer is
  // the invariant that actually means something. Asserting the relationship rather
  // than a literal makes a future Pi bump drag typebox along instead of quietly
  // re-opening the split. (pi-subagents keeps its own nested copy; its business.
  // pi-mcp-adapter declares a `*` peer, so it is satisfied either way.)
  const pkg = (...rel: string[]): Record<string, unknown> =>
    JSON.parse(readFileSync(path.join(__dirname, "..", "pi-runtime", ...rel), "utf8")) as Record<string, unknown>;

  it("pi-runtime pins typebox to exactly the version pi-coding-agent declares", () => {
    const pin = (pkg("package.json").dependencies as Record<string, string> | undefined)?.typebox;
    expect(pin, "typebox must be an explicit pi-runtime dependency").toBeDefined();
    const piDep = (pkg("node_modules", "@earendil-works", "pi-coding-agent", "package.json")
      .dependencies as Record<string, string> | undefined)?.typebox;
    expect(pin).toBe(piDep);
  });

  it("the copy the bridge actually resolves is that version", () => {
    const pin = (pkg("package.json").dependencies as Record<string, string>).typebox;
    expect(pkg("node_modules", "typebox", "package.json").version).toBe(pin);
  });

  it("the bridge imports typebox bare, which is what makes the pin load-bearing", () => {
    expect(readFileSync(BRIDGE, "utf8")).toMatch(/from "typebox"/);
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
    const handler = src.match(/pi\.on\("agent_end",[\s\S]{0,600}/)?.[0] ?? "";
    expect(handler).toContain("drainOutstandingWork");

    // Assert the SEMANTICS, not one spelling. This test previously pinned
    // 0.40's `if (ctx.hasUI) return; … drain(…)` literally and went red on the
    // 0.49 bump, which had merely rewritten it as `if (!ctx.hasUI) await
    // drain(…)` — identical meaning. A guard that must be matched by shape is
    // a guard that cries wolf; what must not change is that the drain is
    // reachable ONLY when there is no UI (in RPC, hasUI is TRUE, which is the
    // whole reason PRD §12's "never block on a delegation" survives).
    const guarded =
      /if \(ctx\.hasUI\) return;[\s\S]{0,160}?drainOutstandingWork/.test(handler) ||
      /if \(!ctx\.hasUI\)[\s\S]{0,60}?drainOutstandingWork/.test(handler);
    expect(guarded).toBe(true);

    // And the function is genuinely blocking, so the guard is load-bearing.
    expect(typeof drainOutstandingWork).toBe("function");
  });
});
