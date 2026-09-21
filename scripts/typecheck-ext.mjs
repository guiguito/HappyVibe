/**
 * `npm run typecheck:ext` — tsconfig.extensions.json, on every platform.
 *
 * The point of this check is pi-runtime/extensions/ (housekeeping item 1, 2026-08-30:
 * that directory was typechecked by NOTHING and shipped a real TDZ ReferenceError
 * across the §12 refusal paths). But the config necessarily pulls pi-subagents' RAW
 * .ts sources into the program — the bridge imports three of its modules by relative
 * path — so tsc also reports diagnostics from code we do not own.
 *
 * CLAUDE.md's standing rule is NEVER to patch vendored source, so those diagnostics are
 * never actionable, and a pin bump where upstream's own .ts is not clean against Pi's
 * newer types must not block the gate. They are PRINTED with a count, never swallowed:
 * a suppression nobody can see is the bug this repo keeps paying for.
 *
 * Pi 0.86.1 + pi-subagents 0.64.0 is exactly that case — 0.86 made ToolResultMessage a
 * conditional type, which collapses a narrowing in upstream's setupAbortResumeParams to
 * `never`. Defensive code at runtime, wrong-by-type at 0.86. Pinned by
 * tests/extensions-typecheck.test.ts.
 *
 * The `paths` shim escape hatch does NOT reach this: `paths` only rewrites bare
 * specifiers, and the modules that pull the failing file in arrive by relative path
 * (which is itself load-bearing — pi-subagents' exports map does not list them).
 *
 * tsc is launched through its own bin with process.execPath, same reason as
 * scripts/test.mjs: no shell means no quoting differences across platforms.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const manifest = require.resolve("typescript/package.json");
// bin.tsc, never a hardcoded path: TS 7 moved its own entry points once already.
const bin = JSON.parse(readFileSync(manifest, "utf8")).bin;
const tsc = path.resolve(path.dirname(manifest), typeof bin === "string" ? bin : bin.tsc);

// argv[2] overrides the project, so the filter itself can be tested against a fixture
// instead of by planting a broken file in the real extensions directory.
const project = process.argv[2] ?? "tsconfig.extensions.json";
const r = spawnSync(process.execPath, [tsc, "--noEmit", "-p", project, "--pretty", "false"], {
  encoding: "utf8",
});

// Both separators: tsc prints native paths, and Windows runs this too.
const VENDORED = /pi-runtime[\\/]node_modules[\\/]/;
// `file(line,col): error TSxxxx: msg` — a diagnostic ABOUT a file.
const FILE_DIAGNOSTIC = /^\S.*\(\d+,\d+\): (error|warning) TS\d+:/;
// `error TSxxxx: msg` with no file — a compiler-level failure (bad config, missing
// project). It names no path, so it can never be vendored, and reading it as such is
// how a broken config passed silently once already.
const GLOBAL_ERROR = /^error TS\d+:/;

const lines = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n");
const ours = [];
const vendored = [];
// Continuation lines of a multi-line message carry no prefix, so they inherit the
// verdict of the line that opened them.
let bucket = ours;
for (const line of lines) {
  if (!line.trim()) continue;
  if (GLOBAL_ERROR.test(line)) bucket = ours;
  else if (FILE_DIAGNOSTIC.test(line)) bucket = VENDORED.test(line) ? vendored : ours;
  bucket.push(line);
}

if (vendored.length) {
  console.log(
    `[hv] ${vendored.length} diagnostic line(s) from pi-runtime/node_modules — vendored source, not ours to fix:`,
  );
  console.log(vendored.join("\n"));
}
if (ours.length) {
  console.log(ours.join("\n"));
  process.exit(1);
}
// A crash with nothing parseable must never read as clean.
if (r.status !== 0 && vendored.length === 0) {
  console.log(`${r.stdout ?? ""}${r.stderr ?? ""}`.trim() || `tsc exited ${r.status}`);
  process.exit(r.status ?? 1);
}
process.exit(0);
