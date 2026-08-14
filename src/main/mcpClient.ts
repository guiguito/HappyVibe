/**
 * mcpClient — on-demand probe: connect, listTools, disconnect.
 * Electron-free (vitest-importable). Takes agentDir explicitly.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

import type { McpServerConfig } from "./mcp.js";
import { probeAuthProvider } from "./mcpOAuth.js";
import type { AdapterStore, AdapterEntry } from "./mcpAdapterStore.js";

export type ProbeResult = {
  state: "connected" | "needs-auth" | "failed";
  tools?: { name: string; description?: string }[];
  error?: string;
};

export interface ProbeOpts {
  /** Deadline for opening the connection (TLS + handshake + token refresh). */
  connectMs?: number;
  /** Deadline for listing tools, measured AFTER the connection is open. */
  listMs?: number;
  /** Extra attempts after a genuine failure. */
  retries?: number;
  /** @deprecated round 12 — one budget for both phases was the bug. */
  timeoutMs?: number;
  /** Credentials live in the adapter's store; http probes need a way to read it. */
  store?: AdapterStore;
  /**
   * Pre-read credential, so the startup sweep pays ONE sidecar spawn for every
   * server rather than one per probe. When omitted, an http probe reads its own.
   */
  authEntry?: AdapterEntry;
}

/**
 * §13 round 12 — the defaults, and why they are not one number.
 *
 * The old probe raced ONE 5 s timer against `connect` and then against
 * `listTools`, so a slow handshake spent the budget the listing still needed
 * and the whole probe failed. Two phases, two clocks. 15 s covers a cold remote
 * server plus a silent token refresh; `npx` stdio servers are the slow ones and
 * they mostly fail in the connect phase.
 */
export function probeDeadlines(opts: ProbeOpts = {}): Required<Pick<ProbeOpts, "connectMs" | "listMs" | "retries">> {
  return {
    connectMs: opts.connectMs ?? opts.timeoutMs ?? 15_000,
    listMs: opts.listMs ?? opts.timeoutMs ?? 10_000,
    retries: opts.retries ?? 1,
  };
}

/**
 * Retry a genuine failure once — the reported symptom was literally "clicking
 * reconnect worked right away". NEVER retry `needs-auth`: that is a real answer
 * (the user has to sign in), and retrying it doubles startup for nothing.
 */
export function shouldRetry(result: ProbeResult, left: number): boolean {
  return left > 0 && result.state === "failed";
}

/**
 * Run at most `limit` tasks at once, preserving input order. A rejected task
 * lands as `undefined` rather than sinking the batch.
 *
 * ponytail: eight lines beats a dependency for the one place that needs it —
 * the startup sweep, which used to fire every configured server concurrently.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<(R | undefined)[]> {
  const out = new Array<R | undefined>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch {
        out[i] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export async function probe(
  name: string,
  cfg: McpServerConfig,
  agentDir: string,
  opts?: ProbeOpts,
): Promise<ProbeResult> {
  const { retries } = probeDeadlines(opts);
  let result = await probeOnce(name, cfg, agentDir, opts);
  for (let left = retries; shouldRetry(result, left); left--) {
    result = await probeOnce(name, cfg, agentDir, opts);
  }
  return result;
}

async function probeOnce(
  name: string,
  cfg: McpServerConfig,
  agentDir: string,
  opts?: ProbeOpts,
): Promise<ProbeResult> {
  const { connectMs, listMs } = probeDeadlines(opts);

  /**
   * Resolve the credential BEFORE connecting, and treat "unavailable" as a hard
   * failure with its reason rather than as needs-auth. Saying needs-auth here
   * would be the old badge's bug in a new costume: a confident signed-out claim
   * about a server nobody actually checked.
   */
  let authEntry: AdapterEntry | undefined = opts?.authEntry;
  if (cfg.url && !authEntry && opts?.store) {
    try {
      authEntry = (await opts.store.read([{ name, url: cfg.url }]))[name];
    } catch (err) {
      return { state: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (cfg.url && authEntry?.status === "unavailable") {
    return { state: "failed", error: authEntry.message };
  }
  if (cfg.url && !opts?.store) {
    // Programming error, not a user-facing state: an http probe with no way to
    // reach the credential store would silently report every authenticated
    // server as needs-auth. Fail loudly instead of guessing.
    return { state: "failed", error: "internal: http probe requires an adapter credential store" };
  }

  const transport = cfg.command
    ? new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
        stderr: "ignore", // ponytail: suppress child stderr noise in probe
      })
    : new StreamableHTTPClientTransport(new URL(cfg.url!), {
        // Non-interactive provider: attaches stored tokens (and refreshes them
        // silently if possible) so an authenticated server connects; it never
        // opens a browser during a background probe.
        authProvider: probeAuthProvider(name, cfg.url!, agentDir, opts!.store!, authEntry),
        requestInit: { headers: cfg.headers },
      });

  const client = new Client({ name: "happyvibe", version: "1.0.0" }, { capabilities: {} });

  let settled = false;

  /**
   * A deadline created AT the phase it guards. The old code built one timer up
   * front and raced it twice, so `listTools` inherited whatever `connect` had
   * left of a 5 s budget — which is why a server that was merely slow to
   * handshake reported "failed" and then connected instantly on a click.
   * The handle is cleared so a resolved phase does not keep the event loop warm.
   */
  const deadline = <T>(task: Promise<T>, ms: number, phase: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    const bomb = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${phase} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([task, bomb]).finally(() => clearTimeout(timer)) as Promise<T>;
  };

  try {
    const connectTask = (async () => {
      await client.connect(transport);
      settled = true; // connection opened — close is now client's responsibility
    })();
    connectTask.catch(() => undefined); // suppress orphaned rejection if the deadline wins
    await deadline(connectTask, connectMs, "connect");

    const listToolsTask = client.listTools();
    listToolsTask.catch(() => undefined); // suppress orphaned rejection if the deadline wins
    const { tools } = await deadline(listToolsTask, listMs, "listTools");

    return {
      state: "connected",
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    };
  } catch (err: unknown) {
    // The http probe attaches a non-interactive auth provider that already
    // supplied any stored tokens (and attempted a silent refresh). So an auth
    // error here means the server genuinely needs interactive (re)auth —
    // classify as needs-auth rather than a hard failure, regardless of what
    // tokens are on disk (they may be present but stale).
    if (
      cfg.url &&
      (err instanceof UnauthorizedError ||
        (err instanceof Error && /401|unauthorized/i.test(err.message)))
    ) {
      return { state: "needs-auth" };
    }
    return { state: "failed", error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Always close; ignore close errors (transport may already be dead)
    if (settled) {
      client.close().catch(() => undefined);
    } else {
      // ponytail: transport.close() when connect never finished (e.g. timeout, spawn error)
      transport.close().catch(() => undefined);
    }
  }
}
