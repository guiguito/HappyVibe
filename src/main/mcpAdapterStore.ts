/**
 * mcpAdapterStore — main's only route to MCP OAuth credentials.
 *
 * pi-mcp-adapter >=2.17.0 keeps credentials in the OS keychain, so main cannot
 * read or write them from a file any more, and must NOT re-implement the
 * payload format (service name, sha256 account, 1000-char chunk manifest,
 * Linux keyring recovery) — mirroring an undocumented internal is exactly what
 * broke last time. Instead we spawn a one-shot sidecar that runs the adapter's
 * own code. See docs/validation/m1.md §Phase 3.
 *
 * Electron-free (node builtins only) and vitest-importable: execPath and env
 * are injected, exactly like spawn.ts.
 */
import { spawn } from "node:child_process";
import path from "node:path";

import { nodeExecPath } from "./pi/spawn.js";

/** Built by scripts/build-mcp-oauth-bridge.mjs (gitignored, made by postinstall). */
export const MCP_OAUTH_BRIDGE_RELPATH = "bin/mcp-oauth-bridge.mjs";

export interface AdapterStoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix seconds
  scope?: string;
}

export interface AdapterStoredClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  redirectUris?: string[];
}

/**
 * `unavailable` is deliberately distinct from `absent`. "Absent" is a claim
 * that the user is signed out; making it because the store could not be read
 * is the defect this module replaces, so callers must handle the third case.
 */
export type AdapterEntry =
  | { status: "present"; tokens: AdapterStoredTokens }
  | { status: "absent" }
  | { status: "unavailable"; message: string };

type Op =
  | { op: "inspect"; name: string; url: string }
  | { op: "writeTokens"; name: string; url: string; tokens: AdapterStoredTokens }
  | { op: "writeClientInfo"; name: string; url: string; clientInfo: AdapterStoredClientInfo }
  | { op: "remove"; name: string };

interface OpResult {
  name: string;
  status: string;
  message?: string;
  tokens?: AdapterStoredTokens;
}

export interface AdapterStore {
  read(servers: readonly { name: string; url: string }[]): Promise<Record<string, AdapterEntry>>;
  writeTokens(name: string, url: string, tokens: AdapterStoredTokens): Promise<void>;
  writeClientInfo(name: string, url: string, info: AdapterStoredClientInfo): Promise<void>;
  remove(name: string): Promise<void>;
}

/** Generous: a cold keychain unlock prompt on macOS can take a few seconds. */
const SIDECAR_TIMEOUT_MS = 10_000;

export function createAdapterStore(opts: {
  agentDir: string;
  runtimeDir: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
}): AdapterStore {
  const script = path.join(opts.runtimeDir, MCP_OAUTH_BRIDGE_RELPATH);

  const run = (ops: Op[]): Promise<OpResult[]> =>
    new Promise((resolve, reject) => {
      const child = spawn(opts.execPath ?? nodeExecPath(), [script], {
        cwd: opts.runtimeDir,
        // ponytail: adapter chatter on stderr is not ours to relay
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(opts.env ?? {}) },
      });

      let out = "";
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error("mcp-oauth-bridge timed out")));
      }, SIDECAR_TIMEOUT_MS);

      child.stdout.on("data", (d) => { out += String(d); });
      child.on("error", (e) => finish(() => reject(e)));
      child.on("close", (code) =>
        finish(() => {
          const line = out.trim().split("\n").pop() ?? "";
          if (!line) return reject(new Error(`mcp-oauth-bridge exited ${code} with no output`));
          let parsed: { ok?: boolean; error?: string; results?: OpResult[] };
          try {
            parsed = JSON.parse(line) as typeof parsed;
          } catch {
            return reject(new Error("mcp-oauth-bridge returned invalid JSON"));
          }
          if (parsed.ok === false) return reject(new Error(parsed.error ?? "mcp-oauth-bridge failed"));
          resolve(parsed.results ?? []);
        }),
      );

      child.stdin.end(JSON.stringify({ agentDir: opts.agentDir, ops }));
    });

  return {
    async read(servers) {
      if (!servers.length) return {};
      const results = await run(servers.map((s) => ({ op: "inspect", name: s.name, url: s.url })));
      const out: Record<string, AdapterEntry> = {};
      for (const s of servers) {
        const r = results.find((x) => x.name === s.name);
        out[s.name] =
          !r
            // A missing result is NOT "absent" — we do not know, so say so.
            ? { status: "unavailable", message: "no result from credential sidecar" }
            : r.status === "present" && r.tokens
              ? { status: "present", tokens: r.tokens }
              : r.status === "unavailable"
                ? { status: "unavailable", message: r.message ?? "credential store unavailable" }
                : { status: "absent" };
      }
      return out;
    },
    async writeTokens(name, url, tokens) {
      await run([{ op: "writeTokens", name, url, tokens }]);
    },
    async writeClientInfo(name, url, clientInfo) {
      await run([{ op: "writeClientInfo", name, url, clientInfo }]);
    },
    async remove(name) {
      await run([{ op: "remove", name }]);
    },
  };
}
