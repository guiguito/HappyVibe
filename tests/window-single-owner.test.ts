/**
 * §7 round 23 — the source scans that keep "a tab lives in exactly one window"
 * true, in the no-DOM suite's two halves: pure exports asserted as DATA (see
 * tests/window-registry.test.ts and friends), plus these scans for what must be
 * ABSENT. An absence is exactly what a render test does not fail on, and every
 * item here is a way the app was single-window by construction.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ipc = readFileSync("src/main/ipc.ts", "utf8");
const index = readFileSync("src/main/index.ts", "utf8");

describe("main is no longer bound to one window (round 23)", () => {
  it("registerIpc receives the registry, not a BrowserWindow", () => {
    expect(ipc).toMatch(/export function registerIpc\(windows: WindowRegistry<BrowserWindow>\)/);
    expect(ipc).not.toMatch(/export function registerIpc\(win: BrowserWindow\)/);
  });

  it("the one push helper is a broadcast", () => {
    expect(ipc).toMatch(/const send = \(channel: string, payload\?: unknown\): void => windows\.broadcast\(channel, payload\)/);
    expect(ipc).not.toMatch(/win\.webContents\.send\(/);
  });

  it("no dialog parents on a captured window — all seven parent on the sender's", () => {
    expect(ipc).not.toMatch(/showOpenDialog\(win,/);
    expect(ipc.match(/showOpenDialog\(ownerOf\(e\)/g)?.length).toBe(7);
  });

  it("the dock-click window goes through the registry too, so it receives pushes", () => {
    // It never did: `activate` called createWindow() and that window was never
    // handed to registerIpc, so it was deaf for its whole life.
    expect(index).not.toMatch(/length === 0\) createWindow\(\)/);
    expect(index).toMatch(/if \(windows\.all\(\)\.length === 0\) openWindow\(/);
  });
});
