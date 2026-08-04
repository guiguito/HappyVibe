import { describe, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, type LogEvent } from "../src/main/log";
import { aggregate } from "../src/main/analytics";
import type { ApiCall } from "../src/main/calls";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "hv-analytics-")), "events.jsonl");

// Synthetic event with an explicit ts (aggregate reads real ts; log.append stamps
// its own, so for time-dependent aggregates we build LogEvents directly).
const ev = (e: Partial<LogEvent> & { type: string; ts: string }): LogEvent => e as LogEvent;

const startStats = (
  input: number,
  output: number,
  cost: number,
  model?: string,
): Record<string, unknown> => ({ stats: { tokens: { input, output }, cost, ...(model ? { model } : {}) } });

describe("analytics.aggregate — pure", () => {
  test("empty log yields a zeroed shape", () => {
    const a = aggregate([]);
    expect(a.totalSessions).toBe(0);
    expect(a.tokens).toEqual({ input: 0, output: 0 });
    expect(a.cost).toBe(0);
    expect(a.duration).toEqual({ avgMs: null, medianMs: null, count: 0 });
    expect(a.sessionsPerDay).toEqual([]);
    expect(a.perWorkspace).toEqual([]);
    expect(a.perModel).toEqual([]);
    expect(a.permissions.total).toBe(0);
  });

  test("token + cost sums come only from ended sessions' stats", () => {
    const a = aggregate([
      ev({ type: "session.start", sessionId: "s1", workspaceId: "w1", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s1", workspaceId: "w1", ts: "2026-07-01T10:05:00.000Z", data: startStats(100, 40, 0.5) }),
      ev({ type: "session.start", sessionId: "s2", workspaceId: "w1", ts: "2026-07-01T11:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s2", workspaceId: "w1", ts: "2026-07-01T11:02:00.000Z", data: startStats(10, 5, 0.1) }),
    ]);
    expect(a.tokens).toEqual({ input: 110, output: 45 });
    expect(a.cost).toBeCloseTo(0.6, 6);
    expect(a.totalSessions).toBe(2);
    expect(a.openSessions).toBe(0);
  });

  test("duration pairs start→end by sessionId; avg + median", () => {
    const a = aggregate([
      // 5 min, 1 min, 3 min
      ev({ type: "session.start", sessionId: "s1", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s1", ts: "2026-07-01T10:05:00.000Z" }),
      ev({ type: "session.start", sessionId: "s2", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s2", ts: "2026-07-01T10:01:00.000Z" }),
      ev({ type: "session.start", sessionId: "s3", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s3", ts: "2026-07-01T10:03:00.000Z" }),
    ]);
    expect(a.duration.count).toBe(3);
    expect(a.duration.avgMs).toBe((5 + 1 + 3) * 60000 / 3);
    expect(a.duration.medianMs).toBe(3 * 60000); // sorted [1,3,5] → 3
  });

  test("even count median averages the two middles", () => {
    const a = aggregate([
      ev({ type: "session.start", sessionId: "s1", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s1", ts: "2026-07-01T10:02:00.000Z" }), // 2m
      ev({ type: "session.start", sessionId: "s2", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s2", ts: "2026-07-01T10:04:00.000Z" }), // 4m
    ]);
    expect(a.duration.medianMs).toBe(3 * 60000); // (2+4)/2
  });

  test("start with no matching end = open, contributes no duration", () => {
    const a = aggregate([
      ev({ type: "session.start", sessionId: "s1", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.start", sessionId: "s2", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s2", ts: "2026-07-01T10:05:00.000Z", data: startStats(1, 1, 0) }),
    ]);
    expect(a.totalSessions).toBe(2);
    expect(a.openSessions).toBe(1);
    expect(a.duration.count).toBe(1);
  });

  test("groups tokens/cost per workspace, sorted by sessions desc", () => {
    const a = aggregate([
      ev({ type: "session.start", sessionId: "s1", workspaceId: "wA", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s1", workspaceId: "wA", ts: "2026-07-01T10:01:00.000Z", data: startStats(100, 0, 1) }),
      ev({ type: "session.start", sessionId: "s2", workspaceId: "wA", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s2", workspaceId: "wA", ts: "2026-07-01T10:01:00.000Z", data: startStats(50, 0, 0.5) }),
      ev({ type: "session.start", sessionId: "s3", workspaceId: "wB", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s3", workspaceId: "wB", ts: "2026-07-01T10:01:00.000Z", data: startStats(10, 0, 0.1) }),
    ]);
    expect(a.perWorkspace.map((b) => b.key)).toEqual(["wA", "wB"]);
    expect(a.perWorkspace[0]).toMatchObject({ sessions: 2, tokens: 150, cost: 1.5 });
  });

  test("per-model breakdown only when stats carry a model", () => {
    const noModel = aggregate([
      ev({ type: "session.start", sessionId: "s1", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s1", ts: "2026-07-01T10:01:00.000Z", data: startStats(1, 1, 0) }),
    ]);
    expect(noModel.perModel).toEqual([]);

    const withModel = aggregate([
      ev({ type: "session.start", sessionId: "s1", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s1", ts: "2026-07-01T10:01:00.000Z", data: startStats(10, 0, 0, "deepseek-chat") }),
      ev({ type: "session.start", sessionId: "s2", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s2", ts: "2026-07-01T10:01:00.000Z", data: startStats(20, 0, 0, "deepseek-chat") }),
    ]);
    expect(withModel.perModel).toHaveLength(1);
    expect(withModel.perModel[0]).toMatchObject({ key: "deepseek-chat", sessions: 2, tokens: 30 });
  });

  test("permission decisions counted by decision and source; crashes counted", () => {
    const a = aggregate([
      ev({ type: "permission.decision", ts: "2026-07-01T10:00:00.000Z", data: { decision: "deny", source: "rule" } }),
      ev({ type: "permission.decision", ts: "2026-07-01T10:00:01.000Z", data: { decision: "allow", source: "user" } }),
      ev({ type: "permission.decision", ts: "2026-07-01T10:00:02.000Z", data: { decision: "allow", source: "rule" } }),
      ev({ type: "session.crash", sessionId: "s1", ts: "2026-07-01T10:00:03.000Z", data: { code: 1 } }),
    ]);
    expect(a.permissions.total).toBe(3);
    expect(a.permissions.byDecision).toEqual({ deny: 1, allow: 2 });
    expect(a.permissions.bySource).toEqual({ rule: 2, user: 1 });
    expect(a.crashes).toBe(1);
  });

  test("unknown event types (e.g. session.hibernate, W1.3) are ignored gracefully", () => {
    const a = aggregate([
      ev({ type: "session.start", sessionId: "s1", workspaceId: "w1", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.hibernate", sessionId: "s1", workspaceId: "w1", ts: "2026-07-01T10:30:00.000Z", data: startStats(9, 9, 9) }),
      ev({ type: "totally.unknown", ts: "2026-07-01T10:31:00.000Z" }),
    ]);
    expect(a.totalSessions).toBe(1);
    expect(a.crashes).toBe(0);
    expect(a.tokens).toEqual({ input: 0, output: 0 }); // hibernate stats don't count as an end
    expect(a.openSessions).toBe(1); // hibernated ≠ ended
  });

  test("missing / null / partial stats degrade to zero, never throw", () => {
    const a = aggregate([
      ev({ type: "session.start", sessionId: "s1", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s1", ts: "2026-07-01T10:01:00.000Z", data: { stats: null } }),
      ev({ type: "session.start", sessionId: "s2", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s2", ts: "2026-07-01T10:01:00.000Z", data: { stats: { tokens: {} } } }),
      ev({ type: "session.start", sessionId: "s3", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.end", sessionId: "s3", ts: "2026-07-01T10:01:00.000Z" }), // no data at all
    ]);
    expect(a.tokens).toEqual({ input: 0, output: 0 });
    expect(a.cost).toBe(0);
    expect(a.totalSessions).toBe(3);
  });

  test("sessionsPerDay buckets by UTC day, ascending", () => {
    const a = aggregate([
      ev({ type: "session.start", sessionId: "s1", ts: "2026-07-02T10:00:00.000Z" }),
      ev({ type: "session.start", sessionId: "s2", ts: "2026-07-01T10:00:00.000Z" }),
      ev({ type: "session.start", sessionId: "s3", ts: "2026-07-01T23:00:00.000Z" }),
    ]);
    expect(a.sessionsPerDay).toEqual([
      { date: "2026-07-01", count: 2 },
      { date: "2026-07-02", count: 1 },
    ]);
  });

  test("workspaceId filter restricts every aggregate", () => {
    const a = aggregate(
      [
        ev({ type: "session.start", sessionId: "s1", workspaceId: "wA", ts: "2026-07-01T10:00:00.000Z" }),
        ev({ type: "session.end", sessionId: "s1", workspaceId: "wA", ts: "2026-07-01T10:01:00.000Z", data: startStats(100, 0, 1) }),
        ev({ type: "session.start", sessionId: "s2", workspaceId: "wB", ts: "2026-07-01T10:00:00.000Z" }),
        ev({ type: "session.end", sessionId: "s2", workspaceId: "wB", ts: "2026-07-01T10:01:00.000Z", data: startStats(999, 0, 9) }),
      ],
      { workspaceId: "wA" },
    );
    expect(a.totalSessions).toBe(1);
    expect(a.tokens.input).toBe(100);
  });

  test("sinceTs filter drops older events", () => {
    const a = aggregate(
      [
        ev({ type: "session.start", sessionId: "old", ts: "2026-06-01T10:00:00.000Z" }),
        ev({ type: "session.start", sessionId: "new", ts: "2026-07-01T10:00:00.000Z" }),
      ],
      { sinceTs: "2026-07-01T00:00:00.000Z" },
    );
    expect(a.totalSessions).toBe(1);
  });

  test("end-to-end over a real EventLog, corrupt line skipped", async () => {
    const file = tmpFile();
    const log = new EventLog(file);
    await log.append({ type: "session.start", sessionId: "s1", workspaceId: "w1" });
    await log.append({ type: "session.end", sessionId: "s1", workspaceId: "w1", data: startStats(5, 5, 0.01) });
    // torn line — EventLog.read skips it, aggregate must still work
    const { appendFileSync } = await import("node:fs");
    appendFileSync(file, '{"ts":"2026-07-05T', "utf8");
    const a = aggregate(await log.read());
    expect(a.totalSessions).toBe(1);
    expect(a.tokens).toEqual({ input: 5, output: 5 });
    expect(a.cost).toBeCloseTo(0.01, 6);
  });
});

// ── round 11: cost comes from the ledger, so Stats agrees with the session pill ──

describe("ledger-backed cost", () => {
  const call = (over: Partial<ApiCall> = {}): ApiCall => ({
    ts: "2026-08-04T10:00:00.000Z",
    provider: "deepseek",
    model: "deepseek-v4",
    input: 100,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.25,
    billing: "metered",
    ...over,
  });

  test("plan-provider spend is excluded from the dashboard total", () => {
    const events = [
      ev({ type: "session.start", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", workspaceId: "/w" }),
      ev({ type: "session.end", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", data: { stats: { cost: 4.2, tokens: { input: 10, output: 5 } } } }),
    ];
    // stats.cost prices a ChatGPT subscription at API rates; the ledger does not.
    const a = aggregate(events, {}, () => [call({ provider: "openai-codex", billing: "plan", cost: 4.2 })]);
    expect(a.cost).toBe(0);
  });

  test("a still-open session contributes its spend (stats.cost never saw it)", () => {
    const events = [ev({ type: "session.start", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", workspaceId: "/w" })];
    const a = aggregate(events, {}, () => [call({ cost: 1.5 })]);
    expect(a.cost).toBe(1.5);
    expect(a.openSessions).toBe(1);
  });

  test("unknown-price calls are flagged rather than counted as zero", () => {
    const events = [
      ev({ type: "session.start", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", workspaceId: "/w" }),
      ev({ type: "session.end", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", data: { stats: null } }),
    ];
    const a = aggregate(events, {}, () => [call({ cost: 0, billing: "unknown" })]);
    expect(a.costUnknown).toBe(true);
    expect(a.cost).toBe(0);
  });

  test("a session file that cannot be read marks the total unknown, not zero", () => {
    const events = [ev({ type: "session.start", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", workspaceId: "/w" })];
    const a = aggregate(events, {}, () => null);
    expect(a.costUnknown).toBe(true);
  });

  test("per-workspace and per-model cost also come from the ledger", () => {
    const events = [
      ev({ type: "session.start", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", workspaceId: "/w" }),
      ev({ type: "session.end", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", data: { stats: { cost: 99 } } }),
    ];
    const a = aggregate(events, {}, () => [
      call({ cost: 1, model: "m1" }),
      call({ cost: 2, model: "m2", billing: "plan" }),
    ]);
    expect(a.perWorkspace[0].cost).toBe(1); // plan row excluded here too
    expect(a.perModel.map((b) => b.key).sort()).toEqual(["m1", "m2"]);
    expect(a.perModel.find((b) => b.key === "m2")?.cost).toBe(0);
  });

  test("tokens come from the ledger too, so a live session is not 0", () => {
    const events = [ev({ type: "session.start", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", workspaceId: "/w" })];
    const a = aggregate(events, {}, () => [call({ input: 7, output: 3 })]);
    expect(a.tokens).toEqual({ input: 7, output: 3 });
  });

  test("without a ledger reader the old stats path still applies", () => {
    const events = [
      ev({ type: "session.start", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", workspaceId: "/w" }),
      ev({ type: "session.end", ts: "2026-08-04T10:00:00.000Z", sessionId: "s1", data: { stats: { cost: 2, tokens: { input: 4, output: 1 } } } }),
    ];
    const a = aggregate(events, {});
    expect(a.cost).toBe(2);
    expect(a.costUnknown).toBe(false);
  });
});
