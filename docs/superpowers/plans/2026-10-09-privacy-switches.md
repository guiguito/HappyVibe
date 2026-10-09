# Privacy switches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every connection HappyVibe (or its Pi) makes on its own gets an in-app switch, on by default, and an environment variable that can only force it off, with the variables documented in the user guide and never named in the app.

**Architecture:** one import-free table, `src/main/privacySwitches.ts`, lists every switch (its stored config key and its env var) plus the master `HV_NO_PHONE_HOME`. `config.ts` gets one generic `getSwitch`/`setSwitch` pair that every gate reads. One IPC pair, `hv:privacy-get`/`hv:privacy-set` plus the broadcast `hv:privacy-changed`, carries the state to every window. The usage, crash and updater setters keep their own handlers, because they have side effects. Each Inlet module, the updater, the web resolver and Pi's spawn env read the same resolver.

**Tech Stack:** Electron main (TypeScript 7), React renderer (Tailwind v4), `inlet-sdk` 0.5.0, vendored Pi 1.0.2, vitest (no DOM), Astro Starlight guide.

**Spec:** Notion "Privacy feedbacks" (`3f3d33dfffca80c78eb5ca4d39595c65`, LOCKED 2026-10-08, checked against the code 2026-10-09), D1–D10. PRD folds: `docs/prd.md` §16, §32, §34, §37, §38, §39, each a "Privacy round, 2026-10-09" decision.

## Global Constraints

- **Defaults:** nothing changes what a fresh install does. Every switch is **on** by default, and an absent config key means on.
- **Env var direction:** a variable can only turn a switch **off**, never on.
- **Variables:** `HV_NO_PHONE_HOME` (master), `HV_NO_USAGE_STATS`, `HV_NO_CRASH_REPORTS`, `HV_NO_FEEDBACK` (button **and** pulse), `HV_NO_REMOTE_CONFIG`, `HV_NO_UPDATE_CHECK`, `HV_NO_DEFAULT_WEB`.
  - An `HV_*` variable counts as set only at exactly `1` (`0`, empty, `true` and `yes` all mean not set).
  - Pi's own `PI_OFFLINE` locks the model-list switch and counts Pi's way: `1`, `true` or `yes`, case-insensitive.
- **Lock line:** a switch under a variable renders **off and disabled**, never hidden, with exactly *"Turned off on this computer by an environment setting."* followed by a **Learn more** link to the guide at `privacy#on-a-managed-computer`.
- **No variable names in the app:** `src/renderer/src` never contains `HV_NO_` or `PI_OFFLINE`.
- **Never set `PI_SKIP_VERSION_CHECK` or `PI_TELEMETRY`** (D4: Pi never makes those calls headless).
- **Where `PI_OFFLINE=1` goes:**
  - the model-list switch puts it only in `resolvePiSpawn`'s env (D10);
  - only the master writes it into `process.env` at boot (PR #104's approach).
- **No events about opt-outs:** no usage event is sent about any opt-out (§39's rule).
- **Repo rules (CLAUDE.md):**
  - Commits use `git commit -s`. Never run `npm run lint` or `npm run format`. The gate is `npm run gate`; never run `typecheck` before it.
  - Never pipe a test run: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
  - Anything the renderer imports must import nothing (`privacySwitches.ts` joins that list). `ipc.ts` never imports `./crash`, `./update`, `./usage`, `./remoteConfig` (only `./remoteConfig/client`), or `@electron-toolkit/utils`.
- **Credit:** commits that reuse plyd's code (Tasks 4–7, 9) carry `Co-authored-by: Vincent J <9133010+plyd@users.noreply.github.com>`, plus this session's `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Truthy-looking values.** `HV_NO_PHONE_HOME=true`, `=yes` or `=" 1"` must **not** lock anything, while `PI_OFFLINE=true` **must** lock the model list. Someone copying Pi's docs would expect Pi's rule for Pi's variable. Pinned in Task 1.
2. **A set call for a locked key.** It can come from a stale window or from devtools. It is ignored, `config.json` is untouched, and the current state comes back. Pinned in Task 3.
3. **Remote settings toggled off → on → off quickly.** The second `start()` must not build a second client while the first `installElectronMain` is in flight, and a switch that went off during the await must end stopped. inlet-sdk warns *"init() was called again"* otherwise. Pinned in Task 4 (source scan) and observed in the GUI pass (log).
4. **A `config.json` from before this round.** No new keys means every switch reads on. One stray `updateCheckOff: true` turns off updates and nothing else. Pinned in Task 2.
5. **Check off, then Check now.** The manual check still runs, and with download on it downloads straight away. This is the reason the download switch stays visible (D7). With an env lock plus `HV_UPDATE_FAKE`, the lock wins. Pinned in Task 5.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/main/privacySwitches.ts` | **Create** | The one table, `lockedByEnv`, `lockedKeys`, `MODEL_LIST_REFRESH_HOURS`, `PrivacyState` type. Imports nothing. |
| `src/main/config.ts` | Modify | Five new negative keys; generic `getSwitch` / `setSwitch`; `getUsageStats` / `getCrashReports` route through them. |
| `src/main/ipc.ts` | Modify | `hv:privacy-get` / `hv:privacy-set` + broadcast; feedback clients not built under `HV_NO_FEEDBACK`; `spawnOpts` passes `offline`. |
| `src/main/feedback/config.ts` | Modify | Master → `null` (PR #101). |
| `src/main/usage/index.ts`, `src/main/crash/index.ts` | Modify | Env lock gates install and the set handler. |
| `src/main/remoteConfig/client.ts`, `remoteConfig/index.ts` | Modify | Switch seam; live stop/start. |
| `src/main/update/state.ts`, `update/index.ts` | Modify | `check` + `locked` in state; `hv:update-set-check`; env lock → `disabled`. |
| `src/main/webTools.ts`, `usage/events.ts`, `usage/fromLog.ts` | Modify | `DEFAULT_OFF` (PR #102). |
| `src/main/pi/spawn.ts`, `src/main/index.ts` | Modify | `piMasterEnv`; `offline` → `PI_OFFLINE=1` (PR #104, trimmed). |
| `src/preload/index.ts`, `src/renderer/src/hv.d.ts` | Modify | `privacyGet` / `privacySet` / `onPrivacyChanged` / `updateSetCheck`. |
| `src/renderer/src/privacy.ts` | **Create** | `usePrivacy()` hook. |
| `src/renderer/src/components/LockLine.tsx` | **Create** | The one lock shape. |
| `src/renderer/src/components/DocsLink.tsx` | Modify | `OpenDocsContext`. |
| `src/renderer/src/components/Toggle.tsx` | Modify | `disabled` prop. |
| `src/renderer/src/components/PrivacyView.tsx` | Modify | Feedback, Remote settings, Model list, Other connections; locks; `PRIVACY_COPY`. |
| `src/renderer/src/components/ChangelogView.tsx`, `updateCopy.ts` | Modify | Check switch; lock state. |
| `src/renderer/src/components/BuiltinToolsBlock.tsx`, `src/renderer/src/remoteConfig.ts` | Modify | Locked default service; "paused" yields to remote settings off. |
| `src/renderer/src/App.tsx` | Modify | Megaphone and pulse gated on the switches; `OpenDocsContext.Provider`. |
| `docs/guide/src/content/docs/privacy.md`, `changelog.md`, `built-in-tools.md` | Modify | Guide. |
| `tests/privacy-switches.test.ts`, `privacy-config.test.ts`, `privacy-wiring.test.ts`, `pi-privacy-contract.test.ts`, `privacy-page.test.ts`, `privacy-guide.test.ts` | **Create** | See tasks. |
| `tests/feedback-config.test.ts`, `update-state.test.ts`, `web-tools-format.test.ts`, `remote-config-wiring.test.ts` | Modify | PR tests, adapted. |
| `CLAUDE.md`, `.claude/rules/crash-feedback.md`, `docs/validation/pv1.md`, `CHANGELOG.md` | Modify/Create | Current-state rules, evidence, changelog. |

---

### Task 0: Bootstrap the worktree

**Files:** none (environment only)

- [ ] **Step 1: Install both trees and link the env file**

Run `/devdoctor`, or by hand:

```bash
npm install && (cd pi-runtime && npm ci)
ln -s ~/Documents/Github/HappyVibe/.env .env
```

Expected: `pi-runtime/node_modules/@earendil-works/pi-coding-agent/package.json` reads `"version": "1.0.2"`. The Pi contract test in Task 7 reads this tree, and a worktree without it fails.

- [ ] **Step 2: Baseline**

Run: `L=/tmp/vitest.log; npm test > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=0`. If it isn't, stop and report: this round must not start on a red suite.

---

### Task 1: The table and the resolver

**Files:**
- Create: `src/main/privacySwitches.ts`
- Test: `tests/privacy-switches.test.ts`
- Modify: `CLAUDE.md` (Import hygiene list)

**Interfaces:**
- Produces:
  - `PRIVACY_SWITCHES`, `type SwitchKey`, `SWITCH_KEYS: SwitchKey[]`, `MASTER_ENV = "HV_NO_PHONE_HOME"`
  - `lockedByEnv(key: SwitchKey, env: Env): boolean`, `lockedKeys(env: Env): SwitchKey[]`
  - `MODEL_LIST_REFRESH_HOURS = 4`
  - `type PrivacyState = { on: Record<SwitchKey, boolean>; locked: SwitchKey[] }`, `type Env = Record<string, string | undefined>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/privacy-switches.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { MASTER_ENV, PRIVACY_SWITCHES, SWITCH_KEYS, lockedByEnv, lockedKeys } from "../src/main/privacySwitches";

describe("privacy switches: env vars only ever turn a switch off", () => {
  it("nothing set → nothing locked", () => {
    expect(lockedKeys({})).toEqual([]);
  });
  it("the master locks every key", () => {
    expect(lockedKeys({ [MASTER_ENV]: "1" })).toEqual(SWITCH_KEYS);
  });
  it("each variable locks only its own key(s); HV_NO_FEEDBACK locks both feedback surfaces", () => {
    for (const k of SWITCH_KEYS) {
      const name = PRIVACY_SWITCHES[k].env;
      const sharing = SWITCH_KEYS.filter((o) => PRIVACY_SWITCHES[o].env === name);
      expect(lockedKeys({ [name]: "1" }), name).toEqual(sharing);
    }
    expect(lockedKeys({ HV_NO_FEEDBACK: "1" })).toEqual(["feedback", "sessionPulse"]);
  });
  it("an HV_ variable counts only at exactly 1 (Review Focus 1)", () => {
    for (const v of ["0", "", "true", "yes", " 1", "1 "]) {
      expect(lockedKeys({ [MASTER_ENV]: v }), JSON.stringify(v)).toEqual([]);
      expect(lockedByEnv("usageStats", { HV_NO_USAGE_STATS: v }), JSON.stringify(v)).toBe(false);
    }
  });
  it("PI_OFFLINE counts Pi's way: 1, true or yes, any case", () => {
    for (const v of ["1", "true", "TRUE", "yes", "Yes"]) expect(lockedByEnv("modelList", { PI_OFFLINE: v }), v).toBe(true);
    for (const v of ["0", "", "no", "false"]) expect(lockedByEnv("modelList", { PI_OFFLINE: v }), v).toBe(false);
    expect(lockedKeys({ PI_OFFLINE: "1" })).toEqual(["modelList"]);
  });
  it("is import-free (the renderer imports it)", () => {
    const src = fs.readFileSync("src/main/privacySwitches.ts", "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `L=/tmp/vitest.log; npx vitest run tests/privacy-switches.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL, `Cannot find module '../src/main/privacySwitches'`.

- [ ] **Step 3: Write the module**

```ts
// src/main/privacySwitches.ts
/**
 * Privacy round (2026-10-09) — the ONE list of what HappyVibe sends on its own,
 * each with the config key that stores the user's "off" (absent = on) and the
 * environment variable that forces it off before the first launch.
 *
 * Imports NOTHING: the renderer imports it for the lock state, and a runtime
 * import here puts node:* in the browser bundle (CLAUDE.md "Import hygiene").
 */
export const PRIVACY_SWITCHES = {
  usageStats: { off: "usageStatsOff", env: "HV_NO_USAGE_STATS" },
  crashReports: { off: "crashReportsOff", env: "HV_NO_CRASH_REPORTS" },
  feedback: { off: "feedbackButtonOff", env: "HV_NO_FEEDBACK" },
  sessionPulse: { off: "sessionPulseOff", env: "HV_NO_FEEDBACK" },
  remoteConfig: { off: "remoteConfigOff", env: "HV_NO_REMOTE_CONFIG" },
  updateCheck: { off: "updateCheckOff", env: "HV_NO_UPDATE_CHECK" },
  // Pi's own variable, counted Pi's way (1, true, yes) — that's what turns Pi offline.
  modelList: { off: "modelListOff", env: "PI_OFFLINE" },
  // The user's control lives on Built-in tools (own service, or web tools off).
  defaultWeb: { off: null, env: "HV_NO_DEFAULT_WEB" },
} as const;

export type SwitchKey = keyof typeof PRIVACY_SWITCHES;
export type Env = Record<string, string | undefined>;
export type PrivacyState = { on: Record<SwitchKey, boolean>; locked: SwitchKey[] };

export const SWITCH_KEYS = Object.keys(PRIVACY_SWITCHES) as SwitchKey[];
export const MASTER_ENV = "HV_NO_PHONE_HOME";
/** Pi's REMOTE_CATALOG_REFRESH_INTERVAL_MS in hours; tests/pi-privacy-contract.test.ts pins it. */
export const MODEL_LIST_REFRESH_HOURS = 4;

const piTruthy = (v: string | undefined): boolean => !!v && ["1", "true", "yes"].includes(v.toLowerCase());

export function lockedByEnv(key: SwitchKey, env: Env): boolean {
  if (env[MASTER_ENV] === "1") return true;
  const name = PRIVACY_SWITCHES[key].env;
  return name === "PI_OFFLINE" ? piTruthy(env[name]) : env[name] === "1";
}

export function lockedKeys(env: Env): SwitchKey[] {
  return SWITCH_KEYS.filter((k) => lockedByEnv(k, env));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: the Step 2 command. Expected: `EXIT=0`, 6 passed.

- [ ] **Step 5: Add it to CLAUDE.md's import-free list**

In `CLAUDE.md`, under "Import hygiene", change the list that starts with `` `schedules.ts`, `hv-paths.ts`, `` so it also names `` `privacySwitches.ts` `` (insert it after `` `docsBase.ts` ``).

- [ ] **Step 6: Commit**

```bash
git add src/main/privacySwitches.ts tests/privacy-switches.test.ts CLAUDE.md
git commit -s -m "feat(privacy): one table of every connection, and the env vars that lock each off"
```

---

### Task 2: Config: one getter and setter for every switch

**Files:**
- Modify: `src/main/config.ts:48-52` (ConfigFile), `:581-601` (usage/crash getters)
- Test: `tests/privacy-config.test.ts`

**Interfaces:**
- Consumes: `PRIVACY_SWITCHES`, `lockedByEnv`, `SwitchKey`, `Env` (Task 1)
- Produces: `getSwitch(key: SwitchKey, env?: Env): boolean`, `setSwitch(key: SwitchKey, on: boolean): void`. `getUsageStats()` and `getCrashReports()` keep their names and now return `false` under a lock.

- [ ] **Step 1: Write the failing test** (pattern: `tests/workflows-default.test.ts`)

```ts
// tests/privacy-config.test.ts
import { beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let userData: string;
vi.mock("electron", () => ({ app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } }));
beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-privacy-config-"));
  vi.resetModules();
});
const writeCfg = (o: object): void => fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify(o));

test("a config from before this round reads every switch on (Review Focus 4)", async () => {
  writeCfg({ usageStatsOff: undefined });
  const { getSwitch } = await import("../src/main/config");
  const { SWITCH_KEYS } = await import("../src/main/privacySwitches");
  for (const k of SWITCH_KEYS) expect(getSwitch(k, {}), k).toBe(true);
});

test("one stray key turns off its own switch and nothing else", async () => {
  writeCfg({ updateCheckOff: true });
  const { getSwitch } = await import("../src/main/config");
  const { SWITCH_KEYS } = await import("../src/main/privacySwitches");
  for (const k of SWITCH_KEYS) expect(getSwitch(k, {}), k).toBe(k !== "updateCheck");
});

test("set stores only a negative and deletes it on the way back on", async () => {
  const { getSwitch, setSwitch } = await import("../src/main/config");
  setSwitch("sessionPulse", false);
  expect(JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8")).sessionPulseOff).toBe(true);
  expect(getSwitch("sessionPulse", {})).toBe(false);
  setSwitch("sessionPulse", true);
  expect(JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8"))).not.toHaveProperty("sessionPulseOff");
});

test("an env lock reads off, whatever is stored, and never turns a stored off back on", async () => {
  const { getSwitch, setSwitch } = await import("../src/main/config");
  expect(getSwitch("crashReports", { HV_NO_CRASH_REPORTS: "1" })).toBe(false);
  setSwitch("feedback", false);
  expect(getSwitch("feedback", { HV_NO_PHONE_HOME: "0" })).toBe(false);
});

test("defaultWeb has no stored key: on unless locked", async () => {
  const { getSwitch } = await import("../src/main/config");
  expect(getSwitch("defaultWeb", {})).toBe(true);
  expect(getSwitch("defaultWeb", { HV_NO_DEFAULT_WEB: "1" })).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `L=/tmp/vitest.log; npx vitest run tests/privacy-config.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL, `getSwitch is not a function`.

- [ ] **Step 3: Implement**

In `ConfigFile` (next to `crashReportsOff?: boolean;`, `config.ts:48`):

```ts
  /** Privacy round (2026-10-09): each set only when the user turns that connection OFF
      (absent = on, the crashReportsOff shape). The keys are PRIVACY_SWITCHES' `off`. */
  feedbackButtonOff?: boolean;
  sessionPulseOff?: boolean;
  remoteConfigOff?: boolean;
  updateCheckOff?: boolean;
  modelListOff?: boolean;
```

Add the import at the top of `config.ts`:

```ts
import { PRIVACY_SWITCHES, lockedByEnv, type Env, type SwitchKey } from "./privacySwitches";
```

Replace `getUsageStats` / `setUsageStats` / `getCrashReports` / `setCrashReports` (`config.ts:581-601`) with:

```ts
/**
 * Privacy round (2026-10-09): every switch on the Privacy and Changelog pages.
 * An env lock reads OFF whatever is stored, and is the only way off before the
 * first launch; it never turns anything on. Absent key = on.
 */
export function getSwitch(key: SwitchKey, env: Env = process.env): boolean {
  if (lockedByEnv(key, env)) return false;
  const off = PRIVACY_SWITCHES[key].off;
  return off ? !load()[off] : true;
}

export function setSwitch(key: SwitchKey, on: boolean): void {
  const off = PRIVACY_SWITCHES[key].off;
  if (!off) return;
  const cfg = load();
  if (on) delete cfg[off];
  else cfg[off] = true;
  save(cfg);
}

/** §39: usage statistics, stored negative so absent means on (the crashReportsOff shape). */
export const getUsageStats = (): boolean => getSwitch("usageStats");
export const setUsageStats = (on: boolean): void => setSwitch("usageStats", on);
export const getCrashReports = (): boolean => getSwitch("crashReports");
export const setCrashReports = (on: boolean): void => setSwitch("crashReports", on);
```

Keep the existing doc comment that sits above `getUsageStats` (the "ON by default and global…" paragraph) attached to `getSwitch`.

- [ ] **Step 4: Run it to verify it passes**

Run: the Step 2 command, plus `tests/crash-optout.test.ts tests/usage-wiring.test.ts`. Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts tests/privacy-config.test.ts
git commit -s -m "feat(privacy): config reads every switch through one lock-aware getter"
```

---

### Task 3: One state, every window: `hv:privacy-get` / `hv:privacy-set`

**Files:**
- Modify: `src/main/ipc.ts`: privacy handlers beside `hv:get-long-cache` (`ipc.ts:4472`); feedback clients (`ipc.ts:4818-4895`)
- Modify: `src/main/remoteConfig/client.ts` (the switch seam, used here and in Task 4)
- Modify: `src/preload/index.ts:440-466`, `src/renderer/src/hv.d.ts`
- Create: `src/renderer/src/privacy.ts`
- Test: `tests/privacy-wiring.test.ts`

**Interfaces:**
- Consumes: `getSwitch`, `setSwitch` (Task 2); `SWITCH_KEYS`, `lockedKeys`, `lockedByEnv`, `PrivacyState` (Task 1)
- Produces:
  - IPC `hv:privacy-get` → `PrivacyState`; `hv:privacy-set(key, on)` → `PrivacyState`, accepted only for `feedback | sessionPulse | remoteConfig | modelList`; broadcast `hv:privacy-changed` with a `PrivacyState`.
  - `remoteConfig/client.ts`: `setRemoteConfigSwitchHandler(fn: ((on: boolean) => void) | null)`, `applyRemoteConfigSwitch(on: boolean)`.
  - Preload: `privacyGet()`, `privacySet(key, on)`, `onPrivacyChanged(cb)`.
  - Renderer: `usePrivacy(): [PrivacyState | null, () => void]` (the second element re-fetches).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/privacy-wiring.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { applyRemoteConfigSwitch, setRemoteConfigSwitchHandler } from "../src/main/remoteConfig/client";

const read = (f: string): string => fs.readFileSync(f, "utf8");

describe("privacy state wiring", () => {
  it("the remote-config seam forwards each flip, and is inert with no handler", () => {
    const seen: boolean[] = [];
    applyRemoteConfigSwitch(false); // no handler yet: must not throw
    setRemoteConfigSwitchHandler((on) => seen.push(on));
    applyRemoteConfigSwitch(false);
    applyRemoteConfigSwitch(true);
    applyRemoteConfigSwitch(false);
    setRemoteConfigSwitchHandler(null);
    expect(seen).toEqual([false, true, false]);
  });
  it("main answers get/set and broadcasts every change", () => {
    const ipc = read("src/main/ipc.ts");
    expect(ipc).toContain('ipcMain.handle("hv:privacy-get"');
    expect(ipc).toContain('ipcMain.handle("hv:privacy-set"');
    expect(ipc).toMatch(/windows\.broadcast\("hv:privacy-changed"/);
  });
  it("a set for a locked or foreign key is refused before anything is written (Review Focus 2)", () => {
    const ipc = read("src/main/ipc.ts");
    const handler = ipc.slice(ipc.indexOf('ipcMain.handle("hv:privacy-set"'));
    const guard = handler.indexOf("lockedByEnv(key, process.env)");
    const write = handler.indexOf("setSwitch(key");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(write);
    expect(ipc).toMatch(/PRIVACY_SET_HERE: SwitchKey\[\] = \["feedback", "sessionPulse", "remoteConfig", "modelList"\]/);
  });
  it("HV_NO_FEEDBACK means the feedback clients are never built, so nothing queued replays", () => {
    expect(read("src/main/ipc.ts")).toMatch(/const inlet = feedbackCfg && !lockedByEnv\("feedback", process\.env\)\s*\?\s*createFeedbackClients/);
  });
  it("the preload exposes the three calls with literal channels", () => {
    const pre = read("src/preload/index.ts");
    expect(pre).toContain('ipcRenderer.invoke("hv:privacy-get")');
    expect(pre).toContain('ipcRenderer.invoke("hv:privacy-set", key, on)');
    expect(pre).toContain('ipcRenderer.on("hv:privacy-changed"');
  });
  it("ipc.ts reaches remote config only through its import-free seam", () => {
    expect(read("src/main/ipc.ts")).toMatch(/from "\.\/remoteConfig\/client"/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `L=/tmp/vitest.log; npx vitest run tests/privacy-wiring.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL (`applyRemoteConfigSwitch is not a function`, missing handlers).

- [ ] **Step 3: The seam** (append to `src/main/remoteConfig/client.ts`)

```ts
/**
 * Privacy round (2026-10-09): the Remote settings switch. ipc.ts (which must not
 * reach Electron) calls applyRemoteConfigSwitch; remoteConfig/index.ts plugs in
 * the live stop/start at install. No handler (dev without a key, tests): inert.
 */
let onSwitch: ((on: boolean) => void) | null = null;

export function setRemoteConfigSwitchHandler(fn: ((on: boolean) => void) | null): void {
  onSwitch = fn;
}

export function applyRemoteConfigSwitch(on: boolean): void {
  onSwitch?.(on);
}
```

- [ ] **Step 4: Main handlers** (`src/main/ipc.ts`, beside `hv:get-long-cache`)

Imports: add `getSwitch, setSwitch` to the existing `./config` import. Add:

```ts
import { SWITCH_KEYS, lockedByEnv, lockedKeys, type PrivacyState, type SwitchKey } from "./privacySwitches";
import { applyRemoteConfigSwitch } from "./remoteConfig/client";
```

Handlers:

```ts
  // Privacy round (2026-10-09): one state for every window. Usage statistics, crash
  // reports and the update check keep their own setters (each has a side effect in
  // an Electron-only module); these four are config plus, for remote config, the seam.
  const PRIVACY_SET_HERE: SwitchKey[] = ["feedback", "sessionPulse", "remoteConfig", "modelList"];
  const privacyState = (): PrivacyState => ({
    on: Object.fromEntries(SWITCH_KEYS.map((k) => [k, getSwitch(k)])) as Record<SwitchKey, boolean>,
    locked: lockedKeys(process.env),
  });
  ipcMain.handle("hv:privacy-get", () => privacyState());
  ipcMain.handle("hv:privacy-set", (_e, key: SwitchKey, on: boolean) => {
    if (!PRIVACY_SET_HERE.includes(key) || lockedByEnv(key, process.env)) return privacyState();
    setSwitch(key, !!on);
    if (key === "remoteConfig") applyRemoteConfigSwitch(!!on);
    const s = privacyState();
    windows.broadcast("hv:privacy-changed", s);
    return s;
  });
```

Feedback clients (`ipc.ts:4822`): change `const inlet = feedbackCfg ? createFeedbackClients(` to:

```ts
  // Privacy round: under HV_NO_FEEDBACK (or the master, which nulls feedbackCfg) the
  // clients are never built, so a queued submission is not replayed while the lock
  // holds. The queue stays on disk: those were explicit Sends.
  const inlet = feedbackCfg && !lockedByEnv("feedback", process.env) ? createFeedbackClients(
```

Then make the three availability checks follow `inlet`:
- `hv:feedback-info` → `({ available: !!inlet, fastPulse: feedbackFast })`
- `hv:feedback-open` → `if (!inlet || !feedbackCfg) return { ok: false, reason: "unavailable" };`

- [ ] **Step 5: Preload + types**

`src/preload/index.ts`, after `setCrashReports`:

```ts
  // Privacy round: the switches' state, pushed to every window on a change.
  privacyGet: () => ipcRenderer.invoke("hv:privacy-get"),
  privacySet: (key: string, on: boolean) => ipcRenderer.invoke("hv:privacy-set", key, on),
  onPrivacyChanged: (cb: (s: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown): void => cb(p);
    ipcRenderer.on("hv:privacy-changed", listener);
    return () => ipcRenderer.removeListener("hv:privacy-changed", listener);
  },
```

`src/renderer/src/hv.d.ts`, beside `getUsageStats(): Promise<boolean>;` (import `PrivacyState` / `SwitchKey` from `../../main/privacySwitches` with `import type`, the way the file already imports main types):

```ts
  privacyGet(): Promise<PrivacyState>;
  privacySet(key: SwitchKey, on: boolean): Promise<PrivacyState>;
  onPrivacyChanged(cb: (s: PrivacyState) => void): () => void;
```

- [ ] **Step 6: Renderer hook**

```ts
// src/renderer/src/privacy.ts
/** Privacy round: the switches as main holds them, live across windows. */
import { useCallback, useEffect, useState } from "react";
import type { PrivacyState } from "../../main/privacySwitches";

export function usePrivacy(): [PrivacyState | null, () => void] {
  const [s, setS] = useState<PrivacyState | null>(null);
  const reload = useCallback(() => void window.hv.privacyGet().then(setS), []);
  useEffect(() => {
    reload();
    return window.hv.onPrivacyChanged(setS);
  }, [reload]);
  return [s, reload];
}
```

- [ ] **Step 7: Run the tests**

Run: the Step 2 command, plus `tests/feedback-dialog.test.ts tests/feedback-audit.test.ts`. Expected: `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc.ts src/main/remoteConfig/client.ts src/preload/index.ts src/renderer/src/hv.d.ts src/renderer/src/privacy.ts tests/privacy-wiring.test.ts
git commit -s -m "feat(privacy): one switch state for every window; HV_NO_FEEDBACK never builds the feedback clients"
```

---

### Task 4: The Inlet modules honour their locks; remote config stops and starts live

**Files:**
- Modify: `src/main/feedback/config.ts:69` (master → null, PR #101)
- Modify: `src/main/usage/index.ts:20-48`, `src/main/crash/index.ts` (`installCrash`, `registerCrashIpc`)
- Modify: `src/main/remoteConfig/index.ts` (whole file, ~30 lines)
- Modify: `src/renderer/src/remoteConfig.ts` (`useWebDefaultPaused`)
- Test: `tests/feedback-config.test.ts`, `tests/remote-config-wiring.test.ts`

**Interfaces:**
- Consumes: `getSwitch` (Task 2); `lockedByEnv`, `MASTER_ENV` (Task 1); `setRemoteConfigSwitchHandler` (Task 3); `usePrivacy` (Task 3)
- Produces: `installRemoteConfig(): Promise<void>` (same signature, now switch-aware)

- [ ] **Step 1: Write the failing tests**

Append to `tests/feedback-config.test.ts` inside `describe("resolveFeedbackConfig", …)` (PR #101's test):

```ts
  /** One switch for every Inlet surface: feedback, crash, usage and remote config all read this. */
  it("HV_NO_PHONE_HOME=1 resolves to null on both channels, whatever else is set", () => {
    for (const isDev of [true, false]) {
      expect(resolveFeedbackConfig({ HV_NO_PHONE_HOME: "1" }, isDev)).toBeNull();
      expect(resolveFeedbackConfig({ HV_NO_PHONE_HOME: "1", HV_FEEDBACK_CHANNEL: "prod", HV_FEEDBACK_PUBLISHABLE_KEY: "ipk_x" }, isDev)).toBeNull();
    }
    expect(resolveFeedbackConfig({ HV_NO_PHONE_HOME: "0" }, false)).not.toBeNull();
  });
```

Append to `tests/remote-config-wiring.test.ts` (it already has `strip(file)`):

```ts
  it("Privacy round: the switch gates install, stop closes, start never runs twice (Review Focus 3)", () => {
    const idx = strip("src/main/remoteConfig/index.ts");
    expect(idx).toMatch(/getSwitch\("remoteConfig"\)/);
    expect(idx).toMatch(/setRemoteConfigSwitchHandler\(/);
    expect(idx).toMatch(/\.uninstall\(\)/);
    expect(idx).toMatch(/\.close\(\)/);
    expect(idx).toMatch(/starting \?\?=/);
    // A switch that went off while the init was in flight ends stopped.
    expect(idx).toMatch(/if \(!getSwitch\("remoteConfig"\)\) stop\(\)/);
  });
  it("Privacy round: usage and crash refuse to install, or to switch, under their lock", () => {
    for (const [f, key] of [["src/main/usage/index.ts", "usageStats"], ["src/main/crash/index.ts", "crashReports"]] as const) {
      expect(strip(f).match(new RegExp(`lockedByEnv\\("${key}", process\\.env\\)`, "g"))?.length, f).toBeGreaterThanOrEqual(2);
    }
  });
  it("Privacy round: the renderer's paused row yields to remote settings off", () => {
    expect(strip("src/renderer/src/remoteConfig.ts")).toMatch(/privacy\?\.on\.remoteConfig !== false/);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `L=/tmp/vitest.log; npx vitest run tests/feedback-config.test.ts tests/remote-config-wiring.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL on the new cases only.

- [ ] **Step 3: Feedback config (PR #101)**

`src/main/feedback/config.ts`: add `import { MASTER_ENV } from "../privacySwitches";` and, first in `resolveFeedbackConfig`:

```ts
  // HV_NO_PHONE_HOME=1: the machine's owner wants nothing sent to Inlet. Null is
  // the keyless path above, so feedback, crash, usage and remote config all stay off.
  if (env[MASTER_ENV] === "1") return null;
```

- [ ] **Step 4: Usage and crash gates**

`src/main/usage/index.ts`: import `lockedByEnv` from `../privacySwitches`.
- In `registerUsageIpc`, the first line of the `hv:set-usage-stats` handler body becomes `if (lockedByEnv("usageStats", process.env)) return;`.
- In `installUsage`, change `if (!cfg) return;` to `if (!cfg || lockedByEnv("usageStats", process.env)) return; // the env lock: no client, no ID on disk`.

`src/main/crash/index.ts`: import `lockedByEnv` from `../privacySwitches`.
- In `installCrash`, change `if (!cfg) return;` (line ~129) to `if (!cfg || lockedByEnv("crashReports", process.env)) return;`.
- In `registerCrashIpc`, the `hv:set-crash-reports` handler returns early on the same condition, before `setCrashReports`.

- [ ] **Step 5: Remote config, live** (replace the body of `src/main/remoteConfig/index.ts` below the imports)

```ts
import { getSwitch } from "../config";
import { setConfigReader, setRemoteConfigSwitchHandler } from "./client";

type Client = Awaited<ReturnType<typeof installElectronMain<typeof CONFIG_DEFAULTS>>>;
let client: Client | null = null;
let starting: Promise<void> | null = null;

/** Privacy round: Remote settings switch off → no check at launch, on focus or on the tick. */
function start(): Promise<void> {
  return (starting ??= (async () => {
    const cfg = resolveFeedbackConfig(process.env, is.dev);
    if (client || !cfg || !getSwitch("remoteConfig")) return; // no key, or off (switch or env lock)
    try {
      client = await installElectronMain({
        baseUrl: cfg.baseUrl,
        publishableKey: cfg.publishableKey,
        databaseId: cfg.configDatabase,
        defaults: CONFIG_DEFAULTS,
        // A window can read values; it cannot change who this device is.
        acceptRendererIdentity: false,
        ...(is.dev ? { debug: (m: string, d?: unknown) => console.warn("[config]", m, d ?? "") } : {}),
      });
      const c = client;
      setConfigReader((key) => c.getBoolean(key, CONFIG_DEFAULTS[key]));
      // Turned off while the init was in flight (Review Focus 3).
      if (!getSwitch("remoteConfig")) stop();
    } catch (err) {
      console.warn("[config] not installed:", err);
    }
  })().finally(() => {
    starting = null;
  }));
}

/** inlet-sdk 0.5.0: close() frees the one-client slot, so a later start() is a fresh init. */
function stop(): void {
  if (!client) return;
  client.uninstall();
  client.close();
  client = null;
  setConfigReader(null); // CONFIG_DEFAULTS answer from here on (the web service stays allowed)
}

export async function installRemoteConfig(): Promise<void> {
  setRemoteConfigSwitchHandler((on) => (on ? void start() : stop()));
  await start();
}
```

If TypeScript rejects the `installElectronMain<…>` instantiation expression, use `type Client = import("inlet-sdk/config/electron").ElectronMainConfig<typeof CONFIG_DEFAULTS>;`. That type is exported, see `node_modules/inlet-sdk/dist/config/electron.d.ts`.

- [ ] **Step 6: Renderer: "paused" yields to remote settings off** (`src/renderer/src/remoteConfig.ts`)

```ts
import { usePrivacy } from "./privacy";

/** Re-renders on a live change, so the Settings row flips without a reload (D13).
    Remote settings off: main reads CONFIG_DEFAULTS, so the box is never "paused". */
export function useWebDefaultPaused(): boolean {
  const read = (): boolean => !remoteConfig.getBoolean("web_default_service", CONFIG_DEFAULTS.web_default_service);
  const [paused, setPaused] = useState(read);
  const [privacy] = usePrivacy();
  useEffect(() => remoteConfig.onUpdate(() => setPaused(read())), []);
  return paused && privacy?.on.remoteConfig !== false;
}
```

- [ ] **Step 7: Run the tests**

Run: the Step 2 command, plus `tests/usage-wiring.test.ts tests/crash-wiring.test.ts tests/crash-optout.test.ts`. Expected: `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/main/feedback/config.ts src/main/usage/index.ts src/main/crash/index.ts src/main/remoteConfig/index.ts src/renderer/src/remoteConfig.ts tests/feedback-config.test.ts tests/remote-config-wiring.test.ts
git commit -s -m "feat(privacy): Inlet modules honour their env locks; remote settings stop and start live" \
  -m "Co-authored-by: Vincent J <9133010+plyd@users.noreply.github.com>" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Updates: "Check for updates automatically", and the env-disabled mode

**Files:**
- Modify: `src/main/update/state.ts:36-62, 64-95`; `src/main/update/index.ts:27-104`
- Modify: `src/renderer/src/components/updateCopy.ts`, `ChangelogView.tsx:44-73`, `Toggle.tsx`
- Modify: `src/preload/index.ts` (`updateSetCheck`), `src/renderer/src/hv.d.ts`
- Test: `tests/update-state.test.ts`, `tests/update-row.test.ts` (no-dead-copy covers the new key)

**Interfaces:**
- Consumes: `getSwitch`, `setSwitch` (Task 2); `lockedByEnv` (Task 1); `LockLine` (Task 8, built here first if Task 8 hasn't run, see Step 6)
- Produces:
  - `UpdateState` gains `check: boolean`, `locked: boolean`; `UpdateEvent` gains `{ t: "check"; on: boolean }`
  - `initialState(mode, auto, check = true, locked = false)`; `updateMode({ …, locked?: boolean })`
  - IPC `hv:update-set-check(on)`; preload `updateSetCheck(on)`
  - `Toggle` gains `disabled?: boolean`

- [ ] **Step 1: Write the failing tests** (append to `tests/update-state.test.ts`)

```ts
describe("Privacy round: the check switch and the env lock", () => {
  it("an env lock disables every packaged build, AppImage included (PR #103)", () => {
    for (const p of [{ platform: "darwin" }, { platform: "win32" }, { platform: "linux" }, { platform: "linux", appImage: "/x.AppImage" }])
      expect(updateMode({ packaged: true, locked: true, ...p })).toBe("disabled");
  });
  it("initial state carries the switch and the lock; old two-argument callers read check on, unlocked", () => {
    expect(initialState("auto", true)).toMatchObject({ check: true, locked: false });
    expect(initialState("disabled", true, false, true)).toMatchObject({ check: false, locked: true });
  });
  it("the check event flips only the switch", () => {
    const s = initialState("auto", true);
    expect(reduce(s, { t: "check", on: false })).toEqual({ ...s, check: false });
  });
  it("check off, then Check now: the manual check still runs and downloads with auto on (Review Focus 5)", () => {
    let s = reduce(initialState("auto", true), { t: "check", on: false });
    s = reduce(s, { t: "checking", manual: true });
    expect(s.phase).toEqual({ k: "checking", manual: true });
    s = reduce(s, { t: "available", version: "9.9.9" });
    expect(s.phase).toEqual({ k: "downloading", version: "9.9.9", percent: 0 });
  });
});

describe("Privacy round: updater wiring", () => {
  const idx = fs.readFileSync("src/main/update/index.ts", "utf8");
  it("scheduled checks stop with the switch; Check now is consent", () => {
    expect(idx).toMatch(/if \(!manual && !state\.check\) return;/);
    expect(idx).toContain('ipcMain.handle("hv:update-set-check"');
  });
  it("the env lock beats HV_UPDATE_FAKE", () => {
    expect(idx).toMatch(/const fake = !app\.isPackaged && !locked && process\.env\.HV_UPDATE_FAKE/);
  });
});
```

(Add `import fs from "node:fs";` at the top if the file doesn't already import it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `L=/tmp/vitest.log; npx vitest run tests/update-state.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL on the new cases.

- [ ] **Step 3: state.ts**

- `UpdateState`: add `check: boolean;` (the "Check for updates automatically" switch) and `locked: boolean;` (an env lock; the page shows the lock line, not the dev-build sentence).
- `UpdateEvent`: add `| { t: "check"; on: boolean }`.
- The `disabled` doc line becomes `` `disabled`: a dev build, or an env lock (HV_NO_UPDATE_CHECK / HV_NO_PHONE_HOME): never checks, never installs over itself. ``

```ts
export function initialState(mode: UpdateMode, auto: boolean, check = true, locked = false): UpdateState {
  return { mode, auto, check, locked, lastCheckedAt: null, phase: { k: "idle" }, gate: { blockedBy: [], terminalsOpen: false, armed: false } };
}

export function updateMode(p: { packaged: boolean; platform: string; appImage?: string; locked?: boolean }): UpdateMode {
  if (!p.packaged || p.locked) return "disabled";
  if (p.platform === "linux" && !p.appImage) return "manual";
  return "auto";
}
```

In `reduce`, beside `case "auto":`:

```ts
    case "check":
      return { ...s, check: e.on };
```

If `HvUpdateState` in `hv.d.ts` is a hand-written copy rather than an import of `UpdateState`, add `check: boolean; locked: boolean;` there too.

- [ ] **Step 4: index.ts**

```ts
import { getAutoUpdate, getSwitch, setAutoUpdate, setSwitch } from "../config";
import { lockedByEnv } from "../privacySwitches";
// …
export function startUpdater(deps: UpdateDeps): void {
  const locked = lockedByEnv("updateCheck", process.env);
  const mode = updateMode({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE, locked });
  let state: UpdateState = initialState(mode, getAutoUpdate(), getSwitch("updateCheck"), locked);
```

- Change the `fake` line to `const fake = !app.isPackaged && !locked && process.env.HV_UPDATE_FAKE ? process.env.HV_UPDATE_FAKE : null;`.
- Next to `hv:update-set-auto`, add:

```ts
  ipcMain.handle("hv:update-set-check", (_e, on: boolean) => {
    if (locked) return;
    setSwitch("updateCheck", !!on);
    apply({ t: "check", on: !!on });
  });
```

- In `check`, after the `disabled || fake` guard, add `if (!manual && !state.check) return; // the switch stops the timers' checks; Check now is consent`. The timers stay scheduled, so turning the switch back on resumes at the next tick.

- [ ] **Step 5: Copy, Toggle, preload**

- `updateCopy.ts`: add `check: "Check for updates automatically",` after `checkNow`.
- `Toggle.tsx`: add a prop `disabled?: boolean`, pass `disabled={disabled}` to the button, and append `disabled:opacity-50 disabled:cursor-default` to its class string.
- Preload, after `updateSetAuto`: `updateSetCheck: (on: boolean) => ipcRenderer.invoke("hv:update-set-check", on),`. In `hv.d.ts`: `updateSetCheck(on: boolean): Promise<void>;`.

- [ ] **Step 6: ChangelogView `UpdateControls`**

`LockLine` comes from Task 8. If you run this task first, do Task 8 Step 3 (the `LockLine` + `OpenDocsContext` part) now.

```tsx
function UpdateControls(): React.JSX.Element {
  const s = useUpdateState();
  if (!s) return <div className="mb-8" />;
  // An env lock: the switch shows off and disabled with the lock line. Check now and the
  // download switch are absent, because nothing they do can happen.
  if (s.locked)
    return (
      <div className="mt-3 mb-8 text-sm">
        <label className="flex items-center gap-3">
          <Toggle on={false} disabled onChange={() => {}} label={C.check} />
          <span>{C.check}</span>
        </label>
        <LockLine />
      </div>
    );
  if (s.mode === "disabled") return <p className="text-sm text-ink-soft mt-3 mb-8">{C.devOff}</p>;
  // …status / Check now / error exactly as today…
  return (
    <div className="mt-3 mb-8 space-y-2 text-sm">
      {/* status line, Check now, manual error: unchanged */}
      <label className="flex items-center gap-3">
        <Toggle on={s.check} onChange={(v) => void window.hv.updateSetCheck(v)} label={C.check} />
        <span>{C.check}</span>
      </label>
      {/* D7: stays visible with check off. It still decides what Check now does. */}
      {s.mode === "auto" && (
        <label className="flex items-center gap-3">
          <Toggle on={s.auto} onChange={(v) => void window.hv.updateSetAuto(v)} label={C.auto} />
          <span>{C.auto}</span>
        </label>
      )}
    </div>
  );
}
```

The check switch also shows in `manual` mode (a `.deb` still checks, then links to the release page).

- [ ] **Step 7: Run the tests**

Run: `L=/tmp/vitest.log; npx vitest run tests/update-state.test.ts tests/update-row.test.ts tests/update-wiring.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: `EXIT=0` (`update-row`'s no-dead-copy finds `C.check`).

- [ ] **Step 8: Commit**

```bash
git add src/main/update src/renderer/src/components/updateCopy.ts src/renderer/src/components/ChangelogView.tsx src/renderer/src/components/Toggle.tsx src/preload/index.ts src/renderer/src/hv.d.ts tests/update-state.test.ts
git commit -s -m "feat(updates): Check for updates automatically, and an env lock that disables the updater" \
  -m "Co-authored-by: Vincent J <9133010+plyd@users.noreply.github.com>" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The default web service under its lock (PR #102)

**Files:**
- Modify: `src/main/webTools.ts:25-60`, `src/main/usage/events.ts` (`web_tool_called.errorCode`), `src/main/usage/fromLog.ts` (`WEB_CODES`)
- Modify: `src/renderer/src/components/BuiltinToolsBlock.tsx` (`WebRow`, ~line 438)
- Test: `tests/web-tools-format.test.ts`

**Interfaces:**
- Consumes: `lockedByEnv` (Task 1); `usePrivacy` (Task 3); `LockLine` (Task 8)
- Produces: `WEB_DEFAULT_OFF`; `resolveWebService(cfg, decrypt, defaultAllowed = true, env: Env = process.env)` and the code `"DEFAULT_OFF"`

- [ ] **Step 1: Write the failing test** (in `describe("§39 the default service can be paused remotely", …)`; add `WEB_DEFAULT_OFF` to the import)

```ts
  it("HV_NO_DEFAULT_WEB=1 or the master + default mode → DEFAULT_OFF, no URL, even with the flag on", () => {
    for (const env of [{ HV_NO_DEFAULT_WEB: "1" }, { HV_NO_PHONE_HOME: "1" }]) {
      const r = resolveWebService({ mode: "default" }, dec, true, env);
      expect(r).toEqual({ error: WEB_DEFAULT_OFF, code: "DEFAULT_OFF", service: "default" });
      expect(JSON.stringify(r)).not.toContain(DEFAULT_WEB_SERVICE_URL);
      expect(resolveWebService(undefined, dec, true, env)).toEqual(r);
    }
  });
  it("the lock + custom mode → the custom service, untouched", () => {
    expect(resolveWebService({ mode: "custom", baseUrl: "https://x.test" }, dec, true, { HV_NO_DEFAULT_WEB: "1" })).toEqual({ baseUrl: "https://x.test", service: "custom" });
  });
  it("DEFAULT_OFF is one of our own codes in the usage catalog", () => {
    expect(mapWebCode("DEFAULT_OFF")).toBe("DEFAULT_OFF");
  });
```

(`mapWebCode` is in `src/main/usage/fromLog.ts`. Import it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `L=/tmp/vitest.log; npx vitest run tests/web-tools-format.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL (`WEB_DEFAULT_OFF` undefined).

- [ ] **Step 3: Implement PR #102 against the resolver**

`src/main/webTools.ts`:

```ts
import { lockedByEnv, type Env } from "./privacySwitches";

/** Privacy round: the sentence a web tool returns instead of reaching the default box under its env lock. */
export const WEB_DEFAULT_OFF =
  "HappyVibe's free web service is turned off on this machine. To use web tools, point the app at your own Firecrawl-compatible service in Settings → Built-in tools.";
```

- `ResolvedWebService`'s error code union becomes `"CUSTOM_URL_INVALID" | "DEFAULT_PAUSED" | "DEFAULT_OFF"`.
- `resolveWebService` gains `env: Env = process.env` as its 4th parameter. Its first line inside `if (cfg?.mode !== "custom") {` is:

```ts
    // The env lock (HV_NO_DEFAULT_WEB / HV_NO_PHONE_HOME): the default box is never contacted; a custom service still is.
    if (lockedByEnv("defaultWeb", env)) return { error: WEB_DEFAULT_OFF, code: "DEFAULT_OFF", service: "default" };
```

`events.ts`: insert `"DEFAULT_OFF",` after `"DEFAULT_PAUSED",` in `web_tool_called.errorCode`. `fromLog.ts`: the same in `WEB_CODES`.

- [ ] **Step 4: Built-in tools: the default option locked** (`WebRow`)

```tsx
  const [privacy] = usePrivacy();
  const defaultLocked = !!privacy?.locked.includes("defaultWeb");
```

On the default radio: `disabled={defaultLocked}`. Directly after that `<label>`, add `{defaultLocked && <div className="pl-5"><LockLine /></div>}`. The paused sentence only renders when `!defaultLocked`: change `{paused && mode === "default" && (` to `{paused && !defaultLocked && mode === "default" && (`. The Test button needs no change: `hv:web-service-test` already answers the resolver's error sentence.

- [ ] **Step 5: Run the tests**

Run: the Step 2 command, plus `tests/usage-catalog.test.ts tests/usage-from-log.test.ts`. Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/main/webTools.ts src/main/usage/events.ts src/main/usage/fromLog.ts src/renderer/src/components/BuiltinToolsBlock.tsx tests/web-tools-format.test.ts
git commit -s -m "feat(web): an env lock keeps web tools off the default service" \
  -m "Co-authored-by: Vincent J <9133010+plyd@users.noreply.github.com>" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pi: the Model list switch, the master, and a contract that pins what Pi never sends

**Files:**
- Modify: `src/main/pi/spawn.ts` (`PiSpawnOptions` ~line 117, env block ~line 311, new `piMasterEnv`)
- Modify: `src/main/index.ts` (after `app.setName('HappyVibe')`, line ~27)
- Modify: `src/main/ipc.ts` `spawnOpts` (~line 1070)
- Test: `tests/pi-privacy-contract.test.ts`

**Interfaces:**
- Consumes: `MASTER_ENV`, `MODEL_LIST_REFRESH_HOURS` (Task 1); `getSwitch` (Task 2)
- Produces: `piMasterEnv(env: Env): Record<string, string>`; `PiSpawnOptions.offline?: boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/pi-privacy-contract.test.ts
/**
 * Privacy round (D4, D10). What the vendored Pi sends on its own, read from its
 * dist — so a pin bump that changes it fails here instead of silently calling home.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PI_CLI_RELPATH, piMasterEnv, resolvePiSpawn } from "../src/main/pi/spawn";
import { MODEL_LIST_REFRESH_HOURS } from "../src/main/privacySwitches";

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist");
const read = (rel: string): string => fs.readFileSync(path.join(dist, rel), "utf8");
function jsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "bundle" ? [] : jsFiles(p); // the bundle concatenates these
    return d.name.endsWith(".js") ? [p] : [];
  });
}

describe("Pi's own calls home", () => {
  it("the master sets only PI_OFFLINE — never PI_SKIP_VERSION_CHECK or PI_TELEMETRY", () => {
    expect(piMasterEnv({})).toEqual({});
    expect(piMasterEnv({ HV_NO_PHONE_HOME: "0" })).toEqual({});
    expect(piMasterEnv({ HV_NO_PHONE_HOME: "1" })).toEqual({ PI_OFFLINE: "1" });
  });

  it("the bundle Pi actually runs reads PI_OFFLINE (PR #104)", () => {
    const chunks = path.join(root, "pi-runtime", path.dirname(PI_CLI_RELPATH), "chunks");
    const bundle = [path.join(root, "pi-runtime", PI_CLI_RELPATH), ...fs.readdirSync(chunks).map((f) => path.join(chunks, f))]
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    expect(bundle).toContain("process.env.PI_OFFLINE");
  });

  it("the version check and install telemetry are reached only from the terminal UI and `pi update`", () => {
    const CALLS = /\b(checkForNewPiVersion|getLatestPiRelease|reportInstallTelemetry)\(/;
    const allowed = new Set(["utils/version-check.js", "modes/interactive/interactive-mode.js", "package-manager-cli.js"]);
    const callers = jsFiles(dist)
      .filter((f) => CALLS.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(dist, f).split(path.sep).join("/"));
    expect(callers.filter((f) => !allowed.has(f))).toEqual([]);
    expect(callers).toContain("modes/interactive/interactive-mode.js"); // the scan isn't vacuous
  });

  it("RPC refreshes the model list unless offline, at the interval the Privacy copy states", () => {
    expect(read("main.js")).toContain('if (!offlineMode && appMode === "rpc") {');
    expect(read("core/remote-catalog-provider.js")).toContain(
      `REMOTE_CATALOG_REFRESH_INTERVAL_MS = ${MODEL_LIST_REFRESH_HOURS} * 60 * 60 * 1000`,
    );
  });

  it("index.ts applies the master to process.env at module load, before any child exists", () => {
    expect(fs.readFileSync(path.join(root, "src/main/index.ts"), "utf8")).toMatch(/^Object\.assign\(process\.env, piMasterEnv\(process\.env\)\)$/m);
  });

  it("the Model list switch puts PI_OFFLINE in that session's env only", () => {
    // Mirror the resolvePiSpawn call shape in tests/tool-switches-spawn.test.ts.
    expect(resolvePiSpawn("/w", "/s", "/r", { offline: true }).env.PI_OFFLINE).toBe("1");
    expect(resolvePiSpawn("/w", "/s", "/r", {}).env.PI_OFFLINE).toBe(process.env.PI_OFFLINE);
  });

  it("spawnOpts passes the switch", () => {
    expect(fs.readFileSync(path.join(root, "src/main/ipc.ts"), "utf8")).toMatch(/offline: !getSwitch\("modelList"\)/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `L=/tmp/vitest.log; npx vitest run tests/pi-privacy-contract.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL (`piMasterEnv is not a function`). The three dist-reading cases already PASS, which confirms the measurement in D4.

- [ ] **Step 3: spawn.ts**

```ts
import { MASTER_ENV, type Env } from "../privacySwitches";

/** Privacy round D4: HV_NO_PHONE_HOME=1 → Pi's own switch for pi.dev (the model list) and the
    fd/rg download from GitHub. index.ts writes it into process.env at boot so every Pi child
    inherits it (PR #104). Never PI_SKIP_VERSION_CHECK or PI_TELEMETRY: Pi only makes those calls
    in its terminal UI, and a value in process.env reaches the built-in terminal's own `pi`. */
export function piMasterEnv(env: Env): Record<string, string> {
  return env[MASTER_ENV] === "1" ? { PI_OFFLINE: "1" } : {};
}
```

- In `PiSpawnOptions`, after `longCache?: boolean;`: `/** Privacy round D10: the Model list switch off → PI_OFFLINE=1 for this session's Pi only. */ offline?: boolean;`
- In the env block, after `...(opts.longCache ? { PI_CACHE_RETENTION: "long" } : {}),`: `...(opts.offline ? { PI_OFFLINE: "1" } : {}),`

- [ ] **Step 4: index.ts and spawnOpts**

`src/main/index.ts`, after `app.setName('HappyVibe')`:

```ts
// Privacy round: HV_NO_PHONE_HOME=1, before any Pi child exists, so all of them inherit it.
Object.assign(process.env, piMasterEnv(process.env))
```

(Add `import { piMasterEnv } from './pi/spawn'` beside the other imports.)

`src/main/ipc.ts` `spawnOpts`, after `longCache: getLongCache(),`:

```ts
      // Privacy round D10: Model list off (or locked) → this Pi skips pi.dev and the fd/rg download.
      offline: !getSwitch("modelList"),
```

- [ ] **Step 5: Run the tests**

Run: the Step 2 command, plus `tests/tool-switches-spawn.test.ts tests/pi-cli-entry.test.ts`. Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/main/pi/spawn.ts src/main/index.ts src/main/ipc.ts tests/pi-privacy-contract.test.ts
git commit -s -m "feat(pi): a Model list switch for Pi's one call home; pin the two it never makes" \
  -m "Co-authored-by: Vincent J <9133010+plyd@users.noreply.github.com>" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Privacy page, the lock line, and the feedback surfaces

**Files:**
- Create: `src/renderer/src/components/LockLine.tsx`
- Modify: `src/renderer/src/components/DocsLink.tsx` (`OpenDocsContext`)
- Modify: `src/renderer/src/components/PrivacyView.tsx` (whole page body)
- Modify: `src/renderer/src/App.tsx`: `NavContext.Provider` (~3401), `feedbackAvailable` (~3425), pulse effect (~3147, ~3169), ChatView `pulse` (~3968)
- Test: `tests/privacy-page.test.ts`

**Interfaces:**
- Consumes: `usePrivacy` (Task 3); `MODEL_LIST_REFRESH_HOURS` (Task 1); `GoTo` (`components/GoTo.tsx`, uses `NavContext`); `docUrl` (`docsLinks.ts`)
- Produces: `LockLine`, `LOCK_COPY = { line, more }`, `OpenDocsContext`, `PRIVACY_COPY` (exported data the tests and the guide pin)

- [ ] **Step 1: Write the failing test**

```ts
// tests/privacy-page.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRIVACY_COPY } from "../src/renderer/src/components/PrivacyView";
import { LOCK_COPY } from "../src/renderer/src/components/LockLine";

const read = (f: string): string => fs.readFileSync(f, "utf8");
const page = read("src/renderer/src/components/PrivacyView.tsx");
function walk(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

describe("Privacy page", () => {
  it("blocks run in the spec's order, Clear all data last", () => {
    const marks = ['title="Usage statistics"', 'title="Crash reports"', "title={C.feedbackTitle}", "title={C.remoteTitle}", "title={C.modelTitle}", "title={C.otherTitle}", 'title="Clear all data"'];
    const at = marks.map((m) => page.indexOf(m));
    expect(at.every((i) => i > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("every PRIVACY_COPY key is used (no dead copy)", () => {
    for (const k of Object.keys(PRIVACY_COPY)) expect(page, k).toMatch(new RegExp(`C\\.${k}\\b`));
  });
  it("the settings-check paragraph lives under Remote settings, not Usage statistics", () => {
    const usage = page.slice(page.indexOf('title="Usage statistics"'), page.indexOf('title="Crash reports"'));
    expect(usage).not.toMatch(/checks HappyVibe|device ID|remoteBody/);
    expect(PRIVACY_COPY.remoteBody).toContain("Turning statistics off doesn't stop it, but the ID is replaced with a new one that isn't linked to your statistics.");
  });
  it("the model-list interval is derived, never typed", () => {
    expect(page).toContain("${MODEL_LIST_REFRESH_HOURS}");
    expect(page).not.toMatch(/every 4 hours/);
  });
  it("the app never names a variable (D2)", () => {
    for (const f of walk("src/renderer/src")) {
      const s = read(f);
      expect(s.includes("HV_NO_") || s.includes("PI_OFFLINE"), f).toBe(false);
    }
  });
  it("the lock line is the spec's words and opens the managed-computer section", () => {
    expect(LOCK_COPY.line).toBe("Turned off on this computer by an environment setting.");
    expect(read("src/renderer/src/components/LockLine.tsx")).toContain('docUrl("privacy", "on-a-managed-computer")');
  });
  it("the megaphone and the pulse are gated on their switches as well as the channel", () => {
    const app = read("src/renderer/src/App.tsx");
    expect(app).toMatch(/feedbackAvailable=\{feedbackInfo\.available && !!privacy\?\.on\.feedback\}/);
    expect(app.match(/feedbackInfo\.available && !!privacy\?\.on\.sessionPulse/g)?.length).toBeGreaterThanOrEqual(2);
    expect(app).toContain("<OpenDocsContext.Provider value={openDocs}>");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `L=/tmp/vitest.log; npx vitest run tests/privacy-page.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL (`PRIVACY_COPY` not exported).

- [ ] **Step 3: OpenDocsContext and LockLine**

`src/renderer/src/components/DocsLink.tsx`: `import { createContext } from "react";` and

```ts
/** Opens a guide page in the app (App's openDocs). A context, like NavContext, so a lock line
    three components deep needs no prop threaded down to it. */
export const OpenDocsContext = createContext<(url: string) => void>(() => {});
```

```tsx
// src/renderer/src/components/LockLine.tsx
/** Privacy round D1/D2: the one shape of a switch an environment variable holds off. Names no variable. */
import { useContext } from "react";
import { OpenDocsContext } from "./DocsLink";
import { docUrl } from "../docsLinks";

export const LOCK_COPY = { line: "Turned off on this computer by an environment setting.", more: "Learn more" } as const;

export function LockLine(): React.JSX.Element {
  const openDocs = useContext(OpenDocsContext);
  return (
    <p className="text-xs text-ink-soft mt-1">
      {LOCK_COPY.line}{" "}
      <button type="button" className="underline cursor-pointer" onClick={() => openDocs(docUrl("privacy", "on-a-managed-computer"))}>
        {LOCK_COPY.more}
      </button>
    </p>
  );
}
```

In `App.tsx`, wrap the existing `<NavContext.Provider value={navigate}>` content with `<OpenDocsContext.Provider value={openDocs}>` … `</OpenDocsContext.Provider>`.

- [ ] **Step 4: PrivacyView**

Export the copy (the strings are the spec's; the guide quotes them verbatim):

```ts
import { MODEL_LIST_REFRESH_HOURS, type SwitchKey } from "../../../main/privacySwitches";

export const PRIVACY_COPY = {
  feedbackTitle: "Feedback",
  feedbackSubtitle: "Things you choose to send us. Nothing leaves until you press Send or tap a rating.",
  feedbackButton: "Show the feedback button",
  feedbackButtonBody: "The megaphone in the sidebar, which opens a short form.",
  pulse: "Ask how a session is going",
  pulseBody: "Once per chat session, a one-tap rating above the message box.",
  remoteTitle: "Remote settings",
  remoteSubtitle: "HappyVibe checks a small list of settings we can change without a release, for now only whether the free web service is available.",
  remoteSwitch: "Receive remote settings",
  remoteBody: "The check carries a random device ID so gradual changes reach the same devices. Turning statistics off doesn't stop it, but the ID is replaced with a new one that isn't linked to your statistics.",
  remoteCost: "Off, HappyVibe uses its built-in settings and we can't pause the free web service for you if it's overloaded.",
  modelTitle: "Model list",
  modelSubtitle: `Pi, the engine inside HappyVibe, asks pi.dev for newly released models when a session starts, at most every ${MODEL_LIST_REFRESH_HOURS} hours. The first time the agent searches files, it also downloads two search tools from GitHub if they aren't installed.`,
  modelSwitch: "Check for new models",
  modelCost: "Off: models released after this version of HappyVibe only appear once you update, and if the search tools aren't on this computer yet, the agent can't download them, so its file search stops working. Applies to new sessions.",
  otherTitle: "Other connections",
  otherSubtitle: "What this page doesn't control, and where you can.",
  updates: "Updates",
  freeWeb: "Free web service",
  provider: "Your model provider",
  providerBody: "Your conversations go to the model you picked. Nothing on this page changes that.",
  on: "On",
  off: "Off",
  locked: "Locked",
} as const;
const C = PRIVACY_COPY;
```

One local switch shape, the page's existing On/Off pill plus a lock:

```tsx
function Pill({ on, locked, onChange }: { on: boolean; locked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => onChange(!on)}
      className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-default ${
        on ? "bg-leaf text-paper border-leaf" : "bg-card text-ink border-line hover:border-leaf"
      }`}
    >
      {on ? C.on : C.off}
    </button>
  );
}

/** One switch row: label, body, optional cost line, the pill, and the lock line when held off. */
function SwitchRow({ label, body, cost, on, locked, onChange }: { label: string; body?: string; cost?: string; on: boolean; locked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <div className="rounded-xl border-2 border-line bg-card p-4 flex items-start justify-between gap-4">
      <div>
        <div className="font-bold">{label}</div>
        {body && <p className="text-sm text-ink-soft mt-0.5">{body}</p>}
        {cost && <p className="text-xs text-ink-soft mt-1">{cost}</p>}
        {locked && <LockLine />}
      </div>
      <Pill on={on} locked={locked} onChange={onChange} />
    </div>
  );
}
```

In `PrivacyView`:
- Replace `useState(true)` for `on` / `stats` with `const [privacy, reloadPrivacy] = usePrivacy();`, `const isOn = (k: SwitchKey) => !!privacy?.on[k];` and `const isLocked = (k: SwitchKey) => !!privacy?.locked.includes(k);`.
- **Usage statistics:** the row keeps its title and calls `window.hv.setUsageStats(v).then(() => { reloadPrivacy(); refresh(); })`. Its body paragraph is **removed**: it moved into `C.remoteBody`. Render it with `<SwitchRow label="Send anonymous usage statistics" on={isOn("usageStats")} locked={isLocked("usageStats")} … />`.
- **Crash reports:** same, with `setCrashReports`; the How-it-works, Show-last-report and Reveal rows are unchanged.
- **Feedback** (rendered only when `feedbackAvailable || isLocked("feedback")`; read `feedbackAvailable` once via `window.hv.feedbackInfo()` on mount — a channel with no key can't send, so its switches would be noise):

```tsx
      <Section icon="audit" title={C.feedbackTitle} subtitle={C.feedbackSubtitle}>
        <div className="space-y-2">
          <SwitchRow label={C.feedbackButton} body={C.feedbackButtonBody} on={isOn("feedback")} locked={isLocked("feedback")} onChange={(v) => void window.hv.privacySet("feedback", v)} />
          <SwitchRow label={C.pulse} body={C.pulseBody} on={isOn("sessionPulse")} locked={isLocked("sessionPulse")} onChange={(v) => void window.hv.privacySet("sessionPulse", v)} />
        </div>
      </Section>
```

- **Remote settings:** `<Section icon="stats" title={C.remoteTitle} subtitle={C.remoteSubtitle}>` holding `<SwitchRow label={C.remoteSwitch} body={C.remoteBody} cost={C.remoteCost} on={isOn("remoteConfig")} locked={isLocked("remoteConfig")} onChange={(v) => void window.hv.privacySet("remoteConfig", v)} />`.
- **Model list:** `<Section icon="stats" title={C.modelTitle} subtitle={C.modelSubtitle}>` holding `<SwitchRow label={C.modelSwitch} cost={C.modelCost} on={isOn("modelList")} locked={isLocked("modelList")} onChange={(v) => void window.hv.privacySet("modelList", v)} />`.
- **Other connections**, read-only (on mount, read `window.hv.builtinsGet()` and `window.hv.webServiceGet()` for the web row):

```tsx
      <Section icon="audit" title={C.otherTitle} subtitle={C.otherSubtitle}>
        <ul className="rounded-xl border-2 border-line bg-card divide-y-2 divide-line text-sm">
          <li className="p-3 flex justify-between gap-3">
            <span className="font-bold">{C.updates}</span>
            <span>{isLocked("updateCheck") ? C.locked : isOn("updateCheck") ? C.on : C.off} · <GoTo view="changelog" /></span>
          </li>
          <li className="p-3 flex justify-between gap-3">
            <span className="font-bold">{C.freeWeb}</span>
            <span>{isLocked("defaultWeb") ? C.locked : webOn && webMode === "default" ? C.on : C.off} · <GoTo view="builtinTools" /></span>
          </li>
          <li className="p-3">
            <div className="flex justify-between gap-3"><span className="font-bold">{C.provider}</span><GoTo view="models" /></div>
            <p className="text-ink-soft mt-0.5">{C.providerBody}</p>
          </li>
        </ul>
      </Section>
```

`webOn` = `builtinsGet().web !== false`. `webMode` = `webServiceGet().mode`. Pick the `Section` icons from the ones `Section` already accepts (`stats`, `audit`). No new icon in this round.

- [ ] **Step 5: App.tsx gates**

```tsx
  const [privacy] = usePrivacy(); // beside feedbackInfo's useState (~line 215)
```

- `feedbackAvailable={feedbackInfo.available}` (~3425) → `feedbackAvailable={feedbackInfo.available && !!privacy?.on.feedback}`.
- In the pulse effect (~3147): `if (!feedbackInfo.available) return;` → `if (!(feedbackInfo.available && !!privacy?.on.sessionPulse)) return;`. In `pulseDecision`'s input (~3169): `available: feedbackInfo.available && !!privacy?.on.sessionPulse,`. Add `privacy` to the effect's dependency list.
- ChatView's `pulse={ feedbackInfo.available ? …` (~3968) → `pulse={ feedbackInfo.available && !!privacy?.on.sessionPulse ? …`.

`!!privacy?.…` hides both surfaces until the state arrives, so a user who turned one off never sees it flash at boot.

- [ ] **Step 6: Run the tests**

Run: the Step 2 command, plus `tests/how-it-works.test.ts tests/docs-links.test.ts tests/modal-layer.test.ts`. Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/LockLine.tsx src/renderer/src/components/DocsLink.tsx src/renderer/src/components/PrivacyView.tsx src/renderer/src/App.tsx tests/privacy-page.test.ts
git commit -s -m "feat(privacy): Feedback, Remote settings, Model list and Other connections on the Privacy page"
```

---

### Task 9: The user guide

**Files:**
- Modify: `docs/guide/src/content/docs/privacy.md` (sections listed below; the rest stays byte-identical)
- Modify: `docs/guide/src/content/docs/changelog.md` (the check switch), `docs/guide/src/content/docs/built-in-tools.md` (the locked default service)
- Test: `tests/privacy-guide.test.ts`

**Interfaces:**
- Consumes: `PRIVACY_SWITCHES`, `MASTER_ENV` (Task 1); `PRIVACY_COPY` (Task 8); `LOCK_COPY` (Task 8); `UPDATE_COPY.check` (Task 5)

- [ ] **Step 1: Write the failing test**

```ts
// tests/privacy-guide.test.ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { MASTER_ENV, PRIVACY_SWITCHES } from "../src/main/privacySwitches";
import { PRIVACY_COPY } from "../src/renderer/src/components/PrivacyView";
import { LOCK_COPY } from "../src/renderer/src/components/LockLine";
import { UPDATE_COPY } from "../src/renderer/src/components/updateCopy";

const guide = fs.readFileSync("docs/guide/src/content/docs/privacy.md", "utf8");

describe("the guide's Privacy page is derived from the table (D2)", () => {
  it("names every variable in the code table, and the master", () => {
    for (const v of [MASTER_ENV, ...new Set(Object.values(PRIVACY_SWITCHES).map((s) => s.env))]) expect(guide, v).toContain(`\`${v}\``);
  });
  it("has the section the lock line links to", () => {
    expect(guide).toMatch(/^## On a managed computer$/m);
  });
  it("quotes the switches and the lock line exactly", () => {
    for (const s of [PRIVACY_COPY.feedbackButton, PRIVACY_COPY.pulse, PRIVACY_COPY.remoteSwitch, PRIVACY_COPY.modelSwitch, LOCK_COPY.line]) expect(guide, s).toContain(s);
  });
  it("gives the routes that work on a Mac (D2) and never the shell line for macOS", () => {
    expect(guide).toContain("launchctl setenv");
    expect(guide).toContain("open -a HappyVibe --env HV_NO_PHONE_HOME=1");
  });
  it("the Changelog page documents the check switch", () => {
    expect(fs.readFileSync("docs/guide/src/content/docs/changelog.md", "utf8")).toContain(UPDATE_COPY.check);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `L=/tmp/vitest.log; npx vitest run tests/privacy-guide.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L`
Expected: FAIL.

- [ ] **Step 3: Write the pages** (voice: `docs/guide/VOICE.md`; every quoted string from `PRIVACY_COPY`, `LOCK_COPY`, `UPDATE_COPY`, character for character)

`privacy.md`:
- **Front matter:** `description` covers usage statistics, crash reports, feedback, remote settings and the model list.
- **"Short version":** it currently says the screen "controls crash reports". Rewrite it to say the screen is where you turn off everything HappyVibe sends on its own. Keep the in-the-app's-own-words quote.
- **"A few things this screen doesn't cover":** replace with a pointer to the new **Other connections** block.
- **"What's on the screen":** add `### Usage statistics` (the page never had it: switch, what it contains via the How-it-works title, "on by default") **before** Crash reports. Then add `### Feedback`, `### Remote settings` (including `remoteBody` and `remoteCost`) and `### Model list` (`modelSubtitle` with "4 hours", `modelCost`), then `### Other connections`. Crash reports and Clear all data keep their text.
- **New `## Turn things off`:** one line per switch and where it lives (Privacy, or Changelog for updates, Built-in tools for the web service), each "takes effect straight away" except the model list ("applies to new sessions").
- **New `## On a managed computer`**, after "Turn things off":
  - why ("a switch can't act before the first launch");
  - the table: variable → what it turns off. Every `HV_NO_*`, plus "`HV_NO_PHONE_HOME` — everything above, and Pi's model list", plus "`PI_OFFLINE` — Pi's own variable; locks the model list";
  - "only `1` counts" (and Pi's `1`/`true`/`yes` for `PI_OFFLINE`);
  - what a locked switch looks like (quote `LOCK_COPY.line`);
  - **macOS:** a LaunchAgent plist in `~/Library/LaunchAgents/` (or `/Library/LaunchAgents/` from MDM) whose `ProgramArguments` is `launchctl setenv HV_NO_PHONE_HOME 1` with `RunAtLoad`, then log out and in; or `open -a HappyVibe --env HV_NO_PHONE_HOME=1` for a single launch. Say plainly that a line in `~/.zshrc` does nothing for an app opened from the Dock;
  - **Linux:** `HV_NO_PHONE_HOME=1 happyvibe` (PR #105's line), or `Exec=env HV_NO_PHONE_HOME=1 happyvibe` in the `.desktop` file;
  - **Windows:** a user environment variable `HV_NO_PHONE_HOME` = `1` (Settings → System → About → Advanced system settings → Environment Variables), then start HappyVibe;
  - "Your conversations still go to the model you picked on [Models]".
- **"Related":** add [Changelog] and [Built-in tools].

`changelog.md`: document "Check for updates automatically" (on by default; off stops the background checks; Check now still works; the download switch still decides what Check now does).

`built-in-tools.md`, under the web-service section: a locked default service shows the lock line; your own service still works. Link to `/docs/privacy/#on-a-managed-computer`.

- [ ] **Step 4: Run the test, then review and build**

Run: the Step 2 command. Expected: `EXIT=0`.
Then run the `docs-reviewer` agent on the three pages and fix every finding. Then: `(cd docs/guide && npm install && npm run build)`. Expected: it exits 0 (`check-build.mjs` passes).

- [ ] **Step 5: Commit**

```bash
git add docs/guide/src/content/docs/privacy.md docs/guide/src/content/docs/changelog.md docs/guide/src/content/docs/built-in-tools.md tests/privacy-guide.test.ts
git commit -s -m "docs(guide): every switch on Privacy, and how to lock them off on a managed computer" \
  -m "Co-authored-by: Vincent J <9133010+plyd@users.noreply.github.com>" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Current-state rules, evidence, changelog

**Files:**
- Create: `docs/validation/pv1.md`
- Modify: `.claude/rules/crash-feedback.md` (its "Usage statistics and remote config (§39)" section)
- Modify: `CHANGELOG.md` (`[Unreleased]`, via the `changelog` skill)

- [ ] **Step 1: Evidence** (`docs/validation/pv1.md`)

Record the measurements this round rests on, with file paths:
- **Pi 1.0.2's calls by mode:** version check and install telemetry only from `modes/interactive/interactive-mode.js` and `pi update`. The RPC model-list refresh is at `main.js` `if (!offlineMode && appMode === "rpc")`, against `https://pi.dev/api/models/providers/<id>`, cached `REMOTE_CATALOG_REFRESH_INTERVAL_MS` = 4 h. fd/rg come from `utils/tools-manager.js` `ensureTool`; offline and missing gives *"ripgrep (rg) is not available and could not be downloaded"*.
- **One-shots:** print mode with `--no-tools`; no refresh.
- **The terminal:** it inherits `process.env` (`terminals.ts:205`).
- **inlet-sdk 0.5.0:** `close()` clears the one-client slot, so a fresh `installElectronMain` re-inits.
- **macOS:** a Dock-launched app reads no shell variables; only `PATH` is imported, at `index.ts:477`, after the Inlet modules start; `open --env` exists (`man open`).

- [ ] **Step 2: Rules** (`.claude/rules/crash-feedback.md`; add these bullets, current-state, one-line whys)

```markdown
- Every connection the app makes on its own is ONE row in `src/main/privacySwitches.ts` (import-free): its
  negative config key and its env var. Read it through `getSwitch` (config.ts) — an env lock reads OFF,
  never on. A new connection gets a row there, a switch, and a line in the guide's "On a managed computer"
  table (`tests/privacy-guide.test.ts` fails otherwise).
- `HV_*` locks count only at exactly `1`; `PI_OFFLINE` counts Pi's way (`1`/`true`/`yes`). The app never
  names a variable (`tests/privacy-page.test.ts` scans `src/renderer/src`).
- The Model list switch puts `PI_OFFLINE=1` in `resolvePiSpawn`'s env only — never `process.env`, which the
  built-in terminal inherits. Only `HV_NO_PHONE_HOME` writes `process.env` (index.ts, at load). Never set
  `PI_SKIP_VERSION_CHECK`/`PI_TELEMETRY`: Pi makes those calls only in its TUI (`tests/pi-privacy-contract.test.ts`).
- Remote settings off = `close()` the config client and `setConfigReader(null)`; on = a fresh
  `installElectronMain`. `starting ??=` keeps a quick off/on from building two clients.
```

- [ ] **Step 3: Changelog**

Invoke the `changelog` skill to write the `[Unreleased]` entry (MINOR, under **Added**). It must say that every connection HappyVibe makes on its own can now be turned off from **Privacy** (feedback button, session pulse, remote settings, model list) and **Changelog** (the update check), and that admins can lock them off before the first launch, documented in the guide. It credits "thanks to @plyd".

- [ ] **Step 4: Commit**

```bash
git add docs/validation/pv1.md .claude/rules/crash-feedback.md CHANGELOG.md
git commit -s -m "docs: privacy-switch rules, the Pi measurements behind them, changelog"
```

---

### Task 11: Verify: gate, live batch, GUI

- [ ] **Step 1: Gate**

Run: `L=/tmp/gate.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -40 $L`
Expected: `EXIT=0`.

- [ ] **Step 2: Live batch, if asked for**

Run `npm run live:why` (it only sees committed work). If it prints anything:
- `pgrep -fl electron-vite` must show no running app;
- `.env` is linked (Task 0);
- then run `npm run test:live` with `run_in_background`, about 7–8 min, alongside nothing that touches `src/` or `pi-runtime/`.

A batch that ends in seconds is a fake green (no `.env`). If `live:why` prints nothing, say "the live batch isn't required".

- [ ] **Step 3: GUI pass.** Every assertion in the Verification section below, with a screenshot or a DOM read per line. Use `/uicheck` (it attaches to the running app). Dev runs from this worktree. Scope every `pkill` to this worktree (`dev-server-port-collision`).

- [ ] **Step 4: Stop for `/land`**, then Task 12.

---

### Task 12: The PRs (outward-facing: confirm with Guilhem first)

- [ ] **Step 1:** show Guilhem the exact comment text, and wait for a yes.
- [ ] **Step 2:** on each of #101–#105:
  - post a thank-you that links the merged round's PR and names what was kept (the env-var idea, PR #101's resolver line, #102's `DEFAULT_OFF`, #103's `disabled` mode, #104's bundle test, #105's Linux and Windows lines) and what changed (the in-app switches, the trimmed Pi variables and why);
  - then `gh pr close <n>`.
- [ ] **Step 3:** #100: its commit is signed off (`Signed-off-by: Vincent J <9133010+plyd@users.noreply.github.com>`, checked 2026-10-09). Approve the fork's workflow run so DCO reports, then `gh pr merge 100 --squash` once it's green.

---

## Verification: what is TRUE on screen

Dev launches from this worktree's terminal, so an env var set on `npm run dev` reaches the app (that's not how a Dock launch works; the guide covers that). A dev build's updater is `disabled`: use `HV_UPDATE_FAKE=available:0.3.0` to see the Changelog controls.

**A. Fresh profile, no variables (`npm run dev`).**
1. **Privacy:** the blocks read, top to bottom: Usage statistics, Crash reports, Feedback, Remote settings, Model list, Other connections, Clear all data. Every switch reads **On**. **No** lock line anywhere on the page.
2. **Privacy:**
   - the Usage statistics block does **not** contain "device ID" or "Turning statistics off doesn't stop it". That sentence appears under **Remote settings**, with the cost line *"Off, HappyVibe uses its built-in settings…"*.
   - Model list reads "at most every 4 hours" and shows the cost line, always visible.
   - Other connections: Updates **On** · Changelog, Free web service **On** · Built-in tools, Your model provider · Models plus the sentence. Each link navigates to its page.
3. **Sidebar** (observed on the sidebar, not on Privacy): the megaphone is present in the expanded **and** the collapsed rail.

**B. Switching off, observed where it bites.**
4. Privacy → *Show the feedback button* Off.
   - The megaphone is **absent** from the sidebar in both states.
   - Open a second window (File → New Window): its megaphone is absent too, with no reload.
   - Turn it back on in window 2: window 1's megaphone returns.
5. **Regression sequence:** open the feedback dialog in window 1, turn the button off in window 2. Window 1's dialog **stays open** until you close it, and the megaphone is gone after.
6. `HV_FEEDBACK_FAST_PULSE=1 npm run dev`, *Ask how a session is going* Off. In a chat, send 1 turn and wait 25 s: **no** "How is this session going?" row above the composer. Turn it on, wait 25 s: the row appears in that same session (it wasn't counted as asked).
7. **Remote settings.**
   - With the dev Inlet config DB set to `web_default_service: false` (inlet MCP `set_config_parameter` on the Dev project, published), Built-in tools → Web tools → Web service reads "HappyVibe's service — paused".
   - Turn Privacy → *Receive remote settings* Off. In the **other** window's Built-in tools, the row flips to "HappyVibe's service (free for now)" with no reload, and a web search succeeds.
   - Turn it back on: the main log shows one `[config]` fetch and **no** *"init() was called again"*. Toggle Off/On/Off within a second: still no such warning.
   - Restore the Dev flag to `true` afterwards.
8. **Model list** Off.
   - Start a **new** session. `ps eww -p <its pi pid> | grep -o 'PI_OFFLINE=1'` prints it. A session started before the switch does **not** have it.
   - In the built-in terminal, `echo "[$PI_OFFLINE]"` prints `[]`. This is the absence: the app's own env is untouched.
9. **Changelog** (`HV_UPDATE_FAKE=available:0.3.0`): *Check for updates automatically* Off.
   - **Download updates automatically** is **still visible** (absence of the hiding, D7), and **Check now** is still there.
   - Back on **Privacy**, Other connections → Updates reads **Off**. That's observed on Privacy, the page that doesn't own it.

**C. Locked (one launch each).**
10. `HV_NO_PHONE_HOME=1 npm run dev`:
    - **Privacy:** every switch reads **Off**, is disabled, and carries *"Turned off on this computer by an environment setting."* + **Learn more**. Learn more opens the User guide at Privacy → On a managed computer. Other connections: Updates **Locked**, Free web service **Locked**.
    - **Sidebar:** no megaphone.
    - **Built-in tools:** the HappyVibe's service radio is disabled with the lock line, and Test answers "…turned off on this machine…".
    - **Changelog** (with `HV_UPDATE_FAKE=available:0.3.0` too): the check switch Off+disabled with the lock line. **No** Check now, **no** download switch, and **not** the text "Updates are off in development builds." (the lock wins over the fake).
    - **Main log:** no `[config]` and no `[usage]` lines.
    - `ps eww` on a session's pi shows `PI_OFFLINE=1`.
11. On Privacy, Changelog and Built-in tools under (10), `document.body.innerText` contains neither `HV_NO_` nor `PI_OFFLINE` (DOM read via electron-debug `evaluate`).
12. `HV_NO_FEEDBACK=1 npm run dev`:
    - the megaphone and the pulse are absent, and both Feedback switches are locked;
    - **Usage statistics and Crash reports are still On and clickable**, which is the absence of over-locking;
    - Remote settings and Model list are unlocked.
13. `PI_OFFLINE=true npm run dev`: only **Model list** is locked; every other switch is unlocked.

**D. Absences, named.**
- `PI_SKIP_VERSION_CHECK` and `PI_TELEMETRY` appear in no Pi child's env, under any launch above (`ps eww … | grep -c PI_SKIP_VERSION_CHECK` → 0).
- No variable name in the app's text (C.11).
- The download switch never disappears because check is off (B.9).
