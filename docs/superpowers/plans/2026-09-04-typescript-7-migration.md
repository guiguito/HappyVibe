# TypeScript 5.9 → 6 → 7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the gate's only TypeScript consumer — the three `tsc --noEmit` passes — from TypeScript 5.9.3 to the native 7.0.2 compiler, in three bisectable commits, with zero source changes.

**Architecture:** TS 7 removes `baseUrl`, which `tsconfig.web.json` and `tsconfig.extensions.json` both set; the fix is to delete it and `./`-prefix every `paths` entry so `paths` resolves relative to the tsconfig file (the same directory `"."` meant). That rewrite is compiler-neutral, so it lands first on 5.9. Then `typescript` is bumped to `^6.0.3` (deprecations become errors, and the list must be empty) and then to `^7.0.2` (native compiler, no JavaScript API). Nothing else in the tree loads the `typescript` JS API, so the blast radius is the gate.

**Tech Stack:** TypeScript 5.9.3 → 6.0.3 → 7.0.2 (`npm`), `@electron-toolkit/tsconfig@2.0.0` base, vitest 5 (`tests/extensions-typecheck.test.ts`), the `npm run gate` chain.

**Spec:** Notion page "TypeScript 6 → 7 migration" (`3d1d33dfffca8179b034d870749fec02`, under Happyibe), rewritten 2026-09-04 with the measurements and the four decisions. Every number below was measured there against the `main` checkout, not estimated.

## Global Constraints

- **No source file changes.** Only `tsconfig.web.json`, `tsconfig.extensions.json`, `package.json`, `package-lock.json` and `CLAUDE.md` change. If a step wants to edit anything under `src/` or `pi-runtime/extensions/`, stop: the measurement said zero errors, so something else is wrong.
- **Never set `ignoreDeprecations`.** A red under TS 6 is the list of things still to fix; after Task 1 that list is empty (measured).
- **Never patch vendored source** under `pi-runtime/node_modules` (CLAUDE.md pin-bump rule).
- **Version spec is a caret**: `"typescript": "^6.0.3"` then `"^7.0.2"`. Root devDeps use carets; exact pins are for runtime-coupled packages (esbuild, sherpa, MCP SDK).
- **Three commits, one variable each**: config rewrite on 5.9 · TS 6 · TS 7. Do not squash.
- **`npm run live:why` prints nothing for this branch** (tsconfig and `package.json` are not Pi-facing). Say so in the final report; do not run `npm run test:live`.
- **Never pipe a test or gate run to `tail`/`grep`.** Redirect to a log, `echo "EXIT=$?"`, then read the log.
- **The PRD is not touched** (decision 4): no PRD section owns build tooling. CLAUDE.md is the record.
- **Lint stays broken and is documented, not aliased** (decision 1). Do not add `@typescript/typescript6` or `@typescript/native` to `package.json`.

---

## Task 0: Install the worktree

A fresh worktree has no `node_modules` and no `pi-runtime/node_modules` (verified 2026-09-04: `ls node_modules` → "No such file or directory"). Every later task needs both.

**Files:** none changed.

- [ ] **Step 1: Install both trees**

```bash
npm install
(cd pi-runtime && npm ci)
```

Expected: both exit 0. `postinstall` runs `electron-builder install-app-deps`, `scripts/fix-pty-helper.mjs` and `scripts/build-mcp-oauth-bridge.mjs`.

- [ ] **Step 2: Confirm the baseline compiler and a green baseline gate**

```bash
./node_modules/.bin/tsc --version
L=/tmp/gate-baseline.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -8 $L
```

Expected: `Version 5.9.3`; `EXIT=0`; the vitest summary line reads roughly `3146 passed | 38 skipped` (the count from `132dd5f`). If the baseline is red, stop — this branch starts from a green `main` and a red baseline is not this migration's problem.

- [ ] **Step 3: Confirm `git status` is clean**

```bash
git status --short
```

Expected: empty. `npm install` must not have changed `package-lock.json`; if it did, the lockfile was stale on `main` and that is a separate fix.

---

## Task 1: Drop `baseUrl`, `./`-prefix `paths` (still on TS 5.9)

Compiler-neutral: measured green on 5.9, 6.0.3 and 7.0.2 with exactly this rewrite. TS 7's own diagnostic spells it: `TS5090: Non-relative paths are not allowed. Did you forget a leading './'?`.

**Files:**
- Modify: `tsconfig.web.json:14-19`
- Modify: `tsconfig.extensions.json:9-14`
- Test: `tests/extensions-typecheck.test.ts` (existing, unchanged — it asserts `include`, `noEmit` and the npm-script strings, none of which move)

**Interfaces:**
- Produces: two tsconfigs with no `baseUrl` key and only `./`-relative `paths` values. Tasks 2 and 3 rely on that being true.

- [ ] **Step 1: Rewrite `tsconfig.web.json`**

Replace the whole file with:

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.web.json",
  "include": [
    "src/renderer/src/env.d.ts",
    "src/renderer/src/**/*",
    "src/renderer/src/**/*.tsx",
    "src/preload/*.d.ts",
    "pi-runtime/extensions/hv-mcp.ts", "pi-runtime/extensions/hv-subagent-boundary.ts",
    "src/main/mcpCatalog.ts"
  ],
  "compilerOptions": {
    "composite": true,
    "jsx": "react-jsx",
    "paths": {
      "@renderer/*": [
        "./src/renderer/src/*"
      ]
    }
  }
}
```

The only two changes: the `"baseUrl": "."` line is gone, and `src/renderer/src/*` became `./src/renderer/src/*`. The `include` block is byte-identical to before.

- [ ] **Step 2: Rewrite `tsconfig.extensions.json`**

Replace the whole file with:

```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": ["pi-runtime/extensions/**/*.ts"],
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "paths": {
      "@earendil-works/pi-ai": ["./pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.d.ts"],
      "@earendil-works/pi-ai/*": ["./pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/*"],
      "@earendil-works/pi-agent-core": ["./pi-runtime/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/index.d.ts"]
    }
  }
}
```

The only changes: `"baseUrl": "."` gone, and each of the three `paths` values gains a leading `./`. The `include` value stays exactly `["pi-runtime/extensions/**/*.ts"]` — `tests/extensions-typecheck.test.ts` asserts it with `toEqual`.

- [ ] **Step 3: Assert the absence**

```bash
grep -n "baseUrl\|ignoreDeprecations" tsconfig*.json; echo "grep-exit=$?"
```

Expected: no lines printed and `grep-exit=1` (grep's "no match"). Any hit means a config still carries the removed option.

- [ ] **Step 4: Run the three typechecks on 5.9**

```bash
L=/tmp/tc1.log; npm run typecheck > $L 2>&1; echo "EXIT=$?"; grep -c "error TS" $L
```

Expected: `EXIT=0`, `0` errors. Then the pinning test alone:

```bash
L=/tmp/t1.log; npx vitest run tests/extensions-typecheck.test.ts > $L 2>&1; echo "EXIT=$?"; tail -6 $L
```

Expected: `EXIT=0`, `2 passed`.

- [ ] **Step 5: Run the gate**

```bash
L=/tmp/gate1.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -8 $L
```

Expected: `EXIT=0`, same test count as the Task 0 baseline.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.web.json tsconfig.extensions.json
git commit -m "chore(tsconfig): drop baseUrl, ./-prefix paths — TS 7 removes the option

Compiler-neutral: green on 5.9.3, 6.0.3 and 7.0.2 (measured against main
before the round). paths now resolves relative to the tsconfig file, which
is the directory baseUrl \".\" meant. No source change.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: Bump `typescript` to `^6.0.3`

TS 6 turns the options it deprecates into hard errors (`TS5101`) unless `ignoreDeprecations: "6.0"` is set. It is deliberately NOT set: after Task 1, the error list must be empty. TS 6 also changes defaults (`types` → `[]`, `noUncheckedSideEffectImports` → `true`); measured, none of the three configs is affected — the node and extensions configs set `types` explicitly and the web config's only ambient dependency is `vite/client`, referenced in `src/renderer/src/env.d.ts`.

**Files:**
- Modify: `package.json` (devDependencies `"typescript": "^5.9.3"` → `"^6.0.3"`)
- Modify: `package-lock.json` (by `npm install`)

**Interfaces:**
- Consumes: the two rewritten tsconfigs from Task 1.
- Produces: a tree where `./node_modules/.bin/tsc --version` prints `Version 6.0.3`.

- [ ] **Step 1: Bump**

```bash
npm install --save-dev typescript@^6.0.3
./node_modules/.bin/tsc --version
```

Expected: `Version 6.0.3`. Confirm `package.json` reads `"typescript": "^6.0.3"` (npm writes the caret from the `^` in the spec; if it wrote an exact `6.0.3`, edit it to `^6.0.3` by hand — the convention is caret).

- [ ] **Step 2: Typecheck — the deprecation list must be empty**

```bash
L=/tmp/tc2.log; npm run typecheck > $L 2>&1; echo "EXIT=$?"; grep "error TS" $L
```

Expected: `EXIT=0` and no `error TS` lines. If `TS5101` appears, a deprecated option survived Task 1 — fix the config, never add `ignoreDeprecations`. If any other error appears, TS 6's default changes reached something the measurement missed; read the error before touching anything, and remember the Global Constraint: no source changes.

- [ ] **Step 3: Run the gate**

```bash
L=/tmp/gate2.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -8 $L
```

Expected: `EXIT=0`, same test count as baseline.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): typescript 5.9.3 -> 6.0.3

Deprecated options are errors in 6 and ignoreDeprecations is deliberately
NOT set — the red list is the work, and after the baseUrl rewrite it is
empty. TS 6's new defaults (types [], noUncheckedSideEffectImports) touch
none of the three configs: node and ext set types explicitly, web's only
ambient is vite/client via env.d.ts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: Bump `typescript` to `^7.0.2`, document lint

TS 7 is the native Go compiler. The `typescript` package's `bin/tsc` is a shim that spawns a platform binary from `@typescript/typescript-<os>-<arch>` (twenty of them, declared as optional deps, so the lockfile carries all and `npm ci` picks the platform's). It ships **no JavaScript API**, which is why `npm run lint` (typescript-eslint peers `<6.1.0`) can no longer load at all — decision 1 documents this rather than aliasing.

**Files:**
- Modify: `package.json` (devDependencies `"typescript": "^6.0.3"` → `"^7.0.2"`)
- Modify: `package-lock.json` (by `npm install`)
- Modify: `CLAUDE.md:11-16` (the lint entry), `CLAUDE.md:10` (the typecheck line)
- Test: `tests/extensions-typecheck.test.ts` (unchanged; must stay green)

**Interfaces:**
- Consumes: Task 2's tree.
- Produces: `./node_modules/.bin/tsc --version` prints `Version 7.0.2`; `npm run typecheck` completes in about a second instead of seven.

- [ ] **Step 1: Bump**

```bash
npm install --save-dev typescript@^7.0.2
./node_modules/.bin/tsc --version
ls node_modules/@typescript/ | head
```

Expected: `Version 7.0.2`; the `@typescript/` directory holds `typescript-darwin-arm64` (on an Apple Silicon Mac) and nothing that fails to install. Confirm `package.json` reads `"typescript": "^7.0.2"`.

- [ ] **Step 2: Confirm the JS API is really gone (this is the fact CLAUDE.md will state)**

```bash
node -e 'const ts = require("typescript"); console.log(JSON.stringify(Object.keys(ts)))'
npx eslint --no-cache src/main/index.ts; echo "EXIT=$?"
```

Expected — **and this is the one thing the round predicted wrong, corrected here from execution**: the require does **not** throw. It resolves to `lib/version.cjs` and prints exactly `["version","versionMajorMinor"]`, so a version probe succeeds while `createProgram`, `transpileModule` and every other compiler function is `undefined`. eslint then exits `2` with `typescript-eslint does not support TS 7.0`, citing Microsoft's side-by-side page and issue #10940. Both facts go into CLAUDE.md — the loud refusal *and* the version stub, because the stub is the one that can mislead a script.

- [ ] **Step 3: Typecheck, and read the timing**

```bash
L=/tmp/tc3.log; time npm run typecheck > $L 2>&1; echo "EXIT=$?"; grep -c "error TS" $L
```

Expected: `EXIT=0`, `0` errors, wall time roughly 1–2 s where Task 1 took ~7 s (measured on `main`: node 1.5 s → 0.2 s, web 2.4 s → 0.2 s, ext 3.0 s → 0.6 s). If TS 7 reports an error TS 6 did not, it is a checker difference (typescript-go `CHANGES.md`); read it before acting and respect the no-source-change constraint — the measured result was zero, so an error here means the tree moved since the measurement.

- [ ] **Step 4: Plant-a-bug check on the extensions config**

This is the verification housekeeping item 1 used when `tsconfig.extensions.json` was added: the gate must go red under the new compiler when the bridge is wrong.

```bash
echo 'const hvPlantedBug: number = "not a number";' >> pi-runtime/extensions/happyvibe-bridge.ts
L=/tmp/plant.log; npm run typecheck:ext > $L 2>&1; echo "EXIT=$?"; grep "happyvibe-bridge.ts" $L | head -3
git checkout -- pi-runtime/extensions/happyvibe-bridge.ts
git status --short pi-runtime/extensions/
```

Expected: `EXIT=2` (or any non-zero), one `error TS2322` line naming `pi-runtime/extensions/happyvibe-bridge.ts`, then a clean `git status` for that directory after the checkout. Do not commit with the planted line — the final `git status --short` must not list the bridge.

- [ ] **Step 5: Run the pinning test and the gate**

```bash
L=/tmp/t3.log; npx vitest run tests/extensions-typecheck.test.ts > $L 2>&1; echo "EXIT=$?"; tail -6 $L
L=/tmp/gate3.log; npm run gate > $L 2>&1; echo "EXIT=$?"; tail -8 $L
```

Expected: both `EXIT=0`; `2 passed` for the pin; the gate's test count equals the baseline.

- [ ] **Step 6: Edit `CLAUDE.md` — the lint entry**

In `CLAUDE.md`, replace lines 11–16 (the bullet beginning `- \`npm run lint\` / \`npm run format\` are SCAFFOLD LEFTOVERS`) with:

```markdown
- `npm run lint` / `npm run format` are SCAFFOLD LEFTOVERS — don't run them casually.
  `eslint.config.mjs` is untouched electron-vite boilerplate from the initial commit: lint reports
  86 errors + 19,839 warnings (mostly `prettier/prettier`) and walks `release/` build output, and
  `npm run format` rewrites 281 of 329 tracked files — an 85%-of-repo diff that buries whatever
  you actually changed. Neither is in `gate` or CI. Leave them alone unless you are deliberately
  doing a formatting pass, on its own branch.
  **Since TypeScript 7 (2026-09-04) lint cannot even LOAD.** TS 7 is the native compiler and ships
  no JavaScript API (`require("typescript")` throws); typescript-eslint peers on `<6.1.0`. That is
  decided, not an oversight: the gate is the only consumer of `typescript` (electron-vite uses
  esbuild, jiti runs the catalog scripts), so a second TypeScript in the tree to keep an unusable
  lint alive was refused. If lint is ever revived, use Microsoft's alias recipe THEN —
  `"typescript": "npm:@typescript/typescript6@^6"` plus `"@typescript/native": "npm:typescript@^7"`
  with the three `typecheck:*` scripts pointed at the native binary — and re-check typescript-eslint's
  peer range first. Spec: Notion "TypeScript 6 → 7 migration".
```

The first six lines are byte-identical to today; only the bold paragraph is new.

- [ ] **Step 7: Edit `CLAUDE.md` — the typecheck line**

Replace line 10:

```markdown
- `npm run typecheck` (node + web + ext; the first two pass `--composite false` — don't hand-roll the raw `tsc` calls)
```

with:

```markdown
- `npm run typecheck` (node + web + ext; the first two pass `--composite false` — don't hand-roll the raw `tsc` calls).
  Runs on TypeScript 7 (native, ~1 s for all three). TS 7 REMOVED `baseUrl`, so `paths` entries are
  `./`-relative to their tsconfig — never re-add `baseUrl`, and never set `ignoreDeprecations`; a
  deprecation red is the list of work, not noise.
```

- [ ] **Step 8: Assert the record's absences**

```bash
grep -n "baseUrl\|ignoreDeprecations" tsconfig*.json; echo "tsconfig-grep-exit=$?"
grep -n "typescript6\|@typescript/native" package.json; echo "alias-grep-exit=$?"
grep -c "TypeScript 7" CLAUDE.md
```

Expected: both grep exits `1` (no matches — no removed option in any tsconfig, no alias in `package.json`), and `CLAUDE.md` mentions `TypeScript 7` at least twice.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json CLAUDE.md
git commit -m "chore(deps): typescript 6.0.3 -> 7.0.2 (native compiler)

Gate green, all three typechecks ~1 s (was ~7 s). Plant-a-bug verified:
a type error in happyvibe-bridge.ts turns typecheck:ext red under 7.

TS 7 ships no JavaScript API, so npm run lint now fails to load rather
than reporting its 86 errors. Decided (round 2026-09-04): document, do
not alias — lint is a scaffold leftover outside gate and CI, and the gate
is the package's only consumer. CLAUDE.md carries the recipe for the day
lint is revived.

live:why prints nothing for this branch (tsconfig and package.json are
not Pi-facing), so the live batch was not run. No CHANGELOG entry: nothing
here is user-facing.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verification

**Automated (every task):** `npm run gate` green with the baseline test count; `tests/extensions-typecheck.test.ts` green; Task 3 step 4's plant-a-bug goes red naming the bridge under TS 7.

**Live-Pi batch:** not required. `npm run live:why` diffs `main...HEAD` for `pi-runtime/extensions/`, `pi-runtime/package*.json`, `src/main/pi/` and live test files; this branch changes none of them, so the command prints nothing. State that in the final report rather than silently omitting the batch.

**GUI pass:** none applies, and this is stated rather than assumed. The change touches no file under `src/renderer/` or `src/main/`; the built app is byte-identical because electron-vite transpiles with esbuild and never consults `typescript`. There is nothing on screen that can be true or false about this change.

**Observable assertions on the surfaces that DO change (the terminal and the tree):**

- `./node_modules/.bin/tsc --version` prints `Version 7.0.2` at the end of Task 3.
- `npm run typecheck` completes in about a second and prints no `error TS` line.
- **Absence:** `grep -n "baseUrl\|ignoreDeprecations" tsconfig*.json` prints nothing — the option this round exists to remove is gone from every config, and the escape hatch that would hide it was never used.
- **Absence:** `grep -n "typescript6\|@typescript/native" package.json` prints nothing — decision 1 (no alias) held.
- **Absence:** `git diff main...HEAD --stat` lists no file under `src/` or `pi-runtime/extensions/` — the no-source-change constraint held.
- `node -e 'require("typescript")'` throws — the fact CLAUDE.md now states is true of the installed package.

**The one regression this design risks, as a sequence someone can perform:** CI on a fresh machine. `git clone`, `npm ci`, `cd pi-runtime && npm ci`, `npm run build`. TS 7's platform binary arrives via an optional dependency selected by `os`/`cpu` from the lockfile; if the lockfile committed in Task 3 lacks the platform packages, `tsc` fails with "could not find native binary" on the runner while working locally. The check is the CI run on the PR (`.github/workflows/ci.yml`, macos-latest, `npm ci` then `npm run build`) — read it before merging rather than trusting the local gate, per the standing "CI is unwatched" note.

## Execution record (2026-09-04, commits `6253b6c` · `3153628` · `8ceff46`)

Executed as written. Gate green at every step, `3146 passed | 38 skipped` unchanged from the baseline across all three. Typecheck went 7 s → **1.16 s** (node 0.19, web 0.25, ext 0.48). Plant-a-bug red under 7 with `TS2322` naming `happyvibe-bridge.ts:2264`, clean after checkout. Every absence assertion held: no `baseUrl`/`ignoreDeprecations` in any tsconfig, no alias in `package.json`, no `src/` or `pi-runtime/extensions/` file in `git diff main...HEAD`. `npm run live:why` printed nothing, so the live batch was correctly not run.

**Two things execution found that the plan did not predict.** The `require("typescript")` behaviour above — a version stub rather than a throw. And the **785-line lockfile diff** for a one-word version change, which has two innocent causes: the 20 `@typescript/typescript-<os>-<arch>` native binaries arrive as `os`/`cpu`-gated optional deps (both darwin variants present, which is what the CI risk below needed), and npm **nested** the whole typescript-eslint tree under `@electron-toolkit/eslint-config-ts/node_modules/` because the hoisted position can no longer satisfy its `typescript <6.1.0` peer. Nothing was removed. `npm ci --dry-run` exits 0.

**The named CI regression risk is still open by design** — it can only be closed by a runner. `npm ci --dry-run` validating locally is evidence, not the check; read the CI run on the PR before merging.

## Self-review against the spec

- Spec "Order of work" steps 0–3 → Tasks 0–3. Step 4 (eslint peer) → decision 1, Task 3 steps 6 and 8.
- Spec "Gate" (say `live:why` prints nothing; plant-a-bug) → Verification and Task 3 step 4.
- Spec decisions 1–4 → Global Constraints, Task 3 steps 6–9, and the explicit PRD non-edit recorded in the round.
- No placeholders: every step carries its command and its expected output.
