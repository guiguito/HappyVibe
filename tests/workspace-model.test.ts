import { beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionIndex, WorkspaceRegistry } from "../src/main/store";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { resolveModelTier } from "../src/renderer/src/composer";

/**
 * V2.A scripted repro for "picking a different model in a workspace does not
 * apply to new sessions" — the EXACT end-to-end flow:
 *
 *   WorkspaceSettingsModal pickModel (provider/modelId split of the <select>
 *   value) → hv:set-workspace-model → WorkspaceRegistry.setModel
 *   → hv:create-session → SessionIndex.create → SessionManager spawn cb
 *   → spawnOpts model resolution → resolvePiSpawn --provider/--model args.
 *
 * spawnOpts lives inline in ipc.ts (electron-bound); `resolveSpawnModel`
 * below mirrors its exact expression — kept in sync by hand like hv.d.ts.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wsmodel-"));
});

const GLOBAL = { provider: "deepseek", modelId: "deepseek-v4-flash" };

/** Mirror of ipc.ts spawnOpts' model expression (session → workspace → global). */
const resolveSpawnModel = (
  index: SessionIndex,
  workspaces: WorkspaceRegistry,
  workspace?: string,
  sessionId?: string
): { provider: string; modelId: string } | null =>
  (sessionId ? index.get(sessionId)?.model : null) ??
  (workspace ? workspaces.getModel(workspace) : null) ??
  GLOBAL;

/** Mirror of WorkspaceSettingsModal pickModel's "<provider>/<modelId>" split. */
const modalPick = (value: string): { provider: string; modelId: string } => ({
  provider: value.split("/")[0],
  modelId: value.split("/").slice(1).join("/"),
});

const argPair = (args: string[], flag: string): string => args[args.indexOf(flag) + 1];

test("workspace model override reaches the spawn args of a NEW session", () => {
  const workspaces = new WorkspaceRegistry(path.join(dir, "workspaces.json"));
  const index = new SessionIndex(path.join(dir, "session-index.json"));
  const ws = "/Users/someone/projects/app"; // dialog-shaped absolute path, no trailing slash
  workspaces.add(ws);

  // Modal: pick a model whose id itself contains slashes (openrouter-style).
  workspaces.setModel(ws, modalPick("openrouter/deepseek/deepseek-chat"));

  // New session in that workspace → spawn resolution.
  const meta = index.create(ws);
  const model = resolveSpawnModel(index, workspaces, meta.workspaceId, meta.id);
  expect(model).toEqual({ provider: "openrouter", modelId: "deepseek/deepseek-chat" });

  const spec = resolvePiSpawn(meta.workspaceId, "/sess", "/rt", { model });
  expect(argPair(spec.args, "--provider")).toBe("openrouter");
  expect(argPair(spec.args, "--model")).toBe("deepseek/deepseek-chat");
});

test("session override beats the workspace override; clearing falls back", () => {
  const workspaces = new WorkspaceRegistry(path.join(dir, "workspaces.json"));
  const index = new SessionIndex(path.join(dir, "session-index.json"));
  const ws = "/tmp/ws-a";
  workspaces.add(ws);
  workspaces.setModel(ws, modalPick("openai/gpt-5"));

  const meta = index.create(ws);
  index.update(meta.id, { model: { provider: "anthropic", modelId: "claude-sonnet-4" } });
  expect(resolveSpawnModel(index, workspaces, ws, meta.id)).toEqual({
    provider: "anthropic",
    modelId: "claude-sonnet-4",
  });

  // Clear both tiers → global default.
  index.update(meta.id, { model: undefined });
  workspaces.setModel(ws, null);
  expect(resolveSpawnModel(index, workspaces, ws, meta.id)).toEqual(GLOBAL);
});

test("trailing-slash path variants can no longer make setModel/getModel miss", () => {
  const workspaces = new WorkspaceRegistry(path.join(dir, "workspaces.json"));
  workspaces.add("/tmp/ws-b");
  // Pre-V2.A this silently no-op'd (raw string compare) — the one layer that
  // could eat the override without any error.
  workspaces.setModel("/tmp/ws-b/", modalPick("openai/gpt-5"));
  expect(workspaces.getModel("/tmp/ws-b")).toEqual({ provider: "openai", modelId: "gpt-5" });
  expect(workspaces.getModel("/tmp/ws-b//")).toEqual({ provider: "openai", modelId: "gpt-5" });
  // add() dedupes across the same variants
  workspaces.add("/tmp/ws-b/");
  expect(workspaces.list()).toEqual(["/tmp/ws-b"]);
});

test("chip-side resolveModelTier agrees with the spawn resolution on the same inputs", () => {
  const workspaces = new WorkspaceRegistry(path.join(dir, "workspaces.json"));
  const index = new SessionIndex(path.join(dir, "session-index.json"));
  const ws = "/tmp/ws-c";
  workspaces.add(ws);
  workspaces.setModel(ws, modalPick("openai/gpt-5"));
  const meta = index.create(ws);

  const sessionTier = index.get(meta.id)?.model ?? null;
  const workspaceTier = workspaces.getModel(ws);
  const chip = resolveModelTier(sessionTier, workspaceTier, GLOBAL);
  expect(chip).toEqual({ ref: { provider: "openai", modelId: "gpt-5" }, tier: "workspace" });
  expect(chip?.ref).toEqual(resolveSpawnModel(index, workspaces, ws, meta.id));
});
