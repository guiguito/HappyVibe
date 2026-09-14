/**
 * `npm test` — the NON-LIVE suite, on every platform.
 *
 * Both provider keys are forced to `sk-REPLACE`. tests/liveModel.ts treats that value
 * as ABSENT for either provider, and its .env loader only fills vars that are UNSET,
 * so this value wins and all 17 live files skip themselves. BOTH must be set: with
 * only one neutralised, the day a key for the other provider lands in .env this
 * script silently stops being the non-live suite — 25-40 s becomes ~6 min and starts
 * spending money, with nothing in the output saying so. Pinned by
 * tests/test-script.test.ts.
 *
 * This used to be an inline `VAR=… vitest run` in package.json, which is POSIX shell
 * syntax: on Windows it fails with "'DEEPSEEK_API_KEY' is not recognized as an
 * internal or external command" before vitest ever starts (Windows round, 2026-09-14).
 *
 * vitest is launched through its own entry with `process.execPath` rather than through
 * `npx` + `shell: true` — no shell means no quoting differences between PowerShell,
 * cmd and bash, which is the entire point of this file.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

// Derived from vitest's OWN manifest, never hardcoded: `vitest/vitest.mjs` is a real
// file but its exports map does not list it, so resolving that subpath throws
// ERR_PACKAGE_PATH_NOT_EXPORTED (an exports map gates bare specifiers — the same trap
// the pi-subagents relative imports are documented for). `./package.json` IS exported,
// and `bin.vitest` is what npm itself would link.
const require = createRequire(import.meta.url);
const manifest = require.resolve("vitest/package.json");
const bin = JSON.parse(readFileSync(manifest, "utf8")).bin;
const vitest = path.resolve(path.dirname(manifest), typeof bin === "string" ? bin : bin.vitest);

const r = spawnSync(process.execPath, [vitest, "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, DEEPSEEK_API_KEY: "sk-REPLACE", OPENROUTER_API_KEY: "sk-REPLACE" },
});

// Killed by a signal (Ctrl-C) reports status null — exit non-zero rather than 0.
process.exit(r.status ?? 1);
