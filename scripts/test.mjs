/**
 * `npm test` — the NON-LIVE suite, on every platform.
 *
 * Both provider keys are forced to `sk-REPLACE`. tests/liveModel.ts treats that value
 * as ABSENT for either provider, and its .env loader only fills vars that are UNSET,
 * so this value wins and every live file skips itself. BOTH must be set: with
 * only one neutralised, the day a key for the other provider lands in .env this
 * script silently stops being the non-live suite — ~50 s becomes ~7-8 min and starts
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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Derived from vitest's OWN manifest, never hardcoded: `vitest/vitest.mjs` is a real
// file but its exports map does not list it, so resolving that subpath throws
// ERR_PACKAGE_PATH_NOT_EXPORTED (an exports map gates bare specifiers — the same trap
// the pi-subagents relative imports are documented for). `./package.json` IS exported,
// and `bin.vitest` is what npm itself would link.
const require = createRequire(import.meta.url);
const manifest = require.resolve("vitest/package.json");
const bin = JSON.parse(readFileSync(manifest, "utf8")).bin;
const vitest = path.resolve(path.dirname(manifest), typeof bin === "string" ? bin : bin.vitest);

const env = { ...process.env, DEEPSEEK_API_KEY: "sk-REPLACE", OPENROUTER_API_KEY: "sk-REPLACE" };
// Killed by a signal (Ctrl-C) reports status null — exit non-zero rather than 0.
const run = (args) => spawnSync(process.execPath, [vitest, "run", ...args], { stdio: "inherit", env }).status ?? 1;

const args = process.argv.slice(2);

/**
 * Windows only (or HV_TEST_SERIAL_PI=1 to try it elsewhere): the files that boot a real Pi
 * run ONE AT A TIME, after everything else has run in parallel. On the Windows runners a Pi
 * started while others boot sometimes hangs silently before its first line of output — the
 * test then dies at 30 s (builtins-contract, piclient, session-fork-contract; frequent since
 * Pi 1.5, never on macOS or Linux). PI_TIMING=1 makes every such Pi print its start-up
 * stages, so the next hang shows how far it got. The list is DERIVED from the files' own
 * text, never written down: a new real-Pi test joins the serial pass by existing.
 * An explicit file argument (`npm test -- <file>`) keeps the single parallel run.
 */
const serialPi = (process.platform === "win32" || process.env.HV_TEST_SERIAL_PI === "1") && args.length === 0;
if (!serialPi) process.exit(run(args));

const testsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests");
const piFiles = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => /PI_CLI_RELPATH|new PiClient\(/.test(readFileSync(path.join(testsDir, f), "utf8")))
  .map((f) => `tests/${f}`);
env.PI_TIMING = "1";
const rest = run(piFiles.flatMap((f) => ["--exclude", f]));
const pi = run(["--no-file-parallelism", ...piFiles]);
process.exit(rest || pi);
