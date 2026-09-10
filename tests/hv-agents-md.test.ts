import { expect, test } from "vitest";
import path from "node:path";
import {
  FILE_TOOLS, NESTED_FILE_CAP, nearestAgentsMd, nestedFileList, renderNestedSection, toolFilePath,
} from "../pi-runtime/extensions/hv-agents-md";

const CWD = "/ws";
const existsOf = (paths: string[]) => (p: string) => paths.includes(p);
const readOf = (files: Record<string, string>) => (p: string) => files[p] ?? null;

// ── toolFilePath ─────────────────────────────────────────────────────────────

test("toolFilePath accepts path | file_path, rejects junk", () => {
  expect(toolFilePath({ path: "a/b.ts" })).toBe("a/b.ts");
  expect(toolFilePath({ file_path: "a/b.ts" })).toBe("a/b.ts");
  expect(toolFilePath({ path: "x", file_path: "y" })).toBe("x"); // path wins (Pi's own order)
  expect(toolFilePath({})).toBeNull();
  expect(toolFilePath({ path: 42 })).toBeNull();
  expect(toolFilePath({ path: "  " })).toBeNull();
  expect(FILE_TOOLS.has("read") && FILE_TOOLS.has("edit") && FILE_TOOLS.has("write")).toBe(true);
  expect(FILE_TOOLS.has("bash")).toBe(false); // bash heuristics are out of scope
});

// ── nearestAgentsMd ──────────────────────────────────────────────────────────

test("nearest file wins, walking up from the touched file's dir", () => {
  const exists = existsOf(["/ws/sub/AGENTS.md", "/ws/sub/pkg/AGENTS.md"]);
  expect(nearestAgentsMd("/ws/sub/pkg/deep/f.ts", CWD, exists)).toBe(path.join("/ws/sub/pkg", "AGENTS.md"));
  expect(nearestAgentsMd("/ws/sub/f.ts", CWD, exists)).toBe(path.join("/ws/sub", "AGENTS.md"));
});

test("walks up multiple levels when intermediate dirs have no file", () => {
  const exists = existsOf(["/ws/sub/AGENTS.md"]);
  expect(nearestAgentsMd("/ws/sub/a/b/c/f.ts", CWD, exists)).toBe(path.join("/ws/sub", "AGENTS.md"));
});

test("stops at cwd EXCLUSIVE — the root AGENTS.md is never reported as nested", () => {
  const exists = existsOf(["/ws/AGENTS.md"]);
  expect(nearestAgentsMd("/ws/sub/f.ts", CWD, exists)).toBeNull(); // only root exists → nothing nested
  expect(nearestAgentsMd("/ws/f.ts", CWD, exists)).toBeNull(); // file directly in cwd → nothing nested
});

test("relative paths resolve against cwd", () => {
  const exists = existsOf(["/ws/sub/AGENTS.md"]);
  expect(nearestAgentsMd("sub/f.ts", CWD, exists)).toBe(path.join("/ws/sub", "AGENTS.md"));
});

test("files outside cwd yield null (no injection for out-of-workspace paths)", () => {
  const exists = () => true; // every candidate "exists" — must still refuse
  expect(nearestAgentsMd("/elsewhere/f.ts", CWD, exists)).toBeNull();
  expect(nearestAgentsMd("/ws/../etc/passwd", CWD, exists)).toBeNull();
  expect(nearestAgentsMd("../outside/f.ts", CWD, exists)).toBeNull();
});

// ── nestedFileList ───────────────────────────────────────────────────────────

test("nestedFileList is path-sorted, cwd-relative, current-chars; deleted files drop out", () => {
  const files = new Set(["/ws/z/AGENTS.md", "/ws/a/AGENTS.md", "/ws/gone/AGENTS.md"]);
  const read = readOf({ "/ws/a/AGENTS.md": "aaaa", "/ws/z/AGENTS.md": "zz" });
  expect(nestedFileList(files, CWD, read)).toEqual([
    { dir: "a", path: "/ws/a/AGENTS.md", chars: 4 },
    { dir: "z", path: "/ws/z/AGENTS.md", chars: 2 },
  ]);
});

// ── renderNestedSection ──────────────────────────────────────────────────────

test("section contains delimited header, per-file relative dir + content", () => {
  const s = renderNestedSection(["/ws/sub/pkg/AGENTS.md"], CWD, readOf({ "/ws/sub/pkg/AGENTS.md": "Use tabs." }));
  // A8 (2026-09-10): Pi's own tag for the root AGENTS.md, reused here so the
  // model sees one family — not a markdown heading beside Pi's XML.
  const dir = path.join("sub", "pkg");
  expect(s).toContain(`<project_instructions path="${dir}/AGENTS.md" applies_to="${dir}/">`);
  expect(s).toContain("</project_instructions>");
  expect(s).not.toContain("## Nested AGENTS.md");
  expect(s).toContain("Use tabs.");
  expect(s).toContain("the closest file takes precedence");
});

test("empty set / all-deleted files render nothing", () => {
  expect(renderNestedSection([], CWD, readOf({}))).toBe("");
  expect(renderNestedSection(["/ws/sub/AGENTS.md"], CWD, readOf({}))).toBe("");
});

test("oversized files are capped with a truncation note", () => {
  const big = "x".repeat(NESTED_FILE_CAP + 100);
  const s = renderNestedSection(["/ws/sub/AGENTS.md"], CWD, readOf({ "/ws/sub/AGENTS.md": big }));
  expect(s).toContain(`[truncated at ${NESTED_FILE_CAP} chars]`);
  expect(s.length).toBeLessThan(big.length + 500);
});

test("Set semantics dedupe repeat discoveries (same subtree touched twice)", () => {
  const set = new Set<string>();
  set.add("/ws/sub/AGENTS.md");
  set.add("/ws/sub/AGENTS.md");
  const s = renderNestedSection(set, CWD, readOf({ "/ws/sub/AGENTS.md": "once" }));
  expect(s.match(/<project_instructions /g)).toHaveLength(1);
});
