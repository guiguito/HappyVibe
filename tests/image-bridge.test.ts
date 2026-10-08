import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";
import { writeNewFile } from "../src/main/files";

/**
 * §13 round 27 — generate_image, end to end on the WIRE: the bridge registers it from
 * HV_IMAGE_MODEL, Pi's registry reaches OpenRouter, a fake "main" writes the file exactly as
 * ipc.ts does, and the result carries OpenRouter's own charge as `usage`.
 *
 * Costs about one image (≈$0.03) per run, and only on the OpenRouter route — the image API is
 * OpenRouter's, so a DeepSeek-direct live route skips it.
 */
let client: PiClient;
afterEach(() => client?.stop());

const IMAGE_MODEL = "google/gemini-3.1-flash-lite-image";

test.skipIf(!KEY || MODEL.provider !== "openrouter")("generate_image reaches OpenRouter, main writes the file, and the result carries the charge", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-img-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: { ...process.env, ...PROVIDER_ENV, HV_IMAGE_MODEL: IMAGE_MODEL } as Record<string, string>,
    cwd: tmp,
  });

  const saves: Record<string, unknown>[] = [];
  let end: Record<string, unknown> | null = null;
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string };
    let t: Record<string, unknown> | null = null;
    try {
      t = JSON.parse(r.title ?? "") as Record<string, unknown>;
    } catch {
      return;
    }
    if (r.method === "select" && t?.kind === "hv.permission") {
      client.respondUi(r.id, { value: "Allow" });
      return;
    }
    if (r.method === "input" && t?.kind === "hv.image-save") {
      saves.push(t);
      try {
        writeNewFile([tmp], tmp, String(t.path), Buffer.from(String(t.data), "base64"));
        client.respondUi(r.id, { value: JSON.stringify({ ok: true, path: t.path }) });
      } catch (e) {
        client.respondUi(r.id, { value: JSON.stringify({ ok: false, error: String(e) }) });
      }
    }
  });
  client.on("event", (m) => {
    const e = m as { type?: string; toolName?: string; result?: Record<string, unknown> };
    if (e.type === "tool_execution_end" && e.toolName === "generate_image") end = e.result ?? {};
  });
  await client.start();

  const reached = await askUntil(
    () => client.send({ type: "prompt", message: "Use the generate_image tool to make a tiny flat icon of a sun and save it to sun.png. Do it now, then stop." }),
    () => saves.length > 0,
  );
  expect(reached, "generate_image never reached main's hv.image-save").toBe(true);
  await new Promise<void>((res) => { const t = setInterval(() => { if (end) { clearInterval(t); res(); } }, 200); });

  const bytes = fs.readFileSync(path.join(tmp, "sun.png"));
  const magic = bytes.subarray(0, 4).toString("hex");
  expect(["89504e47", "ffd8ffe0", "ffd8ffe1", "52494646"].some((h) => magic.startsWith(h.slice(0, 6))), `not an image: ${magic}`).toBe(true);
  const r = end as unknown as { details?: { model?: string }; usage?: { cost?: { total?: number } }; content?: Array<{ type: string }> };
  expect(r.details?.model).toBe(IMAGE_MODEL);
  expect(r.content?.some((b) => b.type === "image")).toBe(true);
  // OpenRouter's own charge, not Pi's text-rate estimate (docs/validation/im1.md: ≈20x higher).
  expect(r.usage?.cost?.total ?? 0).toBeGreaterThan(0.01);
}, 240_000);
