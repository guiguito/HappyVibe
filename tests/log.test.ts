import { describe, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../src/main/log";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "hv-log-")), "events.jsonl");

describe("EventLog", () => {
  test("appends and reads back events with ts stamped", async () => {
    const log = new EventLog(tmpFile());
    await log.append({ type: "session.start", sessionId: "s1", workspaceId: "w1" });
    await log.append({ type: "permission.decision", sessionId: "s1", data: { tool: "bash", decision: "deny" } });
    const events = await log.read();
    expect(events).toHaveLength(2);
    expect(events[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[1].data).toEqual({ tool: "bash", decision: "deny" });
  });

  test("filters by type, sessionId, workspaceId", async () => {
    const log = new EventLog(tmpFile());
    await log.append({ type: "a", sessionId: "s1", workspaceId: "w1" });
    await log.append({ type: "b", sessionId: "s2", workspaceId: "w1" });
    expect(await log.read({ type: "a" })).toHaveLength(1);
    expect(await log.read({ sessionId: "s2" })).toHaveLength(1);
    expect(await log.read({ workspaceId: "w1" })).toHaveLength(2);
    expect(await log.read({ workspaceId: "w9" })).toHaveLength(0);
  });

  test("concurrent appends never interleave lines", async () => {
    const log = new EventLog(tmpFile());
    await Promise.all(Array.from({ length: 50 }, (_, i) => log.append({ type: "t", data: { i } })));
    const events = await log.read();
    expect(events).toHaveLength(50);
  });

  test("skips a torn line and missing file reads as empty", async () => {
    const file = tmpFile();
    const log = new EventLog(file);
    expect(await log.read()).toEqual([]);
    await log.append({ type: "ok" });
    appendFileSync(file, '{"ts":"2026-07-05T', "utf8"); // simulated crash mid-write
    expect(await log.read()).toHaveLength(1);
  });
});
