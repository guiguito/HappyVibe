import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { eventFromLog, type TapContext } from "../src/main/usage/fromLog";
import { modelParams } from "../src/main/usage/mappers";
import { USAGE_EVENTS } from "../src/main/usage/events";
import { REGISTRY_MODELS } from "../src/main/providerCatalog.generated";
import { OnceSet } from "../src/main/usage/client";

const ctx: TapContext = { waitSec: () => undefined, aiMessage: () => false, isStorePlugin: () => null, isScheduleSession: () => false, inWorktree: () => false };
const strip = (f: string): string => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("§39 the deferred minors, fixed", () => {
  it("a failed or aborted auto-compaction is not counted", () => {
    expect(eventFromLog({ type: "context.compact", data: { reason: "threshold", firstKeptEntryId: null } }, ctx)).toBeNull();
    expect(eventFromLog({ type: "context.compact", data: { reason: "threshold", firstKeptEntryId: "e1" } }, ctx)?.params).toEqual({ action: "compacted", trigger: "auto" });
  });
  it("a model id is sent only when Pi's own registry ships it for that provider", () => {
    const prov = "openrouter";
    const ids = REGISTRY_MODELS[prov];
    expect(modelParams(prov, ids[0]).model).toBe(ids[0].replace(/\//g, ":"));
    expect(modelParams(prov, "my-hand-typed-model").model).toBe("custom");
  });
  it("catalog values nothing emits are gone (the Privacy page lists what the catalog says)", () => {
    const feats = (USAGE_EVENTS.feature_used.params.feature as { values: readonly string[] }).values;
    expect(feats).not.toContain("worktree");
    expect(Object.keys(USAGE_EVENTS.session_start_failed.params)).toEqual(["reason"]);
    const ipc = strip("src/main/ipc.ts");
    expect(ipc).toMatch(/track\("git_action", \{ action: "pull_request" \}\)/);
  });
  it("OnceSet reports a key once, and forgets on request", () => {
    const s = new OnceSet();
    expect(s.first("a")).toBe(true);
    expect(s.first("a")).toBe(false);
    s.forget("a");
    expect(s.first("a")).toBe(true);
  });
  it("no_model is counted once per session, not on every respawn", () => {
    expect(strip("src/main/ipc.ts")).toMatch(/noModelOnce\.first\([^)]*\)\) track\("session_start_failed", \{ reason: "no_model" \}\)/);
  });
  it("side effects are not inside a React state updater", () => {
    const chat = strip("src/renderer/src/components/ChatView.tsx");
    expect(chat).not.toMatch(/setOpen\(\(o\) => \{[^}]*trackUi/);
  });
  it("events fire after the action succeeds", () => {
    const app = strip("src/renderer/src/App.tsx");
    expect(app).toMatch(/compactSession\(sid\)\.then\(\(\) => trackUi\("context_changed"/);
    const ipc = strip("src/main/ipc.ts");
    const at = ipc.indexOf("const dangerous = /^\\/hv-dangerous");
    expect(at).toBeGreaterThan(-1);
    expect(ipc.slice(at, at + 700)).toMatch(/await promptSession[\s\S]*track\("bypass_changed"/);
  });
  it("prompt_sent fires only after main accepted the prompt", () => {
    const app = strip("src/renderer/src/App.tsx");
    expect(app.match(/noteWarnings\(warnings\);\s*if \(usage\) trackUi\("prompt_sent", usage\);/g)?.length).toBe(2);
    expect(strip("src/renderer/src/components/ChatView.tsx")).not.toContain('trackUi("prompt_sent"');
  });
  it("prompt timings and per-workspace features are pruned", () => {
    const ipc = strip("src/main/ipc.ts");
    expect(ipc).toMatch(/"hv:respond-input"[\s\S]{0,300}promptShownAt\.delete\(id\)/);
    expect(ipc).toMatch(/"session-exit"[\s\S]{0,600}answeredWaits\.delete\(sessionId\)/);
    expect(ipc).toMatch(/"hv:remove-workspace"[\s\S]{0,400}forgetSessionFeatures\(ws\)/);
  });
});
