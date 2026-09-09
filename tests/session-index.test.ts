import { beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteSessionFile, SessionIndex, WorkspaceRegistry } from "../src/main/store";

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

// ── W1.4: per-workspace model override ──────────────────────────────────────

test("legacy string[] workspaces.json migrates and getModel is null (falls back to global)", () => {
  const wsFile = path.join(dir, "workspaces.json");
  fs.writeFileSync(wsFile, JSON.stringify(["/tmp/a", "/tmp/b"])); // pre-W1.4 format
  const reg = new WorkspaceRegistry(wsFile);
  expect(reg.list()).toEqual(["/tmp/a", "/tmp/b"]);
  expect(reg.getModel("/tmp/a")).toBeNull();
  // Spawn resolution (ipc.ts spawnOpts): workspace model ?? global default.
  const global = { provider: "deepseek", modelId: "deepseek-chat" };
  expect(reg.getModel("/tmp/a") ?? global).toEqual(global);
});

test("setModel persists an override; null clears it; unknown workspace is a no-op", () => {
  const wsFile = path.join(dir, "workspaces.json");
  const reg = new WorkspaceRegistry(wsFile);
  reg.add("/tmp/a");
  const model = { provider: "anthropic", modelId: "claude-sonnet" };
  reg.setModel("/tmp/a", model);
  expect(reg.getModel("/tmp/a")).toEqual(model);
  // Persists across reload, and the workspace → global resolution prefers it.
  const reloaded = new WorkspaceRegistry(wsFile);
  expect(reloaded.getModel("/tmp/a") ?? { provider: "g", modelId: "g" }).toEqual(model);
  reloaded.setModel("/tmp/a", null);
  expect(new WorkspaceRegistry(wsFile).getModel("/tmp/a")).toBeNull();
  // Unknown workspace: nothing stored, nothing thrown.
  reloaded.setModel("/tmp/nope", model);
  expect(new WorkspaceRegistry(wsFile).getModel("/tmp/nope")).toBeNull();
  expect(new WorkspaceRegistry(wsFile).list()).toEqual(["/tmp/a"]);
});

// ── V2.C2: session delete ───────────────────────────────────────────────────

test("remove of an unknown id is a no-op and leaves other sessions intact", () => {
  const index = new SessionIndex(file());
  const meta = index.create("/tmp/ws");
  index.remove("not-a-session");
  expect(new SessionIndex(file()).get(meta.id)).toBeDefined();
});

// Migration safety: a pre-delete-era entry (no piSessionFile) deletes cleanly.
test("delete of a session without piSessionFile just drops the index entry", () => {
  const index = new SessionIndex(file());
  const meta = index.create("/tmp/ws");
  expect(meta.piSessionFile).toBeUndefined();
  deleteSessionFile(path.join(dir, "sessions"), meta.piSessionFile); // must not throw
  index.remove(meta.id);
  expect(new SessionIndex(file()).list()).toHaveLength(0);
});

test("deleteSessionFile removes a file inside the session dir", () => {
  const sessions = path.join(dir, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const f = path.join(sessions, "abc.jsonl");
  fs.writeFileSync(f, "{}");
  deleteSessionFile(sessions, f);
  expect(fs.existsSync(f)).toBe(false);
});

test("deleteSessionFile tolerates a missing file", () => {
  const sessions = path.join(dir, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  expect(() => deleteSessionFile(sessions, path.join(sessions, "gone.jsonl"))).not.toThrow();
});

test("deleteSessionFile NEVER deletes outside the session dir (confinement)", () => {
  const sessions = path.join(dir, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const outside = path.join(dir, "precious.txt");
  fs.writeFileSync(outside, "keep me");
  deleteSessionFile(sessions, outside); // sibling of the dir
  deleteSessionFile(sessions, path.join(sessions, "..", "precious.txt")); // .. traversal
  deleteSessionFile(sessions, "precious.txt"); // relative
  expect(fs.readFileSync(outside, "utf8")).toBe("keep me");
  // prefix trick: /x/sessions-evil must not match /x/sessions
  const evil = sessions + "-evil";
  fs.mkdirSync(evil, { recursive: true });
  const evilFile = path.join(evil, "s.jsonl");
  fs.writeFileSync(evilFile, "x");
  deleteSessionFile(sessions, evilFile);
  expect(fs.existsSync(evilFile)).toBe(true);
});

test("touch sets lastUsedAt and leaves updatedAt alone", async () => {
  // `update()` stamps updatedAt on every call, so touching through it would drag
  // the two meanings back together: every open would also read as a metadata
  // change, and auto-hibernation — which picks the LEAST recently used session
  // — would keep looking like use.
  const index = new SessionIndex(file());
  const meta = index.create("/tmp/ws");
  expect(meta.lastUsedAt).toBeUndefined();
  const before = meta.updatedAt;
  await new Promise((r) => setTimeout(r, 5));

  const touched = index.touch(meta.id)!;
  expect(touched.lastUsedAt).toBeTruthy();
  expect(touched.updatedAt).toBe(before);
  expect(new SessionIndex(file()).get(meta.id)!.lastUsedAt).toBe(touched.lastUsedAt);

  expect(index.touch("nope")).toBeUndefined();
});

test("§34: pulseAskedAt is additive and survives a reload", () => {
  const index = new SessionIndex(file());
  const meta = index.create("/tmp/ws");
  // Absent = never asked. Nothing to migrate for sessions that predate the field.
  expect(meta.pulseAskedAt).toBeUndefined();
  index.update(meta.id, { pulseAskedAt: "2026-09-10T10:00:00.000Z" });
  expect(new SessionIndex(file()).get(meta.id)?.pulseAskedAt).toBe("2026-09-10T10:00:00.000Z");
});
