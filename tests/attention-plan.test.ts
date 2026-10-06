import { describe, expect, test } from "vitest";
import { attentionPlan, dotBitmap, ATTENTION_BODY } from "../src/main/attentionPlan";

// §10 round 25 — a waiting prompt is noticed from outside the app too.
const bg = { total: 1, arrived: true, focused: false, notified: false };

describe("macOS", () => {
  test("a prompt in the background: badge, one informational bounce, the one-time notification", () => {
    expect(attentionPlan({ platform: "darwin", ...bg })).toEqual({ badge: 1, overlay: null, bounce: true, flash: false, notify: true });
  });
  test("already notified once: never again", () => {
    expect(attentionPlan({ platform: "darwin", ...bg, total: 2, notified: true })).toEqual({ badge: 2, overlay: null, bounce: true, flash: false, notify: false });
  });
  test("focused: no bounce, no notification — but the badge still counts", () => {
    expect(attentionPlan({ platform: "darwin", ...bg, focused: true })).toEqual({ badge: 1, overlay: null, bounce: false, flash: false, notify: false });
  });
  test("an answer (count drops, nothing arrived): only the badge moves", () => {
    expect(attentionPlan({ platform: "darwin", total: 0, arrived: false, focused: false, notified: true })).toEqual({ badge: 0, overlay: null, bounce: false, flash: false, notify: false });
  });
});

describe("Windows", () => {
  test("no badge API: overlay dot + taskbar flash, no notification ever", () => {
    expect(attentionPlan({ platform: "win32", ...bg })).toEqual({ badge: null, overlay: true, bounce: false, flash: true, notify: false });
  });
  test("count back to 0 removes the dot", () => {
    expect(attentionPlan({ platform: "win32", total: 0, arrived: false, focused: false, notified: false }).overlay).toBe(false);
  });
});

describe("Linux", () => {
  test("launcher badge + urgency flash, no notification", () => {
    expect(attentionPlan({ platform: "linux", ...bg })).toEqual({ badge: 1, overlay: null, bounce: false, flash: true, notify: false });
  });
});

test("the notification body is the spec's sentence", () => {
  expect(ATTENTION_BODY).toBe("A session is waiting for your answer");
});

test("the overlay dot is a filled circle: opaque centre, transparent corner", () => {
  const b = dotBitmap(16);
  expect(b.length).toBe(16 * 16 * 4);
  const px = (x: number, y: number): number[] => [...b.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  expect(px(8, 8)[3]).toBe(255);
  expect(px(0, 0)[3]).toBe(0);
});

import { readFileSync } from "node:fs";
import path from "node:path";
const read = (f: string): string => readFileSync(path.join(process.cwd(), f), "utf8");

describe("one source for the count: main's pendingUi", () => {
  test("the renderer no longer reports a badge count", () => {
    expect(read("src/renderer/src/App.tsx")).not.toContain("setBadgeCount");
    expect(read("src/preload/index.ts")).not.toContain("hv:set-badge-count");
    expect(read("src/main/ipc.ts")).not.toContain('"hv:set-badge-count"');
  });
  test("main applies the plan when the pending set changes", () => {
    const ipc = read("src/main/ipc.ts");
    expect(ipc).toContain("attentionPlan(");
    expect(ipc).toContain('dock?.bounce("informational")');
    expect(ipc).not.toContain('bounce("critical")');
    // ipc.ts has older process.platform reads; the NEW code must branch on the seam.
    const at = ipc.indexOf("const applyAttention");
    expect(at).toBeGreaterThan(-1);
    const fn = ipc.slice(at, at + 2_000);
    expect(fn).toContain("platform.name");
    expect(fn).not.toMatch(/process\.platform/);
  });
});
