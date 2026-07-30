import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildManifest, diffManifests, SNAPSHOT_EXCLUDE } from "../src/main/snapshots";
import type { Manifest } from "../src/main/snapshots";

let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-snap-"));
});
afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("buildManifest", () => {
  test("hashes visible files and records workspace-relative paths", () => {
    fs.writeFileSync(path.join(ws, "a.txt"), "hello");
    fs.mkdirSync(path.join(ws, "src"));
    fs.writeFileSync(path.join(ws, "src", "b.ts"), "export const b = 1;");

    const m = buildManifest([ws], ws);

    expect(Object.keys(m.files).sort()).toEqual(["a.txt", path.join("src", "b.ts")]);
    // sha256("hello")
    expect(m.files["a.txt"]).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(m.tooLarge).toEqual([]);
  });

  test("skips the shared ignore list and the snapshot-local build-output list", () => {
    for (const d of ["node_modules", ".git", "dist", "__pycache__"]) {
      fs.mkdirSync(path.join(ws, d));
      fs.writeFileSync(path.join(ws, d, "junk.txt"), "junk");
    }
    fs.writeFileSync(path.join(ws, "keep.txt"), "keep");

    const m = buildManifest([ws], ws);

    expect(Object.keys(m.files)).toEqual(["keep.txt"]);
    expect(SNAPSHOT_EXCLUDE.has("dist")).toBe(true);
  });

  test("skips symlinks rather than following them out of the workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hv-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "link.txt"));

    const m = buildManifest([ws], ws);

    expect(m.files).toEqual({});
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test("records an oversized file as not-captured instead of dropping it silently", () => {
    fs.writeFileSync(path.join(ws, "big.bin"), Buffer.alloc(1_000_001, 1));

    const m = buildManifest([ws], ws);

    expect(m.files["big.bin"]).toBeUndefined();
    expect(m.tooLarge).toEqual(["big.bin"]);
  });

  test("rejects an unregistered workspace", () => {
    expect(() => buildManifest([], ws)).toThrow("Unknown workspace");
  });
});

describe("diffManifests", () => {
  test("classifies added, removed and changed paths", () => {
    const from: Manifest = { files: { keep: "h1", gone: "h2", edit: "h3" }, tooLarge: [] };
    const to: Manifest = { files: { keep: "h1", edit: "h9", fresh: "h4" }, tooLarge: [] };

    expect(diffManifests(from, to)).toEqual({
      changed: ["edit"],
      added: ["fresh"],
      removed: ["gone"],
    });
  });

  test("an identical manifest diffs to nothing", () => {
    const m: Manifest = { files: { a: "h" }, tooLarge: [] };
    expect(diffManifests(m, m)).toEqual({ changed: [], added: [], removed: [] });
  });
});
