import { afterEach, expect, test } from "vitest";
import path from "node:path";
import { PiClient } from "../src/main/pi/PiClient";

const fakeSpec = {
  execPath: process.execPath,
  args: [path.join(__dirname, "fixtures/fake-pi.mjs")],
  env: { ...process.env } as Record<string, string>,
  cwd: process.cwd(),
};
let client: PiClient;
afterEach(() => client?.stop());

test("send() correlates response by id and survives garbage lines", async () => {
  client = new PiClient(fakeSpec);
  await client.start();
  const res = await client.send({ type: "get_session_stats" });
  expect(res.success).toBe(true);
});

test("emits events and ui-requests during a prompt", async () => {
  client = new PiClient(fakeSpec);
  await client.start();
  const events: string[] = [];
  const uiReq = new Promise<string>((r) => client.on("ui-request", (m) => r(m.id)));
  client.on("event", (e) => events.push(e.type));
  await client.send({ type: "prompt", message: "hello" });
  expect(await uiReq).toBe("ui-1");
  await new Promise((r) => setTimeout(r, 200));
  expect(events).toContain("message_update");
  expect(events).toContain("agent_end");
});

test("emits exit on crash", async () => {
  client = new PiClient(fakeSpec);
  await client.start();
  const exited = new Promise<number>((r) => client.on("exit", ({ code }) => r(code)));
  client.send({ type: "crash_now" } as never).catch(() => {});
  expect(await exited).toBe(7);
});

import fs from "node:fs";
import os from "node:os";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

test("real vendored pi answers get_session_stats over RPC", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [path.join(runtime, PI_CLI_RELPATH), "--mode", "rpc", "--no-session"],
    env: { ...process.env } as Record<string, string>,
    cwd: tmp,
  });
  await client.start();
  const res = await client.send({ type: "get_session_stats" });
  expect(res.success).toBe(true);
}, 30_000);
