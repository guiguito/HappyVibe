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

  it("pi-node.sh runs the SAME entry as the parent", () => {
    // pi-node.sh is PI_SUBAGENT_PI_BINARY — the children-only route that injects
    // hv-child-guard.ts. It held its own hardcoded copy of the path, so the two
    // drifted independently and a child could die while the parent was fine.
    const sh = read(path.join(RUNTIME, "bin", "pi-node.sh"));
    expect(sh).toContain(PI_CLI_RELPATH);
    expect(sh, "no second, stale CLI path").not.toMatch(/pi-coding-agent\/dist\/cli\.js/);
  });
});

describe("Pi's undeclared @earendil-works/pi-server", () => {
  it("is still undeclared upstream — drop our copy when this fails", () => {
    const pi = json(PI_PKG);
    const declared =
      pi.dependencies?.[SERVER] ?? pi.peerDependencies?.[SERVER] ?? pi.optionalDependencies?.[SERVER];
    expect(
      declared,
      `Pi now declares ${SERVER} (${declared}) — remove it from pi-runtime/package.json`,
    ).toBeUndefined();
  });

  it("is reachable, because Pi's own entrypoints import it", () => {
    // Proof the dependency is real rather than defensive: the library `.` export
    // reaches it, which is the path every vendored extension takes.
    const dist = path.dirname(PI_PKG) + "/dist";
    expect(read(`${dist}/index.js`)).toContain('from "./main.js"');
    expect(read(`${dist}/main.js`)).toContain('from "./experimental/server.js"');
    expect(read(`${dist}/experimental/server.js`)).toContain(SERVER);
  });

  it("we declare it, pinned exact to Pi's own version", () => {
    const deps = json(path.join(RUNTIME, "package.json")).dependencies as Record<string, string>;
    expect(deps[SERVER], `pi-runtime must declare ${SERVER}`).toBeTruthy();
    // Lockstep, like pi-tui: pi-server ships only alongside a matching Pi.
    expect(deps[SERVER]).toBe(deps["@earendil-works/pi-coding-agent"]);
  });

  it("resolves from pi-runtime, so the library import works", () => {
    const p = path.join(RUNTIME, "node_modules", SERVER, "package.json");
    expect(fs.existsSync(p), `${SERVER} is not installed`).toBe(true);
    expect(json(p).version).toBe(json(PI_PKG).version);
  });
});
