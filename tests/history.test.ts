import { describe, expect, it } from "vitest";
import {
  compactionInfo, compactionReason, contextItems, earlierItems, latestCompaction, leafPath,
  parseEntries,
} from "../src/main/history";

/** Build a JSONL session file from a linear entry list (parentId chained). */
function jsonl(entries: Record<string, unknown>[]): string {
  let parent: string | null = null;
  return entries
    .map((e) => {
      const line = JSON.stringify({ parentId: parent, ...e });
      parent = e.id as string;
      return line;
    })
    .join("\n");
}

const userMsg = (id: string, text: string, ts: number): Record<string, unknown> => ({
  type: "message", id, timestamp: new Date(ts).toISOString(),
  message: { role: "user", content: [{ type: "text", text }], timestamp: ts },
});
const asstMsg = (id: string, text: string, ts: number): Record<string, unknown> => ({
  type: "message", id, timestamp: new Date(ts).toISOString(),
  message: { role: "assistant", content: [{ type: "text", text }], timestamp: ts },
});

describe("parseEntries", () => {
  it("skips a torn tail line instead of throwing", () => {
    const raw = `${jsonl([userMsg("a", "hi", 1)])}\n{"type":"mess`;
    expect(parseEntries(raw)).toHaveLength(1);
  });

  it("returns [] for empty or missing input", () => {
    expect(parseEntries(null)).toEqual([]);
    expect(parseEntries("")).toEqual([]);
  });
});

describe("leafPath", () => {
  it("walks the parentId chain from the last entry back to the root", () => {
    const entries = parseEntries(jsonl([userMsg("a", "1", 1), asstMsg("b", "2", 2), userMsg("c", "3", 3)]));
    expect(leafPath(entries).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("ignores entries that are not on the leaf's chain", () => {
    // "orphan" has no child; the leaf is "c", whose chain is a→b→c.
    const raw = [
      JSON.stringify({ type: "message", id: "a", parentId: null, message: { role: "user", content: "1", timestamp: 1 } }),
      JSON.stringify({ type: "message", id: "orphan", parentId: "a", message: { role: "user", content: "x", timestamp: 9 } }),
      JSON.stringify({ type: "message", id: "b", parentId: "a", message: { role: "assistant", content: "2", timestamp: 2 } }),
      JSON.stringify({ type: "message", id: "c", parentId: "b", message: { role: "user", content: "3", timestamp: 3 } }),
    ].join("\n");
    expect(leafPath(parseEntries(raw)).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("latestCompaction", () => {
  it("is null when the session was never compacted", () => {
    expect(latestCompaction(leafPath(parseEntries(jsonl([userMsg("a", "1", 1)]))))).toBeNull();
  });

  it("reports the LAST compaction and counts them all", () => {
    const raw = jsonl([
      userMsg("a", "1", 1), asstMsg("b", "2", 2), userMsg("c", "3", 3),
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "b" },
      userMsg("d", "4", 4),
      { type: "compaction", id: "k2", summary: "s", firstKeptEntryId: "c" },
    ]);
    expect(latestCompaction(leafPath(parseEntries(raw)))).toEqual({ count: 2, firstKeptEntryId: "c" });
  });
});

describe("earlierItems", () => {
  const compacted = jsonl([
    userMsg("a", "one", 1), asstMsg("b", "two", 2), userMsg("c", "three", 3), asstMsg("d", "four", 4),
    { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
    userMsg("e", "five", 5),
  ]);

  it("returns only what is BEFORE firstKeptEntryId", () => {
    expect(earlierItems(compacted)).toEqual([
      { kind: "user", text: "one" },
      { kind: "assistant", text: "two" },
    ]);
  });

  it("is empty when the session was never compacted", () => {
    expect(earlierItems(jsonl([userMsg("a", "one", 1)]))).toEqual([]);
  });

  it("applies §9 removal marks — removed means removed in the earlier region too", () => {
    const raw = jsonl([
      userMsg("a", "one", 1), asstMsg("b", "two", 2), userMsg("c", "three", 3),
      { type: "custom", id: "m1", customType: "hv-context-marks", data: { marks: ["msg:1"] } },
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
    ]);
    expect(earlierItems(raw)).toEqual([{ kind: "assistant", text: "two" }]);
  });

  it("takes the NEWEST marks entry (it is a full snapshot)", () => {
    const raw = jsonl([
      userMsg("a", "one", 1), asstMsg("b", "two", 2), userMsg("c", "three", 3),
      { type: "custom", id: "m1", customType: "hv-context-marks", data: { marks: ["msg:1", "msg:2"] } },
      { type: "custom", id: "m2", customType: "hv-context-marks", data: { marks: ["msg:2"] } },
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
    ]);
    expect(earlierItems(raw)).toEqual([{ kind: "user", text: "one" }]);
  });

  it("drops plan cards — the pill is the route to a compacted-away plan", () => {
    const raw = jsonl([
      {
        type: "message", id: "a",
        message: {
          role: "assistant", timestamp: 1,
          content: [{ type: "toolCall", id: "tc1", name: "plan_complete", arguments: {} }],
        },
      },
      {
        type: "message", id: "b",
        message: { role: "toolResult", toolCallId: "tc1", toolName: "plan_complete", timestamp: 2,
          content: [{ type: "text", text: "Plan saved to .agents/plans/001-x.md. It is ready." }] },
      },
      userMsg("c", "three", 3),
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
    ]);
    expect(earlierItems(raw)).toEqual([]);
  });
});

describe("contextItems", () => {
  it("is the whole transcript when the session was never compacted", () => {
    expect(contextItems(jsonl([userMsg("a", "one", 1), asstMsg("b", "two", 2)]))).toEqual([
      { kind: "user", text: "one" },
      { kind: "assistant", text: "two" },
    ]);
  });

  it("starts at firstKeptEntryId — the complement of earlierItems", () => {
    const raw = jsonl([
      userMsg("a", "one", 1), asstMsg("b", "two", 2), userMsg("c", "three", 3),
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "c" },
      asstMsg("d", "four", 4),
    ]);
    expect(contextItems(raw)).toEqual([
      { kind: "user", text: "three" },
      { kind: "assistant", text: "four" },
    ]);
    // The two halves partition the transcript exactly once.
    expect([...earlierItems(raw), ...contextItems(raw)]).toHaveLength(4);
  });

  it("applies §9 removal marks — get_messages does NOT (the bridge filters at the context event)", () => {
    const raw = jsonl([
      userMsg("a", "one", 1), asstMsg("b", "two", 2),
      { type: "custom", id: "m1", customType: "hv-context-marks", data: { marks: ["msg:1"] } },
    ]);
    expect(contextItems(raw)).toEqual([{ kind: "assistant", text: "two" }]);
  });

  it("falls back to the post-compaction tail when firstKeptEntryId is off-path", () => {
    const raw = jsonl([
      userMsg("a", "one", 1),
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "gone" },
      asstMsg("b", "two", 2),
    ]);
    expect(contextItems(raw)).toEqual([{ kind: "assistant", text: "two" }]);
    expect(earlierItems(raw)).toEqual([]); // boundary unusable — never guess
  });

  it("is empty for a session with no file yet", () => {
    expect(contextItems(null)).toEqual([]);
  });
});

describe("compactionInfo", () => {
  it("matches latestCompaction without a full parse", () => {
    const raw = jsonl([
      userMsg("a", "1", 1), userMsg("b", "2", 2),
      { type: "compaction", id: "k1", summary: "s", firstKeptEntryId: "b" },
    ]);
    expect(compactionInfo(raw)).toEqual({ count: 1, firstKeptEntryId: "b" });
    expect(compactionInfo(jsonl([userMsg("a", "1", 1)]))).toBeNull();
  });
});

describe("compactionReason", () => {
  // As EventLog.read({ type: "context.compact", sessionId }) returns them.
  const events = [{ data: { reason: "threshold", firstKeptEntryId: "b" } }];

  it("joins on firstKeptEntryId", () => {
    expect(compactionReason(events, "b")).toBe("threshold");
  });

  it("is null for an unlogged (pre-feature) compaction", () => {
    expect(compactionReason(events, "zzz")).toBeNull();
    expect(compactionReason([], "b")).toBeNull();
  });

  it("takes the LAST match when two compactions share a firstKeptEntryId", () => {
    const dup = [...events, { data: { reason: "overflow", firstKeptEntryId: "b" } }];
    expect(compactionReason(dup, "b")).toBe("overflow");
  });
});
