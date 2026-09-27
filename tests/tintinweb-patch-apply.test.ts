/**
 * HappyVibe's owned patch to @tintinweb/pi-subagents (PRD §3, 2026-09-26) is applied
 * at install by scripts/patch-tintinweb.mjs. This pins the applier's contract — a
 * missing or ambiguous anchor FAILS the install, and a failure writes nothing — and
 * that the vendored package really carries every hunk. A patch that silently stops
 * applying would re-open the trust hole it exists to close (docs/validation/tw1.md).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — plain .mjs, no types
import { applyHunks } from "../scripts/patch-tintinweb.mjs";
// @ts-expect-error — plain .mjs, no types
import { HUNKS } from "../scripts/tintinweb-hunks.mjs";

type Hunk = { id: string; file: string; find: string; replace: string };

const fixture = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hv-twpatch-"));
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), body);
  }
  return root;
};
const read = (root: string, f: string): string => fs.readFileSync(path.join(root, f), "utf8");
const hunk: Hunk = { id: "T1", file: "src/a.ts", find: "const x = 1;", replace: "const x = 2; // hv-patch:T1 $& stays literal" };

describe("applyHunks", () => {
  it("applies once, then is a no-op (npm ci re-runs postinstall)", () => {
    const root = fixture({ "src/a.ts": "const x = 1;\n" });
    expect(applyHunks(root, [hunk])).toEqual(["T1"]);
    expect(read(root, "src/a.ts")).toBe("const x = 2; // hv-patch:T1 $& stays literal\n");
    expect(applyHunks(root, [hunk])).toEqual([]);
    expect(read(root, "src/a.ts")).toBe("const x = 2; // hv-patch:T1 $& stays literal\n");
  });

  it("fails the install on a missing anchor", () => {
    expect(() => applyHunks(fixture({ "src/a.ts": "const y = 1;\n" }), [hunk])).toThrow(/T1: anchor missing/);
  });

  it("fails the install on an ambiguous anchor", () => {
    expect(() => applyHunks(fixture({ "src/a.ts": "const x = 1;\nconst x = 1;\n" }), [hunk])).toThrow(/T1: anchor found 2×/);
  });

  it("refuses a replacement without its marker", () => {
    expect(() => applyHunks(fixture({ "src/a.ts": "const x = 1;\n" }), [{ ...hunk, replace: "const x = 2;" }])).toThrow(/marker/);
  });

  it("a failing anchor writes NOTHING — no half-patched package", () => {
    const root = fixture({ "src/a.ts": "const x = 1;\n", "src/b.ts": "nothing to find here\n" });
    const second: Hunk = { id: "T2", file: "src/b.ts", find: "absent", replace: "x // hv-patch:T2" };
    expect(() => applyHunks(root, [hunk, second])).toThrow(/T2: anchor missing/);
    expect(read(root, "src/a.ts")).toBe("const x = 1;\n");
  });

  it("two hunks in one file both land", () => {
    const root = fixture({ "src/a.ts": "const x = 1;\nconst y = 1;\n" });
    const h2: Hunk = { id: "T3", file: "src/a.ts", find: "const y = 1;", replace: "const y = 3; // hv-patch:T3" };
    expect(applyHunks(root, [hunk, h2])).toEqual(["T1", "T3"]);
    expect(read(root, "src/a.ts")).toContain("hv-patch:T1");
    expect(read(root, "src/a.ts")).toContain("hv-patch:T3");
  });
});

describe("the vendored package carries every hunk", () => {
  const PKG = path.join(process.cwd(), "pi-runtime/node_modules/@tintinweb/pi-subagents");

  it("is pinned exactly, installed, and patched at install", () => {
    const pkg = JSON.parse(fs.readFileSync("pi-runtime/package.json", "utf8"));
    expect(pkg.dependencies["@tintinweb/pi-subagents"]).toBe("0.19.0");
    expect(pkg.scripts.postinstall).toMatch(/node \.\.\/scripts\/patch-tintinweb\.mjs/);
    expect(JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version).toBe("0.19.0");
  });

  it("every hunk id is unique", () => {
    const ids = (HUNKS as Hunk[]).map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const h of HUNKS as Hunk[]) {
    it(`carries hv-patch:${h.id}`, () => {
      expect(fs.readFileSync(path.join(PKG, h.file), "utf8")).toContain(`hv-patch:${h.id}`);
    });
  }
});
