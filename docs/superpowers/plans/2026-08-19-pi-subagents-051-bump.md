# pi-subagents 0.51 + pi-mcp-adapter 2.26.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take pi-subagents 0.50.0 → 0.51.0 and pi-mcp-adapter 2.25.0 → 2.26.1, and neutralise the one regression 0.51 carries for HappyVibe specifically: upstream #1225 scopes async completion delivery to the launching Pi *process*, which silently drops the result of any delegation whose parent respawned.

**Architecture:** The bump itself is mechanical — both pins move in `pi-runtime/package.json`, the contract tests are re-pinned against measured 0.51 shapes. The one piece of new code is a 12-line extension loaded FIRST in the `-e` chain that claims `Symbol.for("pi-subagents.completion-owner-id")` on `globalThis` from a HappyVibe-supplied stable id, before pi-subagents can mint a random one. It must be its own extension rather than a change to `happyvibe-bridge.ts`, because the bridge is pinned to be the LAST `-e` and the id is minted during pi-subagents' registration.

**Tech Stack:** TypeScript, Electron, vitest, the vendored `pi-runtime` tree, Pi 0.84.2 in `--mode rpc`.

**Spec:** `~/.claude/plans/pi-subagents-got-updated-floofy-cherny.md` (the /round doc, rewritten 2026-08-19 with the decisions folded in). PRD decisions live in `docs/prd.md` §12 and the Notion mirror.

## Global Constraints

- **Pins move to exactly:** `pi-subagents` `0.51.0`, `pi-mcp-adapter` `2.26.1`. `@earendil-works/pi-coding-agent` STAYS `0.84.2` (0.51 declares `pi-ai >=0.80.0`; 0.84.2 is also the latest published). `typebox` STAYS `1.3.7` (tracks Pi, not pi-subagents' nested 1.1.38). `yaml` STAYS `2.8.3`.
- **`happyvibe-bridge.ts` MUST remain the LAST `-e` extension.** Pi dispatches `tool_call` handlers in extension load order and `event.input` is mutable, so a gate that ran before a mutating handler would prompt with args that are not the ones executed. Pinned by `tests/mcp-spawn.test.ts`.
- **Deep imports stay RELATIVE.** `../node_modules/pi-subagents/src/runs/background/async-status.ts` and `.../src/shared/types.ts`. The 0.51 exports map lists **12** subpaths and omits both files; a bare specifier throws at extension LOAD.
- **Never pipe a test run to `tail`/`grep`.** Redirect to a log, echo `EXIT=$?`, then grep the log: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
- **The live model resolver is `tests/liveModel.ts` and nothing else.** Verified 2026-08-19: `OPENROUTER_API_KEY` answers `http=200`, `DEEPSEEK_API_KEY` answers `http=402`. The resolver prefers OpenRouter, so the live batch runs. `.env` is NOT in this worktree — copy it from `~/Documents/Github/HappyVibe/.env` (Task 1).
- **Before believing any live failure at the new pin, re-check the provider answers 200.** Four "0.50 regressions" were a dead key; the tell is an assertion like `expected 0 to be greater than 0`, which means no delegation ran at all.
- **Background the live batch** (`run_in_background: true`, ~6 min) and do only non-tree work while it runs. A mid-run edit to `pi-runtime/` or `src/` yields a result for a tree that never existed.

---

### Task 1: Bump both pins, install, and collect the red inventory

This task's deliverable is a *measurement*, not a fix: the list of what the bump breaks, before anything is repaired. Do not fix anything here.

**Files:**
- Modify: `pi-runtime/package.json:5-8`
- Modify: `pi-runtime/package-lock.json` (regenerated)

**Interfaces:**
- Consumes: nothing.
- Produces: `/tmp/red-inventory.log` — the failing-test list every later task argues from.

- [ ] **Step 1: Bring `.env` into the worktree**

```bash
cp ~/Documents/Github/HappyVibe/.env /Users/guilhemduche/.superset/worktrees/HappyVibe/subagents-051/.env
```

- [ ] **Step 2: Confirm the provider has balance BEFORE anything else**

```bash
K=$(grep '^OPENROUTER_API_KEY=' .env | cut -d= -f2 | tr -d '\r')
curl -s -o /dev/null -w 'http=%{http_code}\n' https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $K" -H 'Content-Type: application/json' \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
```

Expected: `http=200`. Anything else — STOP and report; no live result in this plan means anything until this prints 200.

- [ ] **Step 3: Move both pins**

In `pi-runtime/package.json`, change exactly two values:

```json
    "pi-mcp-adapter": "2.26.1",
    "pi-subagents": "0.51.0",
```

Leave `"@earendil-works/pi-coding-agent": "0.84.2"` and `"typebox": "1.3.7"` untouched.

- [ ] **Step 4: Install and confirm what actually landed**

```bash
(cd pi-runtime && npm install)
node -p "['pi-subagents','pi-mcp-adapter','@earendil-works/pi-coding-agent','typebox'].map(p=>p+' '+require('./pi-runtime/node_modules/'+p+'/package.json').version).join('\n')"
```

Expected: `pi-subagents 0.51.0`, `pi-mcp-adapter 2.26.1`, `@earendil-works/pi-coding-agent 0.84.2`, `typebox 1.3.7`.

- [ ] **Step 5: Confirm the two deep-import paths still resolve on disk**

```bash
ls pi-runtime/node_modules/pi-subagents/src/runs/background/async-status.ts \
   pi-runtime/node_modules/pi-subagents/src/shared/types.ts
```

Expected: both listed. If either is missing, STOP — the bridge fails at extension load and ~18 tests go red at once.

- [ ] **Step 6: Collect the red inventory**

```bash
L=/tmp/red-inventory.log
npm test > $L 2>&1; echo "EXIT=$?"
grep -E '^ *(FAIL|✗|×)' $L | sort -u
tail -20 $L
```

Record the failing files and the exact assertion messages. Expected (predicted, to be confirmed rather than assumed): `tests/pi-subagents-contract.test.ts` fails on the exports-map subpath count (11 → 12). Everything else should be green — the three pi-mcp-adapter files our gates read (`mcp-auth.ts`, `mcp-auth-flow.ts`, `utils.ts`) are byte-identical between 2.25.0 and 2.26.1.

- [ ] **Step 7: Commit the pins with the inventory in the message**

```bash
git add pi-runtime/package.json pi-runtime/package-lock.json
git commit -m "chore(pi): bump pi-subagents 0.50.0 → 0.51.0, pi-mcp-adapter 2.25.0 → 2.26.1

Red inventory from `npm test` at the new pins, before any repair:
<paste the failing file + assertion list from /tmp/red-inventory.log>"
```

---

### Task 2: Probe the wire at 0.51, including the respawn case

Source reading cannot settle this. The 0.50 bump's biggest regression (no `async-started` on the workflow path) was present and unconditional in source and simply not on the wire. This task measures.

**Files:**
- Modify: `scripts/probe-050.ts` (add a `respawn` mode; keep the existing `async`/`fg`/`waitoff` modes untouched)

**Interfaces:**
- Consumes: `resolvePiSpawn`, `PiClient`, `tests/liveModel.ts` — all already imported by the probe.
- Produces: `/tmp/probe-050-respawn.json`, plus the four confirmed/refuted shape facts Task 3 pins.

- [ ] **Step 1: Re-run the three existing probe modes at the new pin**

```bash
for m in async fg waitoff; do
  node --experimental-strip-types --import jiti/register scripts/probe-050.ts $m 2>&1 | tail -5
done
```

Then check each of the four shape facts in the dumps, and write down CONFIRMED or CHANGED for each:

```bash
for m in async fg waitoff; do
  echo "== $m"
  node -e '
    const d = require("/tmp/probe-050-'$m'.json");
    const s = JSON.stringify(d);
    console.log("async-started present:", s.includes("subagent:async-started"));
    console.log("tool_execution_update present:", s.includes("tool_execution_update"));
    console.log("details.asyncId present:", /"asyncId"/.test(s));
    console.log("results[].output present:", /"output"/.test(s));
    console.log("completionOwnerId present:", /"completionOwnerId"/.test(s));
  '
done
```

Expected from the tarball reading, to be CONFIRMED not assumed: `async-started` absent on the workflow path, `tool_execution_update` absent, `asyncId` present, `results[].output` present, `completionOwnerId` present.

- [ ] **Step 2: Add the `respawn` mode to the probe**

Append a fourth mode. It launches an async delegation, kills the Pi child before it completes, respawns resuming the SAME session file, and records whether the completion is ever delivered. Add to the mode union and the dispatch at the bottom of the file:

```ts
const mode = (process.argv[2] ?? "async") as "async" | "fg" | "waitoff" | "respawn";
```

```ts
/**
 * Does a detached run's completion still reach a RESPAWNED parent?
 *
 * pi-subagents 0.51 (#1225) refuses any non-foreground completion whose
 * `completionOwnerId` differs from the current process's, and that id is a
 * randomUUID minted per Pi process. HappyVibe respawns Pi and resumes the same
 * session file on purpose, so this is the measurement that decides whether the
 * seed in Task 4 is needed at all — and, run again after Task 4, whether it works.
 */
async function probeRespawn(): Promise<void> {
  const dir = makeAgentDir(false);
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "probe051-sess-"));
  const events: unknown[] = [];

  const first = new PiClient(resolvePiSpawn(process.cwd(), sessionsDir, runtime, {
    agentDir: dir, providerEnv: PROVIDER_ENV, model: MODEL,
  }));
  first.on("event", (e: unknown) => events.push({ phase: "before", e }));
  first.start();
  await first.send({ type: "prompt", message: "Delegate to code-explorer: list every .ts file under pi-runtime/extensions and say how many there are. Do not answer yourself." });

  // Wait only for the dispatch, never for the result — the point is to die first.
  await new Promise<void>((done) => {
    const t = setTimeout(done, 45_000);
    first.on("event", (e: any) => {
      if (e?.type === "tool_execution_end" && e?.result?.details?.asyncId) { clearTimeout(t); done(); }
    });
  });

  const sessionFile = fs.readdirSync(sessionsDir).map((f) => path.join(sessionsDir, f)).find((f) => f.endsWith(".jsonl"));
  if (!sessionFile) throw new Error("no session file to resume — the probe cannot measure a respawn");
  first.stop();

  const second = new PiClient(resolvePiSpawn(process.cwd(), sessionsDir, runtime, {
    agentDir: dir, providerEnv: PROVIDER_ENV, model: MODEL, resumeFile: sessionFile,
  }));
  second.on("event", (e: unknown) => events.push({ phase: "after", e }));
  second.start();
  await new Promise((r) => setTimeout(r, 120_000));
  second.stop();

  fs.writeFileSync("/tmp/probe-050-respawn.json", JSON.stringify(events, null, 2));
  const after = JSON.stringify(events.filter((x: any) => x.phase === "after"));
  console.error("[probe] delivered after respawn:", after.includes("subagent-notify") || after.includes("Background task completed"));
}
```

- [ ] **Step 3: Run it and record the answer**

```bash
node --experimental-strip-types --import jiti/register scripts/probe-050.ts respawn 2>&1 | tail -5
```

Expected BEFORE Task 4: `delivered after respawn: false` — the completion is refused. If it prints `true`, the regression does not reproduce; STOP and report, because Task 4's whole justification is gone and the plan must be re-cut.

- [ ] **Step 4: Commit the probe**

```bash
git add scripts/probe-050.ts
git commit -m "test(probe): measure whether a respawned parent still gets its delegation's result

0.51's #1225 scopes completion delivery to the launching Pi process. Measured,
not inferred: <paste the delivered-after-respawn result>."
```

---

### Task 3: Re-pin the contract test at 0.51

**Files:**
- Modify: `tests/pi-subagents-contract.test.ts`
- Test: `tests/pi-subagents-contract.test.ts` (it is its own test)

**Interfaces:**
- Consumes: Task 2's CONFIRMED/CHANGED list.
- Produces: a green key-free gate for the 0.51 pin.

- [ ] **Step 1: Update the exports-map case to derive rather than hand-list**

The case at `tests/pi-subagents-contract.test.ts:66` fails because the map grew from 11 to 12 subpaths. Do NOT hardcode 12 — assert the property that matters (both files are absent from every subpath) and let the count be whatever it is:

```ts
  it("still ships an exports map that omits both files (why the relative path exists)", () => {
    const map = JSON.parse(readFileSync(subagentsPkg(), "utf8")).exports as Record<string, string>;
    const targets = Object.values(map);
    expect(targets.length, "the map lists subpaths at all").toBeGreaterThan(1);
    for (const needle of ["runs/background/async-status.ts", "shared/types.ts"]) {
      expect(targets.some((t) => t.endsWith(needle)), `no subpath exposes ${needle}`).toBe(false);
    }
  });
```

- [ ] **Step 2: Write the failing test for the owner-id seed's three anchors**

Add a new group. It must fail now (nothing sets the symbol yet) and stay honest later: it pins the upstream mechanism, so the day upstream changes any of the three the test says so instead of results going quietly missing.

```ts
describe("async completion delivery is scoped to a process, so HappyVibe claims the scope", () => {
  // pi-subagents 0.51 (#1225) refuses a non-foreground completion whose
  // completionOwnerId != the current process's, and mints that id as a
  // randomUUID per Pi process. HappyVibe respawns Pi and resumes the SAME
  // session file on purpose (hibernation wake, MCP live-reload, app relaunch),
  // so an unclaimed id means a detached run's answer is silently dropped.
  // We claim the global-registry symbol from hv-owner-seed.ts before
  // pi-subagents can mint one. All three anchors below are upstream's; if any
  // moves, the seed stops working and this test is the only thing that says so.
  const src = (...p: string[]) => readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", ...p), "utf8");

  it("mints the owner id off a globalThis symbol we can claim first", () => {
    const owner = src("shared", "completion-owner.ts");
    expect(owner).toContain('Symbol.for("pi-subagents.completion-owner-id")');
    expect(owner, "??= is what makes a pre-set value win").toMatch(/\?\?=\s*randomUUID\(\)/);
  });

  it("refuses a completion whose owner does not match, with no fallback", () => {
    const notify = src("runs", "background", "notify.ts");
    expect(notify).toContain("result.completionOwnerId !== state.completionOwnerId");
    expect(notify, "no config key can turn the scoping off").not.toMatch(/completionOwnerScoping|disableCompletionOwner/);
  });

  it("reads the id once, at extension registration, which is why our -e must precede it", () => {
    expect(src("extension", "index.ts")).toContain("completionOwnerId: currentCompletionOwnerId()");
  });

  it("our seed claims the same symbol name", () => {
    const seed = readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "hv-owner-seed.ts"), "utf8");
    expect(seed).toContain('Symbol.for("pi-subagents.completion-owner-id")');
  });
});
```

- [ ] **Step 3: Run it and verify the shape of the failure**

```bash
L=/tmp/vitest.log
npx vitest run tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
tail -40 $L
```

Expected: the three upstream cases PASS (they describe 0.51 as it is), and "our seed claims the same symbol name" FAILS with ENOENT on `hv-owner-seed.ts`. That is the file Task 4 creates.

- [ ] **Step 4: Confirm the rest of the file is green**

Every other case in this file describes shapes measured as unchanged at 0.51 — the deep imports, `ASYNC_DIR`, `PROMPT_REDACTED`, `subagent_wait`, `waitTool.enabled`, the bundled-agent tool allowlist, the typebox relationship, and the bare-`ctx.hasUI` drain gate (`index.ts:689`). If any of those fail, do NOT relax the assertion: measure the wire first (Task 2's probe), because a source-level pass with a wire-level change is exactly the trap 0.50 set.

- [ ] **Step 5: Commit**

```bash
git add tests/pi-subagents-contract.test.ts
git commit -m "test(pi-subagents): re-pin the contract at 0.51, and pin #1225's owner-id mechanism

The exports map grew 11 → 12 subpaths, so the case derives the property (neither
internal is exposed) instead of counting. New group pins the three upstream
anchors the owner-id seed rests on."
```

---

### Task 4: Claim the completion-owner id from HappyVibe's session identity

**Files:**
- Create: `pi-runtime/extensions/hv-owner-seed.ts`
- Modify: `src/main/pi/spawn.ts` — add `sessionId?: string` to `PiSpawnOptions`, add `HV_SUBAGENT_OWNER` to the env block, add the seed as the FIRST `-e`
- Modify: `src/main/ipc.ts:581-600` — pass `sessionId` through `spawnOpts`
- Modify: `tests/mcp-spawn.test.ts` — the `-e` list grows to four, bridge still last
- Test: `tests/mcp-spawn.test.ts`, `tests/pi-subagents-contract.test.ts`

**Interfaces:**
- Consumes: Task 3's failing "our seed claims the same symbol name" case.
- Produces: `pi-runtime/extensions/hv-owner-seed.ts` default export `registerOwnerSeed(pi: ExtensionAPI): void`; `PiSpawnOptions.sessionId?: string`; env var `HV_SUBAGENT_OWNER`.

- [ ] **Step 1: Write the failing test for the `-e` order**

Replace the assertion in `tests/mcp-spawn.test.ts` (it currently expects three entries). Keep the existing comment block above it — it is the reason the bridge is last:

```ts
test("the bridge is the LAST -e extension, so the permission gate sees final tool input", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, { sessionId: "s1" });
  expect(extensionArgs(spec.args)).toEqual([
    path.join(runtime, "extensions/hv-owner-seed.ts"),
    path.join(runtime, PI_SUBAGENTS_RELPATH),
    path.join(runtime, PI_MCP_ADAPTER_RELPATH),
    path.join(runtime, "extensions/happyvibe-bridge.ts"),
  ]);
});

// The seed only works if it runs BEFORE pi-subagents registers: that is when the
// owner id is minted (its index.ts, `completionOwnerId: currentCompletionOwnerId()`).
// It registers no tools and no tool_call handler, so being first costs the gate
// nothing — the invariant is that the GATE is last, not that nothing precedes it.
test("the owner seed precedes pi-subagents, which is the only ordering that works", () => {
  const e = extensionArgs(resolvePiSpawn("/ws", "/sessions", runtime, { sessionId: "s1" }).args);
  expect(e.indexOf(path.join(runtime, "extensions/hv-owner-seed.ts")))
    .toBeLessThan(e.indexOf(path.join(runtime, PI_SUBAGENTS_RELPATH)));
});

// A session with no id is the utility client ($HOME, no workspace) — it never
// delegates, so it gets no seed and upstream mints its own id. Fail open.
test("no session id means no owner claim", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, {});
  expect(spec.env.HV_SUBAGENT_OWNER).toBeUndefined();
});

test("a session id becomes a stable owner claim", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, { sessionId: "abc-123" });
  expect(spec.env.HV_SUBAGENT_OWNER).toBe("hv-abc-123");
  // Stable across respawn is the whole point: same id in, same claim out.
  expect(resolvePiSpawn("/ws", "/sessions", runtime, { sessionId: "abc-123" }).env.HV_SUBAGENT_OWNER)
    .toBe(spec.env.HV_SUBAGENT_OWNER);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-spawn.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: FAIL — the `-e` list has three entries, and `HV_SUBAGENT_OWNER` is undefined for both cases.

- [ ] **Step 3: Write the seed extension**

Create `pi-runtime/extensions/hv-owner-seed.ts`:

```ts
/**
 * Claim pi-subagents' completion-owner id from HappyVibe's session identity.
 *
 * pi-subagents 0.51 (upstream #1225) scopes async completion delivery to the Pi
 * PROCESS that launched the run: `notify.ts` refuses any non-foreground
 * completion whose `completionOwnerId` differs from the current process's, with
 * no config off-switch and — unlike the result watcher — no fallback. The id is
 * a `randomUUID()` cached on `globalThis` under a registry symbol, "stable for
 * one parent Pi process".
 *
 * That guard is right for its case (two windows sharing one session file) and
 * wrong for ours. HappyVibe respawns Pi on purpose — hibernation wake, MCP
 * live-reload, app relaunch — and resumes the SAME session file precisely so a
 * detached run is never orphaned (PRD §12). A per-process id means the resumed
 * parent is a stranger to its own child: the artifact lands on disk, the run
 * card resyncs, and the answer never reaches the model. Measured at 0.50: it
 * delivered. Measured at 0.51: it does not.
 *
 * So we claim the id first, from something stable across a respawn. `??=` is
 * what makes this work — a value already in the registry wins, and upstream
 * never overwrites it. HappyVibe never runs two Pi processes against one session
 * file (a respawn stops the old child first), so this is #1225's intent, keyed
 * on the identity that actually owns the session.
 *
 * This is a separate extension rather than part of the bridge because the id is
 * minted during pi-subagents' own registration, and the bridge is pinned to be
 * the LAST `-e` (the permission gate must see final tool input). It registers no
 * tools and no `tool_call` handler, so preceding everything costs the gate
 * nothing. Pinned by tests/pi-subagents-contract.test.ts + tests/mcp-spawn.test.ts.
 *
 * Fails OPEN: no `HV_SUBAGENT_OWNER` (the utility client, which never delegates)
 * means upstream mints its own id exactly as before.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OWNER_SYMBOL = Symbol.for("pi-subagents.completion-owner-id");

const claimed = process.env.HV_SUBAGENT_OWNER;
if (claimed) {
  (globalThis as Record<symbol, unknown>)[OWNER_SYMBOL] ??= claimed;
}

export default function registerOwnerSeed(_pi: ExtensionAPI): void {
  /* Nothing to register — the claim above happens at module load, which is the
     only moment early enough. Pi requires a default export, so this is it. */
}
```

- [ ] **Step 4: Wire it in `spawn.ts`**

Add the option to `PiSpawnOptions`, after `longCache`:

```ts
  /** HappyVibe's own session id. Becomes HV_SUBAGENT_OWNER, which
      extensions/hv-owner-seed.ts uses to claim pi-subagents' completion-owner
      id (0.51 / upstream #1225) so a RESPAWNED parent still receives its
      detached delegation's result. Stable across respawn by construction —
      that is the entire requirement. Absent for the utility client, which
      never delegates. */
  sessionId?: string;
```

Add the seed as the first `-e`, immediately before the pi-subagents entry at `spawn.ts:103`:

```ts
      // Claims pi-subagents' completion-owner id before it can mint a random
      // one (0.51 / #1225 — see hv-owner-seed.ts). MUST precede pi-subagents,
      // which mints the id during its own registration. Registers no tools and
      // no tool_call handler, so it does not touch the gate-is-last invariant
      // documented below.
      "-e", path.join(runtimeDir, "extensions/hv-owner-seed.ts"),
```

And add the env var beside the other `HV_*` entries (near `spawn.ts:194`):

```ts
      ...(opts.sessionId ? { HV_SUBAGENT_OWNER: `hv-${opts.sessionId}` } : {}),
```

- [ ] **Step 5: Pass the session id from `ipc.ts`**

In `spawnOpts` (`src/main/ipc.ts:581`), add one line to the returned object, beside `skillsFile` which already uses the same `sessionId`:

```ts
      // 0.51 / #1225: a respawned parent must still own its detached runs.
      sessionId,
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-spawn.test.ts tests/pi-subagents-contract.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: PASS, all four `-e`/env cases and the four contract cases including "our seed claims the same symbol name".

- [ ] **Step 7: Prove it on the wire — the unit tests do not**

A green unit test proves the symbol is set. It cannot prove a completion was delivered. Re-run Task 2's respawn probe:

```bash
node --experimental-strip-types --import jiti/register scripts/probe-050.ts respawn 2>&1 | tail -5
```

Expected: `delivered after respawn: true`, where Step 3 of Task 2 recorded `false`. If it is still `false`, the load order or the claim is wrong — dump `/tmp/probe-050-respawn.json` and check whether `HV_SUBAGENT_OWNER` reached the child at all before changing anything else.

- [ ] **Step 8: Commit**

```bash
git add pi-runtime/extensions/hv-owner-seed.ts src/main/pi/spawn.ts src/main/ipc.ts tests/mcp-spawn.test.ts
git commit -m "fix(subagents): a respawned session still owns its detached delegations

0.51 (#1225) scopes completion delivery to the launching Pi process, and
HappyVibe respawns Pi on purpose while resuming the same session file — so a
detached run's answer was silently dropped. We claim the owner id first, from
the HappyVibe session id, which is stable across exactly that respawn.

Measured with scripts/probe-050.ts respawn: delivered false → true."
```

---

### Task 5: Write the isolation contract down instead of inheriting it

**Files:**
- Modify: `src/main/config.ts:622-645` (`writeSubagentConfig`)
- Test: `tests/subagent-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `defaultSubagentContext: "fresh"` in `<agentDir>/extensions/subagent/config.json`.

- [ ] **Step 1: Write the failing test**

Append to `tests/subagent-config.test.ts`:

```ts
// 0.51 adds defaultSubagentContext, deciding whether a child starts fresh or
// FORKS the parent's session. Its default is already "fresh" (upstream
// fork-context.ts: `?? "fresh"`), which is what PRD §12's isolation contract has
// always assumed — so this changes nothing today. It is written anyway because a
// future default flip to "fork" would hand every sub-agent the parent's entire
// transcript, with no user-visible symptom and no failing test to announce it.
it("pins the isolation contract rather than inheriting upstream's default", () => {
  const cfg = JSON.parse(readFileSync(configPath(), "utf8"));
  expect(cfg.defaultSubagentContext).toBe("fresh");
});

it("upstream's own default still agrees, so the pin is a guard and not a change", () => {
  const fork = readFileSync(path.join(__dirname, "..", "pi-runtime", "node_modules", "pi-subagents", "src", "shared", "fork-context.ts"), "utf8");
  expect(fork).toMatch(/defaultSubagentContext\s*\?\?\s*input\.agentDefaultContext\s*\?\?\s*"fresh"/);
});
```

Reuse whatever helper the existing cases in that file use to reach the written config (`configPath()` above stands in for it) — read the top of the file and match it rather than adding a second way to find the same path.

- [ ] **Step 2: Run it to verify it fails**

```bash
L=/tmp/vitest.log
npx vitest run tests/subagent-config.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: the first case FAILS (`undefined` is not `"fresh"`); the second PASSES.

- [ ] **Step 3: Write the config line**

In `src/main/config.ts`, inside `writeSubagentConfig`, after the `waitTool` line:

```ts
  // PRD §12 (2026-08-19): 0.51 can make children FORK the parent session. The
  // default is already "fresh", which is what §12's isolation contract assumes —
  // stated explicitly so a future upstream flip cannot silently hand every child
  // the parent's whole transcript. Pinned in tests/subagent-config.test.ts,
  // which also asserts upstream's default still agrees.
  config.defaultSubagentContext = "fresh";
```

- [ ] **Step 4: Run it to verify it passes**

```bash
L=/tmp/vitest.log
npx vitest run tests/subagent-config.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts tests/subagent-config.test.ts
git commit -m "feat(subagents): state the isolation contract, don't inherit it

0.51's defaultSubagentContext defaults to \"fresh\", which §12 already assumes.
Written explicitly so a future flip to \"fork\" fails a test instead of quietly
giving every child the parent's transcript."
```

---

### Task 6: Name pi-mcp-adapter 2.26's new execution surface

`requestHeadersCommand` (#353) spawns a command per outbound MCP request, and per-server config is readable from a workspace `.mcp.json` — i.e. from a cloned repo. That is the same class as `resolveCommandSecret`'s `!` prefix, which CLAUDE.md already records. Name it now rather than discover it later.

**Files:**
- Modify: `tests/mcp-adapter-interpolation.test.ts`
- Test: `tests/mcp-adapter-interpolation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a pin-bump gate covering both adapter execution surfaces.

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-adapter-interpolation.test.ts`:

```ts
// pi-mcp-adapter 2.26.0 (#353) added per-server `requestHeadersCommand`: it runs
// a command per outbound Streamable-HTTP/SSE request and uses its output as
// headers. Per-server config is readable from a WORKSPACE .mcp.json, so this is
// a second code-execution surface reachable from a cloned repo — the same class
// as resolveCommandSecret's `!` prefix, which this file already pins. Named here
// so a future pin bump that widens it fails loudly.
it("requestHeadersCommand is a spawning surface, and we know it", () => {
  const src = readFileSync(path.join(adapterDir(), "request-headers-command.ts"), "utf8");
  expect(src).toMatch(/from "node:child_process"/);
  expect(src, "it spawns, so a workspace .mcp.json can run a command").toMatch(/\bspawn\b/);
});

it("nothing in our own catalog or config writer uses it", () => {
  const ours = [
    readFileSync(path.join(__dirname, "..", "src", "main", "plugins", "mcpImport.ts"), "utf8"),
    readFileSync(path.join(__dirname, "..", "src", "main", "plugins", "catalog.generated.ts"), "utf8"),
  ].join("\n");
  expect(ours, "HappyVibe never writes requestHeadersCommand on a user's behalf").not.toContain("requestHeadersCommand");
});
```

Reuse the existing helper this file already uses to locate the vendored adapter (`adapterDir()` above stands in for it) — read the top of the file and match it.

- [ ] **Step 2: Run it**

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-adapter-interpolation.test.ts > $L 2>&1; echo "EXIT=$?"
tail -20 $L
```

Expected: PASS on both — the file exists at 2.26.1 and we do not write the key. This case is written to *stay* green; it fails the day either fact changes. If the second case fails, that is a real finding: something in our catalog is passing a command through to a shell.

- [ ] **Step 3: Confirm the three auth-surface files really are unchanged**

The whole reason the adapter rides in this branch is that our gate surfaces did not move. Verify rather than trust:

```bash
L=/tmp/vitest.log
npx vitest run tests/mcp-adapter-authformat.test.ts tests/mcp-plugin-import-auth.test.ts > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: PASS. `tests/mcp-adapter-authformat.test.ts` must be running with `PI_MCP_ADAPTER_TEST_AUTH_STORE=memory` (it sets this itself — confirm it still does, or it reads the developer's real login keychain).

- [ ] **Step 4: Commit**

```bash
git add tests/mcp-adapter-interpolation.test.ts
git commit -m "test(mcp): name requestHeadersCommand, the adapter's second exec surface

2.26.0 (#353) runs a command per outbound request, configurable per server —
so reachable from a cloned repo's .mcp.json, same class as the \`!\` secret
prefix this file already pins. Also asserts we never write the key ourselves."
```

---

### Task 7: Record what the bump moved

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/validation/d1.md`

**Interfaces:**
- Consumes: every measurement from Tasks 1–6.
- Produces: the record the next bump argues from.

- [ ] **Step 1: Add the owner-id entry to `CLAUDE.md`**

Place it directly after the existing "Every delegation is a WORKFLOW from 0.50" bullet, so the 0.50 and 0.51 delegation findings read in order:

```markdown
- **A respawned session is a STRANGER to its own detached runs from 0.51 — unless we claim the
  owner id.** #1225 scopes async completion delivery to the launching Pi PROCESS:
  `notify.ts` refuses any `source !== "foreground"` completion whose `completionOwnerId` differs
  from the current process's, with **no config off-switch** and — unlike `result-watcher.ts`'s
  `shouldProcessResult`, which falls back to a mission-binding file — **no fallback in `deliver()`
  at all**. The id is a `randomUUID()` cached on `globalThis` under
  `Symbol.for("pi-subagents.completion-owner-id")` and minted during pi-subagents' own
  registration (`index.ts`). HappyVibe respawns Pi deliberately and resumes the SAME session file
  so a detached run is never orphaned, so at 0.51 the artifact lands on disk, the card resyncs, and
  the answer never reaches the model — measured `false` where 0.50 measured `true`
  (`scripts/probe-050.ts respawn`). `pi-runtime/extensions/hv-owner-seed.ts` claims the symbol from
  `HV_SUBAGENT_OWNER` (= `hv-<HappyVibe session id>`, stable across exactly that respawn) and
  **must be the FIRST `-e`** — which is why it is its OWN extension rather than part of the bridge,
  since the bridge is pinned LAST for the gate. It registers no tools and no `tool_call` handler,
  so first costs the gate nothing. Fails OPEN (no env var → upstream's own id), which is right for
  the utility client. Pinned by `tests/pi-subagents-contract.test.ts` (three upstream anchors) and
  `tests/mcp-spawn.test.ts` (the order, both env cases).
- **0.51 fixed none of the four things that hurt, and one of them is now permanent.** The
  1,000-char completion truncation survives (`subagent-executor.ts:4194` — the delivery repair
  stays load-bearing), `PROMPT_REDACTED` is unchanged, nothing restores `subagent:async-started`
  for the workflow path, and "async workflows do not have inline `live-card` projection" is now
  **documented as intended** (#1229/#1230) rather than a bug awaiting a fix — so the missing live
  child transcript is a permanent property, not a pin to wait out. Every workaround stays.
  `defaultSubagentContext` is new and still defaults to `"fresh"`; `writeSubagentConfig` states it
  explicitly anyway. `repairScan: true` is new and deliberately NOT adopted — the `.active-runs`
  upgrade hole and the 8 stale markers remain the accepted decision, and #1162 exists to stop
  scanning. 30-day retention runs in a `worker_threads` worker (unref'd, 60 s after activation),
  so it is NOT a child process and carries no Dock-icon hazard.
```

- [ ] **Step 2: Add the adapter note to `CLAUDE.md`**

Extend the existing "MCP secrets can EXECUTE" bullet with one sentence rather than adding a second bullet about the same class:

```markdown
  From 2.26.0 there is a SECOND such surface: per-server `requestHeadersCommand` (#353) spawns a
  command per outbound Streamable-HTTP/SSE request. Both are pinned by
  tests/mcp-adapter-interpolation.test.ts, which also asserts HappyVibe never writes
  `requestHeadersCommand` on a user's behalf.
```

- [ ] **Step 3: Sharpen the `ctx.hasUI` bullet in `CLAUDE.md`**

The adapter now does the right test, which makes the pi-subagents hazard sharper. Append to the existing `ctx.hasUI` bullet:

```markdown
  pi-mcp-adapter 2.26.1 (#365) now discriminates properly — `hasTerminalUI(ctx) = ctx.hasUI &&
  ctx.mode === "tui"` — which is this entry's measurement, upstream. pi-subagents still gates its
  turn-end drain on bare `ctx.hasUI` (`index.ts:689`), which is the ONLY reason that drain stays
  dormant for us; if it ever adopts `ctx.mode`, the drain arms and blocks every turn on its own
  async delegation. The contract-test case pinning the bare-`hasUI` gate is what makes that day loud.
```

- [ ] **Step 4: Add a `docs/validation/d1.md` section**

Append a `## pi-subagents 0.51` section following the existing `## pi-subagents 0.50` convention. It must carry: the four probe-confirmed shape facts with their measured values; the respawn measurement (`false` before the seed, `true` after) with the exact command; the `notify.ts:279` refusal quoted verbatim; the `completion-owner.ts` mint quoted verbatim; the exports-map subpath list at 0.51; and the pi-mcp-adapter 2.25.0→2.26.1 file-level diff with the three gate files named as byte-identical.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/validation/d1.md
git commit -m "docs(0.51): the owner-id claim, and the four pains 0.51 did not fix"
```

---

### Task 8: Full gate, live batch, and the GUI pass

**Files:** none — this task changes nothing and gates everything.

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: the evidence for `/land`.

- [ ] **Step 1: Full gate**

```bash
L=/tmp/gate.log
npm run gate > $L 2>&1; echo "EXIT=$?"
tail -30 $L
```

Expected: EXIT=0. `gate` = `build` (which runs BOTH typechecks and fast-fails on them) then the non-live suite. Do NOT run `npm run typecheck` separately — that is the same check twice.

- [ ] **Step 2: Confirm the live batch is required, and that it sees committed work**

```bash
npm run live:why
```

Expected: prints `pi-runtime/package.json`, `pi-runtime/extensions/hv-owner-seed.ts`, `src/main/pi/spawn.ts`. It diffs `main...HEAD`, so it only sees COMMITTED work — run it after Task 7's commit, not before. Empty output would mean the batch is not required; say so rather than silently skipping.

- [ ] **Step 3: Re-confirm the provider before running the batch**

```bash
K=$(grep '^OPENROUTER_API_KEY=' .env | cut -d= -f2 | tr -d '\r')
curl -s -o /dev/null -w 'http=%{http_code}\n' https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $K" -H 'Content-Type: application/json' \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
```

Expected `http=200`. A red live test with a 402 behind it measures nothing.

- [ ] **Step 4: Run the full serial live batch in the background**

Run with Bash `run_in_background: true` (~6 min, and it blocks):

```bash
L=/tmp/live.log
npm run test:live > $L 2>&1; echo "EXIT=$?"
```

While it runs, do ONLY non-tree work — docs, the PRD, review. A mid-run edit to `pi-runtime/` or `src/` produces a result for a tree that never existed. Expected: 17 files green (re-derive the count with `grep -rl "skipIf(!KEY" tests/`, never trust a number in prose). One failure ⇒ re-run that file in isolation before calling it a regression, and read the ASSERTION not the symptom.

- [ ] **Step 5: Restart the dev server and confirm main is actually running the new code**

`src/main` changes need a RESTART; a renderer reload does not rebuild main. Verifying source is not verifying the app:

```bash
grep -c 'HV_SUBAGENT_OWNER' out/main/index.js
```

Expected: at least 1. Zero means the running app is a stale bundle and every GUI observation below is worthless.

- [ ] **Step 6: The GUI pass — what must be TRUE on screen**

Each line names the surface it is observed on. Do not collapse these into "a GUI pass".

**Chat view, the session that delegates:**
1. Sending "explore this codebase and report what the extensions do" raises a sticky run card at the top of the chat within a few seconds, showing the **agent's name** (`code-explorer`) and the **task text**.
2. **Absence assertion (the caption fix):** that card does NOT read `workflow` as the agent name, and does NOT read `[prompt redacted]` as the task. Both are what 0.50 sends on the wire; seeing either means `hv-subagent-tasks.ts` stopped being consulted.
3. The card shows elapsed time advancing, and slides away when the run completes, leaving the call line and the result in the flow.
4. **Absence assertion (the delivery repair):** between the delegation and the answer there is **no `subagent_wait` card, no `subagent` status-poll card, and no `read` card naming a `*_output.md` artifact** — and the assistant's text contains neither "truncated" nor "let me fetch the full output". Those four absences ARE the feature; the answer arriving is not sufficient evidence.

**Chat view, after a quit and reopen — the surface that owns the fix is not the one that changed:**
5. Start a delegation whose report will take a while, then **quit the app entirely and reopen it**, and reopen that session. The delegation's answer appears as an assistant turn in the resumed session. This is the only observation that tests the owner-id claim; the unit tests prove the symbol is set, never that a completion was delivered.
6. **Absence assertion:** the resumed session shows no run card stuck at "running" for a delegation that has already finished, and no silent gap where the answer should be.

**Settings → MCP page (the adapter bump's surface):**
7. Every configured server shows the same auth state it showed before the bump — a server that read `connected` still reads `connected`, one that needed authentication still says so. The badge is answered by main's keychain sidecar, so a green badge that no longer matches a working session call is exactly the failure mode this page has had before.
8. **Absence assertion:** no server row shows an error or an empty tool list that it did not show at 2.25.0.

- [ ] **Step 7: The regression the design risks, as a sequence to perform**

The owner id is per-SESSION. If it were per-app, two sessions would answer for each other's children; if it were per-process, the fix would not work at all. This sequence separates the three:

1. Open **two** chat sessions in the same workspace.
2. In session **A**, start an async delegation.
3. Switch to session **B** and send a message. Expected: B answers normally, and A's run card is still there and still ticking (an active async run keeps A non-idle).
4. While A's run is still going, open **Settings → MCP** and toggle a server setting. This fires `scheduleMcpReload`. Expected: B (idle) reloads and shows the session-reloading notice; **A does not** — it is busy, so its reload defers.
5. Let A's delegation finish. Expected: A's answer lands **in A**, and nothing about it appears in B.
6. Now let B go idle and repeat step 4. Expected: A reloads once its run has finished, and its already-delivered answer is not re-delivered.

- [ ] **Step 8: Report, then stop for `/land`**

State: gate EXIT, live batch file/test counts, the respawn probe's before/after values, and each GUI assertion as observed or not. Do not claim the GUI pass on a screenshot alone — the absence assertions cannot be screenshotted and must be stated explicitly.

---

## Self-review

**Spec coverage.** Owner-id regression → Tasks 2, 4, 7, 8. `repairScan` not adopted → recorded in Task 7 Step 1, no code task, which is the decision. `defaultSubagentContext` → Task 5. pi-mcp-adapter 2.26.1 → Tasks 1, 6, 7. The four unfixed pains → Task 7 Step 1. Verification → Task 8. Nothing in the spec is unclaimed.

**Type consistency.** `HV_SUBAGENT_OWNER` and the `hv-<sessionId>` format are used identically in Tasks 4 (spawn.ts, tests), 7 (CLAUDE.md) and 8 (the `out/main/index.js` grep). `PiSpawnOptions.sessionId` is defined in Task 4 Step 4 and consumed in Step 5. `registerOwnerSeed` is the default export named in the Interfaces block and defined in Step 3. `Symbol.for("pi-subagents.completion-owner-id")` is spelled the same in Task 3's assertion and Task 4's implementation.

**Known soft spots, stated rather than hidden.** Task 5's `configPath()` and Task 6's `adapterDir()` stand in for whatever helper those test files already use — the step says to read the file and match it, because inventing a second path resolver in a test file that has one is how they drift. Task 7 Step 4 describes d1.md's content rather than quoting it, because every value in it comes from Task 2's dumps and cannot be written before they exist.
