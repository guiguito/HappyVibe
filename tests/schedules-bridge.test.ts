import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";
import { parseScheduleEnvelope } from "../src/main/scheduleEnvelopes";

/**
 * §35 — the four schedule tools over real RPC.
 *
 * What this pins that no unit test can: that a real model can find and fill
 * these schemas, that the envelopes main parses are the envelopes the bridge
 * actually sends, and that `schedule_list` raises no permission prompt.
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

interface Harness {
  client: PiClient;
  notifies: Record<string, unknown>[];
  envelopes: UiReq[];
  permissions: number;
  permissionTools: string[];
  toolArgs: Record<string, unknown>[];
}

async function start(env: Record<string, string>, answer: (kind: string) => string): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-sched-"));
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
  const h: Harness = { client: c, notifies: [], envelopes: [], permissions: 0, permissionTools: [], toolArgs: [] };
  c.on("ui-request", (m) => {
    const r = m as UiReq;
    if (r.method === "notify") {
      h.notifies.push(payloadOf(r));
      return;
    }
    const p = payloadOf(r);
    if (p.kind === "hv.permission") {
      // ALLOW. Denying here is what made the first version of this test fail
      // for a reason that had nothing to do with the tools: the call never ran,
      // so no envelope ever reached main.
      h.permissions += 1;
      h.permissionTools.push(String(p.tool ?? ""));
      c.respondUi(r.id, { value: "Allow" });
      return;
    }
    if (typeof p.kind === "string" && p.kind.startsWith("hv.schedule-")) {
      h.envelopes.push(r);
      c.respondUi(r.id, { value: answer(p.kind) });
      return;
    }
    c.respondUi(r.id, { cancelled: true });
  });
  // tool_execution_start is the ONLY event carrying a call's args.
  c.on("event", (e) => {
    const ev = e as { type?: string; toolName?: string; args?: Record<string, unknown> };
    if (ev.type === "tool_execution_start" && ev.toolName?.startsWith("schedule_") && ev.args) h.toolArgs.push(ev.args);
  });
  await c.start();
  return h;
}

test.skipIf(!KEY)("schedule_list reaches main as its envelope, and raises no permission prompt", async () => {
  const h = await start({}, () => "No schedules in this workspace.");
  const listed = (): boolean => h.envelopes.some((e) => parseScheduleEnvelope(e)?.kind === "hv.schedule-list");
  await askUntil(
    () => h.client.send({ type: "prompt", message: "Use the schedule_list tool to show me my schedules." }),
    listed,
  );
  expect(listed(), `saw ${JSON.stringify(h.envelopes.map((e) => e.title?.slice(0, 80)))}`).toBe(true);
  // A read is a safe default — the same argument that put memory_recall there.
  expect(h.permissionTools).not.toContain("schedule_list");
}, 180_000);

test.skipIf(!KEY)("schedule_create proposes a draft main can parse, carries an intent, and names no workspace", async () => {
  const h = await start({}, () => "declined");
  // FIND the create, never take envelopes[0]. A model that lists first before
  // proposing is behaving well, and the live batch caught exactly that — the
  // same mistake rules-bridge made by taking the first hv.audit notify.
  const created = (): ReturnType<typeof parseScheduleEnvelope> =>
    h.envelopes.map(parseScheduleEnvelope).find((e) => e?.kind === "hv.schedule-create") ?? null;
  await askUntil(
    () =>
      h.client.send({
        type: "prompt",
        message:
          "Use the schedule_create tool to propose a schedule titled 'Daily review' that runs the prompt 'review recent commits' every weekday at 09:00, in read-only mode.",
      }),
    () => created() !== null,
  );

  const env = created();
  expect(
    env,
    `no parseable schedule_create envelope; saw ${JSON.stringify(h.envelopes.map((e) => e.title?.slice(0, 120)))}`,
  ).toBeTruthy();
  const draft = (env as { draft: Record<string, unknown> }).draft;
  // Asserted on what main NEEDS, not on the model's word choices: it parsed, it
  // carries work, and its shape is one nextFire can schedule. Pinning the exact
  // title or a "09:00" spelling would be asserting on the model.
  expect(draft.title).toBeTruthy();
  expect(draft.prompt).toBeTruthy();
  expect(draft.at).toMatch(/^\d{1,2}:\d{2}$/);
  expect(["weekdays", "daily", "weekly"]).toContain((draft.repeat as { kind: string }).kind);
  // The model cannot name a workspace — there is no such parameter, and a
  // payload carrying one would have been refused by the parser above.
  expect(draft).not.toHaveProperty("workspaceId");

  // A writer declares its intent (§7 round 1's split: the headline is the
  // model's words, the thing being approved is ours).
  expect(h.toolArgs.some((a) => typeof a.intent === "string" && (a.intent as string).length > 0)).toBe(true);

  // And it raised NO permission modal of its own: the drawer is the
  // confirmation, and stacking a modal in front of it asks twice.
  expect(h.permissionTools).not.toContain("schedule_create");
}, 240_000);

test.skipIf(!KEY)("with the Schedules built-in off, none of the four tools exists", async () => {
  const h = await start({ HV_BUILTINS: JSON.stringify({ schedules: false }) }, () => "");
  await askUntil(
    () => h.client.send({ type: "prompt", message: "/hv-tools" }),
    () => h.notifies.some((n) => n.kind === "hv.tools"),
  );
  const tools = h.notifies.find((n) => n.kind === "hv.tools") as { tools?: Array<{ name: string }> } | undefined;
  expect(tools?.tools, "expected the hv.tools inventory").toBeTruthy();
  expect(tools!.tools!.map((t) => t.name).filter((n) => n.startsWith("schedule_"))).toEqual([]);
}, 120_000);
