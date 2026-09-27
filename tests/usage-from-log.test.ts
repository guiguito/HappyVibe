import { describe, expect, it } from "vitest";
import { eventFromLog, mapWebCode, storePluginId, type TapContext } from "../src/main/usage/fromLog";
import { checkEvent } from "../src/main/usage/guard";
import { PLUGIN_CATALOG } from "../src/main/plugins/catalog.generated";
import { OFFICIAL_MARKETPLACE_ID } from "../src/main/plugins/officialMarketplace";

const ctx: TapContext = {
  waitSec: () => 7,
  aiMessage: (_ws, m) => m === "feat: generated",
  isStorePlugin: (p) => (p === "superpowers" ? "superpowers" : null),
  isScheduleSession: (id) => id === "sched",
  inWorktree: (ws) => ws === "/wt",
};
const ev = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => eventFromLog({ type, data, ...extra }, ctx);

describe("§39 eventFromLog — an explicit picker, never data wholesale", () => {
  it("permission.decision: only a human's answer, mapped", () => {
    expect(ev("permission.decision", { tool: "bash", summary: "rm -rf /", decision: "allow-session", source: "user", agent: "explorer" }, { sessionId: "s" }))
      .toEqual({ name: "permission_answered", params: { decision: "allow_session", toolKind: "bash", waitSec: 7 } });
    expect(ev("permission.decision", { tool: "bash", decision: "allow", source: "rule" })).toBeNull();
    expect(ev("permission.decision", { tool: "bash", decision: "allow", source: "bypass" })).toBeNull();
  });
  it("plan rows", () => {
    expect(ev("plan.enter", {})?.params).toEqual({ action: "entered" });
    expect(ev("plan.ready", { path: "p.md" })?.params).toEqual({ action: "plan_ready" });
    expect(ev("plan.implement", { path: "p.md" })?.params).toEqual({ action: "implemented" });
    expect(ev("plan.revert", {})?.params).toEqual({ action: "reverted" });
    expect(ev("plan.exit", { discard: true })?.params).toEqual({ action: "exited" });
  });
  it("context.compact: Pi's own only (a click is tracked by the window)", () => {
    expect(ev("context.compact", { reason: "threshold" })).toEqual({ name: "context_changed", params: { action: "compacted", trigger: "auto" } });
    expect(ev("context.compact", { reason: "manual" })).toBeNull();
  });
  it("git.action: the action, never message/branch/path", () => {
    expect(ev("git.action", { action: "commit", message: "feat: generated", sha: "abc", who: "human" }, { workspaceId: "/w" }))
      .toEqual({ name: "git_action", params: { action: "commit", aiMessage: true } });
    expect(ev("git.action", { action: "switch", branch: "secret-branch" })?.params).toEqual({ action: "switch" });
    expect(ev("git.action", { action: "stash-pop", index: 0 })?.params).toEqual({ action: "stash" });
    expect(ev("git.action", { action: "worktree-prune" })).toBeNull();
    expect(JSON.stringify(ev("git.action", { action: "undo-file", path: "/Users/me/x.ts" }))).not.toContain("/Users");
  });
  it("web.call: never host or query", () => {
    const r = ev("web.call", { tool: "web_crawl", ms: 900, ok: true, service: "default", host: "docs.foo.com", resultChars: 5000, pages: 3 });
    expect(r).toEqual({ name: "web_tool_called", params: { tool: "crawl", service: "default", ok: true, ms: 900, chars: 5000, pages: 3 } });
    expect(ev("web.call", { tool: "web_search", ms: 0, ok: false, service: "default", code: "DEFAULT_PAUSED", queryChars: 12 })?.params)
      .toEqual({ tool: "search", service: "default", ok: false, ms: 0, errorCode: "DEFAULT_PAUSED" });
    expect(JSON.stringify(r)).not.toContain("docs.foo.com");
  });
  it("web codes: known pass, 4xx bucket, anything the service invented is other", () => {
    expect(mapWebCode("HTTP_404")).toBe("HTTP_4XX");
    expect(mapWebCode("HTTP_503")).toBe("other");
    expect(mapWebCode("DEADLINE")).toBe("DEADLINE");
    expect(mapWebCode("Your key /etc/passwd is bad")).toBe("other");
    expect(mapWebCode(undefined)).toBe("other");
  });
  it("plugin.installed: store id or custom", () => {
    expect(ev("plugin.installed", { plugin: "superpowers", marketplace: "store-id" })?.params).toEqual({ plugin: "superpowers", marketplace: "store" });
    expect(ev("plugin.installed", { plugin: "my-private", marketplace: "https://x" })?.params).toEqual({ plugin: "custom", marketplace: "custom" });
  });
  it("storePluginId: only the official marketplace's verified entries", () => {
    const known = PLUGIN_CATALOG[0].name;
    expect(storePluginId(known, OFFICIAL_MARKETPLACE_ID)).toBe(known);
    expect(storePluginId(known, "someone-else")).toBeNull();
    expect(storePluginId("not-in-the-store", OFFICIAL_MARKETPLACE_ID)).toBeNull();
  });
  it("session.start: a NEW non-schedule session only; a resume (reopen or hibernation wake) is nothing", () => {
    expect(ev("session.start", { resume: false }, { sessionId: "s", workspaceId: "/wt" })).toEqual({ name: "session_opened", params: { kind: "new", inWorktree: true } });
    expect(ev("session.start", { resume: true }, { sessionId: "s" })).toBeNull();
    expect(ev("session.start", { resume: false }, { sessionId: "sched" })).toBeNull();
  });
  it("every event it produces passes the guard", () => {
    for (const r of [
      ev("permission.decision", { tool: "mcp:github_x", decision: "deny", source: "user", rule: { action: "ask" } }, { sessionId: "s" }),
      ev("web.call", { tool: "web_fetch", ms: 5, ok: false, service: "custom", code: "HTTP_401" }),
      ev("git.action", { action: "delete-branch", branch: "x" }),
      ev("session.start", { resume: false }, { sessionId: "s" }),
    ]) expect(checkEvent(r!.name, r!.params).ok).toBe(true);
  });
  it("an unknown row type is nothing", () => expect(ev("memory.saved", { text: "secret" })).toBeNull());
});
