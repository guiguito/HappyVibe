import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { delegatableAgents, type AgentInfo } from "../src/renderer/src/agents";

/**
 * The shared `agents` list keeps switched-off agents so the Agents page can switch
 * them back on. The CHAT must not: its chip said "10 agents you can delegate to" with
 * six switched off, and both the chip and the @ list offered them for a delegation
 * the child runtime would refuse (found in the 2026-09-27 GUI pass).
 */
const a = (name: string, enabled?: boolean): AgentInfo => ({ name, description: "d", source: "bundled", path: `/a/${name}.md`, enabled });

test("only enabled agents are delegatable; an agent with no flag counts as enabled", () => {
  expect(delegatableAgents([a("on", true), a("off", false), a("unflagged")]).map((x) => x.name)).toEqual(["on", "unflagged"]);
});

test("the chat's chip and its @ list both read the delegatable list, never the raw one", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "src", "components", "ChatView.tsx"), "utf8");
  expect(src).toMatch(/const delegatable = delegatableAgents\(agents \?\? \[\]\)/);
  expect(src).toMatch(/agentMentionItems\(delegatable,/);
  expect(src).toMatch(/<AgentsChip agents=\{delegatable\}/);
  expect(src).not.toMatch(/agentMentionItems\(agents/);
  expect(src).not.toMatch(/<AgentsChip agents=\{agents\}/);
});
