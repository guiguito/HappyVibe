# Usage Analytics and Remote Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship anonymous, content-free usage statistics (on by default, one switch on the Privacy page) and a live remote-config switch for the hosted web service, both through `inlet-sdk` 0.4.0.

**Architecture:** Two new main-process modules, `src/main/usage/` (analytics) and `src/main/remoteConfig/` (config), each split the §37 way: an import-free `client.ts` facade anything may import, and an Electron-only `index.ts` that `ipc.ts` never imports. The event catalog is one import-free const (`src/main/usage/events.ts`); main validates every event against it (`track()` + `beforeSend`), windows send through the SDK's `electron-renderer` entries, and the Privacy copy is derived from the catalog. Facts are emitted where they live: an EventLog tap for rows main already writes, handler calls for settings changes, the renderer for composer/panel/onboarding facts.

**Tech Stack:** Electron main + React renderer, TypeScript 7, vitest (no DOM), `inlet-sdk` 0.4.0 (`/analytics/electron`, `/analytics/electron-renderer`, `/config/electron`, `/config/electron-renderer`).

**Spec:** Notion "UX Analytics and remote config" (`3e8d33dfffca802d858df7c4e89ba855`, D1–D20, §6 event table, §10 verification) and `docs/prd.md` §39 (+ the 2026-09-28 folds in §6, §19, §32, §34, §36, §37, §38). Read both before starting; the Notion §6.2 table is the per-event source of truth for params and emit sites.

## Global Constraints

- `inlet-sdk` pinned **exact** `0.4.0` in the root `package.json` (was `0.2.0`).
- Module dirs are `src/main/usage/` and `src/main/remoteConfig/`. **Never** `src/main/analytics/` — `src/main/analytics.ts` is the local Stats aggregator and stays local-only, untouched.
- `ipc.ts` never imports `usage/index` or `remoteConfig/index` (vitest's `electron` stub kills the whole test file otherwise — CLAUDE.md "Import hygiene").
- The renderer imports only `inlet-sdk/analytics/electron-renderer` and `inlet-sdk/config/electron-renderer` (never `/electron`, `/node`, `/browser`). `src/main/usage/events.ts` and `src/main/remoteConfig/defaults.ts` import **nothing** (renderer-imported).
- Never call `setUserId(`, `setUser(`, `setInstallationIdEnabled(false` anywhere in `src/` (D7, D11). Opt-out is `setEnabled(false, { forget: true })` and nothing else.
- `acceptRendererIdentity: false` on both `installElectronMain` calls.
- Consent: `usageStatsOff?: boolean` in `config.json`, absent = on (mirror `crashReportsOff`, `src/main/config.ts:44`, `:530-538`).
- Environment: `development` on the dev channel, `production` on prod. Dev: `adb_49c94fgpyah0` / `cfg_fnc0pxzkmjc0`. Prod: `adb_k820zq5xsfh1` / `cfg_8hsh4dzaerwj`. Env overrides `HV_ANALYTICS_DB`, `HV_CONFIG_DB`.
- `CONFIG_DEFAULTS = { web_default_service: true }` (fail open). Do not pass `refreshIntervalMinutes` (the database's 60 min applies). Do not pass `activation` (default `launch`).
- Inlet bounds: event name `^[A-Za-z][A-Za-z0-9_.:-]{0,63}$`; ≤ 25 params; param key `^[A-Za-z_][A-Za-z0-9_.]{0,39}$`; values string ≤ 256 / finite number / boolean; category ≤ 32 chars. Our names snake_case past tense; param keys camelCase; durations whole seconds; a param that doesn't apply is omitted.
- Copy, verbatim:
  - Privacy switch: `Send anonymous usage statistics`
  - Privacy subtitle: `Which features get used, where setup gets stuck, and whether the app is reliable. Never what you type, your files or your projects.`
  - Remote-config line: `The app also checks HappyVibe's server for settings, such as whether the free web service is available. That check carries a random device ID so gradual changes reach the same devices. Turning statistics off doesn't stop it, but the ID is replaced with a new one that isn't linked to your statistics.`
  - Paused tool sentence: `HappyVibe's free web service is paused right now. To keep using web tools, point the app at your own Firecrawl-compatible service in Settings → Built-in tools.`
  - Radio: `HappyVibe's service (free for now)` / paused: `HappyVibe's service — paused` + `The free service is paused. Choose Your own to keep using web tools.`
  - How web tools work, appended: `HappyVibe's service is free for now. If that changes, this page will say so, and a service of your own keeps working either way.`
- Commits: `git commit -s` (DCO). Gate = `npm run gate` (never run `typecheck` before it). Never pipe a test run: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
- No new `throw new Error("…")` literals. If one becomes unavoidable, run `npm run catalog:crash-messages` in the same commit.
- `src/main` changes need a dev-server **restart** before a GUI check; grep `out/main/index.js` to confirm the build has them.

## Review Focus

1. **Opt out, quit, relaunch** → statistics stay off: nothing is sent, `app_started` does not arrive, the Privacy switch reads Off. (Test in Task 6: `installUsage` options carry `enabled: false` when `usageStatsOff` is set.)
2. **Launch offline / Inlet down** → the first window opens with no delay, web tools work on the default service, the Settings row does **not** read "paused". (Test in Task 3: the facade answers `true` before install and when the reader throws.)
3. **A user-typed string reaching an id-typed param** (a manual MCP server named `/Users/me/secret`, a custom model `my model`) → the event is **dropped or sent as `custom`**, never truncated and sent. (Test in Task 5: guard rejects non-id-shaped values; Task 11 mapper tests send `custom`.)
4. **The same session open in two windows** → one `feature_used` per session and feature, not one per window. (Task 12 routes UI features through main's dedupe; test in Task 9 on the shared dedupe.)
5. **Pi exits mid-turn, or the user aborts mid-tool** → exactly one `agent_turn_completed` for that turn (`pi_exit` or `aborted`), and the next turn starts from zero counts. (Test in Task 9.)

---

## File structure

| File | Responsibility |
|---|---|
| `src/main/usage/events.ts` (new, import-free) | The catalog: 23 events, categories, param specs, plain-words lines, `SCREENS`, `NEVER_SENT_KEYS` |
| `src/main/usage/guard.ts` (new, pure) | `checkEvent` + `beforeSend` (defence in depth) |
| `src/main/usage/client.ts` (new, electron-free) | Facade: `track()`, `trackFeature()` dedupe, sink seam |
| `src/main/usage/attribution.ts` (new, fs only) | `existing_user` decision (D16) |
| `src/main/usage/turns.ts` (new, pure) | Per-turn counters → `agent_turn_completed` params |
| `src/main/usage/features.ts` (new, pure) | Tool name → `toolKind` / `feature` maps |
| `src/main/usage/fromLog.ts` (new, pure) | EventLog row → event picker |
| `src/main/usage/mappers.ts` (new, pure) | Handler facts → params (provider/model/MCP/git/web codes) |
| `src/main/usage/index.ts` (new, Electron) | `installUsage()`, consent IPC |
| `src/main/remoteConfig/defaults.ts` (new, import-free) | `CONFIG_DEFAULTS` |
| `src/main/remoteConfig/client.ts` (new, electron-free) | `webDefaultServiceAllowed()` + reader seam |
| `src/main/remoteConfig/index.ts` (new, Electron) | `installRemoteConfig()` |
| `src/main/providerError.ts` (moved from `src/renderer/src/providerError.ts`) | Error classifier, gains `kind` |
| `src/renderer/src/usage.ts` (new) | Renderer analytics client + `trackUi()` / `screenView()` |
| `src/renderer/src/remoteConfig.ts` (new) | Renderer config reader |
| `src/renderer/src/usageUi.ts` (new, pure) | `onboardingStep()`, `promptFlags()` helpers |
| Modified | `package.json`, `src/main/feedback/config.ts`, `src/main/webTools.ts`, `src/main/config.ts`, `src/main/log.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/renderer/src/App.tsx`, `ChatView.tsx`, `ContextPanel.tsx`, `OnboardingDialog.tsx`, `PrivacyView.tsx`, `BuiltinToolsBlock.tsx`, `HowItWorks.tsx`, `.claude/rules/crash-feedback.md`, `CLAUDE.md` |

---

### Task 1: inlet-sdk 0.2.0 → 0.4.0, alone

**Files:**
- Modify: `package.json` (`"inlet-sdk": "0.2.0"` → `"0.4.0"`), `package-lock.json`

**Interfaces:** Produces the 0.4.0 entries every later task imports.

- [ ] **Step 1: Bootstrap the worktree** (it has no `node_modules`): `npm install && (cd pi-runtime && npm ci)`, then `ln -s ~/Documents/Github/HappyVibe/.env .env`.
- [ ] **Step 2: Bump:** `npm install inlet-sdk@0.4.0 --save-exact`. Confirm `grep '"inlet-sdk"' package.json` prints `"0.4.0"` and `ls node_modules/inlet-sdk/dist/analytics/electron-renderer.js node_modules/inlet-sdk/dist/config/electron.js` both exist.
- [ ] **Step 3: Run the crash + feedback contracts unchanged:** `L=/tmp/vitest.log; npx vitest run tests/crash-sdk-contract.test.ts tests/crash-wiring.test.ts tests/crash-optout.test.ts tests/feedback-client.test.ts tests/feedback-config.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → EXIT=0.
- [ ] **Step 4: Gate:** `npm run gate` → green.
- [ ] **Step 5: Commit:** `git add package.json package-lock.json && git commit -s -m "chore(§39): inlet-sdk 0.2.0 → 0.4.0, crash and feedback unchanged"`

---

### Task 2: Channel config gains analytics + config databases

**Files:**
- Modify: `src/main/feedback/config.ts:29-78`
- Test: `tests/feedback-config.test.ts`

**Interfaces:**
- Produces: `FeedbackConfig.analyticsDatabase: string`, `FeedbackConfig.configDatabase: string`, `FeedbackConfig.environment: "development" | "production"`.

- [ ] **Step 1: Failing test** (append to `tests/feedback-config.test.ts`):

```ts
describe("§39 analytics + config databases", () => {
  it("dev resolves the dev project's databases in development", () => {
    const c = resolveFeedbackConfig({}, true)!;
    expect(c.analyticsDatabase).toBe("adb_49c94fgpyah0");
    expect(c.configDatabase).toBe("cfg_fnc0pxzkmjc0");
    expect(c.environment).toBe("development");
  });
  it("prod resolves the prod project's databases in production", () => {
    const c = resolveFeedbackConfig({}, false)!;
    expect(c.analyticsDatabase).toBe("adb_k820zq5xsfh1");
    expect(c.configDatabase).toBe("cfg_8hsh4dzaerwj");
    expect(c.environment).toBe("production");
  });
  it("env overrides win", () => {
    const c = resolveFeedbackConfig({ HV_ANALYTICS_DB: "adb_x", HV_CONFIG_DB: "cfg_y" }, true)!;
    expect([c.analyticsDatabase, c.configDatabase]).toEqual(["adb_x", "cfg_y"]);
  });
  it("a forced channel keeps its own environment", () => {
    expect(resolveFeedbackConfig({ HV_FEEDBACK_CHANNEL: "prod" }, true)!.environment).toBe("production");
  });
});
```

- [ ] **Step 2:** Run `L=/tmp/vitest.log; npx vitest run tests/feedback-config.test.ts > $L 2>&1; echo "EXIT=$?"; tail -30 $L` → FAIL (`analyticsDatabase` undefined).
- [ ] **Step 3: Implement.** In `FeedbackConfig` add `analyticsDatabase: string; configDatabase: string; environment: "development" | "production";`. In `FEEDBACK_CHANNELS.dev` add `analyticsDatabase: "adb_49c94fgpyah0", configDatabase: "cfg_fnc0pxzkmjc0"`, in `.prod` add `analyticsDatabase: "adb_k820zq5xsfh1", configDatabase: "cfg_8hsh4dzaerwj"`, and both fields to the `satisfies` shape. In `resolveFeedbackConfig`'s return add:

```ts
    analyticsDatabase: env.HV_ANALYTICS_DB ?? base.analyticsDatabase,
    configDatabase: env.HV_CONFIG_DB ?? base.configDatabase,
    // D8: the environment follows the CHANNEL, not is.dev — a dev build forced
    // onto prod must not write development rows into the prod database.
    environment: channel === "dev" ? "development" : "production",
```

- [ ] **Step 4:** Re-run → PASS. `npx vitest run tests/feedback-secrets.test.ts` stays green (no `isk_`).
- [ ] **Step 5: Commit:** `git commit -s -am "feat(§39): the channel table names each channel's analytics and config databases"`

---

### Task 3: Remote config in main, and the web flag

**Files:**
- Create: `src/main/remoteConfig/defaults.ts`, `src/main/remoteConfig/client.ts`, `src/main/remoteConfig/index.ts`
- Modify: `src/main/webTools.ts:27-49`, `src/main/config.ts:431-433`, `src/main/ipc.ts:2030-2042` (web block), `src/main/ipc.ts:4128-4136` (`hv:web-service-test`), `src/main/index.ts` (whenReady)
- Test: `tests/hv-web.test.ts` (resolver), `tests/remote-config-wiring.test.ts` (new)

**Interfaces:**
- Produces: `CONFIG_DEFAULTS` (`{ web_default_service: true } as const`); `webDefaultServiceAllowed(): boolean`; `setConfigReader(fn: ((key: "web_default_service") => boolean) | null): void`; `WEB_DEFAULT_PAUSED: string`; `resolveWebService(cfg, decrypt, defaultAllowed = true)`; `ResolvedWebService` error variant `{ error: string; code: "CUSTOM_URL_INVALID" | "DEFAULT_PAUSED"; service: "default" | "custom" }`; `installRemoteConfig(): Promise<void>`.

- [ ] **Step 1: Failing resolver tests** (append to `tests/hv-web.test.ts`; import `resolveWebService, WEB_DEFAULT_PAUSED, DEFAULT_WEB_SERVICE_URL` from `../src/main/webTools`):

```ts
describe("§39 the default service can be paused remotely", () => {
  const dec = (s: string): string => s;
  it("flag off + default mode → DEFAULT_PAUSED with the exact sentence, no URL", () => {
    const r = resolveWebService({ mode: "default" }, dec, false);
    expect(r).toEqual({ error: WEB_DEFAULT_PAUSED, code: "DEFAULT_PAUSED", service: "default" });
    expect(WEB_DEFAULT_PAUSED).toBe(
      "HappyVibe's free web service is paused right now. To keep using web tools, point the app at your own Firecrawl-compatible service in Settings → Built-in tools.",
    );
  });
  it("flag off + custom mode → the custom service, untouched", () => {
    expect(resolveWebService({ mode: "custom", baseUrl: "https://x.test" }, dec, false)).toEqual({ baseUrl: "https://x.test", service: "custom" });
  });
  it("flag on (and the default argument) → today's behaviour", () => {
    expect(resolveWebService(undefined, dec)).toEqual({ baseUrl: DEFAULT_WEB_SERVICE_URL, service: "default" });
  });
  it("a bad custom URL keeps its own code", () => {
    expect(resolveWebService({ mode: "custom", baseUrl: "nope" }, dec, false)).toMatchObject({ code: "CUSTOM_URL_INVALID", service: "custom" });
  });
});
```

And `tests/remote-config-wiring.test.ts` (new):

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { CONFIG_DEFAULTS } from "../src/main/remoteConfig/defaults";
import { setConfigReader, webDefaultServiceAllowed } from "../src/main/remoteConfig/client";

const strip = (f: string): string =>
  fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("§39 remote config", () => {
  it("fails OPEN: true before install, and when the reader throws", () => {
    expect(CONFIG_DEFAULTS).toEqual({ web_default_service: true });
    setConfigReader(null);
    expect(webDefaultServiceAllowed()).toBe(true);
    setConfigReader(() => { throw new Error("boom"); });
    expect(webDefaultServiceAllowed()).toBe(true);
    setConfigReader(() => false);
    expect(webDefaultServiceAllowed()).toBe(false);
    setConfigReader(null);
  });
  it("defaults.ts and client.ts import nothing Electron", () => {
    expect(strip("src/main/remoteConfig/defaults.ts")).not.toMatch(/\bimport\b/);
    expect(strip("src/main/remoteConfig/client.ts")).not.toMatch(/from ["'](electron|@electron-toolkit\/utils|inlet-sdk\/config\/electron)["']/);
  });
  it("ipc.ts never imports the Electron half", () => {
    expect(strip("src/main/ipc.ts")).not.toMatch(/remoteConfig\/index|["']\.\/remoteConfig["']/);
  });
  it("identity stays main's: acceptRendererIdentity false, never setInstallationIdEnabled(false", () => {
    const idx = strip("src/main/remoteConfig/index.ts");
    expect(idx).toContain('from "inlet-sdk/config/electron"');
    expect(idx).toMatch(/acceptRendererIdentity:\s*false/);
    expect(idx).not.toContain("refreshIntervalMinutes");
    for (const f of ["src/main/remoteConfig/index.ts", "src/main/ipc.ts", "src/main/index.ts"]) {
      expect(strip(f), f).not.toContain("setInstallationIdEnabled(false");
    }
  });
  it("installed from main index, not awaited", () => {
    expect(strip("src/main/index.ts")).toMatch(/void installRemoteConfig\(\)/);
  });
});
```

- [ ] **Step 2:** Run both files → FAIL (modules missing).
- [ ] **Step 3: Implement.**

`src/main/remoteConfig/defaults.ts`:

```ts
/**
 * §39 — the in-app defaults, shared by main and the renderer. Imports NOTHING:
 * the renderer imports it, and a runtime import here puts node:* in the
 * browser bundle (CLAUDE.md "Import hygiene").
 *
 * `web_default_service` fails OPEN: it applies before the first fetch, offline
 * and during an Inlet outage, and an outage must not switch a free feature off
 * for everyone. It is a cost lever, not a security control.
 */
export const CONFIG_DEFAULTS = { web_default_service: true } as const;
```

`src/main/remoteConfig/client.ts`:

```ts
/**
 * §39 — the electron-free seam, the crash/client.ts pattern: `ipc.ts` and
 * `config.ts` read the flag through here, and `remoteConfig/index.ts` plugs
 * the real reader in at install. Until then — or if it throws — the in-app
 * default answers, so nothing ever fails closed.
 */
import { CONFIG_DEFAULTS } from "./defaults";

type Reader = (key: "web_default_service") => boolean;
let reader: Reader | null = null;

export function setConfigReader(fn: Reader | null): void {
  reader = fn;
}

export function webDefaultServiceAllowed(): boolean {
  try {
    return reader ? reader("web_default_service") : CONFIG_DEFAULTS.web_default_service;
  } catch {
    return CONFIG_DEFAULTS.web_default_service;
  }
}
```

`src/main/remoteConfig/index.ts`:

```ts
/**
 * §39 — the Electron half of remote config. Never imported by `ipc.ts`
 * (vitest's `electron` stub takes the whole test file down otherwise).
 * One client for the app; windows reach it over `inlet:config` through the
 * preload's `inletConfig` bridge and hold no key.
 */
import { is } from "@electron-toolkit/utils";
import { installElectronMain } from "inlet-sdk/config/electron";
import { resolveFeedbackConfig } from "../feedback/config";
import { CONFIG_DEFAULTS } from "./defaults";
import { setConfigReader } from "./client";

export async function installRemoteConfig(): Promise<void> {
  const cfg = resolveFeedbackConfig(process.env, is.dev);
  if (!cfg) return; // no key for this channel: the defaults answer (§20)
  try {
    const client = await installElectronMain({
      baseUrl: cfg.baseUrl,
      publishableKey: cfg.publishableKey,
      databaseId: cfg.configDatabase,
      defaults: CONFIG_DEFAULTS,
      // A window can read values; it cannot change who this device is.
      acceptRendererIdentity: false,
      ...(is.dev ? { debug: (m: string, d?: unknown) => console.warn("[config]", m, d ?? "") } : {}),
    });
    setConfigReader((key) => client.getBoolean(key, CONFIG_DEFAULTS[key]));
  } catch (err) {
    console.warn("[config] not installed:", err);
  }
}
```

`src/main/webTools.ts` — add below `WEB_CUSTOM_URL_INVALID`:

```ts
/** §39: the sentence a web tool returns while remote config pauses the default box. */
export const WEB_DEFAULT_PAUSED =
  "HappyVibe's free web service is paused right now. To keep using web tools, point the app at your own Firecrawl-compatible service in Settings → Built-in tools.";
```

Change the type and resolver:

```ts
export type ResolvedWebService =
  | { baseUrl: string; key?: string; service: "default" | "custom" }
  | { error: string; code: "CUSTOM_URL_INVALID" | "DEFAULT_PAUSED"; service: "default" | "custom" };

export function resolveWebService(
  cfg: WebServiceConfig | undefined,
  decrypt: (b64: string) => string,
  defaultAllowed = true,
): ResolvedWebService {
  if (cfg?.mode !== "custom") {
    // §39: paused remotely → refuse BEFORE any request; the four tools stay
    // registered so the model can relay the sentence (D14).
    if (!defaultAllowed) return { error: WEB_DEFAULT_PAUSED, code: "DEFAULT_PAUSED", service: "default" };
    return { baseUrl: DEFAULT_WEB_SERVICE_URL, service: "default" };
  }
  const base = cfg.baseUrl?.trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\/./.test(base)) return { error: WEB_CUSTOM_URL_INVALID, code: "CUSTOM_URL_INVALID", service: "custom" };
  const key = cfg.keyEnc ? decrypt(cfg.keyEnc) : undefined;
  return key ? { baseUrl: base, key, service: "custom" } : { baseUrl: base, service: "custom" };
}
```

`src/main/config.ts:431` — pass the flag (import `webDefaultServiceAllowed` from `./remoteConfig/client`):

```ts
export function resolveWebServiceForCall(): ResolvedWebService {
  return resolveWebService(
    load().webService,
    (b64) => safeStorage.decryptString(Buffer.from(b64, "base64")),
    webDefaultServiceAllowed(),
  );
}
```

`src/main/ipc.ts` web block (the `if ("error" in resolved)` branch at ~2034): log the resolved code and service instead of the hard-coded custom ones:

```ts
            void log.append({
              type: "web.call",
              sessionId,
              workspaceId: wsId,
              data: { tool: `web_${wr.kind}`, ms: 0, ok: false, service: resolved.service, code: resolved.code },
            });
```

`hv:web-service-test` needs no change: with no `baseUrl` it resolves per call, and `"error" in svc` already returns `{ ok: false, reason: svc.error }` — so Test on the default service answers the paused sentence **without a request**.

`src/main/index.ts` — first line inside `app.whenReady().then(() => {` (before any `openWindow`), import `installRemoteConfig` from `./remoteConfig`:

```ts
  // §39: before the first window so its `hello` finds main listening; not
  // awaited — the network never gates a window, and the install never throws.
  void installRemoteConfig()
```

- [ ] **Step 4:** Re-run both test files → PASS. Run `npx vitest run tests/web-service.test.ts tests/web-bridge.test.ts tests/web-tools-format.test.ts` → green.
- [ ] **Step 5: Commit:** `git add -A src/main tests && git commit -s -m "feat(§32 §39): remote config's live switch can pause the default web service"`

---

### Task 4: Renderer config reader, Settings copy, How web tools work

**Files:**
- Create: `src/renderer/src/remoteConfig.ts`
- Modify: `src/preload/index.ts:764-766` (add `inletConfig` beside `inletCrash`), `src/renderer/src/hv.d.ts:1423-1428`, `src/renderer/src/components/BuiltinToolsBlock.tsx:352-440` (`WebRow`), `src/renderer/src/components/HowItWorks.tsx` (`webTools.body`)
- Test: `tests/remote-config-wiring.test.ts`, `tests/how-it-works.test.ts`

**Interfaces:**
- Consumes: `CONFIG_DEFAULTS`.
- Produces: `remoteConfig` (an `ElectronConfigRenderer<typeof CONFIG_DEFAULTS>`), `useWebDefaultPaused(): boolean`.

- [ ] **Step 1: Failing tests.** Append to `tests/remote-config-wiring.test.ts`:

```ts
describe("§39 the renderer half", () => {
  const preload = strip("src/preload/index.ts");
  it("the preload exposes inletConfig with literal channels only", () => {
    expect(preload).toMatch(/exposeInMainWorld\("inletConfig"/);
    expect(preload).toContain('ipcRenderer.send("inlet:config"');
    expect(preload).toContain('"inlet:config:state"');
  });
  it("the renderer imports only the electron-renderer entry", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
    for (const f of walk("src/renderer/src").filter((x) => /\.tsx?$/.test(x))) {
      expect(strip(f), f).not.toMatch(/inlet-sdk\/config\/(electron|node|browser)["']/);
    }
    expect(strip("src/renderer/src/remoteConfig.ts")).toContain('"inlet-sdk/config/electron-renderer"');
  });
  it("WebRow carries the approved copy", () => {
    const row = fs.readFileSync("src/renderer/src/components/BuiltinToolsBlock.tsx", "utf8");
    expect(row).toContain("HappyVibe&apos;s service (free for now)");
    expect(row).toContain("HappyVibe&apos;s service — paused");
    expect(row).toContain("The free service is paused. Choose Your own to keep using web tools.");
  });
});
```

Append to `tests/how-it-works.test.ts`:

```ts
it("§39 web tools say the default service is free for now", () => {
  expect(HOWTO_COPY.webTools.body).toContain(
    "HappyVibe's service is free for now. If that changes, this page will say so, and a service of your own keeps working either way.",
  );
});
```

- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3: Implement.**

Preload, directly after the `inletCrash` block:

```ts
/**
 * §39 — what `inlet-sdk/config/electron-renderer` talks through
 * (`window.inletConfig.send` / `.on`). Literal channels, as for `inletCrash`:
 * a window reads config state and asks for a refresh, nothing else.
 */
contextBridge.exposeInMainWorld("inletConfig", {
  send: (_channel: string, message: unknown): void => ipcRenderer.send("inlet:config", message),
  on: (_channel: string, listener: (payload: unknown) => void): void => {
    ipcRenderer.on("inlet:config:state", (_e, payload) => listener(payload));
  },
});
```

`hv.d.ts` `Window` interface, beside `inletCrash`:

```ts
    /** §39: the SDK's config bridge; channels are fixed in the preload. */
    inletConfig: { send(channel: string, message: unknown): void; on(channel: string, listener: (payload: unknown) => void): void };
```

`src/renderer/src/remoteConfig.ts`:

```ts
/**
 * §39 — the window's view of main's config client. Holds no key, makes no
 * request (the CSP stays `script-src 'self'`). Reads return CONFIG_DEFAULTS
 * until main's first push, so a window never shows "paused" by accident.
 */
import { useEffect, useState } from "react";
import { createElectronRenderer } from "inlet-sdk/config/electron-renderer";
import { CONFIG_DEFAULTS } from "../../main/remoteConfig/defaults";

export const remoteConfig = createElectronRenderer({ defaults: CONFIG_DEFAULTS });

/** Re-renders on a live change, so the Settings row flips without a reload (D13). */
export function useWebDefaultPaused(): boolean {
  const read = (): boolean => !remoteConfig.getBoolean("web_default_service", CONFIG_DEFAULTS.web_default_service);
  const [paused, setPaused] = useState(read);
  useEffect(() => remoteConfig.onUpdate(() => setPaused(read())), []);
  return paused;
}
```

`WebRow`: add `const paused = useWebDefaultPaused();` and replace the default radio label + add the line:

```tsx
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={mode === "default"} onChange={() => setMode("default")} />
            {paused ? <>HappyVibe&apos;s service — paused</> : <>HappyVibe&apos;s service (free for now)</>}
          </label>
          {paused && mode === "default" && (
            <p className="pl-5 text-ink-soft">The free service is paused. Choose Your own to keep using web tools.</p>
          )}
```

`HOWTO_COPY.webTools.body`: append `" HappyVibe's service is free for now. If that changes, this page will say so, and a service of your own keeps working either way."` to the end of the existing string.

- [ ] **Step 4:** Re-run both → PASS. `npm run build` (typecheck + bundle) → green; grep `out/renderer` has no `node:` import from the config entry: `grep -l "inlet-sdk/config/electron\"" -r out/renderer || echo clean`.
- [ ] **Step 5: Commit:** `git commit -s -am "feat(§32 §39): the web service row says free for now, and paused when it is"`

---

### Task 5: The event catalog and the guard (pure)

**Files:**
- Create: `src/main/usage/events.ts`, `src/main/usage/guard.ts`
- Test: `tests/usage-catalog.test.ts`, `tests/usage-guard.test.ts`

**Interfaces:**
- Produces:
  - `type Category = "activation" | "core" | "trust" | "understanding" | "feature" | "cost" | "quality" | "growth"`
  - `type ParamSpec = { type: "bool" } | { type: "number" } | { type: "enum"; values: readonly string[] } | { type: "id" }` (`id` = a value from a shipped catalog, or the literal `custom`; the guard checks its shape, the mappers choose it)
  - `interface EventSpec { category: Category; plain: string; params: Readonly<Record<string, ParamSpec>> }`
  - `USAGE_EVENTS` (23 entries), `type UsageEventName = keyof typeof USAGE_EVENTS`, `type UsageParams = Record<string, string | number | boolean>`
  - `SCREENS` (readonly string[]), `STANDARD_EVENTS`, `NEVER_SENT_KEYS`
  - `checkEvent(name: string, params?: UsageParams): { ok: true; category: Category; params: UsageParams } | { ok: false; reason: string }`
  - `usageBeforeSend<E extends { name: string; params?: UsageParams }>(env: E): E | null`

- [ ] **Step 1: Write `events.ts`** — the whole catalog, exactly the Notion §6.2 table (params and enums as locked there). Header comment: imports nothing; this is the ONLY list (D20); each `plain` is the Privacy page's line. Write it out in full:

```ts
export const CATEGORIES = ["activation", "core", "trust", "understanding", "feature", "cost", "quality", "growth"] as const;
export type Category = (typeof CATEGORIES)[number];
export type ParamSpec = { type: "bool" } | { type: "number" } | { type: "enum"; values: readonly string[] } | { type: "id" };
export interface EventSpec { category: Category; plain: string; params: Readonly<Record<string, ParamSpec>> }
export type UsageParams = Record<string, string | number | boolean>;

const bool = { type: "bool" } as const;
const num = { type: "number" } as const;
const id = { type: "id" } as const;
const oneOf = <const V extends readonly string[]>(...values: V) => ({ type: "enum", values }) as const;

export const USAGE_EVENTS = {
  onboarding_started: { category: "activation", plain: "The first-run guide opened", params: { providerPrechecked: bool } },
  onboarding_dismissed: { category: "activation", plain: "The first-run guide was closed early, and at which step", params: { atStep: oneOf("welcome", "setup_model", "setup_workspace", "handover") } },
  onboarding_completed: { category: "activation", plain: "The first-run guide finished, and how long it took", params: { durationSec: num, skippedAnimation: bool } },
  provider_connected: { category: "activation", plain: "A model provider was connected, and how (key, sign-in, local runner or custom endpoint)", params: { provider: id, method: oneOf("api_key", "oauth", "local_runner", "custom_endpoint"), providerCount: num } },
  workspace_added: { category: "activation", plain: "A project folder was added, and whether it uses git", params: { isGitRepo: bool, workspaceCount: num } },
  session_opened: { category: "core", plain: "A chat session was created, or a schedule started one", params: { kind: oneOf("new", "scheduled"), inWorktree: bool } },
  prompt_sent: { category: "core", plain: "You sent a message: counts of attachments and mentioned files, never the text", params: { planMode: bool, attachments: num, fileMentions: num, usedTemplate: bool, viaVoice: bool, queued: bool } },
  agent_turn_completed: { category: "core", plain: "The agent finished a turn: how it ended, how long it took, how many tools and files it touched, which model", params: { outcome: oneOf("completed", "aborted", "error"), errorKind: oneOf("auth", "balance", "rate_limit", "overloaded", "server", "network", "context_overflow", "model_not_found", "pi_exit", "other"), durationSec: num, toolCalls: num, filesEdited: num, subagentRuns: num, provider: id, model: id, billing: oneOf("metered", "plan", "unknown"), scheduled: bool } },
  permission_answered: { category: "trust", plain: "You answered a permission prompt: allow or deny, the kind of tool, how long it took", params: { decision: oneOf("allow", "allow_session", "deny"), toolKind: oneOf("bash", "edit", "write", "read", "mcp", "browser", "web", "subagent", "workflow", "terminal", "memory", "schedule", "other"), byRule: bool, fromSubagent: bool, waitSec: num } },
  bypass_changed: { category: "trust", plain: "Bypass permissions was turned on or off", params: { on: bool, scope: oneOf("session", "workspace", "global") } },
  plan_mode_changed: { category: "trust", plain: "Plan mode was entered, produced a plan, was implemented, reverted or left", params: { action: oneOf("entered", "plan_ready", "implemented", "reverted", "exited") } },
  panel_opened: { category: "understanding", plain: "You opened the context, cost, changes or files panel, or a sub-agent's card", params: { panel: oneOf("context", "cost", "git", "files", "run_card"), contextPct: num } },
  context_changed: { category: "understanding", plain: "The conversation was trimmed: a turn removed, a rewind, or a compaction", params: { action: oneOf("turn_removed", "compacted", "rewound"), rewindMode: oneOf("conversation", "files", "both"), trigger: oneOf("suggested", "manual", "auto"), tokensFreed: num } },
  feature_used: { category: "feature", plain: "A feature was used for the first time in a session", params: { feature: oneOf("terminal", "agent_terminal", "browser", "voice", "document", "web_search", "web_read", "memory", "skill", "prompt_template", "subagent", "workflow", "mcp_tool", "ask_user", "file_editor", "git_panel", "worktree"), trigger: oneOf("user", "agent") } },
  builtin_toggled: { category: "feature", plain: "A built-in tool or a bundled skill, prompt or agent was switched on or off (never one you made)", params: { item: id, kind: oneOf("builtin_tool", "bundled_skill", "bundled_prompt", "bundled_agent"), on: bool } },
  model_changed: { category: "feature", plain: "A model was chosen, and for what", params: { provider: id, model: id, scope: oneOf("global", "workspace", "session", "agent", "autofill") } },
  mcp_server_added: { category: "feature", plain: "A tool server was added: from the catalog, a plugin or by hand (a name you typed is never sent)", params: { source: oneOf("catalog", "plugin", "manual"), server: id, transport: oneOf("stdio", "http"), auth: oneOf("oauth", "key", "none") } },
  plugin_installed: { category: "feature", plain: "A plugin was installed", params: { plugin: id, marketplace: oneOf("store", "custom") } },
  schedule_created: { category: "feature", plain: "A schedule was created: how often, and with what access", params: { recurrence: oneOf("daily", "weekdays", "weekly", "hours", "minutes", "once"), access: oneOf("readonly", "full"), source: oneOf("page", "agent") } },
  git_action: { category: "feature", plain: "A git action succeeded from the changes panel (never a branch name or a message)", params: { action: oneOf("commit", "amend", "switch", "delete_branch", "merge", "worktree_add", "worktree_remove", "sync", "publish", "stash", "undo_hunk", "undo_file", "discard_untracked", "init", "pull_request"), aiMessage: bool } },
  web_tool_called: { category: "cost", plain: "A web tool ran: which one, which service, whether it worked, how long and how much text", params: { tool: oneOf("search", "fetch", "map", "crawl"), service: oneOf("default", "custom"), ok: bool, errorCode: oneOf("UNAVAILABLE", "DEFAULT_PAUSED", "CUSTOM_URL_INVALID", "DEADLINE", "CANCELLED", "TOO_LARGE", "BAD_RESPONSE", "CRAWL_FAILED", "HTTP_4XX", "other"), ms: num, chars: num, pages: num } },
  session_start_failed: { category: "quality", plain: "A session could not start, and why", params: { reason: oneOf("no_model", "session_cap", "folder_unavailable", "other"), provider: id } },
  star_nudge_answered: { category: "growth", plain: "The GitHub star card was answered: star or later", params: { action: oneOf("starred", "later") } },
} as const satisfies Record<string, EventSpec>;

export type UsageEventName = keyof typeof USAGE_EVENTS;

/** The `View` union in `src/renderer/src/components/Sidebar.tsx`; a test pins equality. */
export const SCREENS = [
  "chat", "schedules", "workspace",
  "models", "builtinTools", "memory", "plugins", "skills", "promptTemplates", "mcp", "agents", "sysprompt",
  "permissions", "tools", "terminal", "voice", "onBehalf", "shortcuts", "privacy", "stats", "audit", "changelog",
] as const;

/** The SDK's own events; `beforeSend` lets them through with only their standard params. */
export const STANDARD_EVENTS = {
  app_installed: [],
  app_updated: ["previousVersion", "previousBuild"],
  app_started: ["trigger", "crashReporting"],
  session_crashed: ["kind", "crashedAt"],
  screen_viewed: ["screen"],
} as const satisfies Record<string, readonly string[]>;

/** Param keys that would name content. No catalog event may declare one (the absence test). */
export const NEVER_SENT_KEYS = [
  "path", "file", "fileName", "url", "host", "query", "command", "args", "arguments", "message", "text", "prompt",
  "reply", "title", "name", "branch", "commit", "cost", "costUsd", "spend", "key", "apiKey", "error", "errorMessage", "stderr", "workspace",
] as const;
```

(Before writing `SCREENS`, re-read `Sidebar.tsx:19-37` — if the `View` union differs from this list, the union wins; the test below enforces it.)

- [ ] **Step 2: Failing catalog test** `tests/usage-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { CATEGORIES, NEVER_SENT_KEYS, SCREENS, USAGE_EVENTS } from "../src/main/usage/events";

const NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_.]{0,39}$/;

describe("§39 the event catalog (D20: its invariants, not a copy of the spec)", () => {
  const entries = Object.entries(USAGE_EVENTS);
  it("has the 23 locked events", () => expect(entries).toHaveLength(23));
  it("every name, key, category and value fits Inlet's rules", () => {
    for (const [name, spec] of entries) {
      expect(name, name).toMatch(NAME);
      expect(name, name).toMatch(/^[a-z]+(_[a-z]+)+$/);
      expect(CATEGORIES, name).toContain(spec.category);
      const params = Object.entries(spec.params);
      expect(params.length, name).toBeLessThanOrEqual(25);
      for (const [k, p] of params) {
        expect(k, `${name}.${k}`).toMatch(KEY);
        expect(k, `${name}.${k}`).toMatch(/^[a-z][A-Za-z0-9]*$/);
        if (p.type === "enum") for (const v of p.values) expect(v.length, `${name}.${k}=${v}`).toBeLessThanOrEqual(256);
      }
    }
  });
  it("every event has a plain-words line for the Privacy page", () => {
    for (const [name, spec] of entries) expect(spec.plain.length, name).toBeGreaterThan(20);
  });
  it("no param key names content (the never-sent list)", () => {
    for (const [name, spec] of entries) for (const k of Object.keys(spec.params)) {
      expect(NEVER_SENT_KEYS as readonly string[], `${name}.${k}`).not.toContain(k);
    }
  });
  it("the imports-nothing rule holds (the renderer imports this file)", () => {
    const src = fs.readFileSync("src/main/usage/events.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/^\s*import\b/m);
  });
  it("SCREENS equals the renderer's View union", () => {
    const sidebar = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
    const union = sidebar.match(/export type View =([\s\S]*?);/)![1];
    const views = [...union.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).sort();
    expect([...SCREENS].sort()).toEqual(views);
  });
});
```

- [ ] **Step 3: Failing guard test** `tests/usage-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkEvent, usageBeforeSend } from "../src/main/usage/guard";

describe("§39 the guard", () => {
  it("accepts a valid event and drops omitted params", () => {
    expect(checkEvent("bypass_changed", { on: true, scope: "global" })).toEqual({ ok: true, category: "trust", params: { on: true, scope: "global" } });
  });
  it("refuses an unknown name, an unknown param, a non-enum value, a wrong type", () => {
    expect(checkEvent("secret_event", {}).ok).toBe(false);
    expect(checkEvent("bypass_changed", { on: true, scope: "global", path: "/Users/me" }).ok).toBe(false);
    expect(checkEvent("bypass_changed", { on: true, scope: "everywhere" }).ok).toBe(false);
    expect(checkEvent("bypass_changed", { on: "yes", scope: "global" }).ok).toBe(false);
  });
  it("an id param takes a catalog-shaped id or custom — never a path, URL or sentence", () => {
    expect(checkEvent("model_changed", { provider: "openrouter", model: "deepseek/deepseek-v4-flash", scope: "global" }).ok).toBe(false);
    expect(checkEvent("model_changed", { provider: "openrouter", model: "deepseek-v4-flash", scope: "global" }).ok).toBe(true);
    expect(checkEvent("mcp_server_added", { source: "manual", server: "/Users/me/secret", transport: "stdio", auth: "none" }).ok).toBe(false);
    expect(checkEvent("mcp_server_added", { source: "manual", server: "my server", transport: "stdio", auth: "none" }).ok).toBe(false);
    expect(checkEvent("mcp_server_added", { source: "manual", server: "custom", transport: "stdio", auth: "none" }).ok).toBe(true);
  });
  it("numbers must be finite", () => {
    expect(checkEvent("panel_opened", { panel: "context", contextPct: Number.NaN }).ok).toBe(false);
  });
  it("beforeSend drops the three bad shapes and passes standard events with only their own params", () => {
    expect(usageBeforeSend({ name: "nope", params: {} })).toBeNull();
    expect(usageBeforeSend({ name: "bypass_changed", params: { on: true, scope: "global", extra: 1 } })).toBeNull();
    expect(usageBeforeSend({ name: "bypass_changed", params: { on: true, scope: "moon" } })).toBeNull();
    expect(usageBeforeSend({ name: "app_started", params: { trigger: "launch", crashReporting: true } })).not.toBeNull();
    expect(usageBeforeSend({ name: "app_started", params: { trigger: "launch", sneaky: "x" } })).toBeNull();
    expect(usageBeforeSend({ name: "screen_viewed", params: { screen: "privacy" } })).not.toBeNull();
    expect(usageBeforeSend({ name: "screen_viewed", params: { screen: "/Users/me" } })).toBeNull();
  });
});
```

Note on the first `model_changed` case: `/` is not allowed in an id. Pi model ids that contain `/` (OpenRouter's) are mapped by Task 11's `modelParams` by replacing `/` with `:` (`deepseek:deepseek-v4-flash`) — see Task 11; the guard only enforces the shape.

- [ ] **Step 4:** Run both → FAIL (guard missing; catalog test may pass — fix any failure it finds in `events.ts`).
- [ ] **Step 5: Implement `guard.ts`:**

```ts
/**
 * §39 — defence in depth. `track()` calls `checkEvent` before anything is
 * queued, and `usageBeforeSend` re-checks every envelope main's client is
 * about to queue, including the ones a window sent. An event that fails is
 * DROPPED, never trimmed: a trimmed event is an event whose shape we did not
 * design.
 */
import { SCREENS, STANDARD_EVENTS, USAGE_EVENTS, type Category, type ParamSpec, type UsageParams } from "./events";

/** A catalog id or `custom`: letters, digits, `.`, `_`, `-`, `:`. No `/`, no space — so never a path, a URL or a sentence. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const valueOk = (p: ParamSpec, v: unknown): boolean => {
  if (p.type === "bool") return typeof v === "boolean";
  if (p.type === "number") return typeof v === "number" && Number.isFinite(v);
  if (p.type === "enum") return typeof v === "string" && p.values.includes(v);
  return typeof v === "string" && ID.test(v);
};

export function checkEvent(
  name: string,
  params: UsageParams = {},
): { ok: true; category: Category; params: UsageParams } | { ok: false; reason: string } {
  const spec = (USAGE_EVENTS as Record<string, { category: Category; params: Record<string, ParamSpec> }>)[name];
  if (!spec) return { ok: false, reason: `unknown event ${name}` };
  for (const [k, v] of Object.entries(params)) {
    const p = spec.params[k];
    if (!p) return { ok: false, reason: `${name}: unknown param ${k}` };
    if (!valueOk(p, v)) return { ok: false, reason: `${name}.${k}: value refused` };
  }
  return { ok: true, category: spec.category, params };
}

export function usageBeforeSend<E extends { name: string; params?: UsageParams }>(env: E): E | null {
  const std = (STANDARD_EVENTS as Record<string, readonly string[]>)[env.name];
  if (std) {
    const keys = Object.keys(env.params ?? {});
    if (keys.some((k) => !std.includes(k))) return null;
    if (env.name === "screen_viewed" && !(SCREENS as readonly string[]).includes(String(env.params?.screen))) return null;
    return env;
  }
  return checkEvent(env.name, env.params).ok ? env : null;
}
```

- [ ] **Step 6:** Re-run both → PASS.
- [ ] **Step 7: Commit:** `git add src/main/usage tests/usage-*.test.ts && git commit -s -m "feat(§39): the usage event catalog and its guard"`

---

### Task 6: Usage statistics in main — consent, existing_user, install

**Files:**
- Create: `src/main/usage/client.ts`, `src/main/usage/attribution.ts`, `src/main/usage/index.ts`
- Modify: `src/main/config.ts` (beside `getCrashReports`, `:530`), `src/main/index.ts` (whenReady, after `installRemoteConfig`)
- Test: `tests/usage-attribution.test.ts`, `tests/usage-wiring.test.ts`

**Interfaces:**
- Consumes: `checkEvent`, `usageBeforeSend`, `FeedbackConfig.analyticsDatabase/environment`.
- Produces:
  - `track(name: UsageEventName, params?: UsageParams): void`
  - `trackFeature(sessionId: string, feature: string, trigger: "user" | "agent"): void` (dedupe per session+feature)
  - `forgetSessionFeatures(sessionId: string): void`
  - `setUsageSink(fn: ((name: string, category: string, params: UsageParams) => void) | null): void`
  - `existingUserAttribution(inletDir: string, priorUse: boolean): "existing_user" | undefined`
  - `hasPriorUse(userData: string, agentDir: string): boolean`
  - `getUsageStats(): boolean`, `setUsageStats(on: boolean): void`
  - `installUsage(): Promise<void>`; IPC `hv:get-usage-stats` → boolean, `hv:set-usage-stats(on: boolean)` → void

- [ ] **Step 1: Failing attribution test** `tests/usage-attribution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { existingUserAttribution, hasPriorUse } from "../src/main/usage/attribution";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "hv-usage-"));

describe("§39 D16 existing_user", () => {
  it("prior use + no analytics-state.json → existing_user, even when config wrote installation-id.json first", () => {
    const inlet = tmp();
    fs.writeFileSync(path.join(inlet, "installation-id.json"), JSON.stringify("abc"));
    expect(existingUserAttribution(inlet, true)).toBe("existing_user");
  });
  it("a fresh profile → none", () => expect(existingUserAttribution(tmp(), false)).toBeUndefined());
  it("analytics already ran here → none", () => {
    const inlet = tmp();
    fs.writeFileSync(path.join(inlet, "analytics-state.json"), "{}");
    expect(existingUserAttribution(inlet, true)).toBeUndefined();
  });
  it("prior use = a workspace, a key, a custom endpoint or a Pi login", () => {
    const u = tmp(); const a = tmp();
    expect(hasPriorUse(u, a)).toBe(false);
    fs.writeFileSync(path.join(u, "workspaces.json"), JSON.stringify([{ path: "/x" }]));
    expect(hasPriorUse(u, a)).toBe(true);
    const u2 = tmp();
    fs.writeFileSync(path.join(u2, "config.json"), JSON.stringify({ keys: { openrouter: "enc" } }));
    expect(hasPriorUse(u2, a)).toBe(true);
    const u3 = tmp(); const a3 = tmp();
    fs.writeFileSync(path.join(a3, "auth.json"), JSON.stringify({ anthropic: { type: "oauth" } }));
    expect(hasPriorUse(u3, a3)).toBe(true);
    const u4 = tmp();
    fs.writeFileSync(path.join(u4, "workspaces.json"), "not json");
    expect(hasPriorUse(u4, tmp())).toBe(false);
  });
});
```

Before writing it, confirm the stored shape of `workspaces.json` (`WorkspaceRegistry` in `src/main/store.ts:~620`) and of `config.json`'s `keys` / `customEndpoints` / legacy `apiKey` (`src/main/config.ts:18-60`); adjust the fixtures to the real shapes.

- [ ] **Step 2: Failing wiring test** `tests/usage-wiring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { forgetSessionFeatures, setUsageSink, track, trackFeature } from "../src/main/usage/client";

const strip = (f: string): string => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

describe("§39 the usage facade", () => {
  it("is a no-op before install, validates, and forwards category + params", () => {
    const got: unknown[] = [];
    track("bypass_changed", { on: true, scope: "global" }); // no sink yet: nothing, no throw
    setUsageSink((n, c, p) => got.push([n, c, p]));
    track("bypass_changed", { on: true, scope: "global" });
    track("bypass_changed", { on: true, scope: "moon" } as never);
    expect(got).toEqual([["bypass_changed", "trust", { on: true, scope: "global" }]]);
    setUsageSink(null);
  });
  it("feature_used is deduped per session and feature, whichever window asks", () => {
    const got: unknown[] = [];
    setUsageSink((n, _c, p) => got.push([n, p]));
    trackFeature("s1", "terminal", "user");
    trackFeature("s1", "terminal", "user");
    trackFeature("s1", "terminal", "agent");
    trackFeature("s2", "terminal", "user");
    forgetSessionFeatures("s1");
    trackFeature("s1", "terminal", "user");
    expect(got).toHaveLength(3);
    setUsageSink(null);
  });
});

describe("§39 wiring rules", () => {
  const src = walk("src").filter((f) => /\.tsx?$/.test(f));
  it("no user ID, no installation-ID switch-off, anywhere (D7, D11)", () => {
    for (const f of src) {
      const s = strip(f);
      expect(s, f).not.toMatch(/\bsetUserId\(|\bsetUser\(|setInstallationIdEnabled\(false/);
    }
  });
  it("ipc.ts never imports usage/index", () => {
    expect(strip("src/main/ipc.ts")).not.toMatch(/usage\/index|["']\.\/usage["']/);
  });
  it("main installs analytics from the electron entry, refusing renderer identity", () => {
    const idx = strip("src/main/usage/index.ts");
    expect(idx).toContain('from "inlet-sdk/analytics/electron"');
    expect(idx).toMatch(/acceptRendererIdentity:\s*false/);
    expect(idx).toContain("usageBeforeSend");
    expect(idx).toMatch(/enabled:\s*getUsageStats\(\)/);
    expect(idx).toMatch(/forget:\s*true/);
    expect(strip("src/main/index.ts")).toMatch(/void installUsage\(\)/);
  });
  it("the Stats aggregator stays local", () => {
    expect(strip("src/main/analytics.ts")).not.toMatch(/inlet-sdk|usage\//);
  });
});
```

- [ ] **Step 3:** Run both → FAIL.
- [ ] **Step 4: Implement.**

`src/main/config.ts`, beside `getCrashReports`, and add `usageStatsOff?: boolean;` to `ConfigFile` next to `crashReportsOff`:

```ts
/** §39: usage statistics, stored negative so absent means on (the crashReportsOff shape). */
export function getUsageStats(): boolean {
  return !load().usageStatsOff;
}

export function setUsageStats(on: boolean): void {
  const cfg = load();
  if (on) delete cfg.usageStatsOff;
  else cfg.usageStatsOff = true;
  save(cfg);
}
```

`src/main/usage/attribution.ts`:

```ts
/**
 * §39 D16 — is this an upgrade rather than a new install? Decided ONCE, at
 * analytics' init, because Inlet keeps an installation's FIRST attribution:
 * a later setAttribution would miss `app_installed`.
 *
 * The marker is analytics' own `analytics-state.json` (the SDK's FileStore
 * writes `<key>.json` under `<userData>/inlet`), NOT `installation-id.json`:
 * from inlet-sdk 0.4.0 the config module writes that one, possibly first.
 * Electron-free and fs-only, so vitest can drive it with temp dirs.
 */
import fs from "node:fs";
import path from "node:path";

const readJson = (f: string): unknown => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
};
const nonEmpty = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : !!v && typeof v === "object" && Object.keys(v).length > 0;

export function hasPriorUse(userData: string, agentDir: string): boolean {
  const ws = readJson(path.join(userData, "workspaces.json"));
  const cfg = readJson(path.join(userData, "config.json")) as { keys?: unknown; customEndpoints?: unknown; apiKey?: unknown } | null;
  const auth = readJson(path.join(agentDir, "auth.json"));
  return nonEmpty(ws) || nonEmpty(cfg?.keys) || nonEmpty(cfg?.customEndpoints) || !!cfg?.apiKey || nonEmpty(auth);
}

export function existingUserAttribution(inletDir: string, priorUse: boolean): "existing_user" | undefined {
  if (!priorUse) return undefined;
  return fs.existsSync(path.join(inletDir, "analytics-state.json")) ? undefined : "existing_user";
}
```

(If `workspaces.json` turns out to be `{ entries: [...] }` rather than an array, change `nonEmpty(ws)` to read that field — the Step 1 fixture must match the real file.)

`src/main/usage/client.ts`:

```ts
/**
 * §39 — the electron-free seam (the crash/client.ts pattern). Everything in
 * main tracks through here; `usage/index.ts` plugs the SDK in at install.
 * Before install, with no key, or while the user has statistics off, `track`
 * is a no-op or the SDK drops the event — call sites never check.
 */
import { checkEvent } from "./guard";
import type { UsageEventName, UsageParams } from "./events";

type Sink = (name: string, category: string, params: UsageParams) => void;
let sink: Sink | null = null;
const seen = new Map<string, Set<string>>();

export function setUsageSink(fn: Sink | null): void {
  sink = fn;
}

export function track(name: UsageEventName, params: UsageParams = {}): void {
  const r = checkEvent(name, params);
  if (!r.ok) return; // the catalog is the contract; a bad call site loses its event, not the app
  try { sink?.(name, r.category, r.params); } catch { /* analytics never breaks a feature */ }
}

/** First use per session+feature, whichever window or tool reported it (Review Focus 4). */
export function trackFeature(sessionId: string, feature: string, trigger: "user" | "agent"): void {
  let s = seen.get(sessionId);
  if (!s) seen.set(sessionId, (s = new Set()));
  if (s.has(feature)) return;
  s.add(feature);
  track("feature_used", { feature, trigger });
}

export function forgetSessionFeatures(sessionId: string): void {
  seen.delete(sessionId);
}
```

`src/main/usage/index.ts`:

```ts
/**
 * §39 — the Electron half of usage statistics. Never imported by `ipc.ts`.
 * Always initialised (enabled from the setting, like §37), so the Privacy
 * switch is live in both directions with no relaunch.
 */
import path from "node:path";
import { app, ipcMain } from "electron";
import { is } from "@electron-toolkit/utils";
import { installElectronMain } from "inlet-sdk/analytics/electron";
import { resolveFeedbackConfig } from "../feedback/config";
import { agentDir, getUsageStats, setUsageStats } from "../config";
import { existingUserAttribution, hasPriorUse } from "./attribution";
import { usageBeforeSend } from "./guard";
import { setUsageSink } from "./client";

let setEnabled: ((on: boolean, opts?: { forget?: boolean }) => Promise<void> | void) | null = null;

function registerUsageIpc(): void {
  ipcMain.handle("hv:get-usage-stats", () => getUsageStats());
  ipcMain.handle("hv:set-usage-stats", async (_e, on: boolean) => {
    setUsageStats(!!on);
    // D11: off FORGETS this installation (ID, session, queue, and the ID on
    // queued crash reports and submissions). No event is sent about it.
    await setEnabled?.(!!on, on ? undefined : { forget: true });
  });
}

export async function installUsage(): Promise<void> {
  registerUsageIpc(); // before every gate: the Privacy page must always be able to turn it back on
  const cfg = resolveFeedbackConfig(process.env, is.dev);
  if (!cfg) return;
  const userData = app.getPath("userData");
  const attribution = existingUserAttribution(path.join(userData, "inlet"), hasPriorUse(userData, agentDir()));
  try {
    const a = await installElectronMain({
      baseUrl: cfg.baseUrl,
      publishableKey: cfg.publishableKey,
      analyticsDatabaseId: cfg.analyticsDatabase,
      environment: cfg.environment, // D8: dev builds send, to the dev database
      enabled: getUsageStats(),
      ...(attribution ? { attribution } : {}),
      acceptRendererIdentity: false,
      beforeSend: (env) => usageBeforeSend(env),
      ...(is.dev ? { debug: (m: string, d?: unknown) => console.warn("[usage]", m, d ?? ""), onDrop: (r: string, d?: unknown) => console.warn("[usage] dropped:", r, d ?? "") } : {}),
    });
    setEnabled = (on, opts) => a.setEnabled(on, opts);
    setUsageSink((name, category, params) => a.track(name, { category, params }));
  } catch (err) {
    console.warn("[usage] not installed:", err);
  }
}
```

(`beforeSend`'s envelope type is `AnalyticsEnvelope`; `usageBeforeSend` is generic over `{ name; params? }` so it accepts it. If TS complains about `params` value types, type the lambda `(env: AnalyticsEnvelope) => usageBeforeSend(env)` importing the type from `inlet-sdk/analytics`.)

`src/main/index.ts`, right after `void installRemoteConfig()`: `void installUsage()` (import from `./usage`). Also add a flush on quit: in the existing `will-quit`/`before-quit` handler, nothing — the SDK's Electron adapter persists its queue on disk and replays at next start; do **not** add a blocking flush.

- [ ] **Step 5:** Re-run both tests → PASS. `npx vitest run tests/crash-wiring.test.ts tests/crash-optout.test.ts` → green.
- [ ] **Step 6:** Add to `tests/usage-wiring.test.ts` (Review Focus 1): a source assertion that `installElectronMain(` in `usage/index.ts` is called with `enabled: getUsageStats()` (already above) **and** that `hv:set-usage-stats` passes `{ forget: true }` only when turning off — covered by the regex; keep both.
- [ ] **Step 7: Commit:** `git commit -s -am "feat(§39): usage statistics in main — on by default, forget on opt-out, existing users tagged at init"` (add the new files first).

---

### Task 7: Renderer analytics client, and the Privacy page's Usage statistics block

**Files:**
- Create: `src/renderer/src/usage.ts`
- Modify: `src/preload/index.ts` (add `inletAnalytics` + `hv.getUsageStats/setUsageStats/usageFeature`), `src/renderer/src/hv.d.ts`, `src/renderer/src/components/PrivacyView.tsx`, `src/renderer/src/components/HowItWorks.tsx` (new `usageStats` entry, derived)
- Test: `tests/how-it-works.test.ts`, `tests/usage-wiring.test.ts`

**Interfaces:**
- Consumes: `USAGE_EVENTS`, `SCREENS`.
- Produces: `trackUi(name: UsageEventName, params?: UsageParams): void`; `screenView(name: (typeof SCREENS)[number]): void`; `window.hv.getUsageStats(): Promise<boolean>`; `window.hv.setUsageStats(on: boolean): Promise<void>`; `window.hv.usageFeature(sessionId: string, feature: string): void`; `HOWTO_COPY.usageStats`.

- [ ] **Step 1: Failing tests.** In `tests/how-it-works.test.ts`: change the "has all nine entries" key list to include `"usageStats"` (ten), and add:

```ts
import { USAGE_EVENTS } from "../src/main/usage/events";

it("§39 'What is sent' is DERIVED from the catalog, never retyped", () => {
  const b = HOWTO_COPY.usageStats.body;
  for (const spec of Object.values(USAGE_EVENTS)) expect(b).toContain(spec.plain);
  expect(b).toMatch(/random installation ID/i);
  expect(b).toMatch(/IP address is never stored/i);
  expect(b).toMatch(/never/i);
  const src = fs.readFileSync(path.join(R, "components/HowItWorks.tsx"), "utf8");
  expect(src).toMatch(/USAGE_EVENTS/);            // built from the const…
  expect(src).not.toContain(USAGE_EVENTS.prompt_sent.plain); // …not pasted beside it
});
```

In `tests/usage-wiring.test.ts` add:

```ts
describe("§39 renderer half", () => {
  it("preload exposes inletAnalytics with literal channels", () => {
    const p = strip("src/preload/index.ts");
    expect(p).toMatch(/exposeInMainWorld\("inletAnalytics"/);
    expect(p).toContain('ipcRenderer.send("inlet:analytics"');
    expect(p).toContain('"inlet:analytics:ids"');
  });
  it("the renderer imports only the electron-renderer analytics entry", () => {
    for (const f of walk("src/renderer/src").filter((x) => /\.tsx?$/.test(x))) {
      expect(strip(f), f).not.toMatch(/inlet-sdk\/analytics\/(electron|node|browser)["']/);
    }
    expect(strip("src/renderer/src/usage.ts")).toContain('"inlet-sdk/analytics/electron-renderer"');
  });
  it("Privacy puts Usage statistics above Crash reports, with the approved copy", () => {
    const v = fs.readFileSync("src/renderer/src/components/PrivacyView.tsx", "utf8");
    expect(v.indexOf('title="Usage statistics"')).toBeGreaterThan(-1);
    expect(v.indexOf('title="Usage statistics"')).toBeLessThan(v.indexOf('title="Crash reports"'));
    expect(v).toContain("Send anonymous usage statistics");
    expect(v).toContain("Which features get used, where setup gets stuck, and whether the app is reliable. Never what you type, your files or your projects.");
    expect(v).toContain("Turning statistics off doesn&apos;t stop it, but the ID is replaced with a new one that isn&apos;t linked to your statistics.");
    expect(v).toContain('copy="usageStats"');
  });
});
```

- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3: Implement.**

Preload, after `inletConfig`:

```ts
/** §39 — `inlet-sdk/analytics/electron-renderer`'s bridge. Literal channels; main owns identity and consent. */
contextBridge.exposeInMainWorld("inletAnalytics", {
  send: (_channel: string, message: unknown): void => ipcRenderer.send("inlet:analytics", message),
  on: (_channel: string, listener: (payload: unknown) => void): void => {
    ipcRenderer.on("inlet:analytics:ids", (_e, payload) => listener(payload));
  },
});
```

In the `hv` object (next to `getCrashReports`):

```ts
  getUsageStats: (): Promise<boolean> => ipcRenderer.invoke("hv:get-usage-stats"),
  setUsageStats: (on: boolean): Promise<void> => ipcRenderer.invoke("hv:set-usage-stats", on),
  usageFeature: (sessionId: string, feature: string): void => ipcRenderer.send("hv:usage-feature", sessionId, feature),
```

`hv.d.ts`: add the three to `HvApi`, and `inletAnalytics: { send(channel: string, message: unknown): void; on(channel: string, listener: (payload: unknown) => void): void };` to `Window`.

`src/main/ipc.ts`: register the UI feature channel (main dedupes, Review Focus 4). Import `trackFeature` from `./usage/client`:

```ts
  // §39: UI-only first uses (file editor, git panel, a user terminal, voice,
  // a document). Deduped HERE, per session, so two windows showing one
  // session send one event.
  ipcMain.on("hv:usage-feature", (_e, sessionId: string, feature: string) => {
    if (typeof sessionId === "string" && typeof feature === "string") trackFeature(sessionId, feature, "user");
  });
```

`src/renderer/src/usage.ts`:

```ts
/**
 * §39 — the window's analytics: no key, no queue, no request. Main supplies
 * identity and context, re-validates every event (usageBeforeSend), and
 * refuses identity/consent calls from here (acceptRendererIdentity: false).
 */
import { createElectronRenderer } from "inlet-sdk/analytics/electron-renderer";
import { USAGE_EVENTS, SCREENS, type UsageEventName, type UsageParams } from "../../main/usage/events";

const client = createElectronRenderer();

export function trackUi(name: UsageEventName, params: UsageParams = {}): void {
  client.track(name, { category: USAGE_EVENTS[name].category, params });
}

export function screenView(name: (typeof SCREENS)[number]): void {
  client.screen(name);
}
```

`HowItWorks.tsx`: `import { USAGE_EVENTS } from "../../../main/usage/events";` and add the entry (the list is BUILT, never pasted):

```ts
  usageStats: {
    title: "What usage statistics contain",
    body: [
      "Each event is one of these, and nothing else:",
      Object.values(USAGE_EVENTS).map((e) => `• ${e.plain}.`).join("\n"),
      "Each carries a random installation ID, the app version, your operating system and its language, and the country worked out from the connection — the IP address is never stored. They go to HappyVibe's own server, and only there.",
      "Never sent: what you type or what the agent replies, tool arguments, commands, file names, paths, web addresses, searches, session titles, project or branch names, commit messages, names you gave anything, keys, error messages, what you spend.",
    ].join("\n\n"),
  },
```

(The `<p>`-per-paragraph renderer splits on blank lines; the bullet list stays one paragraph with line breaks — add `whitespace-pre-line` to the `<p>` className in `HowItWorks`.)

`PrivacyView.tsx`: add state `const [stats, setStats] = useState(true);`, load it in the existing effect (`void window.hv.getUsageStats().then(setStats);`), and insert **before** the Crash reports `<Section>`:

```tsx
      <Section icon="stats" title="Usage statistics" subtitle="Which features get used, where setup gets stuck, and whether the app is reliable. Never what you type, your files or your projects.">
        <div className="rounded-xl border-2 border-line bg-card p-4 flex items-start justify-between gap-4">
          <div>
            <div className="font-bold">Send anonymous usage statistics</div>
            <p className="text-sm text-ink-soft mt-0.5">
              The app also checks HappyVibe&apos;s server for settings, such as whether the free web service is
              available. That check carries a random device ID so gradual changes reach the same devices. Turning
              statistics off doesn&apos;t stop it, but the ID is replaced with a new one that isn&apos;t linked to your
              statistics.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { const next = !stats; setStats(next); void window.hv.setUsageStats(next); }}
            className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer ${
              stats ? "bg-leaf text-paper border-leaf" : "bg-card text-ink border-line hover:border-leaf"
            }`}
          >
            {stats ? "On" : "Off"}
          </button>
        </div>
        <div className="mt-4">
          <HowItWorks copy="usageStats" />
        </div>
      </Section>
```

(Check `Section`'s `icon` prop union for an existing stats/chart icon name — use whatever the Stats nav row uses in `Sidebar.tsx`'s `NAV`.) Also change the intro sentence's `your audit log and your stats — stays here.` to `your audit log and your Stats page — stays here.` so it no longer reads as contradicting the block below it.

- [ ] **Step 4:** Re-run both → PASS. `npm run build` → green.
- [ ] **Step 5: Commit:** `git commit -s -am "feat(§39): the Privacy page's Usage statistics block, its copy derived from the catalog"` (add new files first).

---

### Task 8: Screens from `activeView`

**Files:**
- Modify: `src/renderer/src/App.tsx` (one effect next to where `activeView` is computed, `~:3050`)
- Test: `tests/usage-wiring.test.ts`

**Interfaces:** Consumes `screenView`.

- [ ] **Step 1: Failing test** (append):

```ts
it("§39 screens: one effect on activeView, never inside navigate()", () => {
  const app = strip("src/renderer/src/App.tsx");
  expect(app.match(/screenView\(/g)?.length).toBe(1);
  expect(app).toMatch(/useEffect\(\(\) => \{?\s*screenView\(activeView\)/);
  const nav = app.slice(app.indexOf("const navigate = useCallback"), app.indexOf("const navigate = useCallback") + 1500);
  expect(nav).not.toContain("screenView");
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — directly below the line that defines `activeView` (read `App.tsx:3040-3060` for its exact name and position; the effect must sit after it):

```tsx
  // §39: every visit, whatever path set the view — the sidebar, ⌘, / ⌘/, a
  // GoTo link or navigate(). navigate() alone misses most of them.
  useEffect(() => { screenView(activeView); }, [activeView]);
```

- [ ] **Step 4:** Re-run → PASS; `npm run build` → green (TS checks `activeView` is a `SCREENS` member; if `View` and `SCREENS` differ, Task 5's test already failed).
- [ ] **Step 5: Commit:** `git commit -s -am "feat(§39): screen views from the active view, the one choke point"`

---

### Task 9: Turns, tool kinds, features — and the classifier's `kind`

**Files:**
- Move: `src/renderer/src/providerError.ts` → `src/main/providerError.ts` (`git mv`); update imports in `src/renderer/src/App.tsx` and `tests/provider-error.test.ts`
- Create: `src/main/usage/turns.ts`, `src/main/usage/features.ts`
- Modify: `src/main/ipc.ts` — `attach()` event listener (`:1552-1665`), `promptSession` (`:3395-3580`), `manager.on("session-exit")` (`:2550`), session delete/forget path (call `forgetSessionFeatures`)
- Test: `tests/provider-error.test.ts`, `tests/usage-turns.test.ts`, `tests/usage-features.test.ts`

**Interfaces:**
- Produces:
  - `describeProviderError(raw, ctx)` now also returns `kind: ErrorKind` where `type ErrorKind = "auth" | "balance" | "rate_limit" | "overloaded" | "server" | "network" | "context_overflow" | "model_not_found" | "other"`
  - `class TurnTracker { start(sessionId: string, scheduled: boolean, now?: number): void; onEvent(sessionId: string, e: { type: string; toolName?: string; isError?: boolean; args?: unknown }): void; end(sessionId: string, outcome: TurnEnd, now?: number): UsageParams | null }` with `type TurnEnd = { outcome: "completed" | "aborted" } | { outcome: "error"; errorKind: string }`
  - `toolKind(tool: string): string`; `featureOfTool(tool: string): string | null`

- [ ] **Step 1: Failing classifier test** (append to `tests/provider-error.test.ts`, after fixing its import to `../src/main/providerError`):

```ts
describe("§39 kind — the only part that leaves the machine", () => {
  const k = (s: string): string => describeProviderError(s).kind;
  it("maps the ladder to a closed set", () => {
    expect(k("402 Insufficient Balance")).toBe("balance");
    expect(k("429 Too Many Requests")).toBe("rate_limit");
    expect(k("529 overloaded_error")).toBe("overloaded");
    expect(k("500 Internal Server Error")).toBe("server");
    expect(k("fetch failed ECONNRESET")).toBe("network");
    expect(k("401 invalid x-api-key")).toBe("auth");
    expect(k("404 model not found")).toBe("model_not_found");
    expect(k("prompt is too long: context length exceeded")).toBe("context_overflow");
    expect(k("something odd")).toBe("other");
    expect(k("")).toBe("other");
  });
});
```

(Match each fixture to the regex the ladder actually uses at `providerError.ts:45-136` — read it first; the timeout branch maps to `network`, the 400 branch to `other`.)

- [ ] **Step 2: Failing turn + feature tests.** `tests/usage-turns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TurnTracker } from "../src/main/usage/turns";

describe("§39 TurnTracker", () => {
  it("counts tool calls, distinct edited files and sub-agent runs; never a path", () => {
    const t = new TurnTracker();
    t.start("s", false, 1_000);
    t.onEvent("s", { type: "tool_execution_start", toolName: "edit", args: { path: "/a.ts" } });
    t.onEvent("s", { type: "tool_execution_end", toolName: "edit", isError: false });
    t.onEvent("s", { type: "tool_execution_start", toolName: "write", args: { path: "/a.ts" } });
    t.onEvent("s", { type: "tool_execution_end", toolName: "write", isError: false });
    t.onEvent("s", { type: "tool_execution_start", toolName: "bash", args: { command: "ls" } });
    t.onEvent("s", { type: "tool_execution_end", toolName: "bash", isError: false });
    t.onEvent("s", { type: "tool_execution_start", toolName: "Agent", args: {} });
    t.onEvent("s", { type: "tool_execution_end", toolName: "Agent", isError: false });
    const p = t.end("s", { outcome: "completed" }, 4_400)!;
    expect(p).toEqual({ outcome: "completed", durationSec: 3, toolCalls: 4, filesEdited: 1, subagentRuns: 1, scheduled: false });
    expect(JSON.stringify(p)).not.toContain("/a.ts");
  });
  it("ends exactly once: a second end (agent_end after pi_exit) is null, and the next turn starts at zero", () => {
    const t = new TurnTracker();
    t.start("s", true, 0);
    t.onEvent("s", { type: "tool_execution_start", toolName: "bash", args: {} });
    expect(t.end("s", { outcome: "error", errorKind: "pi_exit" }, 2_000)).toMatchObject({ outcome: "error", errorKind: "pi_exit", toolCalls: 1, scheduled: true });
    expect(t.end("s", { outcome: "completed" }, 3_000)).toBeNull();
    t.start("s", false, 5_000);
    expect(t.end("s", { outcome: "aborted" }, 6_000)).toMatchObject({ toolCalls: 0, outcome: "aborted" });
  });
  it("an end with no start is null (a resumed session's stray agent_end)", () => {
    expect(new TurnTracker().end("x", { outcome: "completed" })).toBeNull();
  });
});
```

(Use the real delegation tool name: `isDelegationTool` in `pi-runtime/extensions/hv-rules.ts:146` — the tracker must call it, not hard-code `"Agent"`; set the fixture to a name it accepts.)

`tests/usage-features.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { featureOfTool, toolKind } from "../src/main/usage/features";
import { USAGE_EVENTS } from "../src/main/usage/events";

describe("§39 tool → kind / feature", () => {
  it("maps the virtual rule names and built-ins", () => {
    expect(toolKind("bash")).toBe("bash");
    expect(toolKind("mcp:github")).toBe("mcp");
    expect(toolKind("browser:docs.foo.com")).toBe("browser");
    expect(toolKind("subagent:explorer")).toBe("subagent");
    expect(toolKind("web_fetch")).toBe("web");
    expect(toolKind("something_new")).toBe("other");
  });
  it("every kind and feature it can return is in the catalog's enums", () => {
    const kinds = (USAGE_EVENTS.permission_answered.params.toolKind as { values: readonly string[] }).values;
    const feats = (USAGE_EVENTS.feature_used.params.feature as { values: readonly string[] }).values;
    for (const t of ["bash", "edit", "write", "read", "web_search", "web_fetch", "web_map", "web_crawl", "memory_save", "terminal_run", "browser_open", "ask_user", "schedule_create", "mcp:x", "subagent:y"]) {
      expect(kinds, t).toContain(toolKind(t));
      const f = featureOfTool(t);
      if (f) expect(feats, t).toContain(f);
    }
    expect(featureOfTool("web_search")).toBe("web_search");
    expect(featureOfTool("web_fetch")).toBe("web_read");
    expect(featureOfTool("bash")).toBeNull();
  });
});
```

(Replace the sample tool names with real members of `MEMORY_TOOLS`, `TERMINAL_TOOLS`, `BROWSER_TOOLS` — read `pi-runtime/extensions/hv-memory.ts:12`, `hv-terminal.ts:9`, `hv-browser.ts:16`.)

- [ ] **Step 3:** Run the three files → FAIL.
- [ ] **Step 4: Implement.**
  - `git mv src/renderer/src/providerError.ts src/main/providerError.ts`; fix the two imports. Add `kind: ErrorKind` to `ProviderErrorInfo` and to every `return` in the ladder (each branch knows its kind; the empty-string and fall-through returns are `"other"`). Keep the file import-free (the renderer still imports it).
  - `features.ts`: import `WEB_TOOLS` (`../../../pi-runtime/extensions/hv-web`), `MEMORY_TOOLS`, `TERMINAL_TOOLS`, `BROWSER_TOOLS`, `isDelegationTool` (their modules), and `unwrapMcpCall` if MCP tools can arrive unwrapped. `toolKind`: prefix rules first (`mcp:` → mcp, `browser:` → browser, `subagent:` → subagent), then `bash|edit|write|read` as themselves, `WEB_TOOLS` → web, `BROWSER_TOOLS` → browser, `TERMINAL_TOOLS` → terminal, `MEMORY_TOOLS` → memory, `isDelegationTool` → subagent, name starts `schedule_` → schedule, a workflow tool name (read `hv-rules.ts` `SAFE_TOOLS` / tintinweb patch for the literal) → workflow, else other. `featureOfTool`: `web_search` → web_search; other `WEB_TOOLS` → web_read; `BROWSER_TOOLS` → browser; `TERMINAL_TOOLS` → agent_terminal; `MEMORY_TOOLS` → memory; delegation → subagent; workflow → workflow; `ask_user` → ask_user; MCP → mcp_tool; `read_document`-style document tool (literal in `SAFE_TOOLS`) → document; else null.
  - `turns.ts`:

```ts
/**
 * §39 — one turn's counts, from the tool events main already sees. Counts,
 * never content: the edited file set exists only to dedupe and is dropped at
 * end(). A turn ends once — agent_end after a pi_exit (or the reverse) is null.
 */
import { isDelegationTool } from "../../../pi-runtime/extensions/hv-rules";
import type { UsageParams } from "./events";

export type TurnEnd = { outcome: "completed" | "aborted" } | { outcome: "error"; errorKind: string };
interface Turn { startedAt: number; scheduled: boolean; toolCalls: number; files: Set<string>; subagentRuns: number }
const EDIT_TOOLS = new Set(["edit", "write"]);

export class TurnTracker {
  private turns = new Map<string, Turn>();

  start(sessionId: string, scheduled: boolean, now = Date.now()): void {
    this.turns.set(sessionId, { startedAt: now, scheduled, toolCalls: 0, files: new Set(), subagentRuns: 0 });
  }

  onEvent(sessionId: string, e: { type: string; toolName?: string; args?: unknown }): void {
    const t = this.turns.get(sessionId);
    if (!t || e.type !== "tool_execution_start" || !e.toolName) return;
    t.toolCalls++;
    if (isDelegationTool(e.toolName)) t.subagentRuns++;
    const p = (e.args as { path?: unknown } | undefined)?.path;
    if (EDIT_TOOLS.has(e.toolName) && typeof p === "string") t.files.add(p);
  }

  end(sessionId: string, how: TurnEnd, now = Date.now()): UsageParams | null {
    const t = this.turns.get(sessionId);
    if (!t) return null;
    this.turns.delete(sessionId);
    return {
      outcome: how.outcome,
      ...(how.outcome === "error" ? { errorKind: how.errorKind } : {}),
      durationSec: Math.round((now - t.startedAt) / 1000),
      toolCalls: t.toolCalls,
      filesEdited: t.files.size,
      subagentRuns: t.subagentRuns,
      scheduled: t.scheduled,
    };
  }
}
```

(If the test's first case expects `durationSec: 3` from 3 400 ms, `Math.round` gives 3 — keep whole seconds.)

  - `ipc.ts` wiring (import `TurnTracker`, `track`, `trackFeature`, `forgetSessionFeatures`, `featureOfTool`, `describeProviderError` (new path), `modelParams` from Task 11 — until Task 11 lands, send `provider`/`model` as `"custom"`; Task 11 replaces it):
    - Near `turnStartedAt` (`:843`): `const turns = new TurnTracker();`
    - `promptSession`, next to `turnStartedAt.set(sessionId, Date.now())` (`:3565`): `turns.start(sessionId, bySchedule);` and, when `bySchedule`, `track("session_opened", { kind: "scheduled", inWorktree: worktrees.projectOf(meta.workspaceId) !== meta.workspaceId });` (D19 + the "schedule run starts one" rule).
    - `attach()` listener, before the `agent_end` block: `turns.onEvent(sessionId, e as never);` and, on `tool_execution_start`, `const f = featureOfTool(e.toolName); if (f) trackFeature(sessionId, f, "agent");`
    - In the `agent_end` block: read the last assistant message's `stopReason` / `errorMessage` from the event (read `d1.md` for `agent_end`'s shape: `messages[]`, last `role: "assistant"` with `stopReason: "stop" | "length" | "toolUse" | "error" | "aborted"` and `errorMessage?`). Then:

```ts
        const last = lastAssistant(e); // small local helper over e.messages
        const how: TurnEnd = last?.stopReason === "aborted" ? { outcome: "aborted" }
          : last?.stopReason === "error" ? { outcome: "error", errorKind: describeProviderError(String(last.errorMessage ?? "")).kind }
          : { outcome: "completed" };
        const p = turns.end(sessionId, how);
        if (p) track("agent_turn_completed", { ...p, ...turnModel(sessionId) }); // provider, model, billing — Task 11
```

    - `manager.on("session-exit")` (`:2550`): `const p = turns.end(id, { outcome: "error", errorKind: "pi_exit" }); if (p) track("agent_turn_completed", { ...p, ...turnModel(id) });`
    - Where a session is deleted (`session.delete` rows) call `forgetSessionFeatures(id)`.
- [ ] **Step 5:** Re-run the three files + `npx vitest run tests/web-bridge.test.ts tests/schedules.test.ts` → PASS. `npm run build` → green.
- [ ] **Step 6: Commit:** `git commit -s -am "feat(§39): turn outcomes, tool counts and first-use features from the event stream; the error classifier gains a kind"`

---

### Task 10: The EventLog tap

**Files:**
- Modify: `src/main/log.ts` (optional `onAppend`), `src/main/ipc.ts:601` (construct with the tap), `src/main/ipc.ts:1124` (`notePending` timestamps), `:3819` (`hv:respond-permission` wait FIFO), `:2400` (`hv.plan` notify → entered/exited), `src/main/gitMessage.ts` call site (remember the last draft per workspace)
- Create: `src/main/usage/fromLog.ts`
- Test: `tests/usage-from-log.test.ts`

**Interfaces:**
- Consumes: `track`, `toolKind`, `mapWebCode` (defined here).
- Produces:
  - `new EventLog(file, onAppend?: (e: Omit<LogEvent, "ts">) => void)`
  - `interface TapContext { waitSec(sessionId: string): number | undefined; aiMessage(workspaceId: string | undefined, message: unknown): boolean; isStorePlugin(plugin: unknown, marketplace: unknown): string | null; isScheduleSession(sessionId: string | undefined): boolean; inWorktree(workspaceId: string | undefined): boolean }`
  - `eventFromLog(e: Omit<LogEvent, "ts">, ctx: TapContext): { name: UsageEventName; params: UsageParams } | null`
  - `mapWebCode(code: unknown): string`

- [ ] **Step 1: Failing test** `tests/usage-from-log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventFromLog, mapWebCode, type TapContext } from "../src/main/usage/fromLog";
import { checkEvent } from "../src/main/usage/guard";

const ctx: TapContext = {
  waitSec: () => 7,
  aiMessage: (_ws, m) => m === "feat: generated",
  isStorePlugin: (p) => (p === "superpowers" ? "superpowers" : null),
  isScheduleSession: (id) => id === "sched",
  inWorktree: (ws) => ws === "/wt",
};
const ev = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => eventFromLog({ type, data, ...extra }, ctx);

describe("§39 eventFromLog — an explicit picker, never data wholesale", () => {
  it("permission.decision: only a human's answer, mapped", () => {
    expect(ev("permission.decision", { tool: "bash", summary: "rm -rf /", decision: "allow-session", source: "user", agent: "explorer" }, { sessionId: "s" }))
      .toEqual({ name: "permission_answered", params: { decision: "allow_session", toolKind: "bash", byRule: false, fromSubagent: true, waitSec: 7 } });
    expect(ev("permission.decision", { tool: "bash", decision: "allow", source: "rule" })).toBeNull();
    expect(ev("permission.decision", { tool: "bash", decision: "allow", source: "bypass" })).toBeNull();
  });
  it("plan rows", () => {
    expect(ev("plan.ready", { path: "p.md" })?.params).toEqual({ action: "plan_ready" });
    expect(ev("plan.implement", { path: "p.md" })?.params).toEqual({ action: "implemented" });
    expect(ev("plan.revert", {})?.params).toEqual({ action: "reverted" });
    expect(ev("plan.exit", { discard: true })?.params).toEqual({ action: "exited" });
  });
  it("context.compact: Pi's own only (a click is tracked by the window)", () => {
    expect(ev("context.compact", { reason: "threshold" })).toEqual({ name: "context_changed", params: { action: "compacted", trigger: "auto" } });
    expect(ev("context.compact", { reason: "manual" })).toBeNull();
  });
  it("git.action: the action, never message/branch/path", () => {
    expect(ev("git.action", { action: "commit", message: "feat: generated", sha: "abc", who: "human" }, { workspaceId: "/w" }))
      .toEqual({ name: "git_action", params: { action: "commit", aiMessage: true } });
    expect(ev("git.action", { action: "switch", branch: "secret-branch" })?.params).toEqual({ action: "switch" });
    expect(ev("git.action", { action: "stash-pop", index: 0 })?.params).toEqual({ action: "stash" });
    expect(ev("git.action", { action: "worktree-prune" })).toBeNull();
    expect(JSON.stringify(ev("git.action", { action: "undo-file", path: "/Users/me/x.ts" }))).not.toContain("/Users");
  });
  it("web.call: never host or query", () => {
    const r = ev("web.call", { tool: "web_crawl", ms: 900, ok: true, service: "default", host: "docs.foo.com", resultChars: 5000, pages: 3 });
    expect(r).toEqual({ name: "web_tool_called", params: { tool: "crawl", service: "default", ok: true, ms: 900, chars: 5000, pages: 3 } });
    expect(ev("web.call", { tool: "web_search", ms: 0, ok: false, service: "default", code: "DEFAULT_PAUSED", queryChars: 12 })?.params)
      .toEqual({ tool: "search", service: "default", ok: false, ms: 0, errorCode: "DEFAULT_PAUSED" });
  });
  it("web codes: known pass, 4xx bucket, anything the service invented is other", () => {
    expect(mapWebCode("HTTP_404")).toBe("HTTP_4XX");
    expect(mapWebCode("HTTP_503")).toBe("other");
    expect(mapWebCode("DEADLINE")).toBe("DEADLINE");
    expect(mapWebCode("Your key /etc/passwd is bad")).toBe("other");
  });
  it("plugin.installed: store id or custom", () => {
    expect(ev("plugin.installed", { plugin: "superpowers", marketplace: "store-id" })?.params).toEqual({ plugin: "superpowers", marketplace: "store" });
    expect(ev("plugin.installed", { plugin: "my-private", marketplace: "https://x" })?.params).toEqual({ plugin: "custom", marketplace: "custom" });
  });
  it("session.start: a NEW non-schedule session only; a resume (reopen or hibernation wake) is nothing", () => {
    expect(ev("session.start", { resume: false }, { sessionId: "s", workspaceId: "/wt" })).toEqual({ name: "session_opened", params: { kind: "new", inWorktree: true } });
    expect(ev("session.start", { resume: true }, { sessionId: "s" })).toBeNull();
    expect(ev("session.start", { resume: false }, { sessionId: "sched" })).toBeNull(); // counted at the run start (Task 9)
  });
  it("every event it produces passes the guard", () => {
    for (const r of [
      ev("permission.decision", { tool: "mcp:github", decision: "deny", source: "user", rule: { action: "ask" } }, { sessionId: "s" }),
      ev("web.call", { tool: "web_fetch", ms: 5, ok: false, service: "custom", code: "HTTP_401" }),
    ]) expect(checkEvent(r!.name, r!.params).ok).toBe(true);
  });
  it("an unknown row type is nothing", () => expect(ev("memory.saved", { text: "secret" })).toBeNull());
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `fromLog.ts`** — one `switch (e.type)`, each case building params from named fields only:

```ts
/**
 * §39 — EventLog row → usage event, through an explicit picker. NEVER spread
 * `data`: rows carry summaries, commands, paths, branch names and messages.
 * Each case reads the fields it names, and nothing else.
 */
import type { LogEvent } from "../log";
import type { UsageEventName, UsageParams } from "./events";
import { toolKind } from "./features";

export interface TapContext {
  waitSec(sessionId: string): number | undefined;
  aiMessage(workspaceId: string | undefined, message: unknown): boolean;
  isStorePlugin(plugin: unknown, marketplace: unknown): string | null;
  isScheduleSession(sessionId: string | undefined): boolean;
  inWorktree(workspaceId: string | undefined): boolean;
}
type Out = { name: UsageEventName; params: UsageParams } | null;

const WEB_CODES = new Set(["UNAVAILABLE", "DEFAULT_PAUSED", "CUSTOM_URL_INVALID", "DEADLINE", "CANCELLED", "TOO_LARGE", "BAD_RESPONSE", "CRAWL_FAILED"]);
export function mapWebCode(code: unknown): string {
  if (typeof code !== "string") return "other";
  if (WEB_CODES.has(code)) return code;
  return /^HTTP_4\d\d$/.test(code) ? "HTTP_4XX" : "other";
}

const GIT: Record<string, string> = {
  commit: "commit", amend: "amend", switch: "switch", "delete-branch": "delete_branch", merge: "merge",
  "worktree-add": "worktree_add", "worktree-remove": "worktree_remove", sync: "sync", publish: "publish",
  "undo-hunk": "undo_hunk", "undo-file": "undo_file", "discard-untracked": "discard_untracked", init: "init",
};
const PLAN: Record<string, string> = { "plan.ready": "plan_ready", "plan.implement": "implemented", "plan.revert": "reverted", "plan.exit": "exited" };

export function eventFromLog(e: Omit<LogEvent, "ts">, ctx: TapContext): Out {
  const d = e.data ?? {};
  switch (e.type) {
    case "permission.decision": {
      if (d.source !== "user") return null;
      const decision = d.decision === "allow-session" ? "allow_session" : d.decision === "deny" ? "deny" : d.decision === "allow" ? "allow" : null;
      if (!decision || typeof d.tool !== "string") return null;
      const wait = e.sessionId ? ctx.waitSec(e.sessionId) : undefined;
      return { name: "permission_answered", params: { decision, toolKind: toolKind(d.tool), byRule: d.rule != null, fromSubagent: typeof d.agent === "string", ...(wait !== undefined ? { waitSec: wait } : {}) } };
    }
    case "plan.ready": case "plan.implement": case "plan.revert": case "plan.exit":
      return { name: "plan_mode_changed", params: { action: PLAN[e.type] } };
    case "context.compact":
      return d.reason === "manual" ? null : { name: "context_changed", params: { action: "compacted", trigger: "auto" } };
    case "git.action": {
      const raw = String(d.action ?? "");
      const action = raw.startsWith("stash-") ? "stash" : GIT[raw];
      if (!action) return null;
      return { name: "git_action", params: { action, ...(action === "commit" || action === "amend" ? { aiMessage: ctx.aiMessage(e.workspaceId, d.message) } : {}) } };
    }
    case "web.call": {
      const tool = String(d.tool ?? "").replace(/^web_/, "");
      if (!["search", "fetch", "map", "crawl"].includes(tool)) return null;
      return { name: "web_tool_called", params: {
        tool, service: d.service === "custom" ? "custom" : "default", ok: d.ok === true,
        ...(typeof d.ms === "number" ? { ms: d.ms } : {}),
        ...(d.ok !== true ? { errorCode: mapWebCode(d.code) } : {}),
        ...(typeof d.resultChars === "number" ? { chars: d.resultChars } : {}),
        ...(tool === "crawl" && typeof d.pages === "number" ? { pages: d.pages } : {}),
      } };
    }
    case "plugin.installed": {
      const id = ctx.isStorePlugin(d.plugin, d.marketplace);
      return { name: "plugin_installed", params: { plugin: id ?? "custom", marketplace: id ? "store" : "custom" } };
    }
    case "session.start":
      if (d.resume !== false || ctx.isScheduleSession(e.sessionId)) return null;
      return { name: "session_opened", params: { kind: "new", inWorktree: ctx.inWorktree(e.workspaceId) } };
    default:
      return null;
  }
}
```

(Check the real `web.call` field names in `ipc.ts:2055-2110` before finalising — `resultChars` / `pages` are what the crawl branch logs; if fetch logs a different chars key, map it too.)

- [ ] **Step 4: Wire it.**
  - `log.ts`: `constructor(private readonly file: string, private readonly onAppend?: (e: Omit<LogEvent, "ts">) => void)`; first line of `append`: `try { this.onAppend?.(event); } catch { /* analytics never breaks the audit log */ }`.
  - `ipc.ts`, **just before** `const log = new EventLog(...)` (`:601`), declare the tap state (so no TDZ):

```ts
  // §39: the EventLog tap's state. Declared before `log` so an early append
  // can never hit an uninitialised binding.
  const promptShownAt = new Map<string, number>();      // ui-request id → ms
  const answeredWaits = new Map<string, number[]>();    // sessionId → FIFO of wait ms
  const lastCommitDraft = new Map<string, string>();    // workspaceId → last generated message
  const tap: TapContext = {
    waitSec: (sid) => { const q = answeredWaits.get(sid); const ms = q?.shift(); return ms === undefined ? undefined : Math.round(ms / 1000); },
    aiMessage: (ws, m) => typeof m === "string" && !!ws && lastCommitDraft.get(ws) === m,
    isStorePlugin: (p, mk) => storePluginId(p, mk),   // see below
    isScheduleSession: (sid) => !!(sid && index.get(sid)?.scheduleId),
    inWorktree: (ws) => !!ws && worktrees.projectOf(ws) !== ws,
  };
  const log = new EventLog(path.join(userData, "events.jsonl"), (e) => {
    const r = eventFromLog(e, tap);
    if (r) track(r.name, r.params);
  });
```

  (`index` and `worktrees` are declared later in `registerIpc`; the closures only run on append, after init — but if either is a `const` declared *after* line 601 and an append happens during init, the try/catch in `append` swallows the TDZ error. Prefer moving the tap construction below `worktrees` if the order allows; otherwise keep the try/catch.)
  - `storePluginId(plugin, marketplace)`: returns the plugin name when `marketplace` is the bundled store's id and the name is in `src/main/plugins/catalog.generated.ts`, else `null`. Read that file's export name first.
  - `notePending` (`:1124`): `promptShownAt.set(r.id, Date.now());`
  - `hv:respond-permission` (`:3819`): before `clearPending(id)`: `const shown = promptShownAt.get(id); promptShownAt.delete(id); if (shown !== undefined && owner && owner !== UTILITY) { const q = answeredWaits.get(owner) ?? []; q.push(Date.now() - shown); answeredWaits.set(owner, q); }` (Answers arrive in order per session; the bridge writes the row right after, so FIFO pairs them.)
  - `hv.plan` notify handler (`:2400`, where `planState` is set): when the mode flips on → `track("plan_mode_changed", { action: "entered" })`; flips off without a `plan.exit` row → `track("plan_mode_changed", { action: "exited" })`. Read the notify's shape there; emit on transitions only (compare with the previous `planState` value).
  - Where the commit-message draft is generated (`gitMessage.ts`'s caller in `ipc.ts`, the "Write it for me" handler): `lastCommitDraft.set(workspaceId, draft)`.
- [ ] **Step 5:** Re-run `tests/usage-from-log.test.ts` → PASS; `npx vitest run tests/crash-audit.test.ts tests/feedback-audit.test.ts` (EventLog users) → green.
- [ ] **Step 6: Commit:** `git commit -s -am "feat(§39): the EventLog tap — permissions, plan, auto-compaction, git, web, plugins, new sessions"` (add new files first).

---

### Task 11: Handler events — providers, workspaces, bypass, toggles, models, MCP, schedules, start failures

**Files:**
- Create: `src/main/usage/mappers.ts`
- Modify: `src/main/ipc.ts` at the handlers listed below
- Test: `tests/usage-mappers.test.ts`, `tests/usage-wiring.test.ts`

**Interfaces:**
- Produces:
  - `knownProviders(): ReadonlySet<string>` — ids from `PROVIDER_CATALOG` (+ each `providerIds` twin) and the OAuth catalog in `providerCatalog.generated.ts`
  - `modelParams(provider: string, modelId: string, known = knownProviders()): { provider: string; model: string }`
  - `mcpParams(source: "catalog" | "plugin" | "manual", cfg: { command?: unknown; url?: unknown; headers?: unknown }, catalog?: { id: string; auth: "oauth" | "key" | "none" }): UsageParams`
  - `scheduleParams(s: { repeat: { kind: string }; mode: string }, source: "page" | "agent"): UsageParams`
  - `turnModel(sessionId)` in `ipc.ts` (resolves the session's provider/model/billing via the existing session → workspace → global chain and `calls.ts`'s `planProvidersFor`)

- [ ] **Step 1: Failing test** `tests/usage-mappers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { knownProviders, mcpParams, modelParams, scheduleParams } from "../src/main/usage/mappers";
import { checkEvent } from "../src/main/usage/guard";

describe("§39 mappers — shipped ids or `custom`", () => {
  it("a catalog provider keeps its ids; a custom endpoint or runner is custom", () => {
    expect(knownProviders().has("openrouter")).toBe(true);
    expect(modelParams("openrouter", "deepseek/deepseek-v4-flash")).toEqual({ provider: "openrouter", model: "deepseek:deepseek-v4-flash" });
    expect(modelParams("my-endpoint", "my model")).toEqual({ provider: "custom", model: "custom" });
    expect(modelParams("lmstudio", "qwen3-8b")).toEqual({ provider: "custom", model: "custom" });
    expect(modelParams("openrouter", "weird model id with spaces")).toEqual({ provider: "openrouter", model: "custom" });
  });
  it("MCP: transport from command vs url, auth from the catalog or headers, a typed name is never sent", () => {
    expect(mcpParams("manual", { command: "npx" })).toEqual({ source: "manual", server: "custom", transport: "stdio", auth: "none" });
    expect(mcpParams("manual", { url: "https://x", headers: { Authorization: "k" } })).toEqual({ source: "manual", server: "custom", transport: "http", auth: "key" });
    expect(mcpParams("catalog", { url: "https://x" }, { id: "github", auth: "oauth" })).toEqual({ source: "catalog", server: "github", transport: "http", auth: "oauth" });
  });
  it("schedules", () => {
    expect(scheduleParams({ repeat: { kind: "weekdays" }, mode: "readonly" }, "agent")).toEqual({ recurrence: "weekdays", access: "readonly", source: "agent" });
  });
  it("everything passes the guard", () => {
    expect(checkEvent("model_changed", { ...modelParams("openrouter", "deepseek/deepseek-v4-flash"), scope: "session" }).ok).toBe(true);
    expect(checkEvent("mcp_server_added", mcpParams("manual", { command: "x" })).ok).toBe(true);
  });
});
```

Append to `tests/usage-wiring.test.ts` (non-vacuity that each emit site exists, by literal name):

```ts
it("§39 every catalog event has at least one call site with a literal name", async () => {
  const { USAGE_EVENTS } = await import("../src/main/usage/events");
  const all = walk("src").filter((f) => /\.tsx?$/.test(f) && !f.includes("/usage/events.ts")).map(strip).join("\n");
  const fromLog = ["permission_answered", "plan_mode_changed", "context_changed", "git_action", "web_tool_called", "plugin_installed", "session_opened"];
  for (const name of Object.keys(USAGE_EVENTS)) {
    if (fromLog.includes(name) && all.includes(`name: "${name}"`)) continue;
    expect(all, name).toMatch(new RegExp(`(track|trackUi)\\("${name}"`));
  }
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `mappers.ts`** (imports `PROVIDER_CATALOG` + the OAuth list from `../providerCatalog.generated` — read its export names first):

```ts
/** ponytail: a provider in the generated catalog only offers Pi-registry models, so its model id is sent (shape-checked); anything HappyVibe wrote into models.json (custom endpoints, local runners, Ollama) is `custom`. Ceiling: a registry provider with a hand-typed model id sends that id if id-shaped. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export function modelParams(provider: string, modelId: string, known = knownProviders()): { provider: string; model: string } {
  if (!known.has(provider)) return { provider: "custom", model: "custom" };
  const m = modelId.replace(/\//g, ":");
  return { provider, model: ID.test(m) ? m : "custom" };
}
export function mcpParams(source: "catalog" | "plugin" | "manual", cfg: { command?: unknown; url?: unknown; headers?: unknown }, catalog?: { id: string; auth: "oauth" | "key" | "none" }): UsageParams {
  const transport = typeof cfg.url === "string" ? "http" : "stdio";
  const auth = catalog?.auth ?? (cfg.headers && typeof cfg.headers === "object" && Object.keys(cfg.headers).length ? "key" : "none");
  return { source, server: catalog?.id ?? "custom", transport, auth };
}
export function scheduleParams(s: { repeat: { kind: string }; mode: string }, source: "page" | "agent"): UsageParams {
  return { recurrence: s.repeat.kind, access: s.mode === "readonly" ? "readonly" : "full", source };
}
```

- [ ] **Step 4: Wire the handlers in `ipc.ts`** (each a single `track(...)` after the write succeeds; read each handler first):
  - `hv:set-provider-key` (`:3865`) → `track("provider_connected", { provider: modelParams(provider, "").provider, method: "api_key", providerCount: providerCount() })` when the key is non-empty.
  - Utility client `/hv-login` success (`:1220`, `p.stage === "success"`) → `method: "oauth"`, provider from `p.provider` mapped the same way.
  - `hv:save-custom-endpoint` (`:3924`) → `{ provider: "custom", method: "custom_endpoint", providerCount }`.
  - `hv:set-default-model` (`:4717`) → `track("model_changed", { ...modelParams(p, m), scope: "global" })`; and if the new provider is a `LOCAL_RUNNERS` id (or `ollama`) and the previous default's provider differs → also `provider_connected` with `method: "local_runner"`, provider `custom`.
  - `providerCount()` helper: `Object.keys(load().keys ?? {}).length + (load().customEndpoints?.length ?? 0) + authJsonProviders(agentDir()).length` (use `config.ts`'s own accessors, not `load()` directly, if `load` isn't exported).
  - `hv:add-workspace` (`:2764`) and `hv:create-workspace-folder` (`:2759`) → after `workspaces.add`: `void probeWorkspace(dir).then((s) => track("workspace_added", { isGitRepo: s === "repo", workspaceCount: workspaces.list().length }))` (read `probeWorkspace`'s return shape at `git.ts:161`).
  - `hv:prompt-session` (`:3580`): `const m = /^\/hv-dangerous (on|off)$/.exec(msg.trim()); if (m) track("bypass_changed", { on: m[1] === "on", scope: "session" });` — and return early from prompt tracking: `/hv-*` is never a `prompt_sent` (the renderer already excludes it, Task 12).
  - `hv:set-global-bypass` (`:4096`) / `hv:set-workspace-bypass` (`:4105`) → `bypass_changed` with `scope: "global" | "workspace"` and the new boolean (a workspace "inherit"/null clear sends nothing).
  - `hv:builtins-set` (`:4116`) → for each key in the patch whose value changed: `track("builtin_toggled", { item: key, kind: "builtin_tool", on: !!value })`.
  - `hv:skills-set-enabled` (`:6046`), `hv:prompt-templates-set-enabled` (`:6430`), `hv:set-agent-enabled` (`:4836`) → look the item up; only when its `source === "bundled"`: `track("builtin_toggled", { item: <its shipped name>, kind: "bundled_skill" | "bundled_prompt" | "bundled_agent", on })`. **Never the skill id** (an absolute path).
  - `hv:set-workspace-model` (`:5561`) → `scope: "workspace"`; `hv:set-session-model` (`:4870`) → `"session"`; `hv:write-agent` (`:4841`) when `edit.model` is set → `"agent"`; `hv:assistant-task-set` (`:4382`) when a model is set → `"autofill"`.
  - `hv:mcp-install-catalog` (`:5629`) → `mcpParams("catalog", entry.config, { id: catalogKey, auth: entry.auth })` (read the catalog entry's auth field in `mcpCatalog.ts`); the plugin install's MCP write (`:6775`) → `mcpParams("plugin", cfg)`; `hv:mcp-set-server` (`:5588`) when `cfg` is non-null **and the server is new** → `mcpParams("manual", cfg)`.
  - `hv:schedule-save` → when creating (no existing id) `scheduleParams(saved, "page")`; the drawer confirming an agent's `schedule_create` (`hv:schedule-drawer-answer`, `:2326-2336`) → `scheduleParams(res.saved, "agent")`.
  - `session_start_failed`: before the no-model `throw` (`:1031`) → `track("session_start_failed", { reason: "no_model" })`; where `SessionManager`'s cap error surfaces to IPC → `reason: "session_cap"`; `startClient`'s missing/denied-folder branch (`~:2604-2612`) → `reason: "folder_unavailable"`. **Do not add new `throw` literals.**
  - `turnModel(sessionId)`: `const r = resolveSpawnModel(meta.workspaceId, sessionId); return r ? { ...modelParams(r.provider, r.modelId), billing: billingFor(r.provider) } : {}` where `billingFor` reuses `calls.ts`'s `planProvidersFor` (plan) / unknown-price rule — read `ipc.ts:3610` for how the ledger decides; if a per-turn billing answer needs the ledger, send `billing` only for the `plan` case and `metered` otherwise, and note the ceiling in a `ponytail:` comment.
- [ ] **Step 5:** Re-run `tests/usage-mappers.test.ts` → PASS. The wiring test still fails for renderer events — expected until Task 12.
- [ ] **Step 6: Commit:** `git commit -s -am "feat(§39): settings and setup handlers report what changed, as shipped ids or custom"` (add new files first).

---

### Task 12: Renderer events — onboarding, prompts, panels, context edits, star, UI features

**Files:**
- Create: `src/renderer/src/usageUi.ts`
- Modify: `src/renderer/src/components/OnboardingDialog.tsx` (`:99-191`), `src/renderer/src/App.tsx` (`starClicked :2475`, `starLater :2489`, `toggleDrawer :338`, `newTerminal :2102`), `src/renderer/src/components/ChatView.tsx` (`submit :849`, `onContextOpenChange` sites `:1062-1063`, `:1108`, `RunRail setOpen :2244`, `attachDocument :718`, dictation `insertText :349`), `src/renderer/src/components/ContextPanel.tsx` (compact confirm), the rewind confirm (`rewind.ts` caller in `ChatView`/`App`), the turn-removal handler, `FileTab.tsx` (open)
- Test: `tests/usage-renderer.test.ts`, `tests/usage-wiring.test.ts` (goes green)

**Interfaces:**
- Consumes: `trackUi`, `window.hv.usageFeature`.
- Produces: `onboardingStep(s: { welcome: boolean; modelReady: boolean; workspaceReady: boolean }): "welcome" | "setup_model" | "setup_workspace" | "handover"`; `promptFlags(p: { text: string; planMode: boolean; images: number; documents: number; mentions: number; queued: boolean; viaVoice: boolean; templateNames: ReadonlySet<string> }): UsageParams | null` (null for `/hv-*`).

- [ ] **Step 1: Failing test** `tests/usage-renderer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { onboardingStep, promptFlags } from "../src/renderer/src/usageUi";
import { checkEvent } from "../src/main/usage/guard";

describe("§39 renderer helpers", () => {
  it("onboarding step", () => {
    expect(onboardingStep({ welcome: true, modelReady: false, workspaceReady: false })).toBe("welcome");
    expect(onboardingStep({ welcome: false, modelReady: false, workspaceReady: false })).toBe("setup_model");
    expect(onboardingStep({ welcome: false, modelReady: true, workspaceReady: false })).toBe("setup_workspace");
    expect(onboardingStep({ welcome: false, modelReady: true, workspaceReady: true })).toBe("handover");
  });
  it("prompt flags: counts and booleans only; /hv-* is not a prompt", () => {
    const base = { planMode: true, images: 2, documents: 1, mentions: 3, queued: false, viaVoice: true, templateNames: new Set(["review"]) };
    const p = promptFlags({ ...base, text: "/review please look at /Users/me/secret.ts" })!;
    expect(p).toEqual({ planMode: true, attachments: 3, fileMentions: 3, usedTemplate: true, viaVoice: true, queued: false });
    expect(JSON.stringify(p)).not.toContain("secret");
    expect(checkEvent("prompt_sent", p).ok).toBe(true);
    expect(promptFlags({ ...base, text: "/hv-dangerous on" })).toBeNull();
    expect(promptFlags({ ...base, text: "/unknown thing" })!.usedTemplate).toBe(false);
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `usageUi.ts`** (import-free except the type):

```ts
import type { UsageParams } from "../../main/usage/events";

export function onboardingStep(s: { welcome: boolean; modelReady: boolean; workspaceReady: boolean }): "welcome" | "setup_model" | "setup_workspace" | "handover" {
  if (s.welcome) return "welcome";
  if (!s.modelReady) return "setup_model";
  if (!s.workspaceReady) return "setup_workspace";
  return "handover"; // an Esc during the 2.2 s celebration
}

export function promptFlags(p: { text: string; planMode: boolean; images: number; documents: number; mentions: number; queued: boolean; viaVoice: boolean; templateNames: ReadonlySet<string> }): UsageParams | null {
  const t = p.text.trim();
  if (t.startsWith("/hv-")) return null;
  const cmd = /^\/([A-Za-z0-9._-]+)/.exec(t)?.[1];
  return { planMode: p.planMode, attachments: p.images + p.documents, fileMentions: p.mentions, usedTemplate: !!cmd && p.templateNames.has(cmd), viaVoice: p.viaVoice, queued: p.queued };
}
```

- [ ] **Step 4: Wire (read each site first):**
  - **Onboarding** (`OnboardingDialog.tsx`): `const mountedAt = useRef(Date.now()); const skipped = useRef(false);` On mount: `trackUi("onboarding_started", { providerPrechecked: modelReady })` (in a `useEffect(..., [])`). In `land` (the key/mouse handler `:109-112`): `skipped.current = true`. Wrap `onSkip` at both call sites (✕ `:188-191`, Esc `:171`) as `dismiss()` → `trackUi("onboarding_dismissed", { atStep: onboardingStep({ welcome, modelReady, workspaceReady }) }); onSkip();`. In the `complete` timer (`:128`), before `onDone`: `trackUi("onboarding_completed", { durationSec: Math.round((Date.now() - mountedAt.current) / 1000), skippedAnimation: skipped.current })`.
  - **Prompt** (`ChatView.submit :849`): after the existing `/hv-*` routing, compute `promptFlags({ text: input, planMode: planEnabled, images: outgoing.length, documents: documents.length, mentions: mentions.length, queued: busy, viaVoice: dictatedRef.current, templateNames })`, `if (f) trackUi("prompt_sent", f)`, then `dictatedRef.current = false`. `dictatedRef` is a new `useRef(false)` set to `true` inside the dictation `onText` (`insertText`, `:349`). `templateNames` = names from `commandCache` entries with `source === "prompt"` (`mentions.ts:170`). If `f?.usedTemplate` also `window.hv.usageFeature(sessionId, "prompt_template")`.
  - **Panels:** context — at both `onContextOpenChange(true)` sites: `trackUi("panel_opened", { panel: "context", ...(gauge?.percent != null ? { contextPct: Math.round(gauge.percent) } : {}) })` (only when opening; the toggle at `:1063` opens when `!contextOpen`). Cost (`:1062`) likewise with `panel: "cost"`. Git/files — in App `toggleDrawer` when the drawer becomes `"changes"` / `"files"` → `panel: "git"` / `"files"`, plus `window.hv.usageFeature(sid, "git_panel")` for changes. Run card — `RunRail`'s `setOpen` when opening a key → `panel: "run_card"`.
  - **Context edits:** Compact now confirmed (`ContextPanel` `confirmCompact` → `compactSession`) → `trackUi("context_changed", { action: "compacted", trigger: redZone ? "suggested" : "manual" })`. Rewind confirmed → `{ action: "rewound", rewindMode: scope }` (`RewindScope` is already `conversation | both | files`). Turn removed → `{ action: "turn_removed", ...(tokens != null ? { tokensFreed: tokens } : {}) }` from the value the panel displays.
  - **Star:** `starClicked` after `openExternal` resolves → `trackUi("star_nudge_answered", { action: "starred" })`; `starLater` → `{ action: "later" }`.
  - **UI features** (all via `window.hv.usageFeature(sessionId, feature)` so main dedupes): `newTerminal` → `"terminal"`; dictation start → `"voice"`; `attachDocument` / document drop → `"document"`; `FileTab` open → `"file_editor"`.
- [ ] **Step 5:** Run `tests/usage-renderer.test.ts` and `tests/usage-wiring.test.ts` → PASS (the every-event-has-a-call-site test now goes green). `npm run gate` → green.
- [ ] **Step 6: Commit:** `git commit -s -am "feat(§39): onboarding, prompts, panels, context edits, star and UI first-uses from the window"` (add new files first).

---

### Task 13: Rules, lexicon, and the verification pass

**Files:**
- Modify: `.claude/rules/crash-feedback.md` (add a "Usage statistics and remote config" block, current-state rules + one-line whys), `CLAUDE.md:123` (add `usage/events.ts` and `remoteConfig/defaults.ts` to the "import nothing" list)
- No code.

- [ ] **Step 1: Rules.** In `.claude/rules/crash-feedback.md` add (rules, not history): the module names and why not `analytics/`; ipc never imports either `index.ts`; the catalog is the only list and `track()`/`beforeSend` refuse anything else; never spread an EventLog row's `data` into params; `feature_used` goes through main's dedupe; opt-out is `setEnabled(false, { forget: true })` only; dev sends to the dev DB — every Inlet query there needs `environment: development`; the D3 crash check needs `HV_CRASH_DEV=1`.
- [ ] **Step 2: Gate + live.** `npm run gate` → green. Commit, then `npm run live:why`; if it prints anything, `npm run test:live` with `run_in_background` (~7–8 min; check `pgrep -fl "npm run dev"` first and that the `.env` symlink exists). If it prints nothing, record "live batch not required".
- [ ] **Step 3: Dev Inlet checks** (restart `npm run dev` with `HV_CRASH_DEV=1`; confirm `grep -c "inlet:analytics" out/main/index.js` > 0). Use the `inlet` MCP on `adb_49c94fgpyah0` / `cfg_fnc0pxzkmjc0`, every query filtered `environment: development`:
  - `get_analytics_live_events` shows `app_installed` (attribution `existing_user` on this machine, which already has workspaces), `app_started`, `screen_viewed`, `prompt_sent` within ~10 s of acting.
  - **D3:** `hv:crash-test` `message` via CDP + one feedback submission → `get_crash_report` / `get_submission` carry the same installation ID as the live events.
  - **D19:** run a schedule now → its `agent_turn_completed` has `scheduled: true`; a typed turn has `scheduled: false`.
  - **D11:** Privacy → Off; `evaluate_main` config client `getInstallationId()` differs from the ID in the events; a new `hv:crash-test` report carries no installation ID; a feedback submission carries none.
  - **D13:** `set_config_parameter` `web_default_service=false` on the dev draft → `validate_config_draft` → `publish_config`; then CDP `evaluate` `remoteConfig.refresh()` (or wait one interval) → next web call returns the paused sentence with no restart; republish `true` → restored.
- [ ] **Step 4: Lexicon.** For each of the 23 events, `update_analytics_event` on both databases with its `plain` line as the description (and per-param descriptions from the Notion §6.2 table).
- [ ] **Step 5: GUI assertions** (below) — each checked by screenshot + the MCP read it names. Then commit the rules: `git commit -s -am "docs(§39): usage and remote-config rules"`.

---

## Verification — observable assertions

Each line is something a person can check without re-deriving the design. "Page" = where it is observed.

**Privacy page** (sidebar → App features → Privacy)
- "Usage statistics" is the **first** block, above "Crash reports", and its pill reads **On** on a profile that never touched it.
- The block's body contains the sentence *"Turning statistics off doesn't stop it, but the ID is replaced with a new one that isn't linked to your statistics."*
- "What usage statistics contain" expands to **23 bullets**, one per event, and a line saying the IP address is never stored.
- The page intro now ends *"…your audit log and your Stats page — stays here."*
- Toggle Off → quit → relaunch → the pill still reads **Off**, and `get_analytics_live_events` shows **no** `app_started` from this launch.

**Built-in tools page** (Settings → Built-in tools → Web tools → Web service)
- The default radio reads **"HappyVibe's service (free for now)"**.
- With `web_default_service=false` published to dev and refreshed: the radio reads **"HappyVibe's service — paused"**, the line *"The free service is paused. Choose Your own to keep using web tools."* appears under it, the radio is **not** greyed out, and **Test** answers the paused sentence immediately (no spinner past "Testing…").
- Still paused: pick "Your own" with a working URL → Test says "Connected." and a web search in chat succeeds.
- "How web tools work" ends with *"…a service of your own keeps working either way."*

**Chat** (a session on the default service, flag off)
- The agent's web search card reports the paused sentence; the four web tools are still in the context panel's Tool definitions.

**Absence assertions** (read in `get_analytics_live_events` after one turn that reads `src/main/log.ts`, runs `ls -la`, and searches the web for `happyvibe secret query`)
- None of `src/main/log.ts`, `/Users/`, `ls -la`, `happyvibe secret query`, the workspace folder name, or the session title appears in **any** event's params.
- `builtin_toggled` for a bundled skill shows its short name, **not** a path containing `/`.
- A manual MCP server named `my-private-server` arrives as `server: "custom"` — the name is absent.
- The **Audit log** page gains **no** usage-statistics rows and no "Usage" source filter (D18); its Crash reports filter is unchanged.
- The **Stats** page's numbers are unchanged by any of this (it never reads the remote data).

**Regression to perform** (the `forget` path and two windows)
1. Open the same session in two windows (⌘N, pick it in both). Open the Changes panel in window 1, then in window 2 → `get_analytics_live_events` shows **one** `feature_used` `git_panel` for that session and **two** `panel_opened` `git`.
2. Privacy → Off. Send a feedback form. → `get_submission` shows **no** installation ID.
3. Privacy → On. Send a prompt. → the next `prompt_sent` carries a **different** installation ID from step 1's events, and `app_installed` fires again for it.

**Build**
- `npm run gate` green; `grep -rn "inlet-sdk/analytics/electron\"\|inlet-sdk/config/electron\"" out/renderer` prints nothing.
- Live batch: run if `npm run live:why` prints anything; otherwise record that it wasn't required.
