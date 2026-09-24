import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { initialState, installGate, reduce, updateMode } from "../src/main/update/state";

/** PRD §38 — the updater's decisions, pure. Electron-free, key-free. */

describe("updateMode", () => {
  it("dev never updates", () => expect(updateMode({ packaged: false, platform: "darwin" })).toBe("disabled"));
  it("macOS and Windows update in place", () => {
    expect(updateMode({ packaged: true, platform: "darwin" })).toBe("auto");
    expect(updateMode({ packaged: true, platform: "win32" })).toBe("auto");
  });
  it("an AppImage updates in place; a deb is manual (the updater cannot replace it)", () => {
    expect(updateMode({ packaged: true, platform: "linux", appImage: "/x.AppImage" })).toBe("auto");
    expect(updateMode({ packaged: true, platform: "linux" })).toBe("manual");
  });
});

describe("reduce", () => {
  const s0 = initialState("auto", true);
  it("found + auto on → downloading → ready", () => {
    let s = reduce(s0, { t: "available", version: "0.3.0" });
    expect(s.phase).toEqual({ k: "downloading", version: "0.3.0", percent: 0 });
    s = reduce(s, { t: "progress", percent: 42 });
    expect(s.phase).toMatchObject({ k: "downloading", percent: 42 });
    s = reduce(s, { t: "downloaded", version: "0.3.0", at: 5 });
    expect(s.phase).toEqual({ k: "ready", version: "0.3.0" });
    expect(s.lastCheckedAt).toBe(5);
  });
  // Review Focus 3: never "Restart to update" for something not downloaded.
  it("found + auto OFF → available, never ready", () => {
    expect(reduce(initialState("auto", false), { t: "available", version: "0.3.0" }).phase).toEqual({ k: "available", version: "0.3.0" });
  });
  it("manual mode (deb) → available even with auto on", () => {
    expect(reduce(initialState("manual", true), { t: "available", version: "0.3.0" }).phase.k).toBe("available");
  });
  it("progress outside a download is ignored", () => {
    expect(reduce(s0, { t: "progress", percent: 50 })).toEqual(s0);
  });
  // Review Focus 2: a background error stays off screen; a manual one is shown.
  it("an error remembers whether it was asked for", () => {
    const bg = reduce(reduce(s0, { t: "checking", manual: false }), { t: "error", message: "net::ERR", at: 9 });
    expect(bg.phase).toEqual({ k: "error", message: "net::ERR", manual: false });
    expect(bg.lastCheckedAt).toBe(9);
    const man = reduce(reduce(s0, { t: "checking", manual: true }), { t: "error", message: "net::ERR", at: 9 });
    expect(man.phase).toMatchObject({ manual: true });
  });
  it("a download failure after a background check stays a background error", () => {
    const dl = reduce(s0, { t: "available", version: "0.3.0" });
    expect(reduce(dl, { t: "error", message: "x", at: 1 }).phase).toMatchObject({ k: "error", manual: false });
  });
  it("a ready update survives later checks and errors", () => {
    const ready = reduce(reduce(s0, { t: "available", version: "0.3.0" }), { t: "downloaded", version: "0.3.0", at: 1 });
    expect(reduce(ready, { t: "checking", manual: false }).phase.k).toBe("ready");
    expect(reduce(ready, { t: "none", at: 2 }).phase.k).toBe("ready");
    expect(reduce(ready, { t: "error", message: "x", at: 3 }).phase.k).toBe("ready");
  });
  it("nothing new → idle with a fresh timestamp, and it remembers a manual ask", () => {
    const s = reduce(reduce(s0, { t: "checking", manual: true }), { t: "none", at: 7 });
    expect(s.phase).toEqual({ k: "idle", upToDate: true });
    expect(s.lastCheckedAt).toBe(7);
    expect(reduce(reduce(s0, { t: "checking", manual: false }), { t: "none", at: 7 }).phase).toEqual({ k: "idle" });
  });
  it("the auto toggle and the gate are plain replacements", () => {
    expect(reduce(s0, { t: "auto", on: false }).auto).toBe(false);
    const gate = { blockedBy: ["A"], terminalsOpen: true, armed: true };
    expect(reduce(s0, { t: "gate", gate }).gate).toEqual(gate);
  });
});

describe("installGate — a restart never interrupts an agent", () => {
  const live = [
    { id: "a", title: "Refactor" },
    { id: "b", title: "Docs" },
  ];
  it("all idle, nothing pending → clear", () => {
    expect(installGate({ liveSessions: live, isIdle: () => true, pendingSessionIds: [], terminalsOpen: 0 })).toEqual({ blockedBy: [], terminalsOpen: false });
  });
  it("a busy session blocks, by title", () => {
    expect(installGate({ liveSessions: live, isIdle: (id) => id !== "a", pendingSessionIds: [], terminalsOpen: 0 }).blockedBy).toEqual(["Refactor"]);
  });
  // Review Focus 1: a schedule's prompt waiting with every window closed.
  it("a retained prompt blocks even when every session reads idle, deduped by session", () => {
    expect(installGate({ liveSessions: live, isIdle: () => true, pendingSessionIds: ["b", "b"], terminalsOpen: 0 }).blockedBy).toEqual(["Docs"]);
  });
  it("a busy session with a prompt is listed once", () => {
    expect(installGate({ liveSessions: live, isIdle: (id) => id !== "a", pendingSessionIds: ["a"], terminalsOpen: 0 }).blockedBy).toEqual(["Refactor"]);
  });
  it("a prompt from a session with no live title still blocks", () => {
    expect(installGate({ liveSessions: [], isIdle: () => true, pendingSessionIds: ["zzz"], terminalsOpen: 0 }).blockedBy).toEqual(["a session waiting for you"]);
  });
  it("open terminals do not block, they warn", () => {
    expect(installGate({ liveSessions: [], isIdle: () => true, pendingSessionIds: [], terminalsOpen: 2 })).toEqual({ blockedBy: [], terminalsOpen: true });
  });
});

it("state.ts imports nothing — the renderer imports its types (the schedules.ts rule)", () => {
  const src = readFileSync(path.join(__dirname, "..", "src/main/update/state.ts"), "utf8");
  expect(src).not.toMatch(/^import /m);
});
