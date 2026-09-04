import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";

let client: PiClient;
afterEach(() => client?.stop());

interface Harness {
  /** Every hv.document-read envelope the bridge sent, in order. */
  requests: Record<string, unknown>[];
  /** hv.audit notifies, so a refusal can be asserted where it is RECORDED. */
  audits: Record<string, unknown>[];
  starts: Array<{ tool: string; args: Record<string, unknown> }>;
  tools: string[];
}

/**
 * One Pi with the bridge, and a fake "main" answering hv.document-read exactly
 * as src/main/ipc.ts does.
 *
 * What is under test here is the WIRE — that the tool exists, carries a
 * required intent, reaches main with the path the model asked for, and that
 * main's reply becomes the tool result. The conversion itself is covered
 * key-free by anydoc-contract; spending a model turn to re-prove it would buy
 * nothing.
 */
function start(opts: { builtins?: Record<string, unknown> } = {}): Harness {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-doc-"));
  fs.copyFileSync(path.join(process.cwd(), "tests/fixtures/documents/sample.docx"), path.join(tmp, "report.docx"));

  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: {
      ...process.env,
      ...PROVIDER_ENV,
      ...(opts.builtins ? { HV_BUILTINS: JSON.stringify(opts.builtins) } : {}),
    } as Record<string, string>,
    cwd: tmp,
  });

  const h: Harness = { requests: [], audits: [], starts: [], tools: [] };
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string; message?: string };
    if (r.method === "notify") {
      try {
        const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
        if (p.kind === "hv.audit") h.audits.push(p);
        if (p.kind === "hv.tools" && Array.isArray(p.tools)) h.tools = p.tools as string[];
      } catch {
        /* not ours */
      }
      return;
    }
    if (r.method !== "input") return;
    let t: Record<string, unknown> | null = null;
    try {
      t = JSON.parse(r.title ?? "") as Record<string, unknown>;
    } catch {
      return;
    }
    if (t?.kind !== "hv.document-read") return;
    h.requests.push(t);
    // Exactly the shape src/main/ipc.ts replies with.
    client.respondUi(r.id, {
      value: JSON.stringify({
        ok: true,
        name: "report.docx",
        path: String(t.path),
        text: "# Q3 report\n\nRevenue grew 12% against a flat headcount.",
        facts: { format: "docx", totalLines: 3, totalBytes: 58, from: 1, to: 3 },
      }),
    });
  });
  client.on("event", (m) => {
    const e = m as { type?: string; toolName?: string; args?: Record<string, unknown> };
    if (e.type === "tool_execution_start" && e.toolName) h.starts.push({ tool: e.toolName, args: e.args ?? {} });
  });
  return h;
}

test.skipIf(!KEY)("§31: the model reads a .docx through document_read, with intent", async () => {
  const h = start();
  await client.start();

  const reached = await askUntil(
    () =>
      client.send({
        type: "prompt",
        message: "Use the document_read tool on ./report.docx and tell me the revenue figure. Do it now, then stop.",
      }),
    () => h.requests.length > 0,
  );
  expect(
    h.starts.some((s) => s.tool === "document_read"),
    "the model never called document_read",
  ).toBe(true);
  expect(reached, "document_read was called but never reached main").toBe(true);

  expect(String(h.requests[0].path)).toMatch(/report\.docx$/);
  // Required intent, per decision F — the card leads with it.
  const call = h.starts.find((s) => s.tool === "document_read")!;
  expect(typeof call.args.intent).toBe("string");
  expect(String(call.args.intent).length).toBeGreaterThan(0);

  // §31 permission class: a document read raises NO prompt, and the audit log
  // carries no denial for it.
  expect(h.audits.some((a) => a.tool === "document_read" && a.decision === "deny")).toBe(false);
}, 180_000);

test.skipIf(!KEY)("§31: a plain `read` on the .docx is refused, and the refusal is audited", async () => {
  const h = start();
  await client.start();

  // Asserting on the AUDIT row, not on tool_execution_start: start fires BEFORE
  // the tool_call handlers, so it can never prove a call was blocked (§26's
  // recorded trap). The `document` source is what only this refusal emits.
  const refused = await askUntil(
    () =>
      client.send({
        type: "prompt",
        message: "Use the plain `read` tool (NOT document_read) on ./report.docx. Do it now, then stop.",
      }),
    () => h.audits.some((a) => a.source === "document"),
  );
  expect(refused, "read on a .docx was never refused with the document hint").toBe(true);
  const row = h.audits.find((a) => a.source === "document")!;
  expect(row.tool).toBe("read");
  expect(row.decision).toBe("deny");
}, 180_000);
