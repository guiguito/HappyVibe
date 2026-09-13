import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

/**
 * §35 — the read-only RUN clamp, against a real Pi and a real model.
 *
 * The unit tests pin the gate's verdicts; this pins that the verdict reaches
 * the wire. Both arms run the SAME ask, and the only difference is the
 * environment variable — which is the whole claim.
 */
const runtime = path.join(process.cwd(), "pi-runtime");
let client: PiClient | undefined;
afterEach(() => client?.stop());

type UiReq = { id: string; method?: string; title?: string; message?: string };
const payloadOf = (r: UiReq): Record<string, unknown> => {
  try {
    return JSON.parse((r.method === "notify" ? r.message : r.title) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
};

async function run(env: Record<string, string>): Promise<{ notifies: Record<string, unknown>[]; wrote: boolean; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ro-"));
  const c = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...PROVIDER_ENV, ...env } as Record<string, string>,
    cwd: dir,
  });
  client = c;
  const notifies: Record<string, unknown>[] = [];
  c.on("ui-request", (m) => {
    const r = m as UiReq;
    if (r.method === "notify") {
      notifies.push(payloadOf(r));
      return; // fire-and-forget
    }
    // ALLOW, so the unclamped arm can actually reach the filesystem — the
    // clamped arm must fail for its own reason, not for a denied permission.
    c.respondUi(r.id, { value: "Allow" });
  });
  await c.start();
  const wrote = (): boolean => fs.existsSync(path.join(dir, "hello.txt"));
  await askUntil(
    () => c.send({ type: "prompt", message: "Use the write tool to create a file named hello.txt containing the word hi. Do it now." }),
    () => wrote() || notifies.some((n) => n.kind === "hv.plan.blocked"),
  );
  return { notifies, wrote: wrote(), dir };
}

test.skipIf(!KEY)("HV_READONLY blocks a write with the RUN's reason, and nothing lands on disk", async () => {
  const ro = await run({ HV_READONLY: "1" });
  expect(ro.wrote).toBe(false);

  const blocked = ro.notifies.find((n) => n.kind === "hv.plan.blocked") as { reason?: string } | undefined;
  expect(blocked, `expected a blocked notify; saw ${JSON.stringify(ro.notifies.map((n) => n.kind))}`).toBeTruthy();
  // The user picked a read-only SCHEDULE, never plan mode — a card naming a
  // mode they did not choose reads as a bug.
  expect(blocked!.reason).toMatch(/read-only run/i);
  expect(blocked!.reason).not.toMatch(/plan mode/i);

  // The pill's notify: the renderer has no other way to know.
  expect(ro.notifies.some((n) => n.kind === "hv.readonly" && n.enabled === true)).toBe(true);

  // And it is audited as its own source, so the log does not read as plan mode.
  const audit = ro.notifies.filter((n) => n.kind === "hv.audit").map((n) => n as { source?: string; decision?: string });
  expect(audit.some((a) => a.source === "readonly" && a.decision === "deny")).toBe(true);
}, 180_000);

test.skipIf(!KEY)("the SAME ask writes the file with the flag absent — the clamp is the only difference", async () => {
  const rw = await run({});
  expect(rw.wrote, "the unclamped arm should have written hello.txt").toBe(true);
  expect(rw.notifies.some((n) => n.kind === "hv.readonly")).toBe(false);
}, 180_000);
