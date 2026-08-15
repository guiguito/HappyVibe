import { describe, it, expect, vi } from "vitest";
import { AgentBrowsers, MAX_AGENT_BROWSERS } from "../src/main/agentBrowsers";
import type { BrowserManager } from "../src/main/browsers";

/**
 * BrowserManager needs a real Electron window, so the claims layer is tested
 * against a mock — which is the point of the split: the RULES (cap, reuse,
 * release-without-destroy) are the part that can be wrong in a way no
 * screenshot would reveal.
 */
function mockMgr(): BrowserManager & { created: number } {
  let n = 0;
  const live = new Map<string, { id: string; url: string; state: string }>();
  const mgr = {
    created: 0,
    create: vi.fn((workspaceId: string) => {
      const info = { id: `b${++n}`, workspaceId, url: "", title: "", state: "ready", canGoBack: false, canGoForward: false };
      live.set(info.id, info as never);
      mgr.created++;
      return info;
    }),
    navigate: vi.fn((id: string, url: string) => {
      const info = live.get(id);
      if (info) info.url = url;
    }),
    get: vi.fn((id: string) => live.get(id) ?? null),
    // §28 r1: newest-seen first, which is what adoption picks from.
    listByRecency: vi.fn((ws: string) =>
      [...live.values()].filter((i) => (i as { workspaceId?: string }).workspaceId === ws).reverse(),
    ),
    destroy: vi.fn((id: string) => void live.delete(id)),
  } as unknown as BrowserManager & { created: number };
  return mgr;
}

describe("AgentBrowsers (§28 claims)", () => {
  it("caps at one pane per session and reuses it by navigating", () => {
    const mgr = mockMgr();
    const ab = new AgentBrowsers(mgr);
    expect(MAX_AGENT_BROWSERS).toBe(1);

    const first = ab.open("s1", "w", "http://localhost:3000");
    expect(first).toMatchObject({ ok: true, reused: false });

    const second = ab.open("s1", "w", "http://localhost:4000");
    expect(second).toMatchObject({ ok: true, reused: true });
    expect(second.ok && second.browserId).toBe(first.ok && first.browserId);
    expect(mgr.created).toBe(1);
    expect(mgr.navigate).toHaveBeenLastCalledWith(first.ok && first.browserId, "http://localhost:4000", "agent");
  });

  it("keeps claims per session — one session never reaches another's pane", () => {
    const mgr = mockMgr();
    const ab = new AgentBrowsers(mgr);
    ab.open("s1", "w", "http://localhost:1");
    expect(ab.idFor("s2")).toBeNull();
    expect(ab.require("s2")).toMatchObject({ ok: false });
    expect(ab.require("s2").ok === false && ab.require("s2").reason).toMatch(/browser_open/);

    ab.open("s2", "w", "http://localhost:2");
    expect(ab.idFor("s1")).not.toBe(ab.idFor("s2"));
    expect(mgr.created).toBe(2);
  });

  it("ending a session releases the claim WITHOUT destroying the pane", () => {
    const mgr = mockMgr();
    const ab = new AgentBrowsers(mgr);
    const opened = ab.open("s1", "w", "http://localhost:1");
    const id = opened.ok ? opened.browserId : "";

    expect(ab.releaseSession("s1")).toEqual([id]);
    expect(mgr.destroy).not.toHaveBeenCalled();
    expect(mgr.get(id)).not.toBeNull(); // still there for the human
    expect(ab.idFor("s1")).toBeNull();
  });

  it("a pane the user closed stops being claimed, and the next open makes a new one", () => {
    const mgr = mockMgr();
    const ab = new AgentBrowsers(mgr);
    const opened = ab.open("s1", "w", "http://localhost:1");
    const id = opened.ok ? opened.browserId : "";

    mgr.destroy(id); // the user closed the tab
    expect(ab.idFor("s1")).toBeNull();
    expect(ab.require("s1")).toMatchObject({ ok: false });

    const again = ab.open("s1", "w", "http://localhost:9");
    expect(again).toMatchObject({ ok: true, reused: false });
    expect(mgr.created).toBe(2);
  });

  it("the §9 block names the page, never its content — and is empty with no pane", () => {
    const mgr = mockMgr();
    const ab = new AgentBrowsers(mgr);
    expect(ab.buildOpenBrowserBlock("s1")).toBe("");
    ab.open("s1", "w", "http://localhost:5173/app");
    const block = ab.buildOpenBrowserBlock("s1");
    expect(block).toContain("<open-browser>");
    expect(block).toContain("http://localhost:5173/app");
    expect(block.split("\n").length).toBe(3); // open tag, one row, close tag
  });
});

// ── §28 round 1: the agent adopts a browser the human opened ────────────────
describe("AgentBrowsers adoption", () => {
  it("takes over an unclaimed pane instead of opening a second one", () => {
    const mgr = mockMgr();
    // The human's browser: created outside any claim, as ⌘B does.
    const mine = mgr.create("w");
    const ab = new AgentBrowsers(mgr);

    const res = ab.open("s1", "w", "http://localhost:5173");
    expect(res).toMatchObject({ ok: true, browserId: mine.id, reused: true });
    expect(mgr.created).toBe(1); // it did NOT create a second pane
    expect(mgr.navigate).toHaveBeenCalledWith(mine.id, "http://localhost:5173", "agent");
  });

  it("never steals a pane another session already claimed", () => {
    const mgr = mockMgr();
    mgr.create("w");
    const ab = new AgentBrowsers(mgr);
    ab.open("s1", "w", "http://localhost:1"); // s1 adopts the human's

    const res = ab.open("s2", "w", "http://localhost:2");
    expect(res.ok && res.browserId).not.toBe(ab.idFor("s1"));
    expect(mgr.created).toBe(2); // s2 got its own
  });

  it("does not reach into another workspace", () => {
    const mgr = mockMgr();
    mgr.create("other-ws");
    const ab = new AgentBrowsers(mgr);

    const res = ab.open("s1", "w", "http://localhost:1");
    expect(res).toMatchObject({ reused: false });
    expect(mgr.created).toBe(2);
  });

  it("prefers the pane most recently on screen", () => {
    const mgr = mockMgr();
    mgr.create("w");
    const second = mgr.create("w"); // listByRecency mock: newest first
    const ab = new AgentBrowsers(mgr);

    const res = ab.open("s1", "w", "http://localhost:1");
    expect(res.ok && res.browserId).toBe(second.id);
  });

  it("an adopted pane survives the session that adopted it", () => {
    const mgr = mockMgr();
    const mine = mgr.create("w");
    const ab = new AgentBrowsers(mgr);
    ab.open("s1", "w", "http://localhost:1");

    expect(ab.releaseSession("s1")).toEqual([mine.id]);
    expect(mgr.destroy).not.toHaveBeenCalled();
    expect(mgr.get(mine.id)).not.toBeNull();
  });
});
