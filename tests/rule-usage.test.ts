import { describe, expect, it } from "vitest";
import { lastDecided, ruleKey } from "../src/main/ruleUsage";

const row = (ts: string, rule: Record<string, string> | undefined, workspaceId?: string) => ({ ts, workspaceId, data: rule ? { rule } : {} });
const g = { layer: "tool", pattern: "bash", action: "allow", scope: "global" } as const;

describe("lastDecided — when each rule last decided a call (round 29)", () => {
  it("the latest row wins", () => {
    const m = lastDecided([row("2026-10-01T00:00:00Z", g), row("2026-10-20T00:00:00Z", g)]);
    expect(m[ruleKey(g)]).toBe("2026-10-20T00:00:00Z");
  });
  it("a workspace rule is keyed by its workspace", () => {
    const w = { layer: "tool", pattern: "write", action: "allow", scope: "workspace" } as const;
    const m = lastDecided([row("2026-10-01T00:00:00Z", w, "/a"), row("2026-10-02T00:00:00Z", w, "/b")]);
    expect(m[ruleKey(w, "/a")]).toBe("2026-10-01T00:00:00Z");
    expect(m[ruleKey(w, "/b")]).toBe("2026-10-02T00:00:00Z");
  });
  it("rows without a rule are ignored; a bypass row carrying one counts", () => {
    const m = lastDecided([row("2026-10-01T00:00:00Z", undefined), { ts: "2026-10-03T00:00:00Z", data: { source: "bypass", rule: g } }]);
    expect(Object.keys(m)).toEqual([ruleKey(g)]);
  });
});

import { readFileSync } from "node:fs";
import { lastDecidedLine } from "../src/renderer/src/components/PermissionRulesSection";

describe("the Permissions page line", () => {
  it("says when, or never", () => {
    const now = Date.parse("2026-10-27T12:00:00Z");
    expect(lastDecidedLine("2026-10-24T12:00:00Z", now)).toBe("Last decided a call 3d ago");
    expect(lastDecidedLine(undefined, now)).toBe("Never decided a call");
  });
  it("the section renders it under every saved rule", () => {
    const src = readFileSync("src/renderer/src/components/PermissionRulesSection.tsx", "utf8");
    expect(src).toContain("lastDecidedLine(usedHere[");
  });
});
