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
import { captureCrash } from "./crash/client";

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
  | { status: "present"; tokens?: AdapterStoredTokens; clientInfo?: AdapterStoredClientInfo }
  | { status: "absent" }
  | { status: "unavailable"; message: string };

type Op =
  | { op: "inspect"; name: string; url: string }
  | { op: "migrate"; name: string }
  | { op: "writeTokens"; name: string; url: string; tokens: AdapterStoredTokens }
  | { op: "writeClientInfo"; name: string; url: string; clientInfo: AdapterStoredClientInfo }
  | { op: "remove"; name: string };

interface OpResult {
  name: string;
  status: string;
  message?: string;
  tokens?: AdapterStoredTokens;
  clientInfo?: AdapterStoredClientInfo;
}

export interface AdapterStore {
  read(servers: readonly { name: string; url: string }[]): Promise<Record<string, AdapterEntry>>;
  /** Migrating read: imports a legacy plaintext file into the keychain and deletes it. */
  migrate(names: readonly string[]): Promise<void>;
  writeTokens(name: string, url: string, tokens: AdapterStoredTokens): Promise<void>;
  writeClientInfo(name: string, url: string, info: AdapterStoredClientInfo): Promise<void>;
  remove(name: string): Promise<void>;
}

/**
 * Long on purpose. Reading the OS keychain from a process macOS has not been
 * told to trust raises a "wants to use your confidential information" dialog,
 * and the call blocks until the user answers it. A short deadline does not
 * protect anything here — it just kills the child mid-prompt, which leaves the
 * dialog orphaned and makes the NEXT call raise another one. That is what a
 * 10-second timeout produced: a loop of stacked password dialogs.
 *
 * Every caller is either a background sweep (fire-and-forget) or an explicit
 * user action, so waiting is safe. The user answers once — "Always Allow" puts
 * this binary on the item's ACL — and subsequent calls return immediately.
 */
const SIDECAR_TIMEOUT_MS = 120_000;

export function createAdapterStore(opts: {
  agentDir: string;
  runtimeDir: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
}): AdapterStore {
  const script = path.join(opts.runtimeDir, MCP_OAUTH_BRIDGE_RELPATH);

  /**
   * Sidecar calls are SERIALIZED, and that is a UX requirement rather than a
   * tidiness one. Reading the OS keychain from a process macOS does not already
   * trust raises a "wants to use your confidential information" dialog per
   * process. Two concurrent spawns means two stacked dialogs; a failed prefetch
   * that let every probe retry on its own meant four. One at a time, so the
   * user is asked once and can answer once.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  const runOnce = (ops: Op[]): Promise<OpResult[]> =>
    new Promise((resolve, reject) => {
      const child = spawn(opts.execPath ?? nodeExecPath(), [script], {
        cwd: opts.runtimeDir,
        // stderr is CAPTURED, not ignored: a sidecar that dies silently is how
        // the first version's every-spawn hang went undiagnosed.
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(opts.env ?? {}) },
        // Windows: a one-shot child must not flash a console window.
        windowsHide: true,
      });

      let out = "";
      let err = "";
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        // SIGKILL, not SIGTERM: a child blocked inside a native keychain call
        // (e.g. behind an unanswered auth dialog) ignores a polite signal, and
        // a lingering one holds that dialog open.
        child.kill("SIGKILL");
        finish(() =>
          reject(new Error("mcp-oauth-bridge timed out (an unanswered keychain prompt does this)")),
        );
      }, SIDECAR_TIMEOUT_MS);

      child.stdout.on("data", (d) => { out += String(d); });
      child.stderr.on("data", (d) => { err += String(d); });
      child.on("error", (e) => finish(() => reject(e)));
      child.on("close", (code) =>
        finish(() => {
          const line = out.trim().split("\n").pop() ?? "";
          if (!line) {
            const tail = err.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
            // §37: the code refines the grouping; `tail` never travels.
            captureCrash({
              kind: "child-exit",
              exit: { code: code ?? undefined, name: "mcp-oauth-bridge" },
              fingerprint: ["{{ default }}", String(code)],
            });
            return reject(
              new Error(`mcp-oauth-bridge exited ${code} with no output${tail ? `: ${tail}` : ""}`),
            );
          }
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

  const run = (ops: Op[]): Promise<OpResult[]> => serialize(() => runOnce(ops));

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
            : r.status === "present"
              ? { status: "present", tokens: r.tokens, clientInfo: r.clientInfo }
              : r.status === "unavailable"
                ? { status: "unavailable", message: r.message ?? "credential store unavailable" }
                : { status: "absent" };
      }
      return out;
    },
    async migrate(names) {
      if (!names.length) return;
      await run(names.map((name) => ({ op: "migrate", name })));
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
