import { expect, test } from "vitest";
import { toolDiff } from "../src/renderer/src/diffs";

test("edit args (edits[]) map to add/del/ctx hunk lines", () => {
  const d = toolDiff("edit", {
    path: "src/a.ts",
    edits: [{ oldText: "const a = 1;\nconst b = 2;\n", newText: "const a = 1;\nconst b = 3;\n" }],
  });
  expect(d).not.toBeNull();
  expect(d!.kind).toBe("edit");
  expect(d!.path).toBe("src/a.ts");
  expect(d!.lines).toEqual([
    { type: "ctx", text: "const a = 1;" },
    { type: "del", text: "const b = 2;" },
    { type: "add", text: "const b = 3;" },
  ]);
});

test("legacy top-level oldText/newText edit args still map", () => {
  const d = toolDiff("edit", { path: "x.txt", oldText: "hello\n", newText: "goodbye\n" });
  expect(d!.lines).toEqual([
    { type: "del", text: "hello" },
    { type: "add", text: "goodbye" },
  ]);
});

test("multiple edits are separated and all rendered", () => {
  const d = toolDiff("edit", {
    path: "x.txt",
    edits: [
      { oldText: "one\n", newText: "ONE\n" },
      { oldText: "two\n", newText: "TWO\n" },
    ],
  });
  const dels = d!.lines.filter((l) => l.type === "del").map((l) => l.text);
  const adds = d!.lines.filter((l) => l.type === "add").map((l) => l.text);
  expect(dels).toEqual(["one", "two"]);
  expect(adds).toEqual(["ONE", "TWO"]);
  expect(d!.lines.some((l) => l.type === "ctx" && l.text === "···")).toBe(true);
});

test("write args become an all-added new-file view", () => {
  const d = toolDiff("write", { path: "new.md", content: "# Title\n\nbody" });
  expect(d!.kind).toBe("write");
  expect(d!.lines).toEqual([
    { type: "add", text: "# Title" },
    { type: "add", text: "" },
    { type: "add", text: "body" },
  ]);
});

test("non-matching args return null (card falls back to raw JSON)", () => {
  expect(toolDiff("edit", { path: "x" })).toBeNull();
  expect(toolDiff("edit", null)).toBeNull();
  expect(toolDiff("edit", { path: "x", edits: [{ oldText: 1, newText: "y" }] })).toBeNull();
  expect(toolDiff("write", { path: "x" })).toBeNull();
  expect(toolDiff("bash", { command: "ls" })).toBeNull();
});
