import { afterEach, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { askUntil } from "./reask";
import { KEY, MODEL, PROVIDER_ENV } from "./liveModel";
import { UNTRUSTED_BANNER } from "../pi-runtime/extensions/hv-browser";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

let client: PiClient;
afterEach(() => client?.stop());

interface Harness {
  /** Every hv.web-* blocking input the bridge sent, in order. */
  requests: Record<string, unknown>[];
  /** Rule names the gate raised a permission prompt for. */
  prompted: string[];
  /** Prompt summaries, so we can assert WHAT the user was shown. */
  promptSummaries: string[];
  starts: Array<{ tool: string; args: Record<string, unknown> }>;
  /** Text of every web tool's result, as the model received it. */
  results: string[];
  audits: Record<string, unknown>[];
}

/**
 * One real Pi with the bridge, and a fake "main" answering the hv.web-*
 * envelopes with exactly the shapes src/main/ipc.ts replies.
 *
 * What is under test HERE is the WIRE, not the web service: that the four tools
 * exist and carry intent, that fetch/map/crawl gate per HOST under the
 * browser's own rule, that a private address is refused before any prompt, that
 * a search needs no prompt at all, and that main's reply becomes the tool
 * result with the untrusted banner on it. The service itself is measured by
 * scripts/web-service-probe.mjs (manual — CI must never hit that box).
 */
function start(opts: { builtins?: Record<string, unknown>; answer?: "Allow" | "Allow for session" | "Deny" } = {}): Harness {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-web-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
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

  const h: Harness = { requests: [], prompted: [], promptSummaries: [], starts: [], results: [], audits: [] };
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string; message?: string };
    if (r.method === "notify") {
      try {
        const p = JSON.parse(r.message ?? "") as { kind?: string };
        if (p?.kind === "hv.audit") h.audits.push(p as Record<string, unknown>);
      } catch {
        /* not JSON */
      }
      return;
    }
    if (r.method === "input") {
      let t: Record<string, unknown> | null = null;
      try {
        t = JSON.parse(r.title ?? "") as Record<string, unknown>;
      } catch {
        /* not ours */
      }
      if (typeof t?.kind === "string" && (t.kind as string).startsWith("hv.web-")) {
        h.requests.push(t);
        // Stand in for main. These shapes are exactly what src/main/ipc.ts sends.
        if (t.kind === "hv.web-fetch") {
          client.respondUi(r.id, {
            value: JSON.stringify({
              ok: true,
              untrusted: true,
              text:
                `Read ${String(t.url)} (title: "Example Domain", status 200, 1,256 chars total, showing 0–1,256).\n\n` +
                "# Example Domain\nThis domain is for use in illustrative examples.",
              meta: { host: "example.com", total: 1_256, start: 0, end: 1_256, status: 200 },
            }),
          });
        } else {
          client.respondUi(r.id, {
            value: JSON.stringify({
              ok: true,
              untrusted: true,
              text: 'Searched the web for "example" — 1 result.\n\n1. Example Domain — https://example.com',
            }),
          });
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
      } catch {
        /* not a permission prompt */
      }
      client.respondUi(r.id, { value: opts.answer ?? "Allow" });
    }
  });
  client.on("event", (m) => {
    const e = m as {
      type?: string;
      toolName?: string;
      args?: Record<string, unknown>;
      result?: { content?: Array<{ type: string; text?: string }> };
    };
    if (e.type === "tool_execution_start" && e.toolName) h.starts.push({ tool: e.toolName, args: e.args ?? {} });
    if (e.type === "tool_execution_end" && e.toolName?.startsWith("web_")) {
      h.results.push((e.result?.content ?? []).map((c) => c.text ?? "").join("\n"));
    }
  });
  return h;
}

const called = (h: Harness, tool: string): boolean => h.starts.some((s) => s.tool === tool);

/**
 * §32's headline: a public host gates per HOST under the browser's own rule,
 * the prompt shows the URL rather than the model's sentence, and main's reply
 * reaches the model behind the untrusted banner.
 */
test.skipIf(!KEY)("web_fetch gates as browser:<host>, shows the URL, and the banner reaches the result", async () => {
  const h = start();
  await client.start();

  const reached = await askUntil(
    () => client.send({ type: "prompt", message: "Read https://example.com with the web_fetch tool and tell me its title. Do it now." }),
    () => h.requests.some((r) => r.kind === "hv.web-fetch"),
  );
  expect(called(h, "web_fetch"), "the model never called web_fetch").toBe(true);
  expect(reached, "web_fetch was called but never reached main").toBe(true);

  // Gated under the virtual rule name, not the bare tool — this is what makes
  // "allow this host" different from "allow all web reading", and it is the
  // SAME name §28's browser gates under.
  expect(h.prompted).toContain("browser:example.com");

  // The summary is the URL — the FACTUAL action. The model's own sentence is
  // nowhere in it, which is the §13 rule this feature must not break.
  expect(h.promptSummaries).toContain("https://example.com");
  const intent = String(h.starts.find((s) => s.tool === "web_fetch")?.args.intent ?? "");
  expect(intent.length, "web_fetch must declare a required intent").toBeGreaterThan(0);
  expect(h.promptSummaries).not.toContain(intent);

  const req = h.requests.find((r) => r.kind === "hv.web-fetch")!;
  expect(req.url).toBe("https://example.com");
  // The cancel notify has no other way to find the in-flight request.
  expect(typeof req.toolCallId).toBe("string");
  expect(String(req.toolCallId).length).toBeGreaterThan(0);

  // Page bytes must never reach the model dressed as our own words.
  expect(h.results.some((t) => t.startsWith(UNTRUSTED_BANNER)), "the untrusted banner did not reach the tool result").toBe(true);
}, 240_000);

/** Deny blocks the call outright — the envelope never reaches main. */
test.skipIf(!KEY)("a denied host never reaches the web service", async () => {
  const h = start({ answer: "Deny" });
  await client.start();

  await askUntil(
    () => client.send({ type: "prompt", message: "Read https://example.com with the web_fetch tool. Do it now." }),
    () => h.prompted.some((p) => p.startsWith("browser:")),
  );
  expect(h.prompted).toContain("browser:example.com");
  expect(h.requests.some((r) => r.kind === "hv.web-fetch")).toBe(false);
}, 240_000);

/**
 * "Allow for session" is the SHARED grant — the whole point of reusing the
 * browser's rule. A second page on the same host must be silent.
 *
 * (The pane's own Allow button is deliberately NOT shared: it writes that
 * pane's egress state only. That asymmetry is a GUI assertion, not a wire one.)
 */
test.skipIf(!KEY)("Allow for session covers a second page on the same host", async () => {
  const h = start({ answer: "Allow for session" });
  await client.start();

  await askUntil(
    () => client.send({ type: "prompt", message: "Read https://example.com/ with web_fetch. Do it now, then stop." }),
    () => h.requests.some((r) => r.kind === "hv.web-fetch"),
  );
  expect(h.prompted.filter((p) => p === "browser:example.com").length).toBe(1);

  await askUntil(
    () => client.send({ type: "prompt", message: "Now read https://example.com/index.html with web_fetch. Do it now, then stop." }),
    () => h.requests.filter((r) => r.kind === "hv.web-fetch").length >= 2,
  );
  expect(h.requests.filter((r) => r.kind === "hv.web-fetch").length).toBeGreaterThanOrEqual(2);
  // The grant covered it: still exactly one prompt for that host.
  expect(h.prompted.filter((p) => p === "browser:example.com").length).toBe(1);
}, 240_000);

/**
 * A private address is refused in the BRIDGE, before the gate and before any
 * envelope, with a sentence naming the tool that can actually reach it.
 */
test.skipIf(!KEY)("localhost is refused before the gate, naming browser_open, with no prompt", async () => {
  const h = start();
  await client.start();

  await askUntil(
    () => client.send({ type: "prompt", message: "Use web_fetch on http://localhost:5173 and tell me what it says. Do it now." }),
    () => h.audits.some((a) => a.source === "web"),
  );
  expect(called(h, "web_fetch"), "the model never called web_fetch").toBe(true);

  // No prompt: approving browser:localhost for a call that cannot work either
  // way is worse than useless.
  expect(h.prompted).not.toContain("browser:localhost");
  expect(h.requests.some((r) => r.kind === "hv.web-fetch")).toBe(false);

  const row = h.audits.find((a) => a.source === "web");
  expect(row, "the refusal emitted no hv.audit row").toBeTruthy();
  expect(row).toMatchObject({ tool: "web_fetch", decision: "deny" });
  // The refusal must name the alternative, or the model just retries.
  expect(h.results.some((t) => t.includes("browser_open"))).toBe(true);
}, 240_000);

/** web_search is allow-by-default: SAFE_TOOLS, no prompt, audited as such. */
test.skipIf(!KEY)("web_search needs no prompt", async () => {
  const h = start();
  await client.start();

  await askUntil(
    () => client.send({ type: "prompt", message: "Use the web_search tool to search for 'example domain'. Do it now, then stop." }),
    () => h.requests.some((r) => r.kind === "hv.web-search"),
  );
  expect(called(h, "web_search"), "the model never called web_search").toBe(true);
  expect(h.prompted).not.toContain("web_search");
  expect(h.audits.find((a) => a.tool === "web_search")).toMatchObject({ decision: "allow", source: "safe-default" });
  const req = h.requests.find((r) => r.kind === "hv.web-search")!;
  expect(typeof req.query).toBe("string");
}, 240_000);

/** §32: the group is one switch — off means none of the four register. */
test.skipIf(!KEY)("with the web group off, no web tool exists", async () => {
  const h = start({ builtins: { web: false } });
  await client.start();

  const res = await client.send({
    type: "prompt",
    message: "List every tool you have whose name starts with web_. If there are none, say NONE.",
  });
  expect(res).toBeTruthy();
  expect(h.starts.some((s) => s.tool.startsWith("web_"))).toBe(false);
  expect(h.requests.length).toBe(0);
}, 180_000);

/**
 * The cancel path, pinned because it is invisible when it breaks.
 *
 * Pi hands `execute` an AbortSignal and NOTHING else in this repo uses one, so
 * "does an interrupted turn actually fire it?" was an open question rather than
 * an assumption — measured here, and the answer is yes (the notify arrives with
 * the real toolCallId). If a pin bump ever stops firing it, an abandoned crawl
 * silently holds one of the web service's two worker slots for two minutes,
 * and those two are shared by every HappyVibe install. Nothing else would fail.
 *
 * The harness deliberately never answers the envelope, which is what keeps the
 * tool open long enough to interrupt. Note the abort is NOT awaited: that RPC
 * does not resolve while a tool call is still pending (measured — awaiting it
 * hangs the test to its timeout, which is how this test was first written).
 */
test.skipIf(!KEY)("an interrupted turn cancels the in-flight web call", async () => {
  const runtime = path.join(process.cwd(), "pi-runtime");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hv-web-abort-"));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", MODEL.provider, "--model", MODEL.modelId,
    ],
    env: { ...process.env, ...PROVIDER_ENV } as Record<string, string>,
    cwd: tmp,
  });

  const envelopes: Record<string, unknown>[] = [];
  const cancels: Array<{ toolCallId?: string }> = [];
  client.on("ui-request", (m) => {
    const r = m as { id: string; method?: string; title?: string; message?: string };
    if (r.method === "notify") {
      try {
        const p = JSON.parse(r.message ?? "") as { kind?: string; toolCallId?: string };
        if (p?.kind === "hv.web-cancel") cancels.push(p);
      } catch {
        /* not JSON */
      }
      return;
    }
    if (r.method === "input") {
      let p: Record<string, unknown> | null = null;
      try {
        p = JSON.parse(r.title ?? "") as Record<string, unknown>;
      } catch {
        /* not ours */
      }
      if (typeof p?.kind === "string" && (p.kind as string).startsWith("hv.web-")) {
        envelopes.push(p);
        return; // hold the tool open, exactly as a slow crawl would
      }
      client.respondUi(r.id, { cancelled: true });
      return;
    }
    if (r.method === "select") client.respondUi(r.id, { value: "Allow" });
  });
  await client.start();

  void client.send({ type: "prompt", message: "Read https://example.com with web_fetch. Do it now." }).catch(() => {});
  const opened = await askUntil(async () => {}, () => envelopes.length > 0, { attempts: 1, waitMs: 90_000 });
  expect(opened, "the model never called web_fetch").toBe(true);

  void client.send({ type: "abort" }).catch(() => {});
  const cancelled = await askUntil(async () => {}, () => cancels.length > 0, { attempts: 1, waitMs: 20_000 });
  expect(cancelled, "an aborted turn produced no hv.web-cancel — the cancel path is dead").toBe(true);
  // Main matches on this id; a cancel that cannot name its call aborts nothing.
  expect(cancels[0].toolCallId).toBe(envelopes[0].toolCallId);
}, 180_000);
