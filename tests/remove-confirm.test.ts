import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pluginRemoveMessage } from "../src/renderer/src/components/PluginsSection";
import { mcpRemoveMessage } from "../src/renderer/src/components/McpServersSection";

/** docs-round #24. No DOM in this suite: the question is pinned as data, the order by source. */
const C = path.join(__dirname, "..", "src", "renderer", "src", "components");
const src = (f: string): string => fs.readFileSync(path.join(C, f), "utf8");

describe("Remove asks first, the way skill Delete does", () => {
  it("the plugin question names the plugin and everything that goes with it", () => {
    expect(pluginRemoveMessage({ plugin: "demo", skills: ["a", "b"], commands: ["c"], servers: ["s"] }))
      .toBe("Remove “demo”?\n\nThis deletes its 2 skills, 1 prompt and 1 MCP server. Open sessions restart once they're idle. You can install it again later.");
    expect(pluginRemoveMessage({ plugin: "x", skills: [], commands: [], servers: ["s", "t"] }))
      .toContain("This deletes its 2 MCP servers.");
  });

  it("the MCP question names the server and the file it leaves", () => {
    expect(mcpRemoveMessage({ scope: "global", name: "github" }))
      .toBe("Remove “github”?\n\nIt's taken out of your global mcp.json. Open sessions restart once they're idle.");
    expect(mcpRemoveMessage({ scope: "workspace", name: "db" })).toContain("this workspace's .mcp.json");
  });

  it("both Remove paths confirm BEFORE they act", () => {
    expect(src("SkillsSection.tsx")).toMatch(/if \(!window\.confirm\(msg\)\) return;/); // the pattern copied
    expect(src("PluginsSection.tsx")).toMatch(/onClick=\{\(\) => \{ if \(window\.confirm\(pluginRemoveMessage\(p\)\)\) remove\(p\.plugin\); \}\}/);
    expect(src("McpServersSection.tsx")).toMatch(
      /const remove = async \(s: McpServer\): Promise<void> => \{\s*if \(!window\.confirm\(mcpRemoveMessage\(s\)\)\) return;/,
    );
  });
});
