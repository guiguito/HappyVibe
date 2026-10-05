#!/usr/bin/env node
// THROWAWAY spike (PRD §13 Phase 0): memory / processes / start time / tool-def tokens of
// 4 idle sessions with 3 MCP servers — pi-mcp-adapter vs Pi's built-in MCP.
// Usage: node scripts/spike/mcp-footprint.mjs --arm adapter|builtin [--sessions 4]
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const arm = arg("--arm", "builtin");
const N = Number(arg("--sessions", "4"));
const rt = path.resolve("pi-runtime");
const cli = path.join(rt, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), `hv-fp-${arm}-`));
const agentDir = path.join(root, "agent");
fs.mkdirSync(agentDir);
const exposure = arm === "builtin" ? { exposure: "deferred" } : {};
fs.writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
  "chrome-devtools": { command: "npx", args: ["-y", "chrome-devtools-mcp@latest"], ...exposure },
  context7: { url: "https://mcp.context7.com/mcp", ...exposure },
  deepwiki: { url: "https://mcp.deepwiki.com/mcp", ...exposure },
} }));

function boot(i) {
  const ws = path.join(root, `ws${i}`);
  fs.mkdirSync(ws);
  const mcpArgs = arm === "builtin" ? ["-e", "builtin:mcp", "-e", "builtin:tool-search"] : ["-e", path.join(rt, "node_modules/pi-mcp-adapter/index.ts")];
  const t0 = Date.now();
  const child = spawn(process.execPath, [cli, "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    "-e", path.resolve("tests/fixtures/faux-model.ts"), ...mcpArgs, "-e", path.join(rt, "extensions/happyvibe-bridge.ts"),
    "--provider", "faux", "--model", "script"], {
    cwd: ws, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, HV_TEST_RUNTIME: rt, HV_FAUX_STEPS: JSON.stringify([{ text: "ok" }]) },
  });
  const pending = new Map();
  const notes = [];
  readline.createInterface({ input: child.stdout }).on("line", (l) => {
    let m; try { m = JSON.parse(l); } catch { return; }
    if (m.type === "response" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.type === "extension_ui_request" && m.method === "notify") notes.push(m.message);
  });
  let n = 0;
  const send = (cmd) => new Promise((r) => { const id = `c${++n}`; pending.set(id, r); child.stdin.write(JSON.stringify({ id, ...cmd }) + "\n"); });
  return { child, send, notes, t0 };
}

function treeRss(pid) {
  const rows = execSync("ps -A -o pid=,ppid=,rss=").toString().trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [p, pp] of rows) kids.set(pp, [...(kids.get(pp) ?? []), p]);
  const rss = new Map(rows.map(([p, , r]) => [p, r]));
  let total = 0, count = 0;
  const walk = (p) => { total += rss.get(p) ?? 0; count++; for (const c of kids.get(p) ?? []) walk(c); };
  walk(pid);
  return { kb: total, processes: count };
}

const sessions = Array.from({ length: N }, (_, i) => boot(i));
const startMs = await Promise.all(sessions.map(async (s) => { await s.send({ type: "get_state" }); return Date.now() - s.t0; }));
await new Promise((r) => setTimeout(r, 20_000));
const trees = sessions.map((s) => treeRss(s.child.pid));
// Static per-request tool-definition cost, from the bridge's own accounting.
const ctx = sessions[0];
await ctx.send({ type: "prompt", message: "hi" });
await new Promise((r) => setTimeout(r, 3000));
const before = ctx.notes.length;
await ctx.send({ type: "prompt", message: "/hv-context" });
await new Promise((r) => setTimeout(r, 1500));
const ctxNote = ctx.notes.slice(before).map((m) => { try { return JSON.parse(m); } catch { return null; } }).find((m) => m?.kind === "hv.context");
for (const s of sessions) s.child.kill();
console.log(JSON.stringify({
  arm, sessions: N,
  startMs,
  rssMB: Math.round(trees.reduce((a, t) => a + t.kb, 0) / 1024),
  processes: trees.reduce((a, t) => a + t.processes, 0),
  context: ctxNote?.system ? {
    systemPromptTokens: ctxNote.system.estTokens,
    toolDefTokens: Math.round(ctxNote.system.toolDefs.reduce((a, t) => a + t.chars, 0) / 4),
    mcpRows: ctxNote.system.toolDefs.filter((t) => /mcp|tool_search/i.test(t.name)).map((t) => [t.name, Math.round(t.chars / 4)]),
  } : Object.keys(ctxNote ?? {}),
}));
process.exit(0);
