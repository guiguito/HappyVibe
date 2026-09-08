import { describe, expect, it, vi } from "vitest";
import { WindowRegistry, type WinLike } from "../src/main/windows";

function fakeWin(id: number): WinLike & { sent: [string, unknown][]; close(): void; destroyed: boolean } {
  let onClosed: (() => void) | null = null;
  const w = {
    id,
    destroyed: false,
    sent: [] as [string, unknown][],
    isDestroyed() { return w.destroyed; },
    webContents: { id: id * 10, isDestroyed() { return w.destroyed; }, send(c: string, p?: unknown) { w.sent.push([c, p]); } },
    on(_e: "closed", cb: () => void) { onClosed = cb; return w; },
    close() { w.destroyed = true; onClosed?.(); },
  };
  return w;
}

describe("WindowRegistry", () => {
  it("broadcasts to every live window and skips destroyed ones", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {}), b = reg.add(fakeWin(2), {});
    a.destroyed = true; // destroyed but `closed` not yet delivered
    reg.broadcast("hv:x", 1);
    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([["hv:x", 1]]);
  });

  it("primary is the oldest live window, and moves on when it closes", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {}), b = reg.add(fakeWin(2), {});
    expect(reg.primary()).toBe(a);
    a.close();
    expect(reg.primary()).toBe(b);
    expect(reg.all()).toEqual([b]);
  });

  it("resolves a window from its webContents (the ipc sender)", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {});
    expect(reg.bySender({ id: 10 })).toBe(a);
    expect(reg.bySender({ id: 99 })).toBeNull();
  });

  it("keeps an opaque record per window, in creation order, and forgets it on close", () => {
    const onClosed = vi.fn();
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), { n: 1 });
    reg.add(fakeWin(2), { n: 2 });
    reg.setOnClosed(onClosed); // bound AFTER add — ipc.ts binds it after index.ts made the windows
    reg.setRecord(a.id, { n: "one" });
    expect(reg.records()).toEqual([{ n: "one" }, { n: 2 }]);
    reg.setHolds(a.id, { sessions: ["s1"], terminals: ["t1"], browsers: [] });
    a.close();
    expect(reg.records()).toEqual([{ n: 2 }]);
    expect(onClosed).toHaveBeenCalledWith(1, { n: "one" }, { sessions: ["s1"], terminals: ["t1"], browsers: [] });
  });

  it("names the window holding a session, or null", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {}), b = reg.add(fakeWin(2), {});
    reg.setHolds(b.id, { sessions: ["s9"], terminals: [], browsers: [] });
    expect(reg.holderOf("s9")).toBe(b.id);
    expect(reg.holderOf("nope")).toBeNull();
    void a;
  });

  it("a window that never declared holdings holds nothing (no undefined reaching a caller)", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), {});
    expect(reg.holds(a.id)).toEqual({ sessions: [], terminals: [], browsers: [] });
    expect(reg.holderOf("s1")).toBeNull();
  });

  it("setRecord on an unknown or closed window is a no-op, never a resurrection", () => {
    const reg = new WindowRegistry();
    const a = reg.add(fakeWin(1), { n: 1 });
    a.close();
    reg.setRecord(a.id, { n: "zombie" });
    reg.setRecord(999, { n: "ghost" });
    expect(reg.records()).toEqual([]);
    expect(reg.record(a.id)).toBeUndefined();
  });
});
