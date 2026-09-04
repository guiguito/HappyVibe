import { afterAll, beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PiClient } from "../src/main/pi/PiClient";
import { mergeOllamaModelsJson } from "../src/main/providers";
import { isSignedIn } from "../src/renderer/src/auth";
import { PI_CLI_RELPATH } from "../src/main/pi/spawn";

/**
 * B3 contract test — hv-auth-status / hv-login emit hv.auth-shaped
 * extension_ui_requests over RPC (docs/validation/s0.2.md wire mechanics).
 *
 * Runs against a temp PI_CODING_AGENT_DIR (user's real ~/.pi untouched),
 * makes NO network calls: the github-copilot flow is aborted at its very
 * first callback (the pre-network GitHub Enterprise domain prompt).
 */

const runtime = path.join(process.cwd(), "pi-runtime");
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-auth-agent-"));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-auth-cwd-"));

// Hermetic env: no real provider keys may leak into the status contract.
const env: Record<string, string> = { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_CODING_AGENT_DIR: agentDir } as Record<string, string>;
for (const k of Object.keys(env)) {
  if (/API_KEY|OAUTH_TOKEN|COPILOT_GITHUB_TOKEN/.test(k)) delete env[k];
}

let client: PiClient;
type UiReq = { id: string; method?: string; title?: string; message?: string; options?: string[] };
const requests: UiReq[] = [];
const waiters: { match: (r: UiReq) => boolean; resolve: (r: UiReq) => void }[] = [];

function nextRequest(match: (r: UiReq) => boolean, timeoutMs = 30_000): Promise<UiReq> {
  return new Promise((resolve, reject) => {
    const hit = requests.find(match);
    if (hit) return resolve(hit);
    const t = setTimeout(() => reject(new Error(`timed out waiting for ui-request; saw: ${JSON.stringify(requests)}`)), timeoutMs);
    waiters.push({ match, resolve: (r) => { clearTimeout(t); resolve(r); } });
  });
}

function authOf(r: UiReq): Record<string, unknown> {
  return JSON.parse((r.method === "notify" ? r.message : r.title) ?? "{}");
}

function isAuth(r: UiReq, stage: string): boolean {
  try {
    const p = authOf(r);
    return p.kind === "hv.auth" && p.stage === stage;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  // Seed a stored BYOK credential so the status contract covers source:"stored".
  fs.writeFileSync(
    path.join(agentDir, "auth.json"),
    JSON.stringify({ deepseek: { type: "api_key", key: "sk-test-not-real" } }),
    { mode: 0o600 },
  );
  // Seed the models.json our Ollama sync writes — proves Pi 0.80.3 accepts the
  // schema and that the "ollama" apiKey placeholder passes its auth gate.
  fs.writeFileSync(path.join(agentDir, "models.json"), mergeOllamaModelsJson(null, ["llama3.1:8b"]));
  client = new PiClient({
    execPath: process.execPath,
    args: [
      path.join(runtime, PI_CLI_RELPATH),
      "--mode", "rpc", "--no-session",
      "-e", path.join(runtime, "extensions/happyvibe-bridge.ts"),
      "--provider", "deepseek", "--model", "deepseek-v4-flash",
    ],
    env,
    cwd: workDir,
  });
  client.on("ui-request", (m) => {
    const r = m as UiReq;
    requests.push(r);
    const i = waiters.findIndex((w) => w.match(r));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(r);
  });
  await client.start();
}, 60_000);

afterAll(() => client?.stop());

test("hv-auth-status reports curated providers via a structured hv.auth notify, never leaking values", async () => {
  await client.send({ type: "prompt", message: "/hv-auth-status" });
  const req = await nextRequest((r) => isAuth(r, "status"));

  expect(req.method).toBe("notify");
  const payload = authOf(req);
  const providers = payload.providers as Record<string, { configured: boolean; source?: string }>;

  // Curated list is always reported, configured or not.
  for (const id of ["anthropic", "github-copilot", "openai-codex", "ollama", "deepseek", "openai", "google", "openrouter"]) {
    expect(providers[id], `provider ${id} missing from status`).toBeDefined();
  }
  expect(providers.deepseek).toMatchObject({ configured: true, source: "stored" });
  expect(providers.anthropic.configured).toBe(false);
  expect(providers["github-copilot"].configured).toBe(false);

  // Credential values NEVER ride the status wire.
  expect(JSON.stringify(payload)).not.toContain("sk-test-not-real");
}, 60_000);

test("get_available_models lists auth.json-backed and models.json (Ollama) models", async () => {
  const res = await client.send({ type: "get_available_models" });
  const models = (res.data as { models: { provider: string; id: string }[] }).models;
  // deepseek: stored api_key in auth.json; ollama: models.json apiKey placeholder.
  expect(models.some((m) => m.provider === "deepseek")).toBe(true);
  expect(models.some((m) => m.provider === "ollama" && m.id === "llama3.1:8b")).toBe(true);
  // Providers without any configured auth must NOT be listed.
  expect(models.some((m) => m.provider === "openrouter")).toBe(false);
}, 60_000);

test("hv-login rejects unknown providers with an hv.auth error notify", async () => {
  await client.send({ type: "prompt", message: "/hv-login not-a-provider" });
  const req = await nextRequest((r) => isAuth(r, "error") && (authOf(r).provider as string) === "not-a-provider");
  expect(authOf(req).message).toContain("Unknown OAuth provider");
}, 60_000);

test("hv-login github-copilot starts with an hv.auth prompt input; cancel aborts before any network", async () => {
  // Do NOT await: the prompt response only resolves when the whole flow ends.
  const flowDone = client.send({ type: "prompt", message: "/hv-login github-copilot" });

  // First callback of the copilot flow is the (pre-network) enterprise-domain prompt.
  const req = await nextRequest((r) => r.method === "input" && isAuth(r, "prompt"));
  const payload = authOf(req);
  expect(payload).toMatchObject({ kind: "hv.auth", stage: "prompt", provider: "github-copilot" });
  expect(typeof payload.message).toBe("string");

  // Abort right here — cancelled input must surface as an hv.auth error notify.
  client.respondUi(req.id, { cancelled: true });
  const err = await nextRequest((r) => isAuth(r, "error") && (authOf(r).provider as string) === "github-copilot");
  expect(authOf(err).message).toContain("cancelled");
  await flowDone;

  // The aborted flow must not have persisted any credential.
  const auth = JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf8"));
  expect(auth["github-copilot"]).toBeUndefined();
}, 60_000);

// ── round 11: "signed in" must recognise an OAuth credential, not just a key ──

describe("isSignedIn", () => {
  test("an api-key credential reads as signed in", () => {
    expect(isSignedIn({ configured: true, source: "stored" })).toBe(true);
  });

  test("a stored OAuth credential reads as signed in whatever Pi calls its source", () => {
    // The old predicate demanded source === "stored" (what Pi reports for an
    // api_key), so any other spelling left the card on "Sign in" forever.
    expect(isSignedIn({ configured: true, source: "oauth" })).toBe(true);
    expect(isSignedIn({ configured: true, source: "credentials" })).toBe(true);
    expect(isSignedIn({ configured: true })).toBe(true);
  });

  test("an env-provided credential is not 'signed in' — there is nothing to sign out of", () => {
    expect(isSignedIn({ configured: true, source: "env" })).toBe(false);
  });

  test("unconfigured is never signed in", () => {
    expect(isSignedIn({ configured: false, source: "stored" })).toBe(false);
    expect(isSignedIn(undefined)).toBe(false);
  });
});
