/**
 * §13 round 12 — "servers fail on startup and connect fine on a click".
 *
 * Reported on Miro and Context7. Not flakiness: the probe gave `connect` and
 * `listTools` ONE shared 5 s deadline, never retried, and the startup sweep
 * fired every server at once — every TLS handshake, token refresh and `npx`
 * cold start racing at the busiest moment the app has. Reconnect worked because
 * the second attempt is warm.
 *
 * These tests drive the pure pieces (deadline arithmetic and the concurrency
 * cap); the transport itself is the SDK's and is not re-tested here.
 */
import { describe, expect, test } from "vitest";
import { mapLimit, probeDeadlines, shouldRetry } from "../src/main/mcpClient";

describe("probeDeadlines", () => {
  test("connect and list get their OWN budgets, not one shared clock", () => {
    const d = probeDeadlines({});
    // The bug in one assertion: 8s connect + 4s list must both fit.
    expect(d.connectMs).toBeGreaterThanOrEqual(15_000);
    expect(d.listMs).toBeGreaterThanOrEqual(10_000);
  });

  test("an explicit override still wins — the live tests pass short ones", () => {
    expect(probeDeadlines({ connectMs: 200, listMs: 100 })).toMatchObject({
      connectMs: 200,
      listMs: 100,
    });
  });

  test("retries default to one, and can be switched off", () => {
    expect(probeDeadlines({}).retries).toBe(1);
    expect(probeDeadlines({ retries: 0 }).retries).toBe(0);
  });
});

describe("shouldRetry", () => {
  test("a genuine failure is worth a second attempt", () => {
    expect(shouldRetry({ state: "failed", error: "socket hang up" }, 1)).toBe(true);
  });

  test("needs-auth is an ANSWER, not a timeout — never retried", () => {
    // Retrying here would double every startup for a server that is simply
    // waiting for the user to sign in.
    expect(shouldRetry({ state: "needs-auth" }, 1)).toBe(false);
  });

  test("success is not retried, and neither is anything once the budget is spent", () => {
    expect(shouldRetry({ state: "connected", tools: [] }, 1)).toBe(false);
    expect(shouldRetry({ state: "failed", error: "x" }, 0)).toBe(false);
  });
});

describe("mapLimit", () => {
  test("caps how many run at once — the sweep is a badge, not a race", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([...Array(12).keys()], 4, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return n * 2;
    });
    expect(peak).toBe(4);
    expect(out).toEqual([...Array(12).keys()].map((n) => n * 2)); // order preserved
  });

  test("one rejection does not sink the sweep", async () => {
    const out = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(out).toEqual([1, undefined, 3]);
  });

  test("fewer items than the cap still completes", async () => {
    expect(await mapLimit([1], 4, async (n) => n)).toEqual([1]);
    expect(await mapLimit([], 4, async (n) => n)).toEqual([]);
  });
});
