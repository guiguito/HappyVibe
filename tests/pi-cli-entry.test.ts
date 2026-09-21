import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

/**
 * CONTRACT TEST — part of the Pi pin-bump gate.
 *
 * Which FILE we hand to node as "the Pi CLI" is a pin-tracked fact, and it moved
 * without anything failing. Pi shipped its own `bin.pi` as `dist/cli.js` up to
 * 0.84.2, switched it to the bundled `dist/bundle/cli.js` at 0.84.3, and by
 * 0.85.0 the old modular entry does not run at all: `dist/cli.js` statically
 * imports `dist/experimental/server.js`, which imports `@earendil-works/pi-server`
 * — a package Pi publishes but declares in NO dependency field. `node dist/cli.js
 * --version` dies with ERR_MODULE_NOT_FOUND, and because `dist/index.js` (the `.`
 * export) also re-exports `main.js`, so does every extension that imports Pi's
 * library at runtime. pi-subagents does, at src/extension/index.ts, so the break
 * arrives as ~18 test files red at once with the real cause one level down.
 *
 * Two halves, both key-free and both DERIVED from what is installed:
 *   1. our entry is the one upstream ships as `pi`, in both places that name it
 *      (spawn.ts for the parent, pi-node.sh for the §12 child guard), and it runs;
 *   2. we declare Pi's missing dependency ourselves, at Pi's own version — and
 *      that assertion INVERTS the day upstream declares it, so the workaround is
 *      removed rather than carried forever.
 */

const ROOT = path.join(__dirname, "..");
const RUNTIME = path.join(ROOT, "pi-runtime");
const PI_PKG = path.join(RUNTIME, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
const SERVER = "@earendil-works/pi-server";

const read = (p: string) => fs.readFileSync(p, "utf8");
const json = (p: string) => JSON.parse(read(p)) as Record<string, any>;

describe("the embedded Pi CLI entry tracks upstream's own bin", () => {
  it("PI_CLI_RELPATH is the file Pi publishes as `pi`", () => {
    const bin = json(PI_PKG).bin?.pi as string | undefined;
    expect(bin, "pi-coding-agent must publish a bin.pi").toBeTruthy();
    // bin paths are package-relative; PI_CLI_RELPATH is runtime-relative.
    expect(PI_CLI_RELPATH).toBe(`node_modules/@earendil-works/pi-coding-agent/${bin}`);
  });

  it("that file exists and actually boots", () => {
    const cli = path.join(RUNTIME, PI_CLI_RELPATH);
    expect(fs.existsSync(cli), `${PI_CLI_RELPATH} is missing`).toBe(true);
    // The whole failure mode was an entry that resolves on disk and dies on
    // import, so existsSync alone would have passed straight through it.
    const out = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8", timeout: 60_000 });
    expect(out.trim()).toBe(json(PI_PKG).version);
  });

  it("nothing spawns Pi by a hardcoded path — 21 files did", () => {
    // The class, not the instance. Every test that spawns Pi held its own literal
    // "node_modules/@earendil-works/pi-coding-agent/dist/cli.js", so the whole
    // suite went on exercising the modular entry after the app moved to the
    // bundle — green, against a binary HappyVibe no longer runs. Five of them
    // also gated on `existsSync` of that literal, which would have skipped the
    // resource-gate, skills and builtins contract tests in SILENCE the day Pi
    // deletes the file. Sources must build the path from PI_CLI_RELPATH.
    const dirs = ["tests", path.join("src", "main"), path.join("pi-runtime", "extensions")];
    const offenders: string[] = [];
    for (const d of dirs) {
      const root = path.join(ROOT, d);
      const walk = (p: string) => {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          const full = path.join(p, e.name);
          if (e.isDirectory()) walk(full);
          else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && full !== __filename) {
            for (const [i, line] of read(full).split("\n").entries()) {
              // Comments may name the dead path — the CLAUDE.md entry and the
              // spawn.ts docblock both do, deliberately.
              if (/^\s*(\/\/|\*|#)/.test(line)) continue;
              if (line.includes("pi-coding-agent/dist/cli.js")) {
                offenders.push(`${path.relative(ROOT, full)}:${i + 1}`);
              }
            }
          }
        }
      };
      walk(root);
    }
    expect(offenders, "build the path from PI_CLI_RELPATH instead").toEqual([]);
  });

  it("pi-child.mjs runs the SAME entry as the parent", () => {
    // The Windows launcher is a THIRD copy of this path (spawn.ts, pi-node.sh, here).
    // Same drift hazard, same pin.
    const mjs = read(path.join(RUNTIME, "bin", "pi-child.mjs"));
    expect(mjs).toContain(PI_CLI_RELPATH);
    expect(mjs, "no second, stale CLI path").not.toMatch(/pi-coding-agent\/dist\/cli\.js/);
  });

  it("pi-node.sh runs the SAME entry as the parent", () => {
    // pi-node.sh is PI_SUBAGENT_PI_BINARY — the children-only route that injects
    // hv-child-guard.ts. It held its own hardcoded copy of the path, so the two
    // drifted independently and a child could die while the parent was fine.
    const sh = read(path.join(RUNTIME, "bin", "pi-node.sh"));
    expect(sh).toContain(PI_CLI_RELPATH);
    expect(sh, "no second, stale CLI path").not.toMatch(/pi-coding-agent\/dist\/cli\.js/);
  });
});

// RESOLVED UPSTREAM at Pi 0.85.1 ("Fixed SDK import failures caused by unintentionally
// publishing internal experimental code and dependencies in 0.85.0"). Measured at
// 0.86.1: nothing under dist/ imports experimental/server.js any more, both CLI entries
// boot and dist/index.js imports clean — so pi-runtime no longer declares pi-server.
// The block below is the INVERSE of the workaround it replaces: it fails if Pi ever
// re-acquires an import of a package it does not declare, which is what made ~18 test
// files go red at once with the real cause buried one level down in [pi:stderr].
describe("Pi's entrypoints import only packages Pi declares", () => {
  it("nothing under dist/ reaches @earendil-works/pi-server", () => {
    const dist = path.join(path.dirname(PI_PKG), "dist");
    const offenders: string[] = [];
    const walk = (p: string) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".js") && read(full).includes(SERVER)) offenders.push(full);
      }
    };
    walk(dist);
    expect(
      offenders.map((f) => path.relative(dist, f)),
      `Pi imports ${SERVER} again — it declares it in no dependency field, so declare it ` +
        "in pi-runtime/package.json at Pi's own version (see git history for the fix)",
    ).toEqual([]);
  });

  it("the library `.` export imports clean, which is the path every extension takes", () => {
    const dist = path.join(path.dirname(PI_PKG), "dist");
    // Importing it is the test: the original failure was a file that resolves on
    // disk and dies on import, so a source scan alone would have passed through it.
    const out = execFileSync(
      process.execPath,
      ["-e", `import(${JSON.stringify(path.join(dist, "index.js"))}).then(()=>console.log("ok"))`],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(out.trim()).toBe("ok");
  });

  it("we no longer carry the workaround copy", () => {
    const deps = json(path.join(RUNTIME, "package.json")).dependencies as Record<string, string>;
    expect(deps[SERVER], `${SERVER} is declared again — is the import back?`).toBeUndefined();
  });
});
