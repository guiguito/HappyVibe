import { describe, it, expect } from "vitest";
import { classifyEntries, installable, type PluginProbe } from "../src/main/plugins/classifyEntries";
import type { MarketplaceEntry } from "../src/main/plugins/marketplace";

const entry = (name: string, entryComponents: string[] = []): MarketplaceEntry => ({
  name,
  description: "d",
  source: { repoUrl: "https://github.com/o/n.git", sha: "a".repeat(40), subdir: "" },
  entryComponents,
});

const probeOf = (map: Record<string, PluginProbe | null | "throw">) =>
  async (e: MarketplaceEntry): Promise<PluginProbe | null> => {
    const v = map[e.name];
    if (v === "throw") throw new Error("network exploded");
    return v ?? null;
  };

const clean: PluginProbe = {
  manifest: { name: "x", description: "d", author: {} },
  topLevel: ["skills"],
  counts: { skills: 3, commands: 0, servers: 0 },
};

describe("classifyEntries", () => {
  it("classifies each entry through the shared policy", async () => {
    const r = await classifyEntries([entry("good")], probeOf({ good: clean }));
    expect(r.classified).toHaveLength(1);
    expect(r.classified[0].verdict.accepted).toBe(true);
    expect(r.classified[0].counts.skills).toBe(3);
    expect(r.skipped).toEqual([]);
  });

  it("records a rejected entry rather than dropping it — callers decide what to list", async () => {
    const r = await classifyEntries(
      [entry("hooky")],
      probeOf({ hooky: { ...clean, topLevel: ["skills", "hooks"] } }),
    );
    expect(r.classified[0].verdict.accepted).toBe(false);
    expect(r.classified[0].verdict.rejected).toEqual(["hooks"]);
  });

  it("still sees entry-level components the probe cannot know about", async () => {
    // 12 official entries declare lspServers on the ENTRY and nowhere else.
    const r = await classifyEntries([entry("lsp", ["lspServers"])], probeOf({ lsp: { ...clean, topLevel: [] } }));
    expect(r.classified[0].verdict.rejected).toEqual(["lspServers"]);
  });

  it("skips an unresolvable entry instead of throwing", async () => {
    // Two official entries are already dead links; one bad row must not cost
    // the user the rest of the marketplace.
    const r = await classifyEntries([entry("dead"), entry("good")], probeOf({ dead: null, good: clean }));
    expect(r.classified.map((c) => c.entry.name)).toEqual(["good"]);
    expect(r.skipped).toEqual([{ name: "dead", reason: "could not be resolved" }]);
  });

  it("turns a thrown probe into a skip carrying the reason", async () => {
    const r = await classifyEntries([entry("boom")], probeOf({ boom: "throw" }));
    expect(r.classified).toEqual([]);
    expect(r.skipped[0]).toEqual({ name: "boom", reason: "network exploded" });
  });

  it("reports progress once per entry, including skips", async () => {
    const seen: Array<[number, number, string]> = [];
    await classifyEntries(
      [entry("a"), entry("b")],
      probeOf({ a: clean, b: null }),
      (done, total, name) => seen.push([done, total, name]),
    );
    expect(seen).toEqual([
      [1, 2, "a"],
      [2, 2, "b"],
    ]);
  });
});

describe("the client-allowlist gate runs inside the shared pass", () => {
  // In classifyEntries rather than the generator, so phase 2's runtime indexer
  // for user-added marketplaces inherits it without re-implementing anything.
  it("refuses a plugin whose MCP server no client of ours can authenticate with", async () => {
    const r = await classifyEntries(
      [entry("figma")],
      probeOf({ figma: { ...clean, mcpServers: { figma: { url: "https://mcp.figma.com/mcp" } } } }),
    );
    expect(r.classified[0].verdict.accepted).toBe(false);
    expect(r.classified[0].verdict.reason).toContain("Figma");
    expect(installable(r)).toEqual([]);
  });

  it("keeps a plugin whose MCP server authenticates with a token", async () => {
    // The GitHub trap: no DCR, but a bearer PAT works, so it must survive.
    const r = await classifyEntries(
      [entry("github")],
      probeOf({
        github: {
          ...clean,
          mcpServers: { github: { url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer x" } } },
        },
      }),
    );
    expect(r.classified[0].verdict.accepted).toBe(true);
  });

  it("does not gate a plugin with no servers, or a probe that read none", async () => {
    const r = await classifyEntries([entry("skillsonly")], probeOf({ skillsonly: clean }));
    expect(r.classified[0].verdict.accepted).toBe(true);
  });

  it("leaves an already-rejected verdict's reason intact", async () => {
    // The component reason is the more useful one; the gate must not overwrite it.
    const r = await classifyEntries(
      [entry("both")],
      probeOf({
        both: {
          ...clean,
          topLevel: ["skills", "hooks"],
          mcpServers: { figma: { url: "https://mcp.figma.com/mcp" } },
        },
      }),
    );
    expect(r.classified[0].verdict.reason).toBe("uses hooks, not supported in HappyVibe");
  });
});

describe("installable", () => {
  it("keeps only accepted entries that actually carry something", async () => {
    const r = await classifyEntries(
      [entry("full"), entry("empty"), entry("rejected")],
      probeOf({
        full: clean,
        // accepted by the classifier (a skills/ dir exists) but nothing in it
        // that Pi would load — a card here would install zero items.
        empty: { ...clean, counts: { skills: 0, commands: 0, servers: 0 } },
        rejected: { ...clean, topLevel: ["skills", "agents"] },
      }),
    );
    expect(installable(r).map((c) => c.entry.name)).toEqual(["full"]);
  });
});
