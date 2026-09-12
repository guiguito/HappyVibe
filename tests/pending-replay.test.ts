import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PendingPrompts } from "../src/main/pendingPrompts";

const P = (): PendingPrompts => new PendingPrompts(new Set(["select", "input"]));
const perm = (id: string, sid = "s1"): { id: string; sessionId: string; method: string; title: string } => ({
  id, sessionId: sid, method: "select", title: JSON.stringify({ kind: "hv.permission" }),
});

describe("PendingPrompts", () => {
  it("retains a blocking envelope for replay and counts it", () => {
    const p = P();
    expect(p.note(perm("a"))).toBe(true);
    expect(p.list()).toEqual([perm("a")]);
    expect(p.counts()).toEqual({ s1: 1 });
  });

  it("never retains a notify — that map would grow with every transcript card a session draws", () => {
    const p = P();
    expect(p.note({ id: "n", sessionId: "s1", method: "notify", message: "{}" })).toBe(false);
    expect(p.list()).toEqual([]);
    expect(p.counts()).toEqual({});
  });

  it("replays oldest first, so the agent's questions arrive in the order it asked them", () => {
    const p = P();
    p.note(perm("a"));
    p.note(perm("b"));
    p.note(perm("c"));
    expect(p.list().map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("answering clears it; a crashed session drops its own and no other's", () => {
    const p = P();
    p.note(perm("a"));
    p.note(perm("b", "s2"));
    p.note(perm("c"));
    expect(p.clear("a")).toBe(true);
    expect(p.clear("a")).toBe(false);
    expect(p.dropSession("s1")).toBe(true);
    expect(p.dropSession("s1")).toBe(false);
    expect(p.list().map((e) => e.id)).toEqual(["b"]);
    expect(p.counts()).toEqual({ s2: 1 });
  });

  it("counts can exclude the utility session, which is nobody's sidebar row", () => {
    const p = P();
    p.note(perm("u", "utility"));
    p.note(perm("a"));
    expect(p.counts("utility")).toEqual({ s1: 1 });
    expect(p.list()).toHaveLength(2); // still replayable — only the COUNT excludes it
  });
});

describe("wiring (source scan)", () => {
  const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("main exposes the outstanding prompts, re-stamped at REPLAY time", () => {
    const ipc = R("src/main/ipc.ts");
    expect(ipc).toMatch(/ipcMain\.handle\("hv:pending-ui-requests"/);
    // The original stamp may name a window that has since closed — which is
    // exactly the case this feature exists for, so it must be recomputed.
    expect(ipc).toMatch(/pendingUi\.list\(\)\.map\(\(r\) => stampPrompt\(r\)\)/);
  });

  it("the renderer replays through the SAME handler as a live request", () => {
    const app = R("src/renderer/src/App.tsx");
    expect(app).toMatch(/window\.hv\.onUiRequest\(handleUiRequest\)/);
    expect(app).toMatch(/pendingUiRequests\(\)/);
  });

  it("a replayed prompt cannot be queued twice when it races a live push", () => {
    const app = R("src/renderer/src/App.tsx");
    expect(app).toMatch(/q\.some\(\(x\) => x\.req\.id === r\.id\)/);
  });
});
