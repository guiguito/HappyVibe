import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";

// Tiny .env loader — keeps tests dependency-free
for (const line of (fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : [])) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.DEEPSEEK_API_KEY?.startsWith("sk-REPLACE") ? undefined : process.env.DEEPSEEK_API_KEY;
let client: PiClient;
afterEach(() => client?.stop());

interface Harness {
  notifies: Record<string, unknown>[];
  /** Every hv.browser-* blocking input the bridge sent, in order. */
  requests: Record<string, unknown>[];
  /** Rule names the gate raised a permission prompt for (browser:<host>, …). */
  prompted: string[];
  /** Prompt summaries, so we can assert WHAT the user was shown. */
  promptSummaries: string[];
  starts: Array<{ tool: string; args: Record<string, unknown> }>;
}

/**
 * One Pi with the bridge, and a fake "main" answering the hv.browser-*
 * envelopes. Real WebContentsViews need a window, so the pane itself is covered
 * by the unit tests — what is under test HERE is the wire: that the ten tools
 * exist, carry intent, gate per HOST rather than per tool, that localhost is
 * silent, and that main's reply becomes the tool result.
 */
function start(opts: { builtins?: Record<string, unknown>; allow?: boolean } = {}): Harness {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-browser-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: KEY!,
      ...(opts.builtins ? { HV_BUILTINS: JSON.stringify(opts.builtins) } : {}),
    } as Record<string, string>,
    cwd: tmp,
  });

  const h: Harness = { notifies: [], requests: [], prompted: [], promptSummaries: [], starts: [] };
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string; message?: string };
    if (r.method === "notify") {
      try { h.notifies.push(JSON.parse(r.message ?? "")); } catch { /* not JSON */ }
      return;
    }
    if (r.method === "input") {
      let t: Record<string, unknown> | null = null;
      try { t = JSON.parse(r.title ?? "") as Record<string, unknown>; } catch { /* not ours */ }
      if (typeof t?.kind === "string" && (t.kind as string).startsWith("hv.browser-")) {
        h.requests.push(t);
        // Stand in for main. These shapes are exactly what src/main/ipc.ts replies.
        if (t.kind === "hv.browser-open") {
          client.respondUi(r.id, { value: JSON.stringify({ ok: true, browserId: "b1", text: `The browser is open at ${String(t.url)}.` }) });
        } else if (t.kind === "hv.browser-get-text") {
          client.respondUi(r.id, { value: JSON.stringify({ ok: true, text: "Vite + React\nCount is 0", untrusted: true }) });
        } else {
          client.respondUi(r.id, { value: JSON.stringify({ ok: true, text: "done" }) });
        }
        return;
      }
      client.respondUi(r.id, { cancelled: true });
      return;
    }
    if (r.method === "select") {
      try {
        const p = JSON.parse(r.title ?? "") as { kind?: string; tool?: string; summary?: string };
        if (p?.kind === "hv.permission") {
          h.prompted.push(String(p.tool));
          h.promptSummaries.push(String(p.summary ?? ""));
        }
      } catch { /* not a permission prompt */ }
      client.respondUi(r.id, { value: opts.allow === false ? "Deny" : "Allow" });
    }
  });
  client.on("event", (m) => {
    const e = m as { type?: string; toolName?: string; args?: Record<string, unknown> };
    if (e.type === "tool_execution_start" && e.toolName) {
      h.starts.push({ tool: e.toolName, args: e.args ?? {} });
    }
  });
  return h;
}

const has = (h: Harness, tool: string): boolean => h.starts.some((s) => s.tool === tool);

/**
 * §28: localhost opens with NO prompt, and reading the page is a read.
 *
 * Waiting on the ENVELOPE rather than tool_execution_start, for the reason
 * §26's file records: start fires before the tool_call handlers, so it can
 * never prove a call got through the gate.
 */
test.skipIf(!KEY)("browser_open on localhost is silent; get_text needs no prompt", async () => {
  const h = start();
  await client.start();

  const opened = await askUntil(
    () => client.send({ type: "prompt", message: "Open http://localhost:5173 with the browser_open tool. Do it now, then stop." }),
    () => h.requests.some((r) => r.kind === "hv.browser-open"),
  );
  expect(has(h, "browser_open"), "the model never called browser_open").toBe(true);
  expect(opened, "browser_open was called but never reached main").toBe(true);

  const open = h.requests.find((r) => r.kind === "hv.browser-open")!;
  expect(open.url).toBe("http://localhost:5173");
  // §28: intent is REQUIRED — the card leads with it.
  const openStart = h.starts.find((s) => s.tool === "browser_open")!;
  expect(typeof openStart.args.intent).toBe("string");
  expect(String(openStart.args.intent).length).toBeGreaterThan(0);

  // THE localhost carve-out: the dev-preview case is ~all of the value, and a
  // prompt per page load would make the feature unusable.
  expect(h.prompted).not.toContain("browser:localhost");

  const read = await askUntil(
    () => client.send({ type: "prompt", message: "Now read the page with browser_get_text and tell me what it says." }),
    () => h.requests.some((r) => r.kind === "hv.browser-get-text"),
  );
  expect(has(h, "browser_get_text"), "the model never called browser_get_text").toBe(true);
  expect(read, "browser_get_text was called but never reached main").toBe(true);
  // A read is a read: SAFE_TOOLS, no prompt, ever.
  expect(h.prompted).not.toContain("browser_get_text");
}, 240_000);

/**
 * §28's headline: a non-local host gates per HOST, the prompt shows the URL and
 * never the model's sentence, and Deny blocks the call.
 */
test.skipIf(!KEY)("a non-local host prompts as browser:<host>, showing the URL", async () => {
  const h = start({ allow: false });
  await client.start();

  await askUntil(
    () => client.send({ type: "prompt", message: "Open https://example.com with the browser_open tool. Do it now, then stop." }),
    () => h.prompted.some((p) => p.startsWith("browser:")),
  );

  // Gated under the virtual rule name, not the bare tool — this is what makes
  // "allow this host" different from "allow all navigation".
  expect(h.prompted).toContain("browser:example.com");

  // The summary is the URL — the FACTUAL action. And the model's own sentence
  // is nowhere in it, which is the §13 rule this feature must not break.
  expect(h.promptSummaries).toContain("https://example.com");
  const start_ = h.starts.find((s) => s.tool === "browser_open");
  const intent = start_ ? String(start_.args.intent ?? "") : "";
  if (intent) expect(h.promptSummaries).not.toContain(intent);

  // Denied ⇒ the envelope never reached main.
  expect(h.requests.some((r) => r.kind === "hv.browser-open")).toBe(false);
}, 240_000);

/** §28: the group is one switch — off means none of the ten register. */
test.skipIf(!KEY)("with the browser group off, no browser tool exists", async () => {
  const h = start({ builtins: { browser: false } });
  await client.start();

  const res = await client.send({ type: "prompt", message: "List every tool you have whose name starts with browser_. If there are none, say NONE." });
  expect(res).toBeTruthy();
  expect(h.starts.some((s) => s.tool.startsWith("browser_"))).toBe(false);
  expect(h.requests.length).toBe(0);
}, 180_000);
