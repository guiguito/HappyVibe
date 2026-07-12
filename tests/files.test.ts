import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listDir, MAX_FILE_BYTES, readWorkspaceFile, resolveInWorkspace, statMtime, writeWorkspaceFile,
} from "../src/main/files";

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-files-"));
const registered = [ws];
fs.mkdirSync(path.join(ws, "src"));
fs.mkdirSync(path.join(ws, "node_modules"));
fs.mkdirSync(path.join(ws, ".git"));
fs.mkdirSync(path.join(ws, ".pi-subagents"));
fs.mkdirSync(path.join(ws, ".github"));
fs.writeFileSync(path.join(ws, "readme.md"), "# hi\n");
fs.writeFileSync(path.join(ws, ".env"), "SECRET=1\n");
fs.writeFileSync(path.join(ws, "src", "a.ts"), "export const a = 1;\n");

// ── confinement ─────────────────────────────────────────────────────

test("unregistered workspace is rejected", () => {
  expect(() => resolveInWorkspace(registered, os.tmpdir(), "x")).toThrow(/Unknown workspace/);
});

test("traversal outside the workspace is rejected", () => {
  expect(() => resolveInWorkspace(registered, ws, "../elsewhere")).toThrow(/escapes workspace/);
  expect(() => resolveInWorkspace(registered, ws, "src/../../x")).toThrow(/escapes workspace/);
  expect(() => resolveInWorkspace(registered, ws, "/etc/passwd")).toThrow(/escapes workspace/);
});

test("in-workspace paths resolve (\"..\" hops that stay inside are fine)", () => {
  expect(resolveInWorkspace(registered, ws, "src/a.ts")).toBe(path.join(ws, "src", "a.ts"));
  expect(resolveInWorkspace(registered, ws, "src/../readme.md")).toBe(path.join(ws, "readme.md"));
  expect(resolveInWorkspace(registered, ws, "")).toBe(ws);
});

// ── listDir ─────────────────────────────────────────────────────────

test("listDir hides node_modules/.git/.pi-subagents and dotfiles except .pi/.github", () => {
  const names = listDir(registered, ws, "").map((e) => e.name);
  expect(names).toContain("src");
  expect(names).toContain(".github");
  expect(names).toContain("readme.md");
  expect(names).not.toContain("node_modules");
  expect(names).not.toContain(".git");
  expect(names).not.toContain(".pi-subagents");
  expect(names).not.toContain(".env");
});

test("listDir sorts dirs first, then files", () => {
  const entries = listDir(registered, ws, "");
  const kinds = entries.map((e) => e.kind);
  expect(kinds.indexOf("file")).toBeGreaterThan(kinds.lastIndexOf("dir"));
});

test("listDir of a subdirectory is lazy per-level", () => {
  expect(listDir(registered, ws, "src")).toEqual([{ name: "a.ts", kind: "file" }]);
});

// ── read/write/mtime ────────────────────────────────────────────────

test("read/write roundtrip; write returns the new mtime baseline", () => {
  const r = readWorkspaceFile(registered, ws, "src/a.ts");
  expect(r).toMatchObject({ kind: "text", content: "export const a = 1;\n" });
  const mtime = writeWorkspaceFile(registered, ws, "src/a.ts", "export const a = 2;\n");
  expect(mtime).toBe(statMtime(registered, ws, "src/a.ts"));
  expect(readWorkspaceFile(registered, ws, "src/a.ts")).toMatchObject({ kind: "text", mtimeMs: mtime });
});

test("size cap → honest too-large state (never a truncated buffer)", () => {
  fs.writeFileSync(path.join(ws, "big.txt"), "x".repeat(MAX_FILE_BYTES + 1));
  expect(readWorkspaceFile(registered, ws, "big.txt")).toEqual({ kind: "too-large", size: MAX_FILE_BYTES + 1 });
});

test("NUL byte → binary state", () => {
  fs.writeFileSync(path.join(ws, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x0a]));
  expect(readWorkspaceFile(registered, ws, "blob.bin")).toEqual({ kind: "binary" });
});

test("statMtime is null for a missing file (external delete detection)", () => {
  expect(statMtime(registered, ws, "gone.txt")).toBeNull();
});
