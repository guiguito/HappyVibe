/**
 * MCP server config files (standard `mcpServers` JSON, the shape
 * pi-mcp-adapter and the wider ecosystem read). Electron-free — callers
 * (ipc.ts) supply the absolute file path: agentDir()/mcp.json for the global
 * tier, <workspace>/.mcp.json for the workspace tier. Unknown keys are
 * preserved so hand-edited files (imports, settings, lifecycle…) survive a
 * round-trip through the UI.
 */
import fs from "node:fs";
import path from "node:path";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  directTools?: boolean | string[];
  [k: string]: unknown;
}

export interface McpFile {
  mcpServers: Record<string, McpServerConfig>;
  [k: string]: unknown;
}

export function isValidServerName(name: string): boolean {
  return /^[\w-]+$/.test(name);
}

export function readMcpFile(file: string): McpFile {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as McpFile;
    if (!raw || typeof raw !== "object") return { mcpServers: {} };
    if (!raw.mcpServers || typeof raw.mcpServers !== "object" || Array.isArray(raw.mcpServers)) {
      return { ...raw, mcpServers: {} };
    }
    return raw;
  } catch {
    return { mcpServers: {} };
  }
}

/** Upsert (or remove, when cfg is null) one server. Returns the new file content. */
export function writeMcpServer(file: string, name: string, cfg: McpServerConfig | null): McpFile {
  if (!isValidServerName(name)) throw new Error(`invalid MCP server name: ${JSON.stringify(name)}`);
  const cur = readMcpFile(file);
  if (cfg) cur.mcpServers[name] = cfg;
  else delete cur.mcpServers[name];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + "\n");
  return cur;
}
