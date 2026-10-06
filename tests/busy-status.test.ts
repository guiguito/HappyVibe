import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { busyStatus, partialField, streamedLines, STREAM_QUIET_MS, type ToolDraft } from "../src/renderer/src/busyStatus";
import { toolDiff } from "../src/renderer/src/diffs";

// §7 round 25 — what the busy dots say (PRD §7, docs/validation/d1.md round 25).
const draft = (raw: string, toolName = "write"): ToolDraft => ({ contentIndex: 1, toolName, raw });
const base = { promptWaiting: false, draft: null, runningLabel: null, activity: null, now: 10_000 };

describe("partialField", () => {
  test("null until the closing quote has arrived", () => {
    expect(partialField('{"path":"scraper/jo', "path")).toBeNull();
    expect(partialField('{"path":"scraper/jobs.py","con', "path")).toBe("scraper/jobs.py");
  });
  test("unescapes JSON", () => {
    expect(partialField('{"path":"a\\"b.py"}', "path")).toBe('a"b.py');
  });
  test("never reads a path out of the file BODY", () => {
    const raw = '{"content":"{\\"path\\": \\"evil.txt\\"}\\n","path":"config.json"}';
    expect(partialField(raw, "path")).toBe("config.json");
    expect(partialField('{"content":"{\\"path\\": \\"evil.txt\\"', "path")).toBeNull();
  });
});

describe("streamedLines", () => {
  test("null before the content string opens", () => {
    expect(streamedLines('{"path":"a.py"')).toBeNull();
  });
  test("climbs while the body streams", () => {
    expect(streamedLines('{"path":"a.py","content":"one\\ntwo\\nthr')).toBe(3);
  });
  test("ends on the card's own number, with and without a trailing newline", () => {
    for (const content of ["a\nb\nc", "a\nb\nc\n", "x"]) {
      const raw = JSON.stringify({ path: "f.txt", content });
      const d = toolDiff("write", { path: "f.txt", content });
      expect(d?.kind).toBe("write");
      expect(streamedLines(raw)).toBe(d!.lines.length);
    }
  });
});

describe("busyStatus — priority order (PRD §7 round 25)", () => {
  test("a waiting prompt wins over everything", () => {
    expect(busyStatus({ ...base, promptWaiting: true, draft: draft('{"path":"a.py"') })).toBe("Waiting for your answer");
  });
  test("a write being streamed: the card's headline plus a climbing count", () => {
    expect(busyStatus({ ...base, draft: draft('{"path":"scraper/jobs.py","content":"a\\nb\\nc') })).toBe("Creating jobs.py · 3 lines");
  });
  test("content before path (MiMo, d1.md): no guessed name", () => {
    expect(busyStatus({ ...base, draft: draft('{"content":"a\\nb') })).toBe("Creating a file · 2 lines");
  });
  test("one line is singular", () => {
    expect(busyStatus({ ...base, draft: draft('{"path":"a.txt","content":"x') })).toBe("Creating a.txt · 1 line");
  });
  test("a non-write draft: just the headline", () => {
    expect(busyStatus({ ...base, draft: draft('{"path":"src/x.ts","oldText":"a', "edit") })).toBe("Editing x.ts");
  });
  test("a running tool: its card headline", () => {
    expect(busyStatus({ ...base, runningLabel: "Installing dependencies" })).toBe("Installing dependencies");
  });
  test("text or thinking still arriving: no label", () => {
    expect(busyStatus({ ...base, activity: { eventAt: 9_900, streamAt: 9_900 } })).toBeNull();
  });
  test("silence: waiting, with seconds since the last event", () => {
    expect(busyStatus({ ...base, activity: { eventAt: 10_000 - 14_200, streamAt: 0 } })).toBe("Waiting for the model · 14s");
  });
  test("stream gone quiet past the threshold counts as silence", () => {
    const t = 10_000 - STREAM_QUIET_MS - 1;
    expect(busyStatus({ ...base, activity: { eventAt: t, streamAt: t } })).toMatch(/^Waiting for the model · \ds$/);
  });
  test("never the generic 'Working…'", () => {
    expect(busyStatus(base)).not.toMatch(/working/i);
  });
});

describe("App feeds the status line from the tool-call stream", () => {
  const app = readFileSync(path.join(process.cwd(), "src/renderer/src/App.tsx"), "utf8");
  test("reads all three toolcall events", () => {
    for (const t of ['"toolcall_start"', '"toolcall_delta"', '"toolcall_end"']) expect(app).toContain(t);
  });
  test("mirrors drafts and activity on the SAME rAF as the streaming text", () => {
    const flush = app.slice(app.indexOf("const scheduleFlush"), app.indexOf("const scheduleFlush") + 400);
    expect(flush).toContain("setToolDrafts");
    expect(flush).toContain("setActivity");
  });
  test("a draft is cleared at toolcall_end, when its card lands, and when the turn ends", () => {
    expect(app.split("toolDraftRef.current[sid] = null").length - 1).toBeGreaterThanOrEqual(3);
    const start = app.slice(app.indexOf('e.type === "tool_execution_start"'), app.indexOf('e.type === "tool_execution_start"') + 600);
    expect(start).toContain("toolDraftRef.current[sid] = null");
    const end = app.slice(app.indexOf('e.type === "agent_end"'), app.indexOf('e.type === "agent_end"') + 1600);
    expect(end).toContain("toolDraftRef.current[sid] = null");
  });
});

describe("Transcript renders the line beside the dots", () => {
  const tr = readFileSync(path.join(process.cwd(), "src/renderer/src/components/Transcript.tsx"), "utf8");
  test("a BusyStatusLine inside the busy row", () => {
    const row = tr.slice(tr.indexOf("{busy && ("), tr.indexOf("{busy && (") + 900);
    expect(row).toContain("<BusyStatusLine");
  });
  test("no generic placeholder anywhere in the transcript", () => {
    expect(tr).not.toMatch(/Working…|Working\.\.\./);
  });
});
