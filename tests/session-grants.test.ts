import { describe, expect, it } from "vitest";
import { SessionGrants } from "../src/main/sessionGrants";

describe("SessionGrants — 'Allow for session' kept across respawns until the app quits (round 29)", () => {
  it("records and lists per session, sessions independent", () => {
    const g = new SessionGrants();
    g.record("a", "bash");
    g.record("a", "bash");
    g.record("b", "edit");
    expect(g.list("a")).toEqual(["bash"]);
    expect(g.list("b")).toEqual(["edit"]);
    expect(g.list("c")).toEqual([]);
  });

  it("an MCP configuration change drops only that session's mcp: grants", () => {
    const g = new SessionGrants();
    g.record("a", "bash");
    g.record("a", "mcp:notion_search");
    g.record("b", "mcp:notion_search");
    g.dropMcp("a");
    expect(g.list("a")).toEqual(["bash"]);
    expect(g.list("b")).toEqual(["mcp:notion_search"]);
  });

  it("forget empties a closed or deleted session", () => {
    const g = new SessionGrants();
    g.record("a", "bash");
    g.forget("a");
    expect(g.list("a")).toEqual([]);
  });
});
