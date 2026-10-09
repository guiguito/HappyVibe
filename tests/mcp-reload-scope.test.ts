import { expect, test } from "vitest";
import { affectedSessionIds } from "../src/main/mcpReloadScope";

const sessions = [
  { id: "s1", workspaceId: "/ws/a" },
  { id: "s2", workspaceId: "/ws/a/" }, // trailing slash — same workspace as s1
  { id: "s3", workspaceId: "/ws/b" },
];

test("global scope → every live session", () => {
  expect(affectedSessionIds("global", null, sessions)).toEqual(["s1", "s2", "s3"]);
});

test("workspace scope → only matching workspace (trailing-slash-insensitive)", () => {
  expect(affectedSessionIds("workspace", "/ws/a", sessions)).toEqual(["s1", "s2"]);
  expect(affectedSessionIds("workspace", "/ws/a/", sessions)).toEqual(["s1", "s2"]);
  expect(affectedSessionIds("workspace", "/ws/b", sessions)).toEqual(["s3"]);
});

test("workspace scope with no match / null workspaceId → none", () => {
  expect(affectedSessionIds("workspace", "/ws/none", sessions)).toEqual([]);
  expect(affectedSessionIds("workspace", null, sessions)).toEqual([]);
});

test("no live sessions → none", () => {
  expect(affectedSessionIds("global", null, [])).toEqual([]);
});

test("a session started after the change is not reloaded; one alive before is", () => {
  const alive = new Set(["s1", "s3"]); // s2 spawned after the change was scheduled
  expect(affectedSessionIds("global", null, sessions, alive)).toEqual(["s1", "s3"]);
  expect(affectedSessionIds("workspace", "/ws/a", sessions, alive)).toEqual(["s1"]);
  expect(affectedSessionIds("global", null, sessions, new Set())).toEqual([]);
});
