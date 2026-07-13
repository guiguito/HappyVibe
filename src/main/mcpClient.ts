/**
 * mcpClient — on-demand probe: connect, listTools, disconnect.
 * Electron-free (vitest-importable). Takes agentDir explicitly.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

import type { McpServerConfig } from "./mcp.js";
import { authState } from "./mcpAuthStore.js";

export type ProbeResult = {
  state: "connected" | "needs-auth" | "failed";
  tools?: { name: string; description?: string }[];
  error?: string;
};

export async function probe(
  name: string,
  cfg: McpServerConfig,
  agentDir: string,
  opts?: { timeoutMs?: number },
): Promise<ProbeResult> {
  const timeoutMs = opts?.timeoutMs ?? 5_000;

  const transport = cfg.command
    ? new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
        stderr: "ignore", // ponytail: suppress child stderr noise in probe
      })
    : new StreamableHTTPClientTransport(new URL(cfg.url!), {
        requestInit: { headers: cfg.headers },
      });

  const client = new Client({ name: "happyvibe", version: "1.0.0" }, { capabilities: {} });

  let settled = false;
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs),
  );

  try {
    const connectTask = (async () => {
      await client.connect(transport);
      settled = true; // connection opened — close is now client's responsibility
    })();
    connectTask.catch(() => undefined); // suppress orphaned rejection if timer wins the race
    await Promise.race([connectTask, timer]);

    const listToolsTask = client.listTools();
    listToolsTask.catch(() => undefined); // suppress orphaned rejection if timer wins the race
    const { tools } = await Promise.race([listToolsTask, timer]);

    return {
      state: "connected",
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    };
  } catch (err: unknown) {
    // Phase 1 auth detection: http-only, no OAuth attempt
    if (
      cfg.url &&
      (err instanceof UnauthorizedError ||
        (err instanceof Error &&
          /401|unauthorized/i.test(err.message))) &&
      authState(agentDir, name, cfg.url) !== "authenticated"
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
