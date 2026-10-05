import { expect, test } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { probeWorkspace, signInWorkspace } from "../src/main/mcpWorkspaceProbe";

const echo = path.join(process.cwd(), "tests/fixtures/mcp-echo-server.mjs");

// Key-free: a model-less Pi, exactly like the utility client, in a workspace.
test("a workspace server's state and tool names come from a Pi in that workspace", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wsprobe-"));
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wsagent-"));
  fs.writeFileSync(path.join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [echo] } } }));
  const spec = resolvePiSpawn(ws, path.join(agentDir, "sessions"), path.join(process.cwd(), "pi-runtime"), { mcp: true, agentDir });
  expect(await probeWorkspace({ ...spec, env: { ...spec.env, HOME: agentDir } }, ["echo"])).toEqual([
    { name: "echo", state: "connected", toolCount: 1, tools: [{ name: "echo" }] },
  ]);
}, 40_000);

test("a global server of the same name wins, and the workspace row says overridden", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wsprobe-"));
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-wsagent-"));
  const cfg = { mcpServers: { echo: { command: process.execPath, args: [echo] } } };
  fs.writeFileSync(path.join(ws, ".mcp.json"), JSON.stringify(cfg));
  fs.writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify(cfg));
  const spec = resolvePiSpawn(ws, path.join(agentDir, "sessions"), path.join(process.cwd(), "pi-runtime"), { mcp: true, agentDir });
  const rows = await probeWorkspace({ ...spec, env: { ...spec.env, HOME: agentDir } }, ["echo"]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: "echo", state: "overridden" });
}, 40_000);

/** A PiClient-shaped fake: records answers, lets the test emit Pi's ui-requests. */
function fakeClient() {
  const e = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const answered: Array<[string, object]> = [];
  let stopped = false;
  e.start = async () => {};
  e.stop = () => { stopped = true; };
  e.respondUi = (id: string, p: object) => answered.push([id, p]);
  // Like Pi: an extension command answers only when its handler returns — here, never.
  e.send = () => new Promise(() => {});
  return { client: e as never, answered, isStopped: () => stopped, emitUi: (r: object) => e.emit("ui-request", r) };
}

test("sign-in: URL surfaced, Pi's paste-back input left PENDING, done on 'Signed in', Pi stopped", async () => {
  const f = fakeClient();
  const s = signInWorkspace({} as never, "linear", () => f.client);
  await new Promise((r) => setTimeout(r, 0));
  f.emitUi({ id: "n1", method: "notify", message: 'Sign in to MCP server "linear" in your browser:\nhttps://auth/x' });
  expect(await s.url).toBe("https://auth/x");
  f.emitUi({ id: "in1", method: "input", title: 'Waiting for sign-in to "linear"…' });
  f.emitUi({ id: "n2", method: "notify", message: 'Signed in to MCP server "linear" (3 tools).' });
  expect(await s.done).toEqual({ ok: true, message: 'Signed in to MCP server "linear" (3 tools).' });
  expect(f.answered).toEqual([]); // answering the input would have failed the sign-in
  expect(f.isStopped()).toBe(true);
});

test("sign-in cancel answers the pending input as cancelled, then stops Pi", async () => {
  const f = fakeClient();
  const s = signInWorkspace({} as never, "linear", () => f.client);
  await new Promise((r) => setTimeout(r, 0));
  f.emitUi({ id: "in1", method: "input", title: "Waiting…" });
  s.cancel();
  expect(await s.done).toMatchObject({ ok: false });
  expect(f.answered).toEqual([["in1", { cancelled: true }]]);
  expect(f.isStopped()).toBe(true);
});
