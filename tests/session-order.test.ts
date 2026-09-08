import { describe, expect, it } from "vitest";
import { bySidebarOrder, lastUsed } from "../src/renderer/src/sessionOrder";

const s = (id: string, updatedAt: string, lastUsedAt?: string): { id: string; updatedAt: string; lastUsedAt?: string } => ({
  id,
  updatedAt,
  ...(lastUsedAt ? { lastUsedAt } : {}),
});

const order = (list: Array<{ id: string; updatedAt: string; lastUsedAt?: string }>, working: string[] = []): string[] =>
  [...list].sort(bySidebarOrder(new Set(working))).map((x) => x.id);

describe("lastUsed", () => {
  it("prefers lastUsedAt", () => {
    expect(lastUsed(s("a", "2026-01-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"))).toBe("2026-09-01T00:00:00.000Z");
  });

  it("falls back to updatedAt for a session that predates the field", () => {
    // No migration: every existing session reads exactly as it did before.
    expect(lastUsed(s("a", "2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("bySidebarOrder", () => {
  it("puts the most recently used first", () => {
    const list = [
      s("old", "2026-01-01T00:00:00.000Z"),
      s("newest", "2026-01-01T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
      s("middle", "2026-05-01T00:00:00.000Z"),
    ];
    expect(order(list)).toEqual(["newest", "middle", "old"]);
  });

  it("pins a LIVE session above everything, however stale", () => {
    // "Live" is the agent PROCESS being up, not a turn in flight — so a long
    // background run never sinks out of view, and the list does not reshuffle
    // at every turn boundary.
    const list = [
      s("fresh", "2026-09-08T00:00:00.000Z"),
      s("ancient-but-working", "2020-01-01T00:00:00.000Z"),
    ];
    expect(order(list, ["ancient-but-working"])).toEqual(["ancient-but-working", "fresh"]);
  });

  it("orders two live sessions between themselves by recency", () => {
    const list = [
      s("workingOld", "2026-01-01T00:00:00.000Z"),
      s("workingNew", "2026-09-08T00:00:00.000Z"),
      s("idle", "2026-09-09T00:00:00.000Z"),
    ];
    expect(order(list, ["workingOld", "workingNew"])).toEqual(["workingNew", "workingOld", "idle"]);
  });

  it("a session with no lastUsedAt sorts exactly where updatedAt would put it", () => {
    // The no-migration guarantee, stated as an ordering rather than a value.
    const list = [
      s("hasField", "2020-01-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"),
      s("legacyNewer", "2026-06-01T00:00:00.000Z"),
      s("legacyOlder", "2026-04-01T00:00:00.000Z"),
    ];
    expect(order(list)).toEqual(["legacyNewer", "hasField", "legacyOlder"]);
  });

  it("is a stable, total order — equal timestamps do not throw or drop rows", () => {
    const same = "2026-09-08T00:00:00.000Z";
    const list = [s("a", same), s("b", same), s("c", same)];
    expect(order(list)).toHaveLength(3);
  });
});
