# Open-source release & updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `0.2.0` as the first public, signed (macOS), self-updating HappyVibe from a public GitHub repo.

**Architecture:** `electron-updater` reads the public GitHub Releases feed. A pure state module (`src/main/update/state.ts`) owns the reducer, the install gate and the platform mode. An Electron-only module (`src/main/update/index.ts`, the `crash/index.ts` pattern — never imported by `ipc.ts`) wires `autoUpdater`, the timers and IPC. `registerIpc` returns the few live facts the gate needs. The release is one **draft** GitHub Release: CI uploads the Windows and Linux builds, `npm run release:mac` uploads the macOS build from the maintainer's Mac, and a human presses Publish.

**Tech Stack:** Electron 44, electron-builder 26.15.3, electron-updater 6.8.9, React renderer (Tailwind v4, no DOM tests), vitest.

**Spec:** Notion "Open-source release & updates" (`3d7d33dfffca80f490a3d52b4efb910d`); PRD `docs/prd.md` §4, §18, §30, §32 amendments and **§38 Updates**.

## Global Constraints

- `package.json` `version` is the ONLY version; the tag is `v<version>` (§30).
- The first public release is `0.2.0`. `1.0.0` is reserved for the announced launch.
- Signing happens only on the maintainer's Mac. No Apple secret in GitHub. `electron-builder.yml` keeps `identity: null`, so a laptop build stays ad-hoc; `release:mac` overrides it on the CLI.
- Every Mach-O under `Resources/pi-runtime` is found by SCANNING, never hand-listed.
- The updater is off when `!app.isPackaged`. Nothing touches the network on the boot path: first check at +30 s, then every 4 h.
- A restart never interrupts an agent: gate = every live session `activity.isIdle` AND `pendingUi.list().length === 0`. Main re-checks the gate on every click.
- The row lives in the composer stack beside the plan pill and the feedback pulse, styled like them. Never a `Banner`, never a modal, never a toast. No new nav entry.
- Copy lives in one record (`updateCopy.ts`) with a no-dead-copy test (§20). No `⌘` and no "your Mac" (`tests/mod-key-copy.test.ts`).
- `ipc.ts` must never import `./update` (the §37 rule: `electron` is a CJS stub under vitest).
- Config `autoUpdate?: boolean`: absent = on; delete the key when set back to on (the `bypassAll` idiom).
- Audit rows `app.update` with `data: {event, version?, message?}` and no cost key.
- A **custom** web service with an unusable URL fails the call; it never falls back to the default box.
- Windows ships unsigned. Linux `.deb` gets a Download link, never an in-place update.

## Review Focus

1. **Update ready while a permission prompt is open in a CLOSED window** (a scheduled run) → Restart must stay blocked. Pinned in Task 3 (`installGate` counts `pendingCount` even with every session idle).
2. **Offline / GitHub unreachable at the background check** → nothing on screen and one audit row; a manual check shows the message verbatim. Pinned in Task 3 (reducer `error` keeps `manual`) and Task 6 (row renders nothing for `error`).
3. **Auto-download turned off** → the row offers Download, never "Restart to update" for something not downloaded. Pinned in Task 3 (`available` phase when `auto:false`).
4. **A `.deb` install** → never calls `downloadUpdate`/`quitAndInstall`; Download opens the release page. Pinned in Task 3 (`updateMode` → `manual`) and Task 4 (`install` in manual mode opens the URL).
5. **A tag that disagrees with `package.json`**, or a build without `latest-mac.yml` / the zip → `release:mac` refuses before building, and asserts the artifacts after. Pinned in Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/webTools.ts` (modify) | `resolveWebService` refuses an unusable custom URL |
| `build/afterPackLayout.mjs` (modify) | pure `isMachO(buf)` + `machOFiles(root, readHead)` |
| `build/afterPack.mjs` (modify) | Developer ID path signs every Mach-O in pi-runtime; ad-hoc path unchanged |
| `electron-builder.yml` (modify) | mac `[dmg, zip]`, `publish:` github draft |
| `src/main/update/state.ts` (new, pure) | `UpdateState`, `reduce`, `installGate`, `updateMode`, `RELEASES_URL` |
| `src/main/update/index.ts` (new, Electron) | `startUpdater(deps)`: autoUpdater, timers, IPC, audit |
| `src/main/config.ts` (modify) | `getAutoUpdate` / `setAutoUpdate` |
| `src/main/ipc.ts` (modify) | `registerIpc` returns `UpdateDeps` facts |
| `src/main/index.ts` (modify) | calls `startUpdater` |
| `src/preload/index.ts` (+ `index.d.ts`) (modify) | `updateState/updateCheck/updateInstall/updateSetAuto/onUpdateState` |
| `src/renderer/src/components/updateCopy.ts` (new) | every word |
| `src/renderer/src/components/UpdateRow.tsx` (new) | the composer-stack row |
| `src/renderer/src/components/ChatView.tsx` (modify) | mounts `UpdateRow` above `SessionPulse` |
| `src/renderer/src/components/ChangelogView.tsx` (modify) | Last checked · Check now · toggle |
| `scripts/changelog-entry.mjs` (new) | prints one version's CHANGELOG entry |
| `scripts/release-mac.mjs` (new) | preflight + build + sign + notarize + upload + verify |
| `.github/workflows/release.yml` (new) | Windows + Linux legs into the draft |
| `.github/workflows/dco.yml` (new) | every PR commit carries `Signed-off-by` |
| `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/*` (new) | community files |
| `README.md`, `.claude/commands/release.md`, `CLAUDE.md` (modify) | Download section, the two follow-up steps, the Releasing lines |
| `docs/validation/up1.md` (new) | the manual gates and their measured results |

---

### Task 1: A custom web service never falls back to the default box

**Files:**
- Modify: `src/main/webTools.ts:24-41` and its caller(s) of `resolveWebService`
- Test: `tests/web-service-resolve.test.ts` (new)

**Interfaces:**
- Produces: `resolveWebService(cfg, decrypt): { baseUrl: string; key?: string; service: "default" | "custom" } | { error: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveWebService, DEFAULT_WEB_SERVICE_URL } from "../src/main/webTools";

const id = (s: string) => s;
describe("resolveWebService — PRD §32 amendment 2026-09-24", () => {
  it("default mode uses the baked-in box", () => {
    expect(resolveWebService(undefined, id)).toEqual({ baseUrl: DEFAULT_WEB_SERVICE_URL, service: "default" });
  });
  it("a valid custom URL is used, trailing slash trimmed", () => {
    expect(resolveWebService({ mode: "custom", baseUrl: "https://fc.me/" }, id)).toEqual({ baseUrl: "https://fc.me", service: "custom" });
  });
  it.each(["", "   ", "fc.me", "ftp://fc.me"])("an unusable custom URL (%j) is an error, never the default box", (baseUrl) => {
    const r = resolveWebService({ mode: "custom", baseUrl }, id);
    expect(r).toHaveProperty("error");
    expect(JSON.stringify(r)).not.toContain(DEFAULT_WEB_SERVICE_URL);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/web-service-resolve.test.ts > /tmp/v.log 2>&1; echo EXIT=$?` → FAIL (the invalid case returns the default).
- [ ] **Step 3: Implement.** In `resolveWebService`, when `cfg?.mode === "custom"` and the URL fails the check, return `{ error: WEB_CUSTOM_URL_INVALID }` with the exported constant `"Your custom web service URL isn't valid — fix it in Settings → Built-in tools, or switch back to the default service."`. Rewrite the doc comment: the old fallback sent a user who chose their own service to ours without a word. At each caller (`grep -n resolveWebService src/main`), turn `{error}` into the tool's existing failure result, the same shape the "busy or unreachable default service" branch returns. The settings Test button path should show the same message.
- [ ] **Step 4:** Re-run → PASS. Also run the existing web tests: `npx vitest run tests/web > /tmp/v.log 2>&1; echo EXIT=$?`.
- [ ] **Step 5:** Commit `fix(§32): a custom web service with a bad URL says so instead of using ours`.

---

### Task 2: afterPack signs pi-runtime with a Developer ID when one is given

**Files:**
- Modify: `build/afterPackLayout.mjs` (add pure helpers), `build/afterPack.mjs:66-84`, `electron-builder.yml` (`mac.target`, `publish`)
- Test: `tests/afterpack-sign.test.ts` (new), `tests/release-config.test.ts` (new)

**Interfaces:**
- Produces: `isMachO(head: Uint8Array): boolean`, `machOFiles(root: string): string[]` (walks with `fs`, reads the first 4 bytes, skips symlinks), `macSignIdentity(env): string | null` (reads `HV_MAC_IDENTITY`).

- [ ] **Step 1: Failing tests**

```ts
// tests/afterpack-sign.test.ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { isMachO, machOFiles, macSignIdentity } from "../build/afterPackLayout.mjs";

describe("afterPack signing — PRD §4 open-source round", () => {
  it("recognises thin and fat Mach-O magics, and nothing else", () => {
    for (const m of [[0xcf, 0xfa, 0xed, 0xfe], [0xce, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe], [0xbe, 0xba, 0xfe, 0xca]])
      expect(isMachO(Uint8Array.from(m))).toBe(true);
    expect(isMachO(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]))).toBe(false); // ELF
    expect(isMachO(Uint8Array.from([0x23, 0x21]))).toBe(false); // short "#!"
  });
  // Derived, never hand-listed: a pin bump that adds a native binary is covered.
  it.skipIf(process.platform !== "darwin")("finds the real pi-runtime binaries, anydoc included", () => {
    const files = machOFiles(path.join(__dirname, "..", "pi-runtime", "node_modules"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.some((f) => f.endsWith("anydoc.darwin-arm64.node"))).toBe(true);
  });
  it("identity comes from HV_MAC_IDENTITY only; absent means the ad-hoc path", () => {
    expect(macSignIdentity({})).toBeNull();
    expect(macSignIdentity({ HV_MAC_IDENTITY: "Developer ID Application: X (T)" })).toBe("Developer ID Application: X (T)");
  });
});
```

```ts
// tests/release-config.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
const ROOT = path.join(__dirname, "..");
const yml = parse(readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8"));

describe("electron-builder.yml — PRD §38", () => {
  it("builds a zip beside the dmg (Squirrel.Mac updates from the zip)", () => {
    expect(yml.mac.target).toEqual(expect.arrayContaining(["dmg", "zip"]));
  });
  it("keeps identity: null so a laptop build stays ad-hoc; release:mac overrides it", () => {
    expect(yml.mac.identity).toBeNull();
  });
  it("publishes a DRAFT to the public repo", () => {
    expect(yml.publish).toMatchObject({ provider: "github", owner: "guiguito", repo: "HappyVibe", releaseType: "draft" });
  });
});
```

- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3: Implement.**
  - `afterPackLayout.mjs`: add the three helpers (magic set `feedfacf, feedface, cafebabe, bebafeca` read little- and big-endian as in the test; `machOFiles` uses `readdirSync(withFileTypes)`, skips symlinks, opens each regular file and reads 4 bytes with `readSync`).
  - `afterPack.mjs` darwin branch: `const id = macSignIdentity(process.env)`. If `id`, run `codesign --force --options runtime --timestamp --entitlements <plist> --sign <id> <file>` for every `machOFiles(dest)` and **do not** re-sign the bundle (electron-builder signs after this hook — `platformPackager.js:246→255`). Otherwise keep today's ad-hoc `--deep` call unchanged. Keep the §27 entitlements comment, and replace the `ponytail:` line with one naming the two paths.
  - `electron-builder.yml`: `mac.target: [dmg, zip]`, plus a top-level `publish: { provider: github, owner: guiguito, repo: HappyVibe, releaseType: draft }` with a comment naming §38 and why draft.
- [ ] **Step 4:** Both tests → PASS. `npm run build:unpack > /tmp/b.log 2>&1; echo EXIT=$?` — then `codesign --verify --deep --strict release/mac-arm64/HappyVibe.app` still passes (ad-hoc path unchanged) and `ls release/mac-arm64/HappyVibe.app/Contents/Resources/app-update.yml` exists.
- [ ] **Step 5:** Commit `build(§38): zip + draft publish, and a Developer ID path that signs every pi-runtime binary`.

---

### Task 3: The update state machine and the install gate (pure)

**Files:**
- Create: `src/main/update/state.ts`
- Test: `tests/update-state.test.ts`

**Interfaces:**
- Produces:

```ts
export const RELEASES_URL = "https://github.com/guiguito/HappyVibe/releases/latest";
export type UpdateMode = "disabled" | "auto" | "manual";
export type UpdatePhase =
  | { k: "idle" }
  | { k: "checking"; manual: boolean }
  | { k: "downloading"; version: string; percent: number }
  | { k: "available"; version: string }          // found, not downloaded (auto off, or manual mode)
  | { k: "ready"; version: string }              // downloaded, restart installs it
  | { k: "error"; message: string; manual: boolean };
export interface UpdateGate { blockedBy: string[]; terminalsOpen: boolean; armed: boolean }
export interface UpdateState { mode: UpdateMode; auto: boolean; lastCheckedAt: number | null; phase: UpdatePhase; gate: UpdateGate }
export type UpdateEvent =
  | { t: "checking"; manual: boolean }
  | { t: "available"; version: string }
  | { t: "none"; at: number }
  | { t: "progress"; percent: number }
  | { t: "downloaded"; version: string; at: number }
  | { t: "error"; message: string; at: number }
  | { t: "auto"; on: boolean }
  | { t: "gate"; gate: UpdateGate };
export function initialState(mode: UpdateMode, auto: boolean): UpdateState;
export function reduce(s: UpdateState, e: UpdateEvent): UpdateState;
export function updateMode(p: { packaged: boolean; platform: NodeJS.Platform; appImage?: string }): UpdateMode;
export function installGate(p: {
  liveSessions: Array<{ id: string; title: string }>;
  isIdle: (id: string) => boolean;
  pendingSessionIds: string[];
  terminalsOpen: number;
}): { blockedBy: string[]; terminalsOpen: boolean };
```

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { initialState, installGate, reduce, updateMode } from "../src/main/update/state";

describe("updateMode — §38", () => {
  it("dev never updates", () => expect(updateMode({ packaged: false, platform: "darwin" })).toBe("disabled"));
  it("mac and windows update in place", () => {
    expect(updateMode({ packaged: true, platform: "darwin" })).toBe("auto");
    expect(updateMode({ packaged: true, platform: "win32" })).toBe("auto");
  });
  it("an AppImage updates in place; a deb is manual", () => {
    expect(updateMode({ packaged: true, platform: "linux", appImage: "/x.AppImage" })).toBe("auto");
    expect(updateMode({ packaged: true, platform: "linux" })).toBe("manual");
  });
});

describe("reduce — §38", () => {
  const s0 = initialState("auto", true);
  it("found + auto on → downloading → ready", () => {
    let s = reduce(s0, { t: "available", version: "0.3.0" });
    expect(s.phase).toEqual({ k: "downloading", version: "0.3.0", percent: 0 });
    s = reduce(s, { t: "progress", percent: 42 });
    expect(s.phase).toMatchObject({ k: "downloading", percent: 42 });
    s = reduce(s, { t: "downloaded", version: "0.3.0", at: 5 });
    expect(s.phase).toEqual({ k: "ready", version: "0.3.0" });
    expect(s.lastCheckedAt).toBe(5);
  });
  it("found + auto OFF → available, never ready", () => {
    const s = reduce(initialState("auto", false), { t: "available", version: "0.3.0" });
    expect(s.phase).toEqual({ k: "available", version: "0.3.0" });
  });
  it("manual mode (deb) → available even with auto on", () => {
    expect(reduce(initialState("manual", true), { t: "available", version: "0.3.0" }).phase.k).toBe("available");
  });
  it("a background error remembers it was not asked for; a manual one does", () => {
    const bg = reduce(reduce(s0, { t: "checking", manual: false }), { t: "error", message: "net::ERR", at: 9 });
    expect(bg.phase).toEqual({ k: "error", message: "net::ERR", manual: false });
    const man = reduce(reduce(s0, { t: "checking", manual: true }), { t: "error", message: "net::ERR", at: 9 });
    expect(man.phase).toMatchObject({ manual: true });
  });
  it("a ready update survives a later background check", () => {
    const ready = reduce(reduce(s0, { t: "available", version: "0.3.0" }), { t: "downloaded", version: "0.3.0", at: 1 });
    expect(reduce(ready, { t: "checking", manual: false }).phase.k).toBe("ready");
    expect(reduce(ready, { t: "none", at: 2 }).phase.k).toBe("ready");
  });
  it("nothing new → idle with a fresh timestamp", () => {
    const s = reduce(reduce(s0, { t: "checking", manual: true }), { t: "none", at: 7 });
    expect(s.phase).toEqual({ k: "idle" });
    expect(s.lastCheckedAt).toBe(7);
  });
});

describe("installGate — a restart never interrupts an agent", () => {
  const live = [{ id: "a", title: "Refactor" }, { id: "b", title: "Docs" }];
  it("all idle, nothing pending → clear", () => {
    expect(installGate({ liveSessions: live, isIdle: () => true, pendingSessionIds: [], terminalsOpen: 0 })).toEqual({ blockedBy: [], terminalsOpen: false });
  });
  it("a busy session blocks, by title", () => {
    expect(installGate({ liveSessions: live, isIdle: (id) => id !== "a", pendingSessionIds: [], terminalsOpen: 0 }).blockedBy).toEqual(["Refactor"]);
  });
  // Review Focus 1: a schedule's prompt with every window closed.
  it("a retained prompt blocks even when every session reads idle, deduped by session", () => {
    const g = installGate({ liveSessions: live, isIdle: () => true, pendingSessionIds: ["b", "b"], terminalsOpen: 0 });
    expect(g.blockedBy).toEqual(["Docs"]);
  });
  it("a prompt from a session with no live title still blocks", () => {
    expect(installGate({ liveSessions: [], isIdle: () => true, pendingSessionIds: ["zzz"], terminalsOpen: 0 }).blockedBy).toHaveLength(1);
  });
  it("open terminals do not block, they warn", () => {
    expect(installGate({ liveSessions: [], isIdle: () => true, pendingSessionIds: [], terminalsOpen: 2 })).toEqual({ blockedBy: [], terminalsOpen: true });
  });
});
```

- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3: Implement** `state.ts` exactly to the interface. Import-free (the `schedules.ts` rule: the renderer imports its types). Rules: `available` → `downloading` only when `mode==="auto" && auto`; `checking`/`none` never demote `ready`; `none`/`downloaded`/`error` set `lastCheckedAt`; the gate event replaces `gate`; a titleless pending session contributes `"a session waiting for you"`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(§38): the update state machine and the restart gate, pure`.

---

### Task 4: Wire electron-updater in main

**Files:**
- Create: `src/main/update/index.ts`
- Modify: `package.json` (dep `electron-updater@6.8.9`, exact), `src/main/config.ts` (`getAutoUpdate`/`setAutoUpdate`), `src/main/ipc.ts` (`registerIpc` returns `UpdateDeps`), `src/main/index.ts` (call `startUpdater`), `src/preload/index.ts` + `src/preload/index.d.ts`
- Test: `tests/update-config.test.ts` (new), `tests/update-wiring.test.ts` (new, source scan)

**Interfaces:**
- Consumes: Task 3's `reduce`, `installGate`, `updateMode`, `initialState`, `RELEASES_URL`.
- Produces:

```ts
// ipc.ts
export interface UpdateDeps {
  liveSessions: () => Array<{ id: string; title: string }>; // manager.activeIds() + index.get(id)?.title
  isIdle: (id: string) => boolean;                          // activity.isIdle
  pendingSessionIds: () => string[];                        // pendingUi.list().map(p => p.sessionId)
  terminalsOpen: () => number;                              // terminals.list().length
  audit: (data: Record<string, unknown>) => void;           // log.append({ type: "app.update", data })
  send: (channel: string, payload?: unknown) => void;       // the broadcast helper
}
export function registerIpc(...): UpdateDeps;
// update/index.ts
export function startUpdater(deps: UpdateDeps): void;
// IPC: push "hv:update-state" (UpdateState); handle "hv:update-get", "hv:update-check", "hv:update-install", "hv:update-download", "hv:update-set-auto"
// preload: updateGet(), updateCheck(), updateInstall(), updateDownload(), updateSetAuto(on), onUpdateState(cb) → unsubscribe
```

- [ ] **Step 1: Failing tests**

```ts
// tests/update-config.test.ts — use the same temp-HOME/config harness the existing bypassAll tests use (grep "setBypassAll" tests/)
it("autoUpdate is on when absent, and deleted when set back on", () => {
  expect(getAutoUpdate()).toBe(true);
  setAutoUpdate(false); expect(readConfigRaw().autoUpdate).toBe(false);
  setAutoUpdate(true);  expect("autoUpdate" in readConfigRaw()).toBe(false);
});
```

```ts
// tests/update-wiring.test.ts
import { readFileSync } from "node:fs";
const src = (p: string) => readFileSync(p, "utf8");
it("ipc.ts never imports ./update (electron is a CJS stub under vitest — the §37 rule)", () => {
  expect(src("src/main/ipc.ts")).not.toMatch(/from ["']\.\/update/);
});
it("the updater never runs a check on the boot path", () => {
  const s = src("src/main/update/index.ts");
  expect(s).toMatch(/FIRST_CHECK_MS\s*=\s*30_000/);
  expect(s).toMatch(/EVERY_MS\s*=\s*4\s*\*\s*60\s*\*\s*60_000/);
});
it("install re-evaluates the gate in main before quitAndInstall", () => {
  const s = src("src/main/update/index.ts");
  expect(s.indexOf("installGate(")).toBeLessThan(s.indexOf("quitAndInstall("));
});
it("allowPrerelease is off and electron-updater is pinned exact", () => {
  expect(src("src/main/update/index.ts")).toMatch(/allowPrerelease\s*=\s*false/);
  expect(JSON.parse(src("package.json")).dependencies["electron-updater"]).toBe("6.8.9");
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - `npm install --save-exact electron-updater@6.8.9`.
  - `config.ts`: `autoUpdate?: boolean` on the config type; `getAutoUpdate = () => load().autoUpdate ?? true`; `setAutoUpdate(on)` deletes the key when `on` (copy `setBypassAll`'s shape).
  - `ipc.ts`: at the end of `registerIpc`, `return { liveSessions, isIdle: (id) => activity.isIdle(id), pendingSessionIds: () => pendingUi.list().map((p) => p.sessionId), terminalsOpen: () => terminals.list().length, audit: (data) => void log.append({ type: "app.update", data }), send }`.
  - `update/index.ts` (imports `electron`, `electron-updater`, `../config`, `./state`):
    - `mode = updateMode({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE })`. Dev override: when `!app.isPackaged && process.env.HV_UPDATE_FAKE` (e.g. `ready:0.3.0`, `available:0.3.0`, `downloading:0.3.0`), seed that phase so the GUI pass can see the row; install then only logs. Nothing else runs in dev.
    - `autoUpdater.autoDownload = mode === "auto" && getAutoUpdate(); autoUpdater.autoInstallOnAppQuit = mode === "auto"; autoUpdater.allowPrerelease = false;` and map its events (`checking-for-update`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, `error`) onto `reduce`. After every state change, `send("hv:update-state", state)`.
    - Audit rows: `available`, `downloaded`, `error`, `deferred` (install blocked), `installed` (right before `quitAndInstall`).
    - Timers: `setTimeout(check, FIRST_CHECK_MS)` then `setInterval(check, EVERY_MS)`, both `.unref()`.
    - `hv:update-install`: compute `installGate(...)`. Clear → audit `installed`, `autoUpdater.quitAndInstall()`. Blocked → `armed: true`, audit `deferred`, poll every 5 s (`// ponytail: 5 s poll; an activity event hook if it ever matters`) and install on the first clear tick. In manual mode, `shell.openExternal(RELEASES_URL)` instead.
    - `hv:update-download` → `autoUpdater.downloadUpdate()` (auto mode with auto off), or open `RELEASES_URL` in manual mode.
    - `hv:update-set-auto` → `setAutoUpdate`, `autoUpdater.autoDownload = …`, reduce `{t:"auto"}`.
    - A `ready` state refreshes its gate every 5 s while shown, so the row's "Restart when…" copy stays true.
  - `index.ts`: `const updateDeps = registerIpc(...)`; `startUpdater(updateDeps)` on the next line.
  - preload: the six functions from the interface above, same style as the `crash*` block.
- [ ] **Step 4:** Tests PASS. `npm run build > /tmp/b.log 2>&1; echo EXIT=$?` → 0, then `grep -c "hv:update-state" out/main/index.js` ≥ 1 (verify the BUILT main, not the source).
- [ ] **Step 5:** Commit `feat(§38): the app checks, downloads and installs updates behind the idle gate`.

---

### Task 5: Copy record

**Files:**
- Create: `src/renderer/src/components/updateCopy.ts`
- Test: `tests/update-copy.test.ts`

```ts
export const UPDATE_COPY = {
  ready: (v: string) => `HappyVibe ${v} is ready`,
  restart: "Restart to update",
  waiting: (n: number) => (n === 1 ? "Restart when the running session finishes" : `Restart when the ${n} running sessions finish`),
  armed: "Will restart when they finish",
  terminals: "open terminals will close",
  available: (v: string) => `HappyVibe ${v} is out`,
  download: "Download",
  downloading: (v: string, p: number) => `Downloading HappyVibe ${v} — ${Math.round(p)}%`,
  hide: "Hide until next launch",
  lastChecked: "Last checked",
  never: "Not checked yet",
  checkNow: "Check now",
  checking: "Checking…",
  upToDate: "You're on the latest version.",
  auto: "Download updates automatically",
  devOff: "Updates are off in development builds.",
} as const;
```

- [ ] **Step 1:** Test: every key of `UPDATE_COPY` appears as `C.<key>` in `UpdateRow.tsx` or `ChangelogView.tsx` (the `feedback-dialog.test.ts` no-dead-copy pattern), and no value contains `⌘` or "your Mac". Also an ABSENCE scan: `UpdateRow.tsx` must not import `Banner`, and must not contain `hv-overlay`/`hv-dialog` or `fixed` as a class word.
- [ ] **Step 2:** FAIL (files absent). **Step 3:** write the record (Task 6 makes the scan pass). **Step 5:** commit together with Task 6.

---

### Task 6: The row and the Changelog controls

**Files:**
- Create: `src/renderer/src/components/UpdateRow.tsx`
- Modify: `src/renderer/src/components/ChatView.tsx` (mount above the `SessionPulse` block, ~line 1381), `src/renderer/src/components/ChangelogView.tsx`
- Test: `tests/update-copy.test.ts` (from Task 5) plus `tests/update-row.test.ts` (pure `rowView(state): null | {text, action?, note?}` exported from `UpdateRow.tsx`)

**Interfaces:**
- Consumes: `window.hv.updateGet/onUpdateState/updateInstall/updateDownload/updateCheck/updateSetAuto`; `UpdateState` type imported from `src/main/update/state` (import-free module, safe in the renderer).
- Produces: `rowView(s: UpdateState): null | { text: string; action?: { label: string; kind: "install" | "download" }; note?: string }`

- [ ] **Step 1: Failing test (`tests/update-row.test.ts`)**

```ts
import { rowView } from "../src/renderer/src/components/UpdateRow";
import { initialState } from "../src/main/update/state";
const s = (phase: any, gate = { blockedBy: [], terminalsOpen: false, armed: false }) => ({ ...initialState("auto", true), phase, gate });
it("nothing to say → no row (idle, checking, error — background errors stay off screen)", () => {
  for (const p of [{ k: "idle" }, { k: "checking", manual: false }, { k: "error", message: "x", manual: false }, { k: "error", message: "x", manual: true }])
    expect(rowView(s(p))).toBeNull();
});
it("ready and clear → Restart to update", () => {
  expect(rowView(s({ k: "ready", version: "0.3.0" }))).toEqual({ text: "HappyVibe 0.3.0 is ready", action: { label: "Restart to update", kind: "install" } });
});
it("ready but blocked → the waiting sentence, no install verb", () => {
  const v = rowView(s({ k: "ready", version: "0.3.0" }, { blockedBy: ["A", "B"], terminalsOpen: false, armed: false }))!;
  expect(v.action?.label).toBe("Restart when the 2 running sessions finish");
});
it("open terminals add a note", () => {
  expect(rowView(s({ k: "ready", version: "0.3.0" }, { blockedBy: [], terminalsOpen: true, armed: false }))!.note).toBe("open terminals will close");
});
it("available → Download (auto off, or a deb)", () => {
  expect(rowView(s({ k: "available", version: "0.3.0" }))).toEqual({ text: "HappyVibe 0.3.0 is out", action: { label: "Download", kind: "download" } });
});
it("dev-disabled never shows a row", () => {
  expect(rowView({ ...s({ k: "ready", version: "0.3.0" }), mode: "disabled" })).toBeNull();
});
```

- [ ] **Step 2:** FAIL. **Step 3: Implement.**
  - `UpdateRow.tsx`: subscribe on mount (`updateGet()` then `onUpdateState`). Local `hidden` state for the ✕ (this run only; never persisted). Render the SAME wrapper the pulse uses (`flex items-center justify-center gap-2 px-6 text-sm`), text `font-bold`, action as the pulse's underlined `text-ink-soft` button, note in `text-ink-soft`, ✕ copying the pulse's dismiss button classes. No new colours, no icon library, no animation beyond what the pulse already has.
  - `ChatView.tsx`: `<UpdateRow />` immediately above the pulse block, rendered when `crashed === null` (same precedence rule as the pulse: it yields to the crash banner).
  - `ChangelogView.tsx`: under the pins line, one row in `text-sm text-ink-soft`: `Last checked 12 min ago · Check now` (a relative time from `lastCheckedAt`; `Checking…` while `checking`; `You're on the latest version.` after a manual `none`; the manual error message verbatim in the same line), then a checkbox labelled `Download updates automatically` styled like the existing settings checkboxes (`grep -rn 'type="checkbox"' src/renderer/src/components | head -3` and copy the classes). In `mode === "disabled"` show only `Updates are off in development builds.` Rewrite the component's doc comment: the "explicitly not here" paragraph is now superseded by §38.
- [ ] **Step 4:** `npx vitest run tests/update-row.test.ts tests/update-copy.test.ts tests/mod-key-copy.test.ts > /tmp/v.log 2>&1; echo EXIT=$?` → PASS. `npm run build` → 0.
- [ ] **Step 5:** Commit `feat(§38): the update row in the composer stack, and Check now on the Changelog page`.

---

### Task 7: The release workflow (Windows + Linux legs) and the changelog extractor

**Files:**
- Create: `scripts/changelog-entry.mjs`, `.github/workflows/release.yml`
- Test: `tests/changelog.test.ts` (extend), `tests/release-config.test.ts` (extend)

**Interfaces:**
- Produces: `changelogEntry(md: string, version: string): string | null` (exported). CLI: `node scripts/changelog-entry.mjs <version>` prints the entry body (without the heading) or exits 1.

- [ ] **Step 1: Failing tests**

```ts
// tests/changelog.test.ts (append)
import { changelogEntry } from "../scripts/changelog-entry.mjs";
it("the release body is exactly the top released entry", () => {
  const body = changelogEntry(MD, PKG.version)!;
  expect(body).toBeTruthy();
  expect(body).not.toMatch(/^## \[/m);          // stops before the next heading
  expect(body).toContain("Runtime:");            // §30: every entry names the pins
});
it("an unknown version yields null", () => expect(changelogEntry(MD, "9.9.9")).toBeNull());
```

```ts
// tests/release-config.test.ts (append)
const wf = parse(readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8"));
it("fires on v* tags only", () => expect(wf.on).toEqual({ push: { tags: ["v*"] } }));
it("builds Windows and Linux, never macOS (signing is local, §4)", () => {
  const runners = Object.values(wf.jobs).map((j: any) => j["runs-on"]);
  expect(runners).toEqual(expect.arrayContaining(["windows-latest", "ubuntu-latest"]));
  expect(runners.join()).not.toMatch(/macos/);
});
it("refuses a tag that disagrees with package.json, and runs the suite before packaging", () => {
  const text = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  expect(text).toMatch(/package\.json/);
  expect(text.indexOf("npm test")).toBeLessThan(text.indexOf("--publish always"));
});
it("uses only the built-in token — no Apple secret ever reaches GitHub", () => {
  const text = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  expect(text).toMatch(/GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  expect(text).not.toMatch(/APPLE_|CSC_LINK/);
});
it("asserts its own updater metadata exists", () => {
  const text = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
  expect(text).toMatch(/latest\.yml/);
  expect(text).toMatch(/latest-linux\.yml/);
});
```

- [ ] **Step 2:** FAIL. **Step 3: Implement.**
  - `changelog-entry.mjs`: find `## [<version>]`, take the lines up to the next `^## \[`, trim. Export the function and run as a CLI when `import.meta.url === pathToFileURL(process.argv[1]).href`.
  - `release.yml`: `on: push: tags: [v*]`, `permissions: contents: write`. A `verify` job on ubuntu checks `"v$(node -p "require('./package.json').version")" == "$GITHUB_REF_NAME"`. Then `windows` + `linux` jobs (`needs: verify`) copy `ci.yml`'s setup (node 24, electron cache, both `npm ci`), run `npm test`, `npm run build`, then `npx electron-builder --win --publish always` (Windows: through `node build/win-build.mjs` semantics — it's unsigned, so plain electron-builder with the yml is fine) / `--linux --publish always` with `env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Then `test -f release/latest.yml` / `test -f release/latest-linux.yml` + the exe / AppImage / deb exist. A final `notes` job sets the draft's body: `gh release edit "$GITHUB_REF_NAME" --draft --notes "$(node scripts/changelog-entry.mjs ${GITHUB_REF_NAME#v})"`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `ci(§38): a tag builds Windows and Linux into a draft release whose notes are the changelog entry`.

---

### Task 8: `npm run release:mac`

**Files:**
- Create: `scripts/release-mac.mjs`
- Modify: `package.json` (`"release:mac": "node scripts/release-mac.mjs"`)
- Test: `tests/release-mac.test.ts`

**Interfaces:**
- Produces: `macReleasePreflight(f: { clean: boolean; headTags: string[]; version: string; identities: string; profileOk: boolean; ghToken?: string }): { ok: true; identity: string } | { ok: false; problems: string[] }` and `missingMacArtifacts(files: string[], version: string): string[]`.

- [ ] **Step 1: Failing test**

```ts
import { macReleasePreflight, missingMacArtifacts } from "../scripts/release-mac.mjs";
const ID = '  1) ABC "Developer ID Application: Guilhem Duche (BZGBG4WG68)"';
const good = { clean: true, headTags: ["v0.2.0"], version: "0.2.0", identities: ID, profileOk: true, ghToken: "t" };
it("all good → the Developer ID name", () => {
  expect(macReleasePreflight(good)).toEqual({ ok: true, identity: "Developer ID Application: Guilhem Duche (BZGBG4WG68)" });
});
it("an Apple Development cert alone is refused, naming the fix", () => {
  const r = macReleasePreflight({ ...good, identities: '  1) X "Apple Development: Guilhem Duche (BZGBG4WG68)"' });
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).toMatch(/Developer ID Application/);
});
it.each([
  [{ clean: false }, /uncommitted/],
  [{ headTags: [] }, /v0\.2\.0/],
  [{ headTags: ["v0.1.9"] }, /v0\.2\.0/],
  [{ profileOk: false }, /notarytool store-credentials happyvibe/],
  [{ ghToken: undefined }, /GH_TOKEN/],
])("refuses %o", (patch, msg) => {
  const r = macReleasePreflight({ ...good, ...patch } as any);
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).toMatch(msg);
});
it("a dmg-only build is incomplete — the updater needs the zip, its blockmap and latest-mac.yml", () => {
  expect(missingMacArtifacts(["HappyVibe-0.2.0-arm64.dmg"], "0.2.0")).toEqual(
    expect.arrayContaining(["latest-mac.yml", "HappyVibe-0.2.0-arm64-mac.zip", "HappyVibe-0.2.0-arm64-mac.zip.blockmap"]),
  );
  expect(missingMacArtifacts(["HappyVibe-0.2.0-arm64.dmg", "HappyVibe-0.2.0-arm64-mac.zip", "HappyVibe-0.2.0-arm64-mac.zip.blockmap", "latest-mac.yml"], "0.2.0")).toEqual([]);
});
```

- [ ] **Step 2:** FAIL. **Step 3: Implement** `release-mac.mjs`: gather facts (`git status --porcelain`, `git tag --points-at HEAD`, `security find-identity -v -p codesigning`, `xcrun notarytool history --keychain-profile happyvibe` exit code, `process.env.GH_TOKEN`), run the preflight, print every problem and exit 1 on failure. Otherwise: `npm run build`, then `npx electron-builder --mac --publish always -c.mac.identity="<name minus 'Developer ID Application: '>" -c.mac.notarize=true` with env `HV_MAC_IDENTITY=<full name>`, `APPLE_KEYCHAIN_PROFILE=happyvibe`, `CSC_IDENTITY_AUTO_DISCOVERY=false`. Then `missingMacArtifacts(readdirSync("release"))` must be empty, and `codesign --verify --deep --strict --verbose=2` plus `spctl -a -vv` on `release/mac-arm64/HappyVibe.app` must print `source=Notarized Developer ID`. Exit non-zero on any failure (never pipe it to `tail`). Only run as a CLI when invoked directly (same guard as Task 7).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `build(§38): release:mac signs, notarizes and uploads the macOS leg from this Mac`.

---

### Task 9: Open-source files, docs and the retro tag

**Files:**
- Create: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, contact `guilhem.duche@gmail.com`), `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/workflows/dco.yml`, `docs/validation/up1.md`
- Modify: `README.md` (Download + Contributing sections), `.claude/commands/release.md` (phase 6), `CLAUDE.md` (`## Releasing`: 3 lines)
- Test: `tests/oss-files.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { existsSync, readFileSync } from "node:fs";
it("the community files exist", () => {
  for (const f of ["CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", ".github/ISSUE_TEMPLATE/bug_report.yml", ".github/ISSUE_TEMPLATE/feature_request.yml", ".github/workflows/dco.yml"])
    expect(existsSync(f), f).toBe(true);
});
it("CONTRIBUTING asks for DCO sign-off and states BOTH installs", () => {
  const c = readFileSync("CONTRIBUTING.md", "utf8");
  expect(c).toMatch(/git commit -s/);
  expect(c).toMatch(/cd pi-runtime && npm ci/);
  expect(c).not.toMatch(/\bCLA\b.*required/i);
});
it("SECURITY routes reports to private vulnerability reporting, not public issues", () => {
  expect(readFileSync("SECURITY.md", "utf8")).toMatch(/security\/advisories\/new/);
});
it("the README links the latest release", () => {
  expect(readFileSync("README.md", "utf8")).toMatch(/github\.com\/guiguito\/HappyVibe\/releases\/latest/);
});
```

- [ ] **Step 2:** FAIL. **Step 3: Write** the files.
  - CONTRIBUTING: setup (both installs; Linux needs `build-essential python3`), `npm run gate`, the live tests need a key in `.env` and are optional for contributors, `git commit -s` plus what DCO means in one paragraph, and the "match the surrounding code" rule.
  - SECURITY: report at `https://github.com/guiguito/HappyVibe/security/advisories/new`; scope = the permission layer, path confinement, and MCP secret handling.
  - Issue templates: bug asks for version (Changelog page), OS, and steps; `config.yml` has `blank_issues_enabled: false`.
  - `dco.yml`: on `pull_request`, for each commit in `github.event.pull_request.base.sha..head.sha`, fail if the message lacks `Signed-off-by:`. Plain `git log`, no third-party action.
  - README: "Download" section linking `releases/latest`, with one line per OS (macOS: signed and notarized; Windows: the SmartScreen paragraph; Linux: AppImage needs `libfuse2`, deb installs clean).
  - `release.md` phase 6: after the hand-back, the three follow-up steps: `git push --follow-tags` → `GH_TOKEN=… npm run release:mac` → read the draft → Publish.
  - `CLAUDE.md` `## Releasing`: three lines — mac signs locally via `release:mac` (Developer ID + `happyvibe` notarytool profile); CI builds Windows/Linux into the draft on the tag; the updater is `src/main/update/`, off in dev, and `HV_UPDATE_FAKE=ready:0.3.0` shows the row for a GUI pass.
  - `docs/validation/up1.md`: the manual gates (below), each with a blank result line to fill in.
  - `git tag v0.1.0 d987a92` (local only; it gets pushed with the first `--follow-tags`).
- [ ] **Step 4:** PASS. **Step 5:** Commit `docs(§18): open-source files, DCO check, and the download path`.

---

### Task 10: Gate

- [ ] `npm run gate > /tmp/gate.log 2>&1; echo EXIT=$?` → 0. Read the file count and the duration (~306 files / ~50 s baseline).
- [ ] `npm run live:why` → expected **empty** (nothing Pi-facing changed). Say so explicitly.
- [ ] `npm run build:unpack` → `app-update.yml` is present in `Contents/Resources`, and the ad-hoc bundle still launches with a working microphone (the §27 regression the afterPack edit risks).

---

## Manual gates (Guilhem, in order — recorded in `docs/validation/up1.md`)

1. Xcode › Settings › Accounts › team BzApps Ltd › Manage Certificates (Account Holder only) › **+ Developer ID Application**. Confirm with `security find-identity -v -p codesigning`.
2. `xcrun notarytool store-credentials happyvibe --apple-id <id> --team-id 4K6P6U479K` (the cert's OU; `BZGBG4WG68` is the member ID and returns 403`.
3. Web box: per-IP rate limit plus a raised `maxConcurrency` on `firecrawl.bzapps.eu`.
4. Flip the repo to public (`gh repo edit guiguito/HappyVibe --visibility public --accept-visibility-change-consequences`) and turn on Settings › Code security › **Private vulnerability reporting**.
5. `/release minor` → `git push --follow-tags` → wait for `release.yml` → `GH_TOKEN=$(gh auth token) npm run release:mac` → read the draft → **Publish**.
6. On a second Mac, open the downloaded dmg: no Gatekeeper warning; the microphone captures; one MCP credential read prompts once and "Always Allow" sticks.
7. Round-trip: install `0.2.0`, publish `0.2.1`, and within 4 h (or via Check now) the row appears and a restart lands on `0.2.1` with sessions restored. Record the delta download size.

## GUI verification (observable assertions)

Run with `HV_UPDATE_FAKE=ready:0.3.0 npm run dev` unless stated.

- **Chat pane, composer stack:** one line reads **"HappyVibe 0.3.0 is ready · Restart to update"**, in the same type and colours as the feedback pulse (bold text, underlined soft-ink action, small ✕). It sits directly above where the pulse sits. **Absent:** any red/amber banner, any modal, any toast, any `⌘` glyph.
- **Blocked:** start a turn (a long `sleep 20` via bash), then click Restart → the line changes to **"Restart when the running session finishes"** while the turn runs, and nothing quits. Regression sequence: open two sessions, make both busy, click Restart, stop one → it still says "…finishes" (singular), and only after the second ends does the fake install log `installed` in the Audit log.
- **✕:** hides the row. Reload the renderer (⌘R): the row is back (hide is per run, main keeps state). **Absent:** any "never show again".
- **`HV_UPDATE_FAKE=available:0.3.0`:** the row reads **"HappyVibe 0.3.0 is out · Download"**. **Absent:** the word "Restart".
- **Changelog page:** under the pins, **"Updates are off in development builds."** (plain dev run) — and with the fake set, **"Last checked … · Check now"** plus the **"Download updates automatically"** checkbox, checked by default. Unchecking it and reopening the page keeps it unchecked; `config.json` then contains `"autoUpdate": false`, and re-checking removes the key.
- **Audit log page:** the fake install writes an `app.update` row, and a background error writes a row with **no on-screen message anywhere else**.
- **Settings → Built-in tools → Web, custom mode with `fc.me` (no scheme):** a web tool call in chat fails with **"Your custom web service URL isn't valid — fix it in Settings → Built-in tools…"**. **Absent:** any request to `firecrawl.bzapps.eu` (check the main-process log / network).
