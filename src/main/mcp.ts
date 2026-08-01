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

/**
 * True if any of the given config files still defines a server with this name.
 * Used on removal to decide whether the (name-keyed, scope-agnostic) OAuth
 * credentials can be revoked. ponytail: only sees the workspaces currently
 * registered — a same-named server in an unregistered folder's .mcp.json loses
 * its tokens; it re-auths on next use.
 */
export function serverNameInFiles(name: string, files: string[]): boolean {
  return files.some((f) => name in readMcpFile(f).mcpServers);
}

/**
 * Upsert (or remove, when cfg is null) one server. Returns the new file content.
 *
 * `failIfExists` is for the curated catalog (§13 round 8): a one-click install
 * must never silently replace a server the user configured by hand. The manual
 * editor deliberately does NOT pass it — Edit overwrites by design.
 */
export function writeMcpServer(
  file: string,
  name: string,
  cfg: McpServerConfig | null,
  opts?: { failIfExists?: boolean },
): McpFile {
  if (!isValidServerName(name)) throw new Error(`invalid MCP server name: ${JSON.stringify(name)}`);
  const cur = readMcpFile(file);
  if (cfg && opts?.failIfExists) {
    // Case-INSENSITIVE: mcpServers keys are case-sensitive, so a catalog install
    // of "notion" next to a hand-added "Notion" would silently create a SECOND
    // server — duplicate tools, duplicate context cost — instead of colliding.
    const clash = Object.keys(cur.mcpServers).find(
      (k) => k.toLowerCase() === name.toLowerCase(),
    );
    if (clash) throw new Error(`A server named "${clash}" already exists`);
  }
  if (cfg) cur.mcpServers[name] = cfg;
  else delete cur.mcpServers[name];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + "\n");
  return cur;
}
