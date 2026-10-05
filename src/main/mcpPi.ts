/**
 * §13 (2026-10-05): main manages GLOBAL MCP servers through Pi's own shell commands —
 * `pi mcp list --json | login | logout` — instead of being an MCP client itself.
 * Electron-free (vitest imports it). Workspace servers are invisible to these commands
 * (they're registered by the bridge): see mcpWorkspaceProbe.ts.
 *
 * The login URL line and /mcp's status text are COPY, not an API; tests/mcp-pi.test.ts
 * source-scans the vendored Pi so a wording change is a red test, not a dead button.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { nodeExecPath, PI_CLI_RELPATH } from "./pi/spawn";

export interface PiCliOpts { runtimeDir: string; agentDir: string; env: Record<string, string>; execPath?: string; cliPath?: string }
export interface PiMcpServer { name: string; scope: string; enabled: boolean; exposure: string; state: string; tools: string[]; error?: string }
export type McpState = "connected" | "needs-auth" | "failed" | "checking";

export const LOGIN_URL_RE = /Sign in to MCP server "([^"]+)" in your browser:\s*\n(\S+)/;

function run(o: PiCliOpts, args: string[]) {
  // One-shot Pi calls hang unless stdin is closed (CLAUDE.md). cwd = home so no project
  // .pi/mcp.json is ever consulted; nodeExecPath() so macOS shows no extra Dock icon.
  return spawn(o.execPath ?? nodeExecPath(), [o.cliPath ?? path.join(o.runtimeDir, PI_CLI_RELPATH), "mcp", ...args], {
    cwd: os.homedir(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...o.env, PI_CODING_AGENT_DIR: o.agentDir },
  });
}

function collect(o: PiCliOpts, args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const c = run(o, args);
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("error", reject);
    c.on("close", (code) => resolve({ code, out, err }));
  });
}

export async function piMcpList(o: PiCliOpts): Promise<{ servers: PiMcpServer[]; errors: string[] }> {
  const { out, err } = await collect(o, ["list", "--json"]);
  try {
    const j = JSON.parse(out) as { servers?: PiMcpServer[]; errors?: string[] };
    return { servers: j.servers ?? [], errors: j.errors ?? [] };
  } catch {
    throw new Error(`Pi's MCP list returned no JSON: ${(err || out).trim().slice(0, 300)}`);
  }
}

export function piMcpLogin(o: PiCliOpts, name: string): { url: Promise<string | null>; done: Promise<{ ok: boolean; message: string }>; cancel(): void } {
  const c = run(o, ["login", name, "--timeout", "300"]);
  let cancelled = false;
  let out = "";
  let err = "";
  let gotUrl: (u: string | null) => void = () => {};
  const url = new Promise<string | null>((r) => (gotUrl = r));
  c.stdout.on("data", (d) => {
    out += d;
    const m = LOGIN_URL_RE.exec(out);
    if (m) gotUrl(m[2]);
  });
  c.stderr.on("data", (d) => (err += d));
  const done = new Promise<{ ok: boolean; message: string }>((resolve) => {
    c.on("error", (e) => { gotUrl(null); resolve({ ok: false, message: e.message }); });
    c.on("close", (code) => {
      gotUrl(null);
      if (cancelled) return resolve({ ok: false, message: "Sign-in cancelled." });
      // Pi's verdict is the last stdout line on success; on failure the reason is on stderr —
      // never fall back to stdout there, whose last line is the sign-in URL.
      const last = out.trim().split("\n").pop() ?? "";
      resolve(code === 0 ? { ok: true, message: last } : { ok: false, message: err.trim() || `Pi's sign-in exited with ${code}` });
    });
  });
  return { url, done, cancel: () => { cancelled = true; c.kill(); } };
}

export async function piMcpLogout(o: PiCliOpts, name: string): Promise<{ ok: boolean; message: string }> {
  const { code, out, err } = await collect(o, ["logout", name]);
  return { ok: code === 0, message: (code === 0 ? out : err || out).trim() };
}

export function statusFromList(s: PiMcpServer): { state: McpState; toolCount: number; tools: { name: string }[]; error?: string } | null {
  if (!s.enabled || s.state === "disabled") return null;
  const state: McpState = s.state === "connected" ? "connected" : s.state === "needs-auth" ? "needs-auth" : s.state === "connecting" ? "checking" : "failed";
  return { state, toolCount: s.tools.length, tools: s.tools.map((name) => ({ name })), ...(s.error ? { error: s.error } : {}) };
}

export function configErrorFor(name: string, errors: string[]): string | undefined {
  return errors.find((e) => e.includes(`server "${name}"`));
}

export function parseMcpStatus(text: string): Array<{ name: string; state: McpState | "off" | "overridden"; toolCount?: number; error?: string }> {
  const rows: Array<{ name: string; state: McpState | "off" | "overridden"; toolCount?: number; error?: string }> = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("    ")) {
      const last = rows[rows.length - 1];
      if (last) last.error = last.error ? `${last.error}\n${line.trim()}` : line.trim();
      continue;
    }
    if (line.startsWith("config error: ")) continue;
    // Pi: `overridden: "<name>" registered by <ext> is overridden by "<name>" in <file>`.
    const ov = /^overridden: "([A-Za-z0-9_-]+)"/.exec(line);
    if (ov) { rows.push({ name: ov[1], state: "overridden" }); continue; }
    const m = /^([A-Za-z0-9_-]+): (.*) \(([a-z-]+)\)$/.exec(line);
    if (!m) continue;
    const [, name, body] = m;
    if (body.startsWith("needs sign-in")) rows.push({ name, state: "needs-auth" });
    else if (body.startsWith("connected")) rows.push({ name, state: "connected", toolCount: Number(/, (\d+) tools/.exec(body)?.[1] ?? 0) });
    else if (body === "disabled") rows.push({ name, state: "off" });
    else if (body === "starting" || body === "connecting") rows.push({ name, state: "checking" });
    else rows.push({ name, state: "failed" });
  }
  return rows;
}

/** Removing a server: Pi finds a server BY NAME in mcp.json, so a sign-in is revoked
    before the entry goes, or the token is orphaned in mcp-auth.json. A failing logout
    never blocks the removal. */
export async function removeServerInOrder(o: { stillUsed: boolean; logout: () => Promise<unknown>; write: () => void }): Promise<void> {
  if (!o.stillUsed) {
    try { await o.logout(); } catch { /* the removal still happens */ }
  }
  o.write();
}

/**
 * Every MCP status refresh starts servers (Pi has no lazy start), so overlapping refreshes of
 * one tier must not stack: at most one runs and one waits per key. A caller that arrives while
 * one runs gets the queued run, which starts AFTER the running one — so a refresh asked for after
 * a sign-in or a config change always sees it.
 */
export function coalescer(): (key: string, fn: () => Promise<void>) => Promise<void> {
  const running = new Map<string, Promise<void>>();
  const queued = new Map<string, Promise<void>>();
  const start = (key: string, fn: () => Promise<void>): Promise<void> => {
    const p: Promise<void> = fn().finally(() => { if (running.get(key) === p) running.delete(key); });
    running.set(key, p);
    return p;
  };
  return (key, fn) => {
    const q = queued.get(key);
    if (q) return q;
    const r = running.get(key);
    if (!r) return start(key, fn);
    const next = r.catch(() => {}).then(() => { queued.delete(key); return start(key, fn); });
    queued.set(key, next);
    return next;
  };
}
