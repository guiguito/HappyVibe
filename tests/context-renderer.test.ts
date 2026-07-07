import { expect, test } from "vitest";
import {
  computeGauge, groupItems, parseContextAck, parseContextSnapshot, totalEstTokens, zoneOf,
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

test("zoneOf thresholds: calm < 70 <= amber < 90 <= red", () => {
  expect(zoneOf(0)).toBe("calm");
  expect(zoneOf(69)).toBe("calm");
  expect(zoneOf(70)).toBe("amber");
  expect(zoneOf(89)).toBe("amber");
  expect(zoneOf(90)).toBe("red");
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

test("totalEstTokens sums system prompt + context files + items", () => {
  const total = totalEstTokens({
    system: { chars: 0, estTokens: 100, toolCount: 3, contextFiles: [{ path: "AGENTS.md", chars: 0, estTokens: 40 }] },
    items: [item({ estTokens: 10 }), item({ estTokens: 20 })],
    marks: [],
  });
  expect(total).toBe(170);
});
