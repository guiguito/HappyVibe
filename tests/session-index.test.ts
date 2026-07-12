import { beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionIndex, WorkspaceRegistry } from "../src/main/store";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-index-"));
});

const file = (): string => path.join(dir, "session-index.json");

test("create returns a complete meta and persists across reload", () => {
  const index = new SessionIndex(file());
  const meta = index.create("/tmp/ws-a");
  expect(meta.id).toBeTruthy();
  expect(meta.title).toBe("New session");
  expect(meta.workspaceId).toBe("/tmp/ws-a");
  expect(meta.archived).toBe(false);
  expect(meta.titleSource).toBe("fallback");

  const reloaded = new SessionIndex(file());
  expect(reloaded.get(meta.id)).toMatchObject({ id: meta.id, workspaceId: "/tmp/ws-a" });
});

test("update patches fields and bumps updatedAt", async () => {
  const index = new SessionIndex(file());
  const meta = index.create("/tmp/ws");
  await new Promise((r) => setTimeout(r, 5));
  const updated = index.update(meta.id, { title: "Fix the login bug", titleSource: "user" })!;
  expect(updated.title).toBe("Fix the login bug");
  expect(updated.titleSource).toBe("user");
  expect(updated.updatedAt > meta.createdAt).toBe(true);
  expect(index.update("nope", { title: "x" })).toBeUndefined();
});

test("archive is a flag, session stays listed", () => {
  const index = new SessionIndex(file());
  const meta = index.create("/tmp/ws");
  index.update(meta.id, { archived: true });
  expect(new SessionIndex(file()).get(meta.id)?.archived).toBe(true);
});

test("remove deletes the entry", () => {
  const index = new SessionIndex(file());
  const meta = index.create("/tmp/ws");
  index.remove(meta.id);
  expect(index.get(meta.id)).toBeUndefined();
  expect(new SessionIndex(file()).list()).toHaveLength(0);
});

test("corrupt index file starts empty instead of crashing", () => {
  fs.writeFileSync(file(), "{not json!");
  const index = new SessionIndex(file());
  expect(index.list()).toEqual([]);
  index.create("/tmp/ws"); // and can write again
  expect(new SessionIndex(file()).list()).toHaveLength(1);
});

// W1.3 migration: `hibernated` is additive — a pre-W1.3 index (field absent)
// parses fine and the flag round-trips once set.
test("index without hibernated field parses; flag is settable and clears", () => {
  fs.writeFileSync(
    file(),
    JSON.stringify([
      {
        id: "old-1", title: "Pre-W1.3 session", workspaceId: "/tmp/ws",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        archived: false, titleSource: "fallback",
      },
    ])
  );
  const index = new SessionIndex(file());
  expect(index.get("old-1")?.hibernated).toBeUndefined(); // absent = not hibernated
  index.update("old-1", { hibernated: true });
  expect(new SessionIndex(file()).get("old-1")?.hibernated).toBe(true);
  index.update("old-1", { hibernated: false });
  expect(new SessionIndex(file()).get("old-1")?.hibernated).toBe(false);
});

test("workspace registry adds, dedupes, removes, persists", () => {
  const wsFile = path.join(dir, "workspaces.json");
  const reg = new WorkspaceRegistry(wsFile);
  reg.add("/tmp/a");
  reg.add("/tmp/a");
  reg.add("/tmp/b");
  expect(reg.list()).toEqual(["/tmp/a", "/tmp/b"]);
  reg.remove("/tmp/a");
  expect(new WorkspaceRegistry(wsFile).list()).toEqual(["/tmp/b"]);
});
