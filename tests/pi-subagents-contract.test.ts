/**
 * Contract tests — every pi-subagents behaviour HappyVibe is pin-coupled to
 * (the pin-bump gate). All key-free (no Pi spawn, no model):
 *
 *   1. the active-run inventory behind /hv-subagent-list       (the deep import)
 *   2. the parent-blocking wait tool                            (PRD §12 guard)
 *   3. bundled agents' `tools:` allowlist                       (delegation works)
 *   4. rpc mode is UI-ful, disarming the auto-drain              (PRD §12 guard)
 *   5. completion delivery is scoped to a PROCESS                (PRD §12 guard)
 *   6. typebox and pi-tui pinned to what Pi declares            (dependency pins)
 *   7. the capability ceiling's propagation chain               (FR11, §12)
 *
 * FR11 asks that every upstream surface the sub-agent boundary rests on fails
 * `npm test` rather than the GUI. That inventory is deliberately spread across
 * SIX files, because each one owns a different question — collapsing them here
 * would put behaviour a long way from the thing it constrains:
 *
 *   pi-subagents-contract   the ceiling chain, the pins, wait/drain/delivery
 *   subagent-adversarial    what a malicious AGENT FILE cannot reach
 *   subagent-preflight-shape the contract fields the prompt reads + inheritance
 *                            defaults (`inheritSkills` false is load-bearing)
 *   subagent-config          native permissions refused; bash ungateable twice
 *   mcp-spawn                wrapper argv pass-through + the guard injection
 *   subagent-status          status persisted before the result publishes
 *
 * If you are auditing FR11, read those six. This header is the index.
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
import registerSubagentNotify from "../pi-runtime/node_modules/pi-subagents/src/runs/background/notify.ts";
import { currentCompletionOwnerId } from "../pi-runtime/node_modules/pi-subagents/src/shared/completion-owner.ts";
import {
  parseSubagentCapabilityCeiling,
  registerSubagentCapabilityCeiling,
  resolveSubagentCapabilityCeiling,
} from "../pi-runtime/node_modules/pi-subagents/src/api/capability-ceiling.ts";
import { buildPiArgs } from "../pi-runtime/node_modules/pi-subagents/src/runs/shared/pi-args.ts";
import { EXTERNAL_CLI_AGENTS, REDACTED_PROMPT, WAIT_TOOLS, displayableTask, isRedactedPrompt, isWaitTool } from "../pi-runtime/extensions/hv-rules";
import { isStoppableChild } from "../src/renderer/src/agents";

const BRIDGE = path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts");

/**
 * Contents of a file inside the vendored pi-subagents tree. Module-scoped twin
 * of the `subagentsSrc` helper inside the lifecycle describe below, which is
 * block-scoped; both read the same tree, neither derives a second path scheme.
 */
const subagentSource = (...rel: string[]): string =>
  readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", ...rel), "utf8");
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

/**
 * The isolation contract is STATED, not inherited (PRD §12, 2026-08-28).
 *
 * 0.58 flipped `inheritGlobalContext` so a child no longer inherits the
 * operator's global context file — which is what §12's isolation contract has
 * always assumed, so it changes nothing today. Both bundled agents state it
 * anyway, for the same reason `defaultSubagentContext: "fresh"` is stated: a
 * future flip back would hand every sub-agent the operator's global context,
 * with no user-visible symptom and no failing test to announce it.
 */
/**
 * Our external-agent refusal set still equals upstream's, exactly (§12, 2026-08-28).
 *
 * EXTERNAL_CLI_AGENTS in hv-rules.ts is a hand-written copy of an upstream fact.
 * If a future pin adds a seventh adapter, nothing else in the app notices — the
 * new agent simply arrives delegatable, opaque to the ceiling, the child guard
 * and the audit log. So the set is DERIVED here from upstream's own agent
 * frontmatter and compared, rather than re-listed.
 */
describe("our external-agent refusal set still equals upstream's, exactly", () => {
  const upstreamAgentsDir = path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "agents");

  /** Every builtin agent upstream SHIPS, read from its own bundled files. */
  const builtinAgentFiles = (): Array<{ name: string; src: string }> =>
    readdirSync(upstreamAgentsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ name: f.replace(/\.md$/, ""), src: readFileSync(path.join(upstreamAgentsDir, f), "utf8") }));

  /** An external runner declares `type: external-cli` (or -job) under `runner:`. */
  const isExternal = (src: string): boolean => /^\s*type:\s*external-(cli|job)\s*$/m.test(src);

  it("upstream ships a builtin roster we have accounted for", () => {
    // 7 files at 0.53, 12 at 0.58 (BUILTIN_AGENT_NAMES lists 13 — `advisor` is an
    // alias 0.57 resolves through the bundled `oracle`, so it ships no file).
    // A CHANGE here is the signal to re-audit: a new builtin arrives delegatable
    // with no decision from us.
    expect(builtinAgentFiles().map((a) => a.name).sort()).toEqual([
      "claude-code",
      "claude-code-writer",
      "codex-exec",
      "codex-exec-writer",
      "cursor-agent",
      "cursor-agent-writer",
      "delegate",
      "oracle",
      "researcher",
      "reviewer",
      "scout",
      "worker",
    ]);
  });

  it("we refuse exactly the external-runner ones, no more and no fewer", () => {
    const external = builtinAgentFiles().filter((a) => isExternal(a.src)).map((a) => a.name).sort();
    expect(external.length, "upstream ships external runners").toBeGreaterThan(0);
    expect([...EXTERNAL_CLI_AGENTS].sort()).toEqual(external);
  });

  it("the ones we KEEP are native Pi children the ceiling governs", () => {
    // The other half of the decision: disableBuiltins would have taken these too,
    // including the two the fleet round wants to adopt.
    const native = builtinAgentFiles().filter((a) => !isExternal(a.src)).map((a) => a.name);
    for (const name of native) expect(EXTERNAL_CLI_AGENTS.has(name), `${name} is kept`).toBe(false);
    expect(native).toContain("worker");
    expect(native).toContain("reviewer");
  });

  it("`advisor` is an alias with no file, so deriving from files cannot miss it", () => {
    // Guard against the subtle version of this drift: if upstream ever gives
    // `advisor` its own file WITH an external runner, the derivation above picks
    // it up and the set comparison fails. This asserts today's shape so that
    // change is visible rather than silently reclassifying an agent.
    const names = readFileSync(
      path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "agents", "builtin-names.ts"),
      "utf8",
    );
    expect(names, "advisor is still a declared builtin name").toContain('"advisor"');
    expect(readdirSync(upstreamAgentsDir), "but ships no file of its own").not.toContain("advisor.md");
  });
});

describe("the isolation contract is stated, not inherited", () => {
  const agentsDir = path.join(__dirname, "..", "pi-runtime", "agents");
  // Local, because the identically-named helper above is scoped to its describe.
  const upstream = (...rel: string[]): string =>
    readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", ...rel), "utf8");

  it("every bundled agent states inheritGlobalContext explicitly", () => {
    const agents = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(agents.length, "bundled agents present").toBeGreaterThan(0);
    for (const file of agents) {
      const src = readFileSync(path.join(agentsDir, file), "utf8");
      expect(src, `${file} states inheritGlobalContext`).toMatch(/^inheritGlobalContext:\s*false$/m);
    }
  });

  it("our bundled agents resolve to systemPromptMode 'replace' — the identity pin", () => {
    // P4 item 5, "the child never thinks it is Pi", CLOSED by measurement rather
    // than built: `defaultSystemPromptMode(name)` returns "replace" for every
    // agent except the builtin `delegate`, and neither bundled agent sets the key
    // — so both resolve to "replace". At launch that emits `--system-prompt`
    // rather than `--append-system-prompt` (pi-args.ts), so the child receives ONLY
    // its own prompt and never Pi's. Already true; pinned because it is exactly
    // the kind of fact that flips silently on a bump, and the symptom would be a
    // sub-agent that introduces itself as Pi.
    expect(upstream("agents", "agents.ts"))
      .toMatch(/defaultSystemPromptMode[\s\S]{0,120}name === "delegate" \? "append" : "replace"/);
    for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
      const src = readFileSync(path.join(agentsDir, file), "utf8");
      expect(src, `${file} must not opt into append`).not.toMatch(/^systemPromptMode:\s*append$/m);
      expect(file, "a bundled agent named delegate would default to append").not.toBe("delegate.md");
    }
    // …and "replace" is what actually changes the argv, not just a stored string.
    expect(upstream("runs", "shared", "pi-args.ts"))
      .toMatch(/systemPromptMode === "replace"[\s\S]{0,80}"--system-prompt"[\s\S]{0,60}"--append-system-prompt"/);
  });

  it("upstream still DEFAULTS it to false, so our value changes nothing today", () => {
    // If this fails, upstream flipped back and our explicit false is suddenly
    // doing real work — which is exactly why it is written down. Two independent
    // default sites, both false; asserting both so a change to either is loud.
    expect(upstream("agents", "runtime-agent-registry.ts"))
      .toMatch(/inheritGlobalContext:\s*definition\.inheritGlobalContext \?\? false/);
    expect(upstream("agents", "agent-management.ts"))
      .toMatch(/inheritGlobalContext:\s*false/);
  });

  it("it is a real boolean to upstream, which is why the value is bare `false`", () => {
    // pi-subagents rejects a non-boolean outright, so `false` must not be quoted
    // in our frontmatter. Our own flat parser reads it as the STRING "false",
    // which is fine — nothing on our side branches on it; only Pi consumes it.
    expect(upstream("agents", "agent-management.ts"))
      .toContain("config.inheritGlobalContext must be a boolean when provided.");
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

/**
 * pi-tui — the same relationship as typebox, for a dependency that is NOT ours to
 * want and is required anyway.
 *
 * pi-subagents declares @earendil-works/pi-tui as an OPTIONAL peer, and `npm ci` skips optional peers. But we load
 * pi-subagents/src/extension/index.ts as an extension on every spawn
 * (PI_SUBAGENTS_RELPATH), and that file imports pi-tui at line 21 — so the app
 * has always needed it to boot pi-subagents at all, while a clean install did not
 * install it. Nobody noticed because nothing in the TEST graph reached that import
 * until the bridge started importing pi-subagents/preflight, whose chain runs
 * through ../extension/config.ts, which imports pi-tui too.
 *
 * CI caught it as three suites failing to collect with "Could not resolve
 * @earendil-works/pi-tui". The local runs were green only because this machine
 * happened to carry a stale top-level 0.74.0 that `npm ci` would never place.
 *
 * So it is declared explicitly, and pinned to what Pi itself declares rather than
 * to "newest" — the TUI code paths are dormant for us (we run --mode rpc), so the
 * version that matters is the one the rest of the vendored tree was built against.
 */
describe("pi-tui is an explicit pin, because pi-subagents needs it and npm ci will not guess", () => {
  const pkg = (...rel: string[]): Record<string, unknown> =>
    JSON.parse(readFileSync(path.join(__dirname, "..", "pi-runtime", ...rel), "utf8")) as Record<string, unknown>;
  const TUI = "@earendil-works/pi-tui";

  it("pi-runtime declares it, so a clean npm ci installs it", () => {
    const pin = (pkg("package.json").dependencies as Record<string, string> | undefined)?.[TUI];
    expect(pin, "must be an explicit dependency, not an optional peer nobody installs").toBeDefined();
  });

  it("pinned to the version pi-coding-agent declares, not to newest", () => {
    const pin = (pkg("package.json").dependencies as Record<string, string>)[TUI];
    const piDep = (pkg("node_modules", "@earendil-works", "pi-coding-agent", "package.json")
      .dependencies as Record<string, string> | undefined)?.[TUI];
    expect(piDep, "pi-coding-agent still declares pi-tui").toBeDefined();
    // Pi declares a caret range; we pin exact. The pin must satisfy it.
    expect(`^${pin}`).toBe(piDep);
  });

  it("the copy actually installed is that version", () => {
    const pin = (pkg("package.json").dependencies as Record<string, string>)[TUI];
    expect(pkg("node_modules", "@earendil-works", "pi-tui", "package.json").version).toBe(pin);
  });

  it("pi-subagents still needs it — the reason the pin exists at all", () => {
    // If upstream ever stops importing pi-tui from the extension entry and the
    // config module, this pin can go. Until then it is load-bearing: without it
    // the extension fails to load and the whole subagent feature is gone.
    const sub = (...rel: string[]): string =>
      readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", ...rel), "utf8");
    expect(sub("src", "extension", "index.ts"), "the entry we pass with -e").toMatch(/from "@earendil-works\/pi-tui"/);
    expect(sub("src", "extension", "config.ts"), "reached via api/preflight.ts").toMatch(/from "@earendil-works\/pi-tui"/);
    expect((JSON.parse(sub("package.json")) as { peerDependenciesMeta?: Record<string, { optional?: boolean }> })
      .peerDependenciesMeta?.[TUI]?.optional, "still declared OPTIONAL upstream, which is the trap").toBe(true);
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

describe("async completion delivery is scoped to a PROCESS, so HappyVibe claims the scope", () => {
  // pi-subagents 0.51 (upstream #1225, "concurrent windows sharing one session
  // file cannot consume each other's results") refuses any non-foreground
  // completion whose `completionOwnerId` differs from the current process's, and
  // mints that id as a randomUUID PER PI PROCESS.
  //
  // HappyVibe respawns Pi on purpose — hibernation wake, MCP live-reload, app
  // relaunch — and resumes the SAME session file precisely so a detached run is
  // never orphaned (PRD §12). A per-process id makes the resumed parent a
  // stranger to its own child: the artifact lands on disk, /hv-subagent-list
  // resyncs the card, and the answer never reaches the model. At 0.50 the guard
  // was session-id only and this path worked.
  //
  // So extensions/hv-owner-seed.ts claims the registry symbol from
  // HV_SUBAGENT_OWNER before pi-subagents can mint one. These tests measure the
  // MECHANISM rather than scanning for it: the refusal is exercised, and so is
  // the `??=` that makes a pre-claimed value win.
  const OWNER_KEY = Symbol.for("pi-subagents.completion-owner-id");
  const SESSION = "/tmp/session-under-test.jsonl";

  /** Read a file out of the vendored pi-subagents source tree. */
  const src = (...p: string[]): string =>
    readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", ...p), "utf8");

  /** Enough of an ExtensionAPI for the notifier: it sends and it subscribes. */
  const fakePi = () => {
    const sent: Array<{ customType?: string; content?: string }> = [];
    return {
      sent,
      pi: {
        sendMessage: (message: { customType?: string; content?: string }) => { sent.push(message); },
        events: { on: () => () => {} },
      },
    };
  };

  const completion = (ownerId: string | undefined) => ({
    id: "child-run-1",
    runId: "child-run-1",
    sessionId: SESSION,
    source: "async" as const,
    agent: "code-explorer",
    success: true,
    state: "complete",
    summary: "the child's whole answer",
    ...(ownerId === undefined ? {} : { completionOwnerId: ownerId }),
  });

  it("delivers when the owner matches — the case a claimed id restores", async () => {
    const { pi, sent } = fakePi();
    const notifier = registerSubagentNotify(
      pi as never,
      { currentSessionId: SESSION, completionOwnerId: "hv-session-42" },
      { batchConfig: { enabled: false } },
    );
    const accepted = await notifier.deliver(completion("hv-session-42"));
    expect(accepted, "same owner id ⇒ delivered").toBe(true);
    expect(sent.map((m) => m.customType)).toEqual(["subagent-notify"]);
    notifier.dispose();
  });

  it("REFUSES when the owner differs, which is what a respawn used to look like", async () => {
    const { pi, sent } = fakePi();
    const notifier = registerSubagentNotify(
      pi as never,
      // A respawned Pi: same session file, brand-new randomUUID owner.
      { currentSessionId: SESSION, completionOwnerId: "a-fresh-process-uuid" },
      { batchConfig: { enabled: false } },
    );
    const accepted = await notifier.deliver(completion("the-dead-process-uuid"));
    expect(accepted, "owner mismatch ⇒ refused").toBe(false);
    expect(sent, "and nothing whatsoever reaches the model").toHaveLength(0);
    notifier.dispose();
  });

  it("refuses a completion carrying NO owner id at all", async () => {
    // Belt and braces: `!state.completionOwnerId || result.completionOwnerId !==
    // state.completionOwnerId` also rejects an absent id, so a pre-0.51 result
    // file left on disk across the upgrade is dropped rather than mis-delivered.
    const { pi, sent } = fakePi();
    const notifier = registerSubagentNotify(
      pi as never,
      { currentSessionId: SESSION, completionOwnerId: "hv-session-42" },
      { batchConfig: { enabled: false } },
    );
    expect(await notifier.deliver(completion(undefined))).toBe(false);
    expect(sent).toHaveLength(0);
    notifier.dispose();
  });

  it("a FOREGROUND completion is exempt, so blocking delegations never needed this", async () => {
    // `result.source !== "foreground"` guards the check. Worth pinning: it is why
    // an `async:false` delegation was unaffected by #1225, and why the seed only
    // has to cover the async path.
    const { pi, sent } = fakePi();
    const notifier = registerSubagentNotify(
      pi as never,
      { currentSessionId: SESSION, completionOwnerId: "hv-session-42" },
      { batchConfig: { enabled: false } },
    );
    const accepted = await notifier.deliver({ ...completion("someone-else"), source: "foreground" });
    expect(accepted).toBe(true);
    expect(sent).toHaveLength(1);
    notifier.dispose();
  });

  it("a pre-claimed symbol wins — the whole mechanism the seed relies on", () => {
    const prior = (globalThis as Record<symbol, unknown>)[OWNER_KEY];
    try {
      delete (globalThis as Record<symbol, unknown>)[OWNER_KEY];
      (globalThis as Record<symbol, unknown>)[OWNER_KEY] = "hv-session-42";
      // `??=` means upstream never overwrites a value already in the registry.
      expect(currentCompletionOwnerId()).toBe("hv-session-42");
      expect(currentCompletionOwnerId(), "and it stays stable on re-read").toBe("hv-session-42");
    } finally {
      if (prior === undefined) delete (globalThis as Record<symbol, unknown>)[OWNER_KEY];
      else (globalThis as Record<symbol, unknown>)[OWNER_KEY] = prior;
    }
  });

  it("upstream still mints a random id when nobody claimed it (so we must)", () => {
    const prior = (globalThis as Record<symbol, unknown>)[OWNER_KEY];
    try {
      delete (globalThis as Record<symbol, unknown>)[OWNER_KEY];
      const minted = currentCompletionOwnerId();
      // A uuid, not anything derived from the session — which is the bug for us.
      expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    } finally {
      if (prior === undefined) delete (globalThis as Record<symbol, unknown>)[OWNER_KEY];
      else (globalThis as Record<symbol, unknown>)[OWNER_KEY] = prior;
    }
  });

  it("the seed claims that exact symbol, and reads it from the spawn env", () => {
    const seed = readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "hv-owner-seed.ts"), "utf8");
    expect(seed).toContain('Symbol.for("pi-subagents.completion-owner-id")');
    expect(seed).toContain("HV_SUBAGENT_OWNER");
    // ??= so we never stomp a value some future upstream set first.
    expect(seed).toMatch(/\?\?=/);
  });

  it("an on-disk result is delivered through the SAME owner check, at session start", () => {
    // This is what makes the refusal REACHABLE, and it is easy to miss: a result
    // is a FILE, not just a live process. Even though an async run dies with its
    // parent Pi (measured — see docs/validation/d1.md §0.51), a child that
    // finished and wrote its result before the parent went away leaves that file
    // behind, and the NEXT session start scans it:
    //
    //   index.ts        -> primeExistingResults({ triggerTurn: !recovering })
    //   result-watcher  -> scheduleResult -> handleResult -> notifier.deliver(...)
    //
    // …which is the owner-scoped guard exercised behaviourally above. Without a
    // claimed id the resumed process's id never matches, so the answer is refused
    // — and refused deliveries are RETRIED rather than dropped, with the file left
    // un-marked, so no future process ever delivers it either. Permanent, silent
    // loss of a completed sub-agent's answer. Pinned as a ROUTE assertion: if a
    // pin bump stops priming at session start, or stops routing priming through
    // deliver, the seed silently stops covering this and this test says so.
    expect(src("extension", "index.ts"), "results left on disk are primed at session start")
      .toContain("primeExistingResults(");
    const watcher = src("runs", "background", "result-watcher.ts");
    expect(watcher, "priming schedules the same handler as the live path").toMatch(/primeExistingResults[\s\S]{0,600}scheduleResult\(file, triggerTurn\)/);
    expect(watcher, "and that handler delivers through the owner-scoped notifier").toContain("await notifier.deliver(");
    expect(watcher, "a refused delivery is retried, never discarded").toMatch(/if \(!accepted\) \{[\s\S]{0,120}scheduleResult\(file, triggerTurn, RETRY_DELAY_MS\)/);
  });

  it("there is still no config key that turns the scoping off", () => {
    // If upstream ever adds one, prefer it and delete the seed.
    //
    // 0.58 MOVED this comparison rather than removing it: notify.ts used to
    // inline `result.completionOwnerId !== state.completionOwnerId`, and now
    // delegates to an injectable `ownership.owns(sessionId, completionOwnerId)`
    // (result-delivery-ownership.ts) with that same comparison as its default.
    // The behavioural group above exercises the real notify.ts and still sees a
    // mismatched owner REFUSED, so this scan tracks the code to its new home
    // instead of being deleted — the point is that a future pin which drops the
    // owner requirement is loud rather than silent.
    const notify = readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "runs", "background", "notify.ts"), "utf8");
    expect(notify, "notify still falls back to comparing the owner id itself")
      .toContain("completionOwnerId === state.completionOwnerId");
    expect(notify).not.toMatch(/completionOwnerScoping|disableCompletionOwner|ignoreCompletionOwner/);

    const ownership = readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "runs", "background", "result-delivery-ownership.ts"), "utf8");
    expect(ownership, "the extracted module refuses a non-matching owner")
      .toMatch(/if \(!owner \|\| completionOwnerId !== owner\) return false/);
    expect(ownership).not.toMatch(/completionOwnerScoping|disableCompletionOwner|ignoreCompletionOwner/);
  });

  it("0.58's predecessor-session fallback does NOT relax the owner requirement", () => {
    // 0.58 (#1531) added `claimPredecessor`, which lets a replaced session's
    // results be delivered — the first thing upstream has shipped that looks
    // like a fallback on the DELIVERY path, and therefore the first thing that
    // could make the seed redundant. It does not: the claim is keyed BY the
    // current owner id and `owns` still demands `completionOwnerId === owner`
    // before it ever looks at the session id. So a respawn that mints a fresh
    // random uuid is refused exactly as before, and hv-owner-seed.ts stays
    // load-bearing. If this assertion fails, re-measure before deleting the seed.
    const ownership = readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "runs", "background", "result-delivery-ownership.ts"), "utf8");
    expect(ownership, "the fallback exists").toContain("claimPredecessor(");
    expect(ownership, "and it is gated on the current owner").toMatch(/claimPredecessor\([\s\S]{0,400}const owner = currentOwner\(\);[\s\S]{0,80}if \(!owner/);
    expect(ownership, "a claim is stored under the owner id, not bare").toMatch(/claimed\.set\([^)]*, owner\)/);
  });
});

/**
 * FR11 — the sub-agent BOUNDARY's own propagation chain (2026-08-22).
 *
 * §12's three layers rest on a chain of upstream behaviours, and the round that
 * built them pinned the ends but not the middle: `registerSubagentCapabilityCeiling`
 * was exercised, and the resulting argv was measured, but nothing asserted how a
 * registration REACHES that argv, or how the ceiling reaches a GRANDCHILD.
 *
 * Every assertion here guards a failure that is silent by construction — the
 * child simply gets more than the human approved, and no UI says so. That is the
 * same shape as the 0.40.0 bump this file's other groups exist for.
 *
 * Key-free: pure argv/env resolution and source scans, no Pi spawn, no model.
 */
describe("FR11 — the capability ceiling's propagation chain", () => {
  const sub = (...rel: string[]): string =>
    path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", ...rel);
  const read = (...rel: string[]): string => readFileSync(sub(...rel), "utf8");

  /** buildPiArgs' required fields, minimal, plus a ceiling. Returns argv. */
  const childArgs = (ceiling: Record<string, unknown>): string[] =>
    buildPiArgs({
      baseArgs: ["--mode", "json", "-p"],
      task: "t",
      sessionEnabled: false,
      inheritProjectContext: false,
      inheritSkills: false,
      cwd: process.cwd(),
      capabilityCeiling: parseSubagentCapabilityCeiling(ceiling),
    } as never).args as string[];

  it("the ceiling env name is unchanged — it is how the ceiling reaches a GRANDCHILD", () => {
    // A rename here does not break a build: the parent still bounds its own
    // child (registry, in-process), while every DESCENDANT silently loses the
    // ceiling, because inheritance travels only through this variable.
    const src = read("src", "runs", "shared", "capability-ceiling.ts");
    expect(src).toContain('SUBAGENT_CAPABILITY_CEILING_ENV = "PI_SUBAGENT_CAPABILITY_CEILING_V1"');
    expect(src).toContain('SUBAGENT_CAPABILITY_CEILING_REGISTRY_KEY = "pi-subagents.capability-ceiling.v1"');
  });

  it("pi-args ENCODES the resolved ceiling into the child's env", () => {
    // The other half of inheritance: without this write, a grandchild starts
    // unbounded even though the env NAME is right.
    const src = read("src", "runs", "shared", "pi-args.ts");
    expect(src).toMatch(/env\[SUBAGENT_CAPABILITY_CEILING_ENV\] = encodedCapabilityCeiling/);
    expect(src, "and DECODES an inherited one on the way in")
      .toMatch(/decodeSubagentCapabilityCeiling\(\s*process\.env\[SUBAGENT_CAPABILITY_CEILING_ENV\]/);
  });

  it("a registered ceiling is what the launch path actually reads", () => {
    // The link between the bridge's registerSubagentCapabilityCeiling() and the
    // argv: if the launch path stopped consulting the registry, registration
    // would keep succeeding and bound nothing.
    for (const f of [
      ["src", "runs", "foreground", "execution.ts"],
      ["src", "runs", "background", "async-execution.ts"],
    ]) {
      expect(read(...f), f.join("/")).toMatch(/resolveCurrentSubagentCapabilityCeiling|resolveSubagentCapabilityCeiling/);
    }
  });

  it("a registration round-trips through the registry to a resolved ceiling", () => {
    // Behavioural, not a source scan: register → resolve, the exact path the
    // bridge depends on, including that dispose() actually releases it.
    const sessionId = `hv-fr11-${process.pid}`;
    const handle = registerSubagentCapabilityCeiling({
      sessionId, source: "happyvibe-test",
      ceiling: { allowedTools: ["read"], denyExtensions: true },
    });
    try {
      const resolved = resolveSubagentCapabilityCeiling(sessionId);
      expect(resolved?.allowedTools).toEqual(["read"]);
      expect(resolved?.denyExtensions).toBe(true);
      handle.update({ allowedTools: ["read", "bash"], denyExtensions: true });
      expect(resolveSubagentCapabilityCeiling(sessionId)?.allowedTools).toEqual(["bash", "read"]);
    } finally {
      handle.dispose();
    }
    expect(resolveSubagentCapabilityCeiling(sessionId), "dispose releases it").toBeUndefined();
  });

  it("the ceiling reaches ARGV as real flags, not just a plan object", () => {
    // The plan's booleans are not the contract; the child's argv is. This is the
    // difference between "we computed a restriction" and "the child is restricted".
    const args = childArgs({
      version: 1, allowedTools: ["read", "grep"], denyExtensions: true, sources: ["happyvibe"],
    });
    expect(args).toContain("--tools");
    expect(args[args.indexOf("--tools") + 1]).toBe("grep,read");
    expect(args, "denyExtensions must disable ambient discovery").toContain("--no-extensions");
  });

  it("an EMPTY allowed set becomes --no-tools, never a missing flag", () => {
    // The dangerous degenerate case: if an empty intersection emitted nothing,
    // the child would fall back to Pi's FULL builtin set — the exact hole FR3
    // closes. It must emit --no-tools instead.
    const args = childArgs({
      version: 1, allowedTools: [], denyExtensions: true, sources: ["happyvibe"],
    });
    expect(args).toContain("--no-tools");
    expect(args).not.toContain("--tools");
  });

  it("buildPiArgs is NOT in the exports map, so the argv assertion needs a deep import", () => {
    // Recorded because it is the reason the import above is relative: the public
    // ./pi-args subpath exposes only resolvePiLaunchToolPlan (the pure plan), not
    // the argv builder. If upstream ever exports it, this can become a bare
    // specifier — same relationship as listAsyncRuns/ASYNC_DIR above.
    const map = (JSON.parse(readFileSync(PKG, "utf8")) as { exports: Record<string, string> }).exports;
    expect(map["./pi-args"], "the subpath exists").toBeDefined();
    expect(readFileSync(sub("src", "api", "pi-args.ts"), "utf8"))
      .not.toMatch(/buildPiArgs/);
  });

  it("strict tool availability still REJECTS an unknown child tool", () => {
    // pi-subagents >=0.40 fails the whole run for an unknown name (0.34 ignored
    // it). Both bundled agents once asked for `glob, list`, which do not exist.
    expect(read("src", "runs", "shared", "tool-availability.ts"))
      .toMatch(/requested unavailable child tools/i);
  });
});

/**
 * 8. The child session-file layout the cost ledger reads (PRD §19, 2026-08-22).
 *
 * `src/main/store.ts` childSessionFiles resolves upstream's layout to find a
 * delegation's own Pi session file, which is what puts sub-agent spend in the
 * session's cost, the pill and Stats. Nothing about that is announced on the
 * wire — if upstream moves the directory, every sub-agent figure silently
 * becomes absent rather than wrong, which is the quieter failure and the reason
 * this group exists.
 */
describe("child session files (the cost ledger's source)", () => {
  const read = (...rel: string[]): string =>
    readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", ...rel), "utf8");

  it("roots a child's session beside the PARENT's own session file", () => {
    // Not a tmpdir — this is what makes a reopened session able to show the
    // same numbers it showed live.
    const src = read("src", "extension", "index.ts");
    expect(src).toMatch(/function getSubagentSessionRoot/);
    expect(src).toMatch(/path\.basename\(parentSessionFile, "\.jsonl"\)/);
    expect(src).toMatch(/path\.join\(sessionsDir, baseName\)/);
  });

  it("nests one directory per run and one per step, leaf session.jsonl", () => {
    const src = read("src", "runs", "foreground", "subagent-executor.ts");
    expect(src).toMatch(/sessionRoot = path\.join\(baseSessionRoot, runId\)/);
    expect(src).toMatch(/path\.join\(sessionRoot, `run-\$\{idx \?\? 0\}`\)/);
    expect(src).toMatch(/path\.join\(sessionDirForIndex\(idx\), "session\.jsonl"\)/);
  });

  it("always enables a child session on the dispatch path", () => {
    // Without this a child writes no session file at all and there is nothing
    // to read: the numbers would be ABSENT rather than wrong.
    expect(read("src", "runs", "foreground", "subagent-executor.ts")).toMatch(/sessionDir: sessionDirForIndex\(0\)/);
    expect(read("src", "runs", "background", "subagent-runner.ts")).toMatch(/sessionEnabled = Boolean\(config\.sessionDir\)/);
  });

  it("still records the per-turn cost our ledger sums", () => {
    // The child's own stream reports `usage.cost.total`; calls.ts reads exactly
    // that field. We sum Pi's numbers and never price anything ourselves.
    expect(read("src", "runs", "background", "subagent-runner.ts")).toMatch(/usage\.cost \+= eventUsage\.cost\?\.total/);
  });
});

// ── The live child context gauge (PRD §12, 2026-08-29 — the fleet round) ─────
//
// The run card's per-child gauge is §9's headline differentiator applied to a
// sub-agent, and it rests entirely on two upstream fields. If either is renamed
// or stops reaching the status file, the gauge does not break loudly — it just
// silently never renders, which is indistinguishable from "this model has no
// known window". These pins turn that into a failing test.
describe("pi-subagents live child context contract", () => {
  const types = subagentSource("src", "shared", "types.ts");
  const projection = subagentSource("src", "runs", "background", "async-status.ts");

  it("TokenUsage still carries `window` — the live occupancy, not the total", () => {
    expect(types).toMatch(/interface TokenUsage[\s\S]{0,400}?window\?: number/);
  });

  it("an async status step still carries `contextLimit` — the divisor", () => {
    expect(types).toMatch(/steps\?: Array<\{[\s\S]*?contextLimit\?: number/);
  });

  it("BOTH survive into the status.json projection, which is all we can read", () => {
    // A detached run reaches us ONLY through status.json. A field that lives on
    // the in-process type but is dropped from the projection reads to us as
    // permanently absent, with every other assertion here still green.
    expect(projection).toMatch(/contextLimit\?: number/);
    expect(projection).toMatch(/tokens\?: TokenUsage/);
  });

  it("upstream updates the window per child TURN, not only at the end", () => {
    // The word "live" is the whole feature. If this moved to a completion-only
    // write, the gauge would appear once at 100% and never climb — and every
    // assertion above would still pass.
    const runner = subagentSource("src", "runs", "background", "subagent-runner.ts");
    expect(runner).toMatch(/message_end[\s\S]{0,1500}?step\.tokens = \{[^}]*window/);
  });
});

// ── Our bundled agents shadow upstream's builtins (PRD §12, 2026-08-29) ──────
//
// The fleet round AUTHORS `worker` rather than adopting upstream's, and the
// whole reason that is free is precedence: a file in the app-owned agent dir
// overrides the builtin of the same name outright. If upstream ever reorders
// that merge, ours silently stops being the one that runs — and the symptom is
// a `worker` with a different prompt and `defaultContext: fork`, which nothing
// else here would catch.
describe("our bundled agents still shadow upstream's builtins of the same name", () => {
  const selection = subagentSource("src", "agents", "agent-selection.ts");
  const OURS = path.join(__dirname, "..", "pi-runtime", "agents", "worker.md");

  it("merges builtins FIRST, so later scopes overwrite them by name", () => {
    const builtinAt = selection.indexOf("of builtinAgents");
    const userAt = selection.indexOf("of userAgents");
    expect(builtinAt).toBeGreaterThan(-1);
    expect(userAt).toBeGreaterThan(builtinAt);
    expect(selection).toContain("agentMap.set(agent.name, agent)");
  });

  it("upstream ships a builtin `worker` — the name we are deliberately taking", () => {
    expect(subagentSource("src", "agents", "builtin-names.ts")).toContain('"worker"');
  });

  it("ours declares no defaultContext, so the config's `fresh` governs it", () => {
    // Upstream's worker.md declares `defaultContext: fork` — the child would
    // start from the parent's session. Config defaultSubagentContext wins over
    // an agent defaultContext, but only for an agent that leaves it unset is
    // that unambiguous, so ours must never acquire the key by copy-paste.
    expect(readFileSync(OURS, "utf8")).not.toMatch(/^defaultContext:/m);
  });

  it("upstream's own worker still declares the fork we are declining to inherit", () => {
    // If this stops being true the shadowing is less load-bearing, not more —
    // it documents WHY we authored rather than adopted, and going stale is the
    // signal to re-read that decision, not a failure of ours.
    expect(subagentSource("agents", "worker.md")).toMatch(/^defaultContext: fork$/m);
  });

  it("ours is write-capable, which is the point of bundling it", () => {
    const fm = readFileSync(OURS, "utf8");
    for (const tool of ["bash", "edit", "write"]) expect(fm).toMatch(new RegExp(`^tools:.*\\b${tool}\\b`, "m"));
    // contact_supervisor needs the intercom relay writeSubagentConfig disables,
    // and an unknown/unavailable tool name fails the WHOLE run from 0.40.
    expect(fm).not.toContain("contact_supervisor");
  });
});

// ── The agent inventory comes from upstream's discovery (§12, 2026-08-29) ────
//
// The bridge used to enumerate two directories. Upstream reads six plus
// installed packages and walks UP for the project root, so the Agents page and
// the model's per-turn roster both under-reported — silently, since a short
// list looks exactly like a small installation.
describe("the agent inventory comes from upstream's own discovery", () => {
  const bridge = readFileSync(BRIDGE, "utf8");
  const agentsSrc = subagentSource("src", "agents", "agents.ts");

  it("reaches discoverAgentsAll by relative path — the exports map blocks the bare one", () => {
    expect(bridge).toContain('from "../node_modules/pi-subagents/src/agents/agents.ts"');
    expect(bridge).not.toMatch(/from\s+"pi-subagents\/src\//);
  });

  it("the `./agents` subpath exists but exposes registration, not discovery", () => {
    // This is why the reach is relative even though a subpath of that name is
    // in the map — reading the map alone would suggest a bare specifier works.
    const exports = (JSON.parse(readFileSync(PKG, "utf8")) as { exports?: Record<string, string> }).exports ?? {};
    expect(exports["./agents"]).toBeTruthy();
    const api = subagentSource("src", "api", "agents.ts");
    expect(api).not.toContain("discoverAgentsAll");
  });

  it("upstream still exports discoverAgentsAll with the four scopes we render", () => {
    expect(agentsSrc).toMatch(/export function discoverAgentsAll\(cwd: string\)/);
    for (const scope of ["builtin", "package", "user", "project"]) {
      expect(agentsSrc).toMatch(new RegExp(`${scope}: AgentConfig\\[\\]`));
    }
  });

  it("discoverAgentsAll does NOT drop disabled agents, which is why we filter", () => {
    // The singular discoverAgents filters (`agent.disabled !== true`); the All
    // variant does not. Without our own filter the six refused external-CLI
    // agents would be listed on the Agents page as available.
    const all = agentsSrc.slice(agentsSrc.indexOf("export function discoverAgentsAll"));
    expect(all.slice(0, all.indexOf("export function", 10))).not.toContain("agent.disabled !== true");
    expect(bridge).toContain("a.disabled === true) continue");
  });

  it("the page filters on the SAME predicate the bridge refuses with", () => {
    // Not a second copy of the set: a page that advertises an agent the bridge
    // declines is worse than one that omits it.
    expect(bridge).toContain("if (isExternalCliAgent(name0)) continue;");
    expect(bridge).toContain('?.type === "external-cli") continue;');
  });

  it("upstream still discovers from the dirs the old two-dir scan missed", () => {
    expect(agentsSrc).toContain('path.join(os.homedir(), ".agents")');
    expect(agentsSrc).toContain("collectPackageSubagentPaths");
    expect(agentsSrc).toContain("findConfiguredProjectRoot");
    expect(agentsSrc).toContain("EXTRA_AGENT_DIRS_ENV");
  });

  it("an AgentConfig still carries the fields the page renders", () => {
    expect(agentsSrc).toMatch(/export interface AgentConfig \{[\s\S]*?filePath: string/);
    for (const field of ["name: string", "description: string", "tools\\?: string\\[\\]", "source: AgentSource"]) {
      expect(agentsSrc).toMatch(new RegExp(`export interface AgentConfig \\{[\\s\\S]*?${field}`));
    }
  });
});

// ── Child-scoped stop (PRD §12, 2026-08-29 — the fleet round) ───────────────
//
// Upstream 0.55 (#1367) added it. The whole value is the failure direction: a
// malformed child id must be REJECTED, never widened into a run-level stop that
// kills the siblings the user was deliberately keeping.
describe("child-scoped stop contract", () => {
  const rpc = subagentSource("src", "extension", "rpc.ts");

  it("`stop` is a real RPC method, distinct from `interrupt`", () => {
    expect(rpc).toMatch(/SUBAGENT_RPC_METHODS = \[[^\]]*"interrupt"[^\]]*"stop"/);
  });

  it("`stop` accepts a childId and rejects a malformed one instead of widening", () => {
    expect(rpc).toContain("RPC stop childId must be a non-empty string");
  });

  it("only pending/running children are stoppable — what the button gates on", () => {
    const id = subagentSource("src", "runs", "shared", "child-identity.ts");
    expect(id).toMatch(/isStoppableAsyncStatusStep[\s\S]{0,200}?"pending"[\s\S]{0,40}?"running"/);
    // Our copy of that rule, which the card uses to decide whether to draw ◼.
    expect(isStoppableChild("pending")).toBe(true);
    expect(isStoppableChild("running")).toBe(true);
    for (const done of ["complete", "completed", "failed", "stopped", "rejected", "paused", undefined]) {
      expect(isStoppableChild(done)).toBe(false);
    }
  });

  it("a status step still carries the childId that stop resolves", () => {
    expect(subagentSource("src", "shared", "types.ts")).toMatch(/steps\?: Array<\{[\s\S]*?childId\?: string/);
  });

  it("the bridge drives `stop`, not `interrupt`, for a child", () => {
    const bridge = readFileSync(BRIDGE, "utf8");
    expect(bridge).toContain('rpcRequest("stop", { runId, childId })');
    expect(bridge).toContain("hv-subagent-stop-child");
  });
});

// ── Child thinking (PRD §12, 2026-08-29 — the fleet round) ──────────────────
describe("child thinking contract", () => {
  it("a status step still carries transcriptPath — our only route to the reasoning", () => {
    expect(subagentSource("src", "shared", "types.ts")).toMatch(/steps\?: Array<\{[\s\S]*?transcriptPath\?: string/);
  });

  it("the status projection keeps it, so a detached run is not blind", () => {
    expect(subagentSource("src", "runs", "background", "async-status.ts")).toContain("transcriptPath?: string");
  });

  it("we confine against the sessions dir, never tmpdir", () => {
    // subagent-artifacts lives in OUR session dir. A tmpdir guard here returns
    // nothing at all — and nothing is exactly what a passing test looks like.
    const src = readFileSync(new URL("../src/main/subagentThinking.ts", import.meta.url), "utf8");
    // Comments stripped: the file EXPLAINS the tmpdir trap at length, and a scan
    // that reads prose as code fails on its own documentation.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("os.tmpdir()");
    expect(code).toContain("sessionsRoot");
    // Containment, not a string prefix: `<root>-evil` must not pass.
    expect(src).toContain("root + path.sep");
  });

  it("upstream still writes artifacts into the dir we confine to", () => {
    // If pi-subagents ever relocates subagent-artifacts out of our session dir,
    // the confinement starts refusing every real transcript.
    const store = readFileSync(new URL("../src/main/store.ts", import.meta.url), "utf8");
    expect(store).toContain('const ARTIFACT_DIR = "subagent-artifacts"');
  });
});
