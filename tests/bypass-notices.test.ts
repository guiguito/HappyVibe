import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BypassNotices } from "../src/main/bypassNotices";

const notify = (sessionId: string, payload: Record<string, unknown>, id = `n-${sessionId}`) => ({
  id,
  sessionId,
  method: "notify",
  message: JSON.stringify(payload),
});
const on = (sid: string, id?: string) => notify(sid, { kind: "hv.dangerous", on: true }, id);
const off = (sid: string) => notify(sid, { kind: "hv.dangerous", on: false }, `off-${sid}`);

/** docs round #2: a window that opens after session_start must still learn the session runs without asking. */
describe("BypassNotices", () => {
  it("keeps the ON envelope, shaped exactly like the forwarded notify, for replay", () => {
    const n = new BypassNotices();
    n.note(on("s1"));
    expect(n.list()).toEqual([on("s1")]);
  });

  it("keeps only the latest per session, and an OFF forgets it", () => {
    const n = new BypassNotices();
    n.note(on("s1", "a"));
    n.note(on("s1", "b"));
    n.note(on("s2"));
    expect(n.list().map((e) => e.id)).toEqual(["b", "n-s2"]);
    n.note(off("s1"));
    expect(n.list().map((e) => e.sessionId)).toEqual(["s2"]);
  });

  it("drop forgets one session and no other's", () => {
    const n = new BypassNotices();
    n.note(on("s1"));
    n.note(on("s2"));
    n.drop("s1");
    n.drop("nope");
    expect(n.list().map((e) => e.sessionId)).toEqual(["s2"]);
  });

  it("ignores everything that is not an hv.dangerous {on: boolean} notify", () => {
    const n = new BypassNotices();
    n.note(notify("s1", { kind: "hv.dangerous", stage: "error", message: "Usage: /hv-dangerous on|off" }));
    n.note(notify("s1", { kind: "hv.readonly", enabled: true }));
    n.note(notify("s1", { kind: "hv.dangerous", on: "yes" }));
    n.note({ id: "x", sessionId: "s1", method: "notify", message: "not json" });
    n.note({ id: "y", sessionId: "s1", method: "select", title: JSON.stringify({ kind: "hv.dangerous", on: true }) });
    expect(n.list()).toEqual([]);
  });
});

describe("wiring (source scan)", () => {
  const ipc = fs.readFileSync(path.join(process.cwd(), "src/main/ipc.ts"), "utf8");
  const handler = (name: string, len = 900): string => {
    const at = ipc.indexOf(name);
    expect(at, name).toBeGreaterThan(0);
    return ipc.slice(at, at + len);
  };

  it("main records the forwarded notify and replays the recorded ones, re-stamped, through the same handler", () => {
    expect(ipc).toContain("bypassNotices.note(");
    const h = handler('ipcMain.handle("hv:pending-ui-requests"');
    expect(h).toContain("...bypassNotices.list().map((r) => stampPrompt(r))");
    // The replay is a notify: it is never registered as outstanding, so nothing can answer it.
    expect(h).not.toContain("respondUi");
  });

  it("a session's exit (and so every respawn) forgets it", () => {
    const h = handler('manager.on("session-exit"', 700);
    expect(h).toContain("bypassNotices.drop(sessionId)");
  });
});
