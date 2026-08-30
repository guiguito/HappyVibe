import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

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
    expect(pkg.scripts["typecheck:ext"]).toBe("tsc --noEmit -p tsconfig.extensions.json");
    expect(pkg.scripts.typecheck).toContain("typecheck:ext");
  });
});
