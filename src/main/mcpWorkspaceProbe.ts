/**
 * §13 (2026-10-05): status and sign-in for WORKSPACE MCP servers.
 *
 * The bridge registers a workspace's .mcp.json servers with pi.registerMcpServer(), and
 * Pi's shell commands (`pi mcp list|login|logout`) never see extension-registered servers.
 * So main asks a short-lived, model-less Pi in that workspace — the way provider sign-in
 * already rides the utility client: `/mcp` for status, `/hv-mcp-tools` for tool names,
 * `/mcp login|logout <server>`. Electron-free (vitest imports it).
 *
 * The /mcp text is copy, not an API: parseMcpStatus is pinned against the vendored Pi by
 * tests/mcp-pi.test.ts.
 */
import { PiClient } from "./pi/PiClient";
import { LOGIN_URL_RE, parseMcpStatus, type McpState } from "./mcpPi";

type SpawnSpec = ConstructorParameters<typeof PiClient>[0];
type ClientLike = Pick<PiClient, "start" | "stop" | "send" | "respondUi" | "on" | "off">;
type UiRequest = { id: string; method?: string; message?: string; title?: string };

export interface WorkspaceRow {
  name: string;
  state: McpState | "off" | "overridden";
  toolCount: number;
  tools: { name: string }[];
  error?: string;
}

/** Notifies raised while one command runs. An extension command's response arrives
    after its handler finished, so everything it notified is in by then. */
async function command(c: ClientLike, message: string): Promise<string[]> {
  const notes: string[] = [];
  const onUi = (r: UiRequest): void => {
    if (r.method === "notify" && r.message) notes.push(r.message);
  };
  c.on("ui-request", onUi);
  try {
    await c.send({ type: "prompt", message });
  } finally {
    c.off("ui-request", onUi);
  }
  return notes;
}

export async function probeWorkspace(spec: SpawnSpec, names: string[], make: (s: SpawnSpec) => ClientLike = (s) => new PiClient(s)): Promise<WorkspaceRow[]> {
  const c = make(spec);
  try {
    await c.start();
    const status = (await command(c, "/mcp")).find((n) => /\((deferred|direct|codemode|hidden)\)/.test(n) || n.startsWith("overridden: ")) ?? "";
    const toolsNote = (await command(c, "/hv-mcp-tools")).find((n) => n.includes('"hv.mcp-tools"'));
    const report = (toolsNote ? JSON.parse(toolsNote) : {}) as { servers?: Record<string, string[]>; errors?: string[] };
    const tools = report.servers ?? {};
    // A server Pi refused to register never reaches /mcp; the bridge kept Pi's reason.
    const refused = (name: string): string | undefined =>
      report.errors?.find((e) => e.startsWith(`${name}: `))?.slice(name.length + 2).replace(/^Invalid MCP server registered by extension "[^"]*": /, "");
    const rows = parseMcpStatus(status);
    return names.map((name) => {
      // A global server of the same name wins; its own line shares the name, so the
      // overridden line decides this (workspace) row.
      const row = rows.find((r) => r.name === name && r.state === "overridden") ?? rows.find((r) => r.name === name);
      const list = (tools[name] ?? []).map((t) => ({ name: t }));
      if (!row) return { name, state: "failed", toolCount: 0, tools: [], error: refused(name) ?? "Not reported by Pi" };
      return {
        name,
        state: row.state,
        toolCount: row.state === "connected" ? (row.toolCount ?? list.length) : 0,
        tools: row.state === "connected" ? list : [],
        ...(row.error ? { error: row.error } : {}),
      };
    });
  } finally {
    c.stop();
  }
}

const SIGNED_IN = /^Signed in to MCP server "/;
const SIGNIN_TIMEOUT_MS = 300_000; // pi mcp login's own default

export function signInWorkspace(
  spec: SpawnSpec,
  name: string,
  make: (s: SpawnSpec) => ClientLike = (s) => new PiClient(s),
): { url: Promise<string | null>; done: Promise<{ ok: boolean; message: string }>; cancel(): void } {
  const c = make(spec);
  let gotUrl: (u: string | null) => void = () => {};
  const url = new Promise<string | null>((r) => (gotUrl = r));
  let finish: (r: { ok: boolean; message: string }) => void = () => {};
  const done = new Promise<{ ok: boolean; message: string }>((r) => (finish = r));
  // Pi's paste-back box. It must stay PENDING while the browser flow runs — answering it
  // empty fails the sign-in (oauth.js) — and Pi aborts it locally without telling us when
  // the browser wins (rpc-mode.js), so it is simply forgotten on success.
  let pendingInput: string | null = null;
  let settled = false;
  const settle = (r: { ok: boolean; message: string }): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    gotUrl(null);
    c.stop();
    finish(r);
  };
  const cancel = (): void => {
    if (pendingInput) c.respondUi(pendingInput, { cancelled: true });
    settle({ ok: false, message: "Sign-in cancelled." });
  };
  const timer = setTimeout(cancel, SIGNIN_TIMEOUT_MS);
  c.on("ui-request", (r: UiRequest) => {
    if (r.method === "input") { pendingInput = r.id; return; }
    if (r.method !== "notify" || !r.message) return;
    const m = LOGIN_URL_RE.exec(r.message);
    if (m) { gotUrl(m[2]); return; }
    if (SIGNED_IN.test(r.message)) settle({ ok: true, message: r.message });
    else if (/sign-in|sign in|cancelled|failed/i.test(r.message) && r.message.includes(`"${name}"`)) settle({ ok: false, message: r.message });
  });
  void (async () => {
    try {
      await c.start();
      await c.send({ type: "prompt", message: `/mcp login ${name}` });
    } catch (e) {
      settle({ ok: false, message: e instanceof Error ? e.message : String(e) });
      return;
    }
    // The command returned without a verdict notify (e.g. "does not use OAuth").
    settle({ ok: false, message: `Pi did not sign in to "${name}".` });
  })();
  return { url, done, cancel };
}

export async function signOutWorkspace(spec: SpawnSpec, name: string, make: (s: SpawnSpec) => ClientLike = (s) => new PiClient(s)): Promise<{ ok: boolean; message: string }> {
  const c = make(spec);
  try {
    await c.start();
    const notes = await command(c, `/mcp logout ${name}`);
    const msg = notes.find((n) => n.includes(`"${name}"`)) ?? "";
    return { ok: /^Signed out of MCP server "|^No stored credentials for MCP server "/.test(msg), message: msg };
  } finally {
    c.stop();
  }
}
