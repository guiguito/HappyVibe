/**
 * docs-round #8 — Duplicate and Edit work wherever tintinweb finds an agent: `<agentDir>/agents`,
 * `.pi/agents` and `.agents/agents`, in every root the app admits (a worktree too). Driven through
 * the real path confinement on temp dirs; the wiring halves are source scans.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedAgentDirs, confineAgentPath, duplicateAgent, readAgentBody } from "../src/main/agents";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-agent-dirs-"));
const builtin = path.join(tmp, "agent", "agents");
const ws = path.join(tmp, "ws");
const wt = path.join(tmp, "wt");
const shared = path.join(ws, ".agents", "agents");
for (const d of [builtin, path.join(ws, ".pi", "agents"), shared, path.join(wt, ".pi", "agents")]) fs.mkdirSync(d, { recursive: true });
const AGENT = "---\nname: greeter\ndescription: Says hello.\n---\nSay hello, then stop.\n";
fs.writeFileSync(path.join(shared, "greeter.md"), AGENT);
fs.writeFileSync(path.join(wt, ".pi", "agents", "tester.md"), AGENT.replace("greeter", "tester"));
const dirs = allowedAgentDirs(builtin, [ws, wt]);

describe("agents in .agents/agents can be edited and duplicated", () => {
  it("the allowed folders are the three tintinweb discovers", () => {
    expect(dirs).toEqual(expect.arrayContaining([path.resolve(builtin), path.resolve(ws, ".pi", "agents"), path.resolve(shared)]));
  });

  it("Edit loads the agent's prompt", () => {
    expect(readAgentBody(dirs, path.join(shared, "greeter.md")).body).toContain("Say hello, then stop.");
  });

  it("Duplicate writes the copy beside the original", () => {
    const copy = duplicateAgent(dirs, path.join(shared, "greeter.md"));
    expect(copy).toBe(path.join(shared, "greeter-copy.md"));
    expect(fs.readFileSync(copy, "utf8")).toMatch(/name: greeter-copy/);
  });

  it("a worktree root counts, once roots() lists it", () => {
    expect(readAgentBody(dirs, path.join(wt, ".pi", "agents", "tester.md")).body).toContain("Say hello");
  });

  it("still refuses anything outside an agent folder", () => {
    fs.writeFileSync(path.join(ws, ".agents", "notes.md"), "x");
    expect(() => confineAgentPath(dirs, path.join(ws, ".agents", "notes.md"))).toThrow(/escapes/);
  });
});

describe("the page passes every root and says why a copy failed", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const view = fs.readFileSync("src/renderer/src/components/AgentsView.tsx", "utf8");

  it("main confines to roots(), so a worktree session's agents are in", () => {
    expect(ipc).toMatch(/allowedAgentDirs\(builtinAgentsDir\(\), roots\(\)\)/);
    expect(ipc).not.toMatch(/allowedAgentDirs\(builtinAgentsDir\(\), workspaces\.list\(\)\)/);
  });

  it("a refused Duplicate is shown in main's words, and the dialog stays open", () => {
    const at = view.indexOf("const duplicate = async");
    const dup = view.slice(at, view.indexOf("return (", at));
    expect(dup).toMatch(/catch \(e\) \{\s*setDupError\(ipcMessage\(e\)\);\s*return false;/);
    expect(view).toMatch(/if \(ok\) setInspecting\(null\)/);
    expect(view).toMatch(/\{error && <div className="mb-2 text-sm font-semibold text-berry">\{error\}<\/div>\}/);
  });

  it("the editor shows main's sentence, not the IPC preamble", () => {
    expect(view).not.toMatch(/setError\(String\(e\)\)/);
    expect((view.match(/setError\(ipcMessage\(e\)\)/g) ?? []).length).toBe(2);
  });
});
