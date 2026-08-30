/**
 * `assistantTasks` — the three model calls HappyVibe makes without a session
 * (PRD §19, 2026-08-30): the session title, the commit message, the PR draft.
 *
 * One global record per task holding model + append + on/off, mirroring
 * `getBuiltinTools`/`setBuiltinTools` right beside it in config.ts rather than
 * inventing a second shape for the same idea.
 *
 * It REPLACES `gitMessageModel`, which was a single setting two of these rows
 * would have silently shared. That one was built end to end in main — config
 * field, getter, setter, two IPC handlers, preload binding, type declaration —
 * and never given a renderer caller, so nothing has ever written it and there
 * is nothing to migrate. The last test here is what keeps it gone.
 *
 * Key-free: pure fs + a mocked electron userData. Stays in the non-live suite.
 */
import { beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let userData: string;

vi.mock("electron", () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
}));

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "hv-assistant-tasks-"));
});

const load = async () => await import("../src/main/config");

test("all three default to on, no model override, no append", async () => {
  const { getAssistantTasks } = await load();
  const t = getAssistantTasks();
  expect(Object.keys(t).sort()).toEqual(["commit-message", "pr-draft", "title"]);
  for (const v of Object.values(t)) {
    expect(v).toEqual({ enabled: true, model: null, append: "" });
  }
});

test("fail OPEN — a task the user has never touched runs", async () => {
  // Same convention as getBuiltinTools: absent config means the feature is on.
  // A task that defaulted off would be a model call the user configured and
  // never got, with nothing on screen explaining the silence.
  const { getAssistantTasks } = await load();
  expect(getAssistantTasks().title.enabled).toBe(true);
});

test("a patch merges rather than replacing the record", async () => {
  const { getAssistantTasks, setAssistantTask } = await load();
  setAssistantTask("title", { model: { provider: "openrouter", modelId: "x/y" } });
  setAssistantTask("title", { append: "always mention the ticket id" });
  expect(getAssistantTasks().title).toEqual({
    enabled: true,
    model: { provider: "openrouter", modelId: "x/y" },
    append: "always mention the ticket id",
  });
});

test("one task's patch leaves the other two alone", async () => {
  const { getAssistantTasks, setAssistantTask } = await load();
  setAssistantTask("commit-message", { enabled: false });
  const t = getAssistantTasks();
  expect(t["commit-message"].enabled).toBe(false);
  expect(t["pr-draft"]).toEqual({ enabled: true, model: null, append: "" });
  expect(t.title).toEqual({ enabled: true, model: null, append: "" });
});

test("a model override survives a round-trip through the file", async () => {
  const { getAssistantTasks, setAssistantTask } = await load();
  setAssistantTask("pr-draft", { model: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } });
  const onDisk = JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8")) as {
    assistantTasks?: Record<string, { model?: { provider: string } }>;
  };
  expect(onDisk.assistantTasks?.["pr-draft"]?.model?.provider).toBe("anthropic");
  expect(getAssistantTasks()["pr-draft"].model?.modelId).toBe("claude-haiku-4-5-20251001");
});

test("an unknown task id is ignored, not written", async () => {
  const { getAssistantTasks, setAssistantTask } = await load();
  // The renderer is a trust boundary like any other: a typo must not grow a
  // fourth task nothing reads.
  (setAssistantTask as unknown as (id: string, p: unknown) => void)("agents-md", { enabled: false });
  expect(Object.keys(getAssistantTasks()).sort()).toEqual(["commit-message", "pr-draft", "title"]);
});

test("gitMessageModel is gone — no UI ever wrote it, so there was nothing to migrate", () => {
  const read = (rel: string): string => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  // The CHAIN, link by link, rather than the word: config.ts still explains in
  // prose why the field went, and that comment is the useful part.
  const dead = [
    /getGitMessageModel/,
    /setGitMessageModel/,
    /cfg\.gitMessageModel/,
    /gitMessageModel\?:/,
    /hv:git-message-model/,
    /hv:set-git-message-model/,
  ];
  for (const f of [
    "src/main/config.ts",
    "src/main/ipc.ts",
    "src/preload/index.ts",
    "src/renderer/src/hv.d.ts",
  ]) {
    const src = read(f);
    for (const re of dead) expect(src, `${f} still has ${re}`).not.toMatch(re);
  }
});
