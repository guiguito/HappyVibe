/**
 * FR1's approval copy, asserted as DATA.
 *
 * The renderer suite has no DOM (vitest.config.ts includes `tests/**\/*.test.ts`
 * only, no jsdom, no @testing-library), so the contract is pinned the way
 * ToolCard's marks are: the mapping is exported as data and the ABSENCES are
 * asserted here, because an absence is exactly what a render test does not fail
 * on. Styling is not pinned; wording that changes what a user believes is.
 */
import { describe, expect, it } from "vitest";
import { boundaryLines } from "../src/renderer/src/components/PermissionModal";
import { parsePermission } from "../src/renderer/src/permission";
import type { BoundarySummary } from "../pi-runtime/extensions/hv-subagent-boundary";

const b = (over: Partial<BoundarySummary> = {}): BoundarySummary => ({
  agent: "code-explorer",
  tools: ["find", "grep", "ls", "read"],
  declared: true,
  writeCapable: [],
  fanout: false,
  skills: [],
  context: "fresh",
  declarations: [],
  ...over,
});

const text = (over: Partial<BoundarySummary> = {}): string => boundaryLines(b(over)).join("\n");

describe("boundaryLines", () => {
  it("names the agent and every tool it may use", () => {
    const t = text();
    expect(t).toContain("code-explorer");
    for (const tool of ["find", "grep", "ls", "read"]) expect(t).toContain(tool);
  });

  it("says read-only in words when nothing can change", () => {
    expect(text()).toMatch(/read-only/i);
  });

  it("names every write-capable tool, never a count", () => {
    const t = text({ tools: ["read", "bash", "write"], writeCapable: ["bash", "write"] });
    expect(t).toContain("bash");
    expect(t).toContain("write");
    expect(t).not.toMatch(/\b2 (tools|writes|write-capable)/);
  });

  it("does not claim read-only when the boundary can write", () => {
    // The one sentence that must never appear on a bash-capable delegation.
    expect(text({ tools: ["read", "bash"], writeCapable: ["bash"] })).not.toMatch(/read-only/i);
  });

  it("reports fan-out separately from writing", () => {
    const t = text({ tools: ["read", "subagent"], fanout: true });
    expect(t).toMatch(/delegate/i);
    // fan-out is not a write, and must not be described as one
    expect(t).not.toMatch(/can change|modify|write/i);
  });

  it("says an undeclared agent was CLAMPED, not that it asked for read-only", () => {
    // The honesty case: this agent declared nothing and would otherwise have had
    // Pi's whole builtin set. Saying only "read-only" would credit the agent for a
    // restriction HappyVibe imposed.
    const t = text({ declared: false });
    expect(t).toMatch(/declares no tools|no tool list/i);
    expect(t).toMatch(/read-only/i);
  });

  it("lists declared skills and resource declarations", () => {
    const t = text({ skills: ["pdf-tools"], declarations: ["inheritSkills", "shadowsAnotherAgent"] });
    expect(t).toContain("pdf-tools");
    expect(t).toContain("inheritSkills");
    expect(t).toContain("shadowsAnotherAgent");
  });

  it("distinguishes a fresh context from one that sees this conversation", () => {
    expect(text({ context: "fresh" })).toMatch(/own context|fresh|does not see/i);
    expect(text({ context: "fork" })).toMatch(/sees this conversation|forks/i);
  });

  it("NEVER shows a model — deliberately out of scope for v1", () => {
    for (const over of [{}, { declared: false }, { writeCapable: ["bash"], tools: ["read", "bash"] }]) {
      expect(text(over), JSON.stringify(over)).not.toMatch(/model/i);
    }
  });

  it("returns no empty or whitespace-only lines", () => {
    for (const line of boundaryLines(b({ skills: ["s"], declarations: ["d"], fanout: true }))) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("parsePermission carries the boundary through", () => {
  const req = (payload: unknown) => ({ id: "1", method: "select" as const, title: JSON.stringify(payload) });

  it("parses a boundary when present", () => {
    const info = parsePermission(req({ kind: "hv.permission", tool: "subagent:code-explorer", summary: "{}", boundary: b() }));
    expect(info?.boundary?.agent).toBe("code-explorer");
    expect(info?.boundary?.tools).toEqual(["find", "grep", "ls", "read"]);
  });

  it("leaves it undefined for a non-delegation prompt", () => {
    const info = parsePermission(req({ kind: "hv.permission", tool: "bash", summary: "ls" }));
    expect(info?.boundary).toBeUndefined();
    expect(info?.tool).toBe("bash");
  });

  it("ignores a malformed boundary rather than throwing", () => {
    const info = parsePermission(req({ kind: "hv.permission", tool: "subagent:x", summary: "{}", boundary: "nope" }));
    expect(info).not.toBeNull();
    expect(info?.boundary).toBeUndefined();
  });
});
