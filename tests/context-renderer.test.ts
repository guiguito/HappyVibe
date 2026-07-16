import { expect, test } from "vitest";
import {
  computeGauge, groupItems, parseContextAck, parseContextSnapshot, summarizeGroups, totalEstTokens, zoneOf,
  type ContextItem,
} from "../src/renderer/src/context";

// ── gauge sourcing ────────────────────────────────────────────────────────

test("computeGauge prefers measured contextUsage and labels it measured", () => {
  const g = computeGauge({ contextUsage: { tokens: 60000, contextWindow: 200000, percent: 30 } });
  expect(g).toMatchObject({ tokens: 60000, contextWindow: 200000, percent: 30, source: "measured", zone: "calm" });
});

test("computeGauge falls back to an ESTIMATE against the model window when contextUsage is absent", () => {
  const g = computeGauge({ tokens: { input: 90000, output: 10000 } }, 200000);
  expect(g).toMatchObject({ tokens: 100000, contextWindow: 200000, percent: 50, source: "estimated" });
});

test("computeGauge returns PENDING (not a stale cumulative estimate) when Pi has a window but tokens are null (post-compaction)", () => {
  // Root cause: cumulative session totals (20000) DON'T drop after compaction,
  // so presenting them as live context % would mislead. Show "measuring…" instead.
  const g = computeGauge(
    { tokens: { input: 20000, output: 0 }, contextUsage: { tokens: null, contextWindow: 100000, percent: null } },
  );
  expect(g).toEqual({ source: "pending", tokens: null, percent: null, contextWindow: 100000, zone: "calm" });
});

test("computeGauge returns null when there is nothing honest to show", () => {
  expect(computeGauge(null)).toBeNull();
  expect(computeGauge({ tokens: { input: 5 } })).toBeNull(); // no window
});

test("zoneOf thresholds (v5): calm < 35 <= amber < 80 <= red", () => {
  expect(zoneOf(0)).toBe("calm");
  expect(zoneOf(34)).toBe("calm");
  expect(zoneOf(35)).toBe("amber");
  expect(zoneOf(79)).toBe("amber");
  expect(zoneOf(80)).toBe("red");
  expect(zoneOf(100)).toBe("red");
});

// ── snapshot parsing ────────────────────────────────────────────────────────

test("parseContextSnapshot reads an hv.context snapshot notify, ignores anything else", () => {
  const good = parseContextSnapshot({
    method: "notify",
    message: JSON.stringify({ kind: "hv.context", stage: "snapshot", system: null, items: [], marks: ["tool:x"] }),
  });
  expect(good).toEqual({ system: null, items: [], marks: ["tool:x"] });
  expect(parseContextSnapshot({ method: "select", message: "{}" })).toBeNull();
  expect(parseContextSnapshot({ method: "notify", message: JSON.stringify({ kind: "hv.audit" }) })).toBeNull();
});

test("parseContextAck reads removed/restored acks", () => {
  expect(parseContextAck({ method: "notify", message: JSON.stringify({ kind: "hv.context", stage: "removed", marks: ["a"] }) }))
    .toEqual({ marks: ["a"] });
  expect(parseContextAck({ method: "notify", message: JSON.stringify({ kind: "hv.context", stage: "restored", marks: [] }) }))
    .toEqual({ marks: [] });
  expect(parseContextAck({ method: "notify", message: JSON.stringify({ kind: "hv.context", stage: "snapshot" }) })).toBeNull();
});

// ── grouping + sizing ────────────────────────────────────────────────────────

const item = (o: Partial<ContextItem>): ContextItem => ({
  markKey: null, entryId: "e", group: "conversation", preview: "", chars: 0, estTokens: 0, removable: false, ...o,
});

test("groupItems orders groups and sums per-group estimated tokens", () => {
  const items = [
    item({ group: "conversation", estTokens: 10 }),
    item({ group: "tool", estTokens: 5 }),
    item({ group: "tool", estTokens: 7 }),
    item({ group: "compaction", estTokens: 3 }),
  ];
  const groups = groupItems(items);
  expect(groups.map((g) => g.key)).toEqual(["conversation", "tool", "compaction"]);
  expect(groups.find((g) => g.key === "tool")!.estTokens).toBe(12);
});

// ── W2.4: summary-first rows ─────────────────────────────────────────────────

test("summarizeGroups returns nothing for an empty snapshot", () => {
  expect(summarizeGroups([], null)).toEqual([]);
});

test("summarizeGroups builds system, files (incl. nested AGENTS.md) and group rows with shares", () => {
  const rows = summarizeGroups(
    [
      item({ group: "conversation", estTokens: 30, chars: 120 }),
      item({ group: "tool", estTokens: 10, chars: 40 }),
      item({ group: "tool", estTokens: 10, chars: 40 }),
    ],
    {
      chars: 100, estTokens: 25, toolCount: 3,
      contextFiles: [{ path: "/w/AGENTS.md", chars: 60, estTokens: 15 }],
      nested: [{ dir: "pkg", path: "/w/pkg/AGENTS.md", chars: 40 }], // → ceil(40/4)=10
    },
  );
  // #9: a "tools" row is surfaced (unmeasured) after the files row.
  expect(rows.map((r) => r.key)).toEqual(["system", "files", "tools", "conversation", "tool"]);
  const files = rows.find((r) => r.key === "files")!;
  expect(files).toMatchObject({ count: 2, chars: 100, estTokens: 25 });
  expect(rows.find((r) => r.key === "tools")).toMatchObject({ count: 3, measured: false, estTokens: 0 });
  // total = 25 + 25 + 30 + 20 = 100 → shares are exact percents (tools contributes 0)
  expect(rows.map((r) => r.share)).toEqual([25, 25, 0, 30, 20]);
  expect(rows.find((r) => r.key === "tool")).toMatchObject({ count: 2, estTokens: 20, removedCount: 0 });
});

test("summarizeGroups counts removed items per category from marks", () => {
  const rows = summarizeGroups(
    [
      item({ group: "tool", markKey: "tool:a", estTokens: 5 }),
      item({ group: "tool", markKey: "tool:b", estTokens: 5 }),
      item({ group: "conversation", markKey: "turn:1", estTokens: 5 }),
      item({ group: "conversation", markKey: null, estTokens: 5 }),
    ],
    null,
    ["tool:a", "tool:b", "turn:1"],
  );
  expect(rows.find((r) => r.key === "tool")!.removedCount).toBe(2);
  expect(rows.find((r) => r.key === "conversation")!.removedCount).toBe(1);
});

test("summarizeGroups share math: zero total → zero shares; skips empty files row", () => {
  const rows = summarizeGroups(
    [item({ group: "conversation", estTokens: 0 })],
    { chars: 0, estTokens: 0, toolCount: 0, contextFiles: [] },
  );
  expect(rows.map((r) => r.key)).toEqual(["system", "conversation"]);
  expect(rows.every((r) => r.share === 0)).toBe(true);
});

test("totalEstTokens sums system prompt + context files + items", () => {
  const total = totalEstTokens({
    system: { chars: 0, estTokens: 100, toolCount: 3, contextFiles: [{ path: "AGENTS.md", chars: 0, estTokens: 40 }] },
    items: [item({ estTokens: 10 }), item({ estTokens: 20 })],
    marks: [],
  });
  expect(total).toBe(170);
});
