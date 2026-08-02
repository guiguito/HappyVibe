/**
 * Prove the ui-request fallback end to end against REAL Pi: a third-party
 * extension's blocking ctx.ui.confirm is recognised as unanswerable, denied
 * with {cancelled:true}, and the extension CONTINUES instead of hanging.
 *
 * tests/ui-fallback.test.ts covers the predicate in isolation. This covers the
 * two things it cannot: that Pi really leaves such a request pending forever
 * (the bug), and that {cancelled:true} really unblocks all of it (the fix) —
 * both facts live in the vendored Pi, so this is a pin-bump gate.
 *
 * Key-free: a slash command is dispatched locally by Pi, so no model call.
 */
import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { isUnhandledBlockingUi, UI_CANCEL_RESPONSE } from "../src/main/uiFallback";

const runtime = path.join(process.cwd(), "pi-runtime");
const CLI = path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const FIXTURE = path.join(process.cwd(), "tests/fixtures/foreign-ui-extension.ts");

let client: PiClient | undefined;
afterEach(() => client?.stop());

type Req = { id: string; method?: string; title?: string; message?: string };

const startWithFixture = async (): Promise<{ reqs: Req[]; probe: () => Record<string, unknown> | undefined }> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-uifb-"));
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });

  client = new PiClient({
    execPath: process.execPath,
    args: [
      CLI, "--mode", "rpc", "--no-session",
      "-e", FIXTURE,
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      DEEPSEEK_API_KEY: "sk-contract-noop",
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
    } as Record<string, string>,
    cwd: tmp,
  });

  const reqs: Req[] = [];
  client.on("ui-request", (m) => reqs.push(m as Req));
  await client.start();

  const probe = (): Record<string, unknown> | undefined => {
    for (const r of reqs) {
      if (r.method !== "notify") continue;
      try {
        const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
        if (p.kind === "hv.probe") return p;
      } catch { /* not JSON */ }
    }
    return undefined;
  };
  return { reqs, probe };
};

const waitFor = async (pred: () => boolean, ms = 8000): Promise<boolean> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

test.skipIf(!fs.existsSync(CLI))(
  "a foreign blocking confirm hangs when unanswered — the bug this fallback exists for",
  async () => {
    const { reqs, probe } = await startWithFixture();
    // Fire-and-forget: the pending RPC rejects when afterEach stops the client,
    // which is expected teardown, not a failure.
    client!.send({ type: "prompt", message: "/probe-confirm" }).catch(() => {});

    const arrived = await waitFor(() => reqs.some((r) => r.method === "confirm"));
    expect(arrived, "fixture never issued its confirm").toBe(true);

    const req = reqs.find((r) => r.method === "confirm")!;
    // It is blocking, and carries no hv.* envelope — so nothing in HappyVibe
    // would ever render it. This is exactly what the predicate must catch.
    expect(isUnhandledBlockingUi(req)).toBe(true);

    // Deliberately answer NOTHING. Pre-fix behaviour: the extension stays stuck.
    expect(await waitFor(() => probe() !== undefined, 3000)).toBe(false);
  },
  30_000,
);

test.skipIf(!fs.existsSync(CLI))(
  "{cancelled:true} unblocks it and the extension reads it as a denial",
  async () => {
    const { reqs, probe } = await startWithFixture();
    // Answer any unanswerable blocking request, exactly as ipc.ts now does.
    client!.on("ui-request", (m) => {
      const r = m as Req;
      if (isUnhandledBlockingUi(r)) client!.respondUi(r.id, UI_CANCEL_RESPONSE);
    });
    // Fire-and-forget: the pending RPC rejects when afterEach stops the client,
    // which is expected teardown, not a failure.
    client!.send({ type: "prompt", message: "/probe-confirm" }).catch(() => {});

    expect(await waitFor(() => probe() !== undefined), "extension still hung after the cancel").toBe(true);
    const p = probe()!;
    expect(p.answered).toBe(true);
    // Pi maps {cancelled:true} to `false` for confirm — a denial, not a silent
    // approval. If a pin bump changed that, an auto-deny could become an
    // auto-ALLOW, so assert the value and not merely that it resumed.
    expect(p.answer).toBe(false);
    expect(reqs.some((r) => r.method === "confirm")).toBe(true);
  },
  30_000,
);
