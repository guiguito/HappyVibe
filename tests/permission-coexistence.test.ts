/**
 * Task 13 — V6 Gate: pi-permission-system coexistence (headless integration test)
 *
 * Validates whether @gotgenes/pi-permission-system@18.1.1 coexists with the
 * happyvibe-bridge extension and whether its `ask` prompts surface over the
 * same RPC ui-request channel as the bridge.
 *
 * Config schema used (project-scope, per README):
 *   <cwd>/.pi/extensions/pi-permission-system/config.json
 *   Top-level key: "permission", surface key "write": "ask" is supposed to
 *   trigger a UI prompt before any file-write tool call.
 *
 * Distinction between extension ui-requests:
 *   - happyvibe-bridge emits method="select" + JSON title {"kind":"hv.permission",...}
 *   - pi-permission-system sends method="setStatus" (status updates, NOT selectable prompts)
 *
 * V6 FINDING (recorded 2026-07-03):
 *   pi-permission-system does NOT surface its `ask` prompts over RPC as select requests.
 *   It only emits setStatus messages over the extension_ui_request channel.
 *   Enforcement for the write tool came exclusively from the happyvibe-bridge.
 *   pi-permission-system options (Yes/Yes,for this session/No/No,provide reason)
 *   were never presented over RPC — the extension likely renders internally via
 *   ctx.ui.select which in RPC mode does not produce a ui-request; it may only
 *   work in TUI (terminal UI) mode.
 *   V6 verdict: FAIL — pi-permission-system ask prompts do NOT surface over RPC.
 */

import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";

// Tiny .env loader — keeps tests dependency-free
for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;
let client: PiClient;
afterEach(() => client?.stop());

/**
 * Classify which extension emitted a ui-request by inspecting its title/method.
 * - Bridge: method="select" + JSON title with "kind": "hv.permission"
 * - pi-permission-system: method="setStatus" (status update, not a prompt)
 * - unknown: anything else
 */
function classifyUiRequest(req: Record<string, unknown>): "bridge" | "pi-permission-system-status" | "unknown" {
  const title = typeof req.title === "string" ? req.title : "";
  const method = typeof req.method === "string" ? req.method : "";

  if (method === "setStatus" && req.statusKey === "pi-permission-system") {
    return "pi-permission-system-status";
  }

  if (method === "select") {
    try {
      const parsed = JSON.parse(title) as Record<string, unknown>;
      if (parsed.kind === "hv.permission") return "bridge";
    } catch {
      // plain text select — could be pi-permission-system's actual prompt if it surfaces
    }
  }

  return "unknown";
}

test.skipIf(!KEY)(
  "V6: pi-permission-system coexistence — capture real RPC behavior of both extensions",
  async () => {
    const runtime = path.join(process.cwd(), "pi-runtime");

    // Create a temp workspace with pi-permission-system project-scope config
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-v6-"));
    const piDir = path.join(tmp, ".pi", "extensions", "pi-permission-system");
    fs.mkdirSync(piDir, { recursive: true });

    // Config schema: project-scope at <cwd>/.pi/extensions/pi-permission-system/config.json
    // "write": "ask" — should gate file-write tool calls via UI prompt.
    // All other ops allowed to keep test focused on the write surface.
    const config = {
      "permission": {
        "*": "allow",
        "bash": { "*": "allow" },
        "write": "ask",
      },
    };
    fs.writeFileSync(path.join(piDir, "config.json"), JSON.stringify(config, null, 2));

    // Spawn Pi with BOTH extensions: bridge first, then pi-permission-system
    client = new PiClient({
      execPath: process.execPath,
      args: [
        path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--mode", "rpc", "--no-session",
        "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
        "-e", path.join(runtime, "node_modules/@gotgenes/pi-permission-system/src/index.ts"),
        "--provider", "deepseek", "--model", "deepseek-v4-flash",
      ],
      env: { ...process.env, DEEPSEEK_API_KEY: KEY! } as Record<string, string>,
      cwd: tmp,
    });
    await client.start();

    // Collect ALL ui-request events with their classification
    const uiRequests: Array<{ req: Record<string, unknown>; classification: string; idx: number }> = [];
    let uiIdx = 0;

    const agentDone = new Promise<void>((resolve) =>
      client.on("event", (e) => {
        const ev = e as Record<string, unknown>;
        if (ev.type === "agent_end") resolve();
      })
    );

    // Listen for ALL ui-requests, classify and respond
    client.on("ui-request", (m) => {
      const req = m as Record<string, unknown>;
      const idx = ++uiIdx;
      const classification = classifyUiRequest(req);

      console.log(`[v6.test] ui-request #${idx} classification=${classification} method=${req.method} id=${req.id}`);
      console.log(`[v6.test] RAW ui-request #${idx}:`, JSON.stringify(req, null, 2));

      uiRequests.push({ req, classification, idx });

      // Respond based on method:
      // - select: deny (bridge: "Deny", plain: "No")
      // - setStatus: respond with empty (status acks don't block)
      if (req.method === "select") {
        const denyValue = classification === "bridge" ? "Deny" : "No";
        console.log(`[v6.test] Responding select #${idx} with { value: "${denyValue}" }`);
        client.respondUi(req.id as string, { value: denyValue });
      } else {
        // setStatus or other — respond with empty object to unblock
        client.respondUi(req.id as string, {});
      }
    });

    // Prompt model to create a file — triggers write tool
    await client.send({
      type: "prompt",
      message: "You MUST immediately create a file called v6-target.txt containing 'v6 test content', using the write tool. Do not explain — just call the write tool now.",
    });

    await agentDone;

    // ── Evidence capture ──────────────────────────────────────────────────

    const selectRequests = uiRequests.filter((r) => r.req.method === "select");
    const setStatusRequests = uiRequests.filter((r) => r.req.method === "setStatus");
    const bridgeSelects = uiRequests.filter((r) => r.classification === "bridge");
    const piPermStatusUpdates = uiRequests.filter((r) => r.classification === "pi-permission-system-status");

    // Check for any plain-text select (pi-permission-system's actual prompt if it surfaced)
    const piPermSelects = selectRequests.filter((r) => r.classification !== "bridge");

    const targetFile = path.join(tmp, "v6-target.txt");
    const fileExists = fs.existsSync(targetFile);

    console.log(`[v6.test] TOTAL ui-requests: ${uiRequests.length}`);
    console.log(`[v6.test]   method=select: ${selectRequests.length} (bridge: ${bridgeSelects.length}, pi-permission-system: ${piPermSelects.length})`);
    console.log(`[v6.test]   method=setStatus: ${setStatusRequests.length} (pi-permission-system status: ${piPermStatusUpdates.length})`);
    console.log(`[v6.test] v6-target.txt exists after responding to all prompts: ${fileExists}`);
    console.log(`[v6.test] pi-permission-system surfaced ask prompt over RPC as select: ${piPermSelects.length > 0}`);
    console.log(`[v6.test] Double-prompt (bridge + pi-permission-system both asked as select): ${bridgeSelects.length > 0 && piPermSelects.length > 0}`);

    // ── V6 findings assertions ─────────────────────────────────────────────

    // FINDING: pi-permission-system only emits setStatus, NOT select prompts
    // This is the core V6 finding — documenting actual behavior:
    expect(piPermStatusUpdates.length, "pi-permission-system sends setStatus events (confirmed behavior)").toBeGreaterThan(0);

    // FINDING: The bridge correctly intercepted the write tool call
    expect(bridgeSelects.length, "bridge must have intercepted the write tool call").toBeGreaterThan(0);

    // FINDING: deny from bridge blocks write
    expect(fileExists, "v6-target.txt must NOT exist — bridge deny blocks the write").toBe(false);

    // FINDING: pi-permission-system's ask policy does NOT produce a select prompt over RPC
    // This is the V6 FAIL condition — recorded for PRD architecture decision.
    // The following assertion documents that pi-permission-system ask does NOT surface:
    expect(piPermSelects.length, "pi-permission-system did NOT surface ask as a select prompt over RPC (V6 FAIL finding)").toBe(0);

    console.log("[v6.test] V6 FAIL finding confirmed: pi-permission-system ask does NOT surface over RPC.");
    console.log("[v6.test] Bridge enforcement still works (PASS for bridge isolation).");
    console.log("[v6.test] PRD impact: cannot rely on pi-permission-system for RPC-mode permission UI.");
  },
  120_000,
);
