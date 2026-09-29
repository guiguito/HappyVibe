/**
 * docs-round #8 — Duplicate and Edit work wherever tintinweb finds an agent: `<agentDir>/agents`,
 * `.pi/agents` and `.agents/agents`, in every root the app admits (a worktree too). Driven through
 * the real path confinement on temp dirs; the wiring halves are source scans.
 */
import { afterAll, describe, expect, it } from "vitest";
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
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

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

describe("Duplicate confines the copy's path, since the name is the file's own text", () => {
  // A repo can supply an agent file, and its frontmatter `name:` is free text. The victim folders
  // exist, so an unconfined write would succeed (writeFileSync never creates missing folders).
  const evil = path.join(tmp, "evil");
  const evilAgents = path.join(evil, ".agents", "agents");
  const victims = [path.join(tmp, "victim"), path.join(evilAgents, "sub"), path.join(evilAgents, "tmp")];
  for (const d of [evilAgents, ...victims]) fs.mkdirSync(d, { recursive: true });
  const evilDirs = allowedAgentDirs(builtin, [evil]);
  const listing = (d: string): string[] => fs.readdirSync(d).sort();

  it.each([
    ["../../../victim/planted", "a parent-folder name"],
    ["sub/dir", "a name with a separator"],
    ["/tmp/x-planted", "an absolute name"],
  ])("refuses %s (%s) and writes nothing", (name) => {
    const evilFile = path.join(evilAgents, "evil.md");
    fs.writeFileSync(evilFile, `---\nname: ${name}\ndescription: Not what it seems.\n---\nBody.\n`);
    const before = victims.map(listing);
    const beforeAllowed = listing(evilAgents);
    expect(() => duplicateAgent(evilDirs, evilFile)).toThrow(/escapes/);
    expect(victims.map(listing)).toEqual(before);
    expect(listing(evilAgents)).toEqual(beforeAllowed);
    fs.rmSync(evilFile);
  });

  it("a normal name still duplicates as <name>-copy.md beside the original", () => {
    const ok = path.join(evilAgents, "fine.md");
    fs.writeFileSync(ok, "---\nname: fine\ndescription: Ordinary.\n---\nBody.\n");
    expect(duplicateAgent(evilDirs, ok)).toBe(path.join(evilAgents, "fine-copy.md"));
  });
});

describe("only the exact agent folders of admitted roots are allowed", () => {
  it("a root that isn't in the list is refused", () => {
    const only = allowedAgentDirs(builtin, [ws]);
    expect(() => readAgentBody(only, path.join(wt, ".pi", "agents", "tester.md"))).toThrow(/escapes/);
  });

  it("a sibling folder sharing the prefix is refused", () => {
    const sibling = path.join(ws, ".agents", "agents-evil");
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "x.md"), AGENT);
    expect(() => readAgentBody(dirs, path.join(sibling, "x.md"))).toThrow(/escapes/);
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
