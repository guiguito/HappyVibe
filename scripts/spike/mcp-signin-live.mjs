#!/usr/bin/env node
// THROWAWAY spike (PRD §13 Phase 0, decision 12): does a RUNNING session use a sign-in made
// from the shell, without a respawn? Turn 1 before sign-in, `pi mcp login` from the shell,
// turn 2 after — same Pi process. Usage: PI_CODING_AGENT_DIR=<dir> node … <server> <tool>
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

const [server, tool] = process.argv.slice(2);
const rt = path.resolve("pi-runtime");
const cli = path.join(rt, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const call = { tool: `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_"), args: { query: "test" } };
const steps = [call, { text: "one" }, call, { text: "two" }];
spawnSync(process.execPath, [cli, "mcp", "logout", server], { stdio: ["ignore", "inherit", "inherit"] });
const child = spawn(process.execPath, [cli, "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
  "-e", path.resolve("tests/fixtures/faux-model.ts"), "-e", "builtin:mcp", "-e", path.join(rt, "extensions/happyvibe-bridge.ts"),
  "--provider", "faux", "--model", "script"], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, HV_TEST_RUNTIME: rt, HV_FAUX_STEPS: JSON.stringify(steps) } });
let n = 0;
const send = (cmd) => child.stdin.write(JSON.stringify({ id: `c${++n}`, ...cmd }) + "\n");
let onEnd = () => {};
readline.createInterface({ input: child.stdout }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.type === "extension_ui_request" && m.method === "select") send({ type: "extension_ui_response", id: m.id, value: "Allow" });
  if (m.type === "tool_execution_end" && m.toolName === call.tool) {
    const text = JSON.stringify(m.result).slice(0, 160);
    console.log(`RESULT isError=${m.isError} ${text}`);
  }
  if (m.type === "agent_end") onEnd();
});
const turn = (msg) => new Promise((r) => { onEnd = r; send({ type: "prompt", message: msg }); });
await new Promise((r) => setTimeout(r, 3000));
console.log("--- turn 1 (signed out)");
await turn("one");
console.log("--- signing in from the shell");
const login = spawnSync(process.execPath, [cli, "mcp", "login", server, "--timeout", "300"], { stdio: ["ignore", "inherit", "inherit"] });
console.log(`login exit ${login.status}`);
console.log("--- turn 2 (same process)");
await turn("two");
child.kill();
process.exit(0);
