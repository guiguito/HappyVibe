import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Housekeeping item 1 (2026-08-30): pi-runtime/extensions/ was typechecked by
// NOTHING for the app's whole life, which shipped a real TDZ ReferenceError
// across the §12 refusal paths. The coverage is pinned here so an include-list
// or script "cleanup" fails this suite instead of silently reopening the hole.
describe("extensions typecheck coverage", () => {
  it("tsconfig.extensions.json covers the whole extensions directory", () => {
    const cfg = JSON.parse(readFileSync("tsconfig.extensions.json", "utf8"));
    expect(cfg.include).toEqual(["pi-runtime/extensions/**/*.ts"]);
    // noEmit is what makes allowImportingTsExtensions legal; losing it breaks the check.
    expect(cfg.compilerOptions.noEmit).toBe(true);
  });

  it("the typecheck chain runs it, so build/gate/CI inherit it", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["typecheck:ext"]).toBe("node scripts/typecheck-ext.mjs");
    expect(pkg.scripts.typecheck).toContain("typecheck:ext");
  });
});

// The wrapper exists because Pi 0.86.1 + pi-subagents 0.64.0 leaves UPSTREAM's own .ts
// not type-clean (0.86 made ToolResultMessage a conditional type), and CLAUDE.md's
// standing rule is never to patch vendored source. The risk it introduces is the one
// worth a test: that the filter also swallows OUR errors. Both directions are driven
// through the real script against fixture projects, never by reading its source.
describe("typecheck:ext vendored-diagnostic filter", () => {
  const run = (project: string) =>
    spawnSync(process.execPath, ["scripts/typecheck-ext.mjs", project], { encoding: "utf8" });

  const fixture = (rel: string, body: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "hv-tsx-"));
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: [rel] }),
    );
    return { dir, project: path.join(dir, "tsconfig.json") };
  };

  it("fails on an error in our own code", () => {
    const { dir, project } = fixture("src/bad.ts", "export const n: number = 'no';\n");
    try {
      const r = run(project);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("bad.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes but still PRINTS an error under pi-runtime/node_modules", () => {
    const { dir, project } = fixture(
      "pi-runtime/node_modules/vendor/bad.ts",
      "export const n: number = 'no';\n",
    );
    try {
      const r = run(project);
      expect(r.status).toBe(0);
      // Printed, never swallowed — a suppression nobody can see is the bug to avoid.
      expect(r.stdout).toContain("pi-runtime/node_modules");
      expect(r.stdout).toContain("not ours to fix");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly when tsc itself cannot run", () => {
    const r = run(path.join(tmpdir(), "hv-no-such-tsconfig.json"));
    expect(r.status).not.toBe(0);
  });
});
