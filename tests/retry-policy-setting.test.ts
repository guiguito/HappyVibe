import { describe, expect, test } from "vitest";
import fs from "node:fs";
import { RETRY_POLICY } from "../src/main/providerError";
import { withRetryPolicy } from "../src/main/subagentSettings";

/**
 * A dropped connection pauses the turn for minutes instead of ending it: Pi's
 * own retry continues the same turn, so the fix is its budget, written into
 * Pi's settings file for every spawn. Key-free: no model call here.
 */

test("withRetryPolicy writes the budget into Pi's retry settings and keeps every other key", () => {
  const s = { compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetryDelayMs: 60_000 } } };
  expect(withRetryPolicy(s)).toEqual({
    compaction: { enabled: false },
    retry: {
      // Pi's own set_auto_retry owns `enabled`: left as it is.
      enabled: false,
      provider: { maxRetryDelayMs: 60_000 },
      maxRetries: RETRY_POLICY.maxRetries,
      baseDelayMs: RETRY_POLICY.baseDelayMs,
      maxAgentDelayMs: RETRY_POLICY.maxDelayMs,
    },
  });
  expect(withRetryPolicy({})).toEqual({
    retry: { maxRetries: RETRY_POLICY.maxRetries, baseDelayMs: RETRY_POLICY.baseDelayMs, maxAgentDelayMs: RETRY_POLICY.maxDelayMs },
  });
});

test("the keys are the ones Pi reads (settings-manager getRetrySettings)", () => {
  const pi = fs.readFileSync("pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js", "utf8");
  for (const key of ["maxRetries", "baseDelayMs", "maxAgentDelayMs"]) expect(pi).toContain(`this.settings.retry?.${key}`);
});

test("the policy is written at startup, before any session spawns", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const startup = ipc.indexOf("writePiCompactionSetting();");
  expect(startup).toBeGreaterThan(-1);
  expect(ipc.indexOf("writePiRetrySetting();", startup)).toBeGreaterThan(startup);
});

/**
 * The transcript side, by source scan (no DOM in this suite). Pi emits agent_end
 * BEFORE auto_retry_start, so a card flushed at agent_end landed once per
 * attempt: measured with a stream cut mid-request, four red "failed without
 * saying why" cards in sixteen seconds, under a notice frozen on its first text.
 */
describe("a retried attempt leaves no card and no half answer", () => {
  const app = fs.readFileSync("src/renderer/src/App.tsx", "utf8");
  const on = (type: string): string => {
    const i = app.indexOf(`if (e.type === "${type}") {`);
    expect(i, type).toBeGreaterThan(-1);
    return app.slice(i, app.indexOf("\n      }\n", i));
  };

  test("agent_end holds the error for Pi's verdict instead of showing it", () => {
    const end = on("agent_end");
    expect(end).toContain("errorVerdict.current.add(sid)");
    expect(end).not.toMatch(/kind: "error"/);
  });

  test("the next event is the verdict: a retry drops the error, anything else shows it", () => {
    const top = app.slice(app.indexOf("const offPiEvent = window.hv.onPiEvent"), app.indexOf("§7 round 25: any event resets"));
    expect(top).toMatch(/errorVerdict\.current\.has\(sid\) && e\.type !== "auto_retry_start"/);
    expect(top).toContain("flushPendingError(sid)");
    const retry = on("auto_retry_start");
    expect(retry).toContain("delete pendingError.current[sid]");
    expect(retry).toContain("errorVerdict.current.delete(sid)");
  });

  test("the paused turn stays busy, so Stop is there and a new message joins it", () => {
    expect(on("auto_retry_start")).toMatch(/setBusy\(\(p\) => \(p\[sid\] \? p : \{ \.\.\.p, \[sid\]: true \}\)\)/);
  });

  test("a failed attempt's partial answer is held with its error, not committed", () => {
    const i = app.indexOf('m.stopReason === "error"');
    const block = app.slice(i, app.indexOf("pendingError.current[sid] = {", i) + 200);
    expect(block).toContain("discardStream(sid)");
    expect(block).not.toContain("commitStream(sid)");
  });

  test("no notice predicts the id appendItem will give it", () => {
    expect(app).not.toMatch(/= idCounter\.current;/);
  });
});
