import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

/**
 * §7 round 25 — the busy status line reads Pi's tool-call stream. In RPC mode Pi
 * strips `partial` (modes/json-event.js), so the renderer only ever sees the raw
 * JSON fragments. This pins THAT contract (a pin bump that changes it breaks the
 * status line silently): start names the tool, deltas are strings, and the
 * fragments concatenate into the arguments `toolcall_end` reports.
 */
const runtime = path.join(process.cwd(), "pi-runtime");
let client: PiClient | undefined;
afterEach(() => client?.stop());

type Ame = { type: string; contentIndex?: number; toolName?: string; delta?: string; toolCall?: { name: string; arguments: Record<string, unknown> } };

test.skipIf(!KEY)("toolcall_* fragments concatenate into the arguments toolcall_end reports", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-tcs-"));
  const c = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...PROVIDER_ENV } as Record<string, string>,
    cwd: dir,
  });
  client = c;
  const ames: Ame[] = [];
  c.on("event", (e) => {
    const ev = e as { type?: string; assistantMessageEvent?: Ame };
    if (ev.type === "message_update" && ev.assistantMessageEvent?.type.startsWith("toolcall_")) ames.push(ev.assistantMessageEvent);
  });
  c.on("ui-request", (m) => {
    const r = m as { id: string; method?: string };
    if (r.method !== "notify") c.respondUi(r.id, { value: "Allow" });
  });
  await c.start();
  const target = path.join(dir, "notes.txt");
  await askUntil(
    () => c.send({ type: "prompt", message: "Use the write tool to create notes.txt containing the numbers 1 to 40, one per line. Do it now." }),
    () => fs.existsSync(target),
  );

  const start = ames.find((a) => a.type === "toolcall_start" && a.toolName === "write");
  expect(start, `saw ${JSON.stringify(ames.map((a) => a.type))}`).toBeTruthy();
  const idx = start!.contentIndex;
  const deltas = ames.filter((a) => a.type === "toolcall_delta" && a.contentIndex === idx);
  expect(deltas.every((d) => typeof d.delta === "string")).toBe(true);
  const end = ames.find((a) => a.type === "toolcall_end" && a.contentIndex === idx);
  expect(end?.toolCall?.name).toBe("write");
  const raw = deltas.map((d) => d.delta).join("");
  const joined = JSON.parse(raw) as Record<string, unknown>;
  expect(joined.path).toBe(end!.toolCall!.arguments.path);
  // Observation, not a contract (model behaviour) — goes in d1.md, never asserted.
  if (process.env.HV_PROBE_OUT) fs.appendFileSync(process.env.HV_PROBE_OUT, `[toolcall-stream] ${MODEL.provider}/${MODEL.modelId}: ${deltas.length} deltas, path ${raw.indexOf('"path"') < raw.indexOf('"content"') ? "BEFORE" : "AFTER"} content\n`);
}, 180_000);
