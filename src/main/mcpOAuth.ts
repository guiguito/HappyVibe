/**
 * mcpOAuth — main-side (host-driven) MCP OAuth.
 *
 * pi-mcp-adapter's OAuth is TUI-gated in RPC mode, so HappyVibe's main process
 * runs the OAuth flow itself using the MCP SDK's OAuthClientProvider, then
 * persists tokens to the adapter's on-disk store (mcpAuthStore) so the adapter
 * connects at runtime with no re-auth.
 *
 * Electron-free (only node builtins + SDK + ./mcp*), vitest-importable: the
 * browser-open is INJECTED (deps.openExternal), exactly like spawn.ts.
 * The on-disk AuthEntry shape mirrors the adapter (mcp-oauth-provider.ts); we
 * never import the adapter at runtime.
 */
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import type { McpServerConfig } from "./mcp.js";
import { readFlowState, writeFlowState, clearFlowState } from "./mcpAuthStore.js";
import type {
  AdapterStore,
  AdapterEntry,
  AdapterStoredTokens,
  AdapterStoredClientInfo,
} from "./mcpAdapterStore.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // matches adapter MANUAL_AUTH_TIMEOUT_MS

export interface AuthDeps {
  openExternal: (url: string) => void;
  /** Where credentials actually live — the adapter's store, via the sidecar. */
  store: AdapterStore;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type AuthResult =
  | { ok: true; tools: { name: string; description?: string }[] }
  | { ok: false; error: string };

/**
 * OAuthClientProvider whose credentials live in the ADAPTER's store, reached
 * through the sidecar. Every persist passes serverUrl = cfg.url, which the
 * adapter binds the entry to and invalidates on mismatch.
 *
 * The SDK allows these accessors to return promises, which is what makes an
 * out-of-process store usable here at all.
 */
class HvOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly name: string,
    private readonly serverUrl: string,
    private readonly agentDir: string,
    private readonly deps: AuthDeps,
    private readonly redirectUrlValue: string,
    // Probe mode (background startup/reconnect sweep): supply stored tokens and
    // allow silent refresh, but NEVER open a browser or mutate stored auth
    // artifacts (DCR client, oauthState, codeVerifier). Only saveTokens persists
    // (a legitimate non-interactive refresh should update the store).
    private readonly probeMode = false,
    // Pre-read entry: the startup sweep reads every server in ONE sidecar spawn
    // and hands each provider its own answer, rather than paying a spawn per
    // provider callback.
    private readonly prefetched?: AdapterEntry,
    private readonly prefetchedClientInfo?: AdapterStoredClientInfo,
  ) {}

  get redirectUrl(): string {
    return this.redirectUrlValue;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "HappyVibe",
      redirect_uris: [this.redirectUrlValue],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  /** The adapter's entry, read once per provider (the sweep pre-reads it). */
  private entry: AdapterEntry | undefined;
  private async load(): Promise<AdapterEntry> {
    if (this.prefetched) return this.prefetched;
    if (!this.entry) {
      this.entry = (await this.deps.store.read([{ name: this.name, url: this.serverUrl }]))[this.name];
    }
    return this.entry ?? { status: "absent" };
  }
  /** Invalidate after a write so a later read in the same flow sees it. */
  private forget(): void {
    this.entry = undefined;
  }

  state(): string {
    const state = randomBytes(32).toString("hex");
    // PKCE/CSRF state is OURS and stays on disk — see mcpAuthStore's header for
    // why it must not go anywhere the adapter's legacy import can reach it.
    if (!this.probeMode) {
      writeFlowState(this.agentDir, this.name, {
        ...readFlowState(this.agentDir, this.name),
        oauthState: state,
      });
    }
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const e = await this.load();
    const ci = this.prefetchedClientInfo ?? (e.status === "present" ? e.clientInfo : undefined);
    if (!ci) return undefined;
    // Probe mode reuses the stored client unconditionally (to enable silent
    // refresh without triggering DCR); it never completes an interactive
    // redirect, so the port-drift concern below doesn't apply.
    if (this.probeMode) return { client_id: ci.clientId, client_secret: ci.clientSecret };
    // A dynamically-registered client is bound to the exact redirect_uri(s) it
    // registered with. Our loopback callback port is OS-assigned and differs
    // per flow, so reusing a client registered against a stale port makes the
    // authorization server reject the new redirect_uri ("Invalid redirect_uri
    // for OAuth client"). Only reuse the stored client when it was registered
    // for our current redirect URL; otherwise return undefined to force fresh
    // dynamic registration for this port.
    if (!ci.redirectUris?.includes(this.redirectUrlValue)) return undefined;
    return { client_id: ci.clientId, client_secret: ci.clientSecret };
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    if (this.probeMode) return; // never persist a DCR client during a background probe
    const clientInfo: AdapterStoredClientInfo = {
      clientId: info.client_id,
      clientSecret: info.client_secret,
      clientIdIssuedAt: info.client_id_issued_at,
      clientSecretExpiresAt: info.client_secret_expires_at,
      redirectUris: info.redirect_uris ?? [this.redirectUrlValue],
    };
    await this.deps.store.writeClientInfo(this.name, this.serverUrl, clientInfo);
    this.forget();
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const e = await this.load();
    const t = e.status === "present" ? e.tokens : undefined;
    if (!t) return undefined;
    return {
      access_token: t.accessToken,
      token_type: "Bearer",
      refresh_token: t.refreshToken,
      expires_in: t.expiresAt ? Math.max(0, Math.floor(t.expiresAt - Date.now() / 1000)) : undefined,
      scope: t.scope,
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const stored: AdapterStoredTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
      scope: tokens.scope,
    };
    await this.deps.store.writeTokens(this.name, this.serverUrl, stored);
    this.forget();
  }

  saveCodeVerifier(codeVerifier: string): void {
    if (this.probeMode) return; // never persist PKCE verifier during a background probe
    writeFlowState(this.agentDir, this.name, {
      ...readFlowState(this.agentDir, this.name),
      codeVerifier,
    });
  }

  codeVerifier(): string {
    const v = readFlowState(this.agentDir, this.name)?.codeVerifier;
    if (!v) throw new Error(`No code verifier saved for MCP server: ${this.name}`);
    return v;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.deps.openExternal(authorizationUrl.toString());
  }
}

/**
 * A non-interactive OAuth provider for background probes (startup/reconnect
 * sweep). It attaches stored tokens and permits silent refresh, but its
 * openExternal is a no-op so a probe never launches a browser, and probeMode
 * prevents any on-disk mutation of the DCR client / oauthState / codeVerifier.
 * If interactive authorization is genuinely required, the connect surfaces an
 * UnauthorizedError, which the probe maps to "needs-auth".
 */
export function probeAuthProvider(
  name: string,
  serverUrl: string,
  agentDir: string,
  store: AdapterStore,
  /** Pre-read entry, so the startup sweep costs one sidecar spawn for all servers. */
  prefetched?: AdapterEntry,
): OAuthClientProvider {
  return new HvOAuthProvider(
    name,
    serverUrl,
    agentDir,
    { openExternal: () => undefined, store },
    "http://127.0.0.1/mcp-probe", // unused: a probe never completes an interactive redirect
    true,
    prefetched,
    prefetched?.status === "present" ? prefetched.clientInfo : undefined,
  );
}

/**
 * Loopback callback server bound to 127.0.0.1 on an OS-assigned port.
 * Resolves { code } on GET /callback?code&state after validating state.
 */
interface CallbackServer {
  redirectUrl: string;
  waitForCode: (opts: { timeoutMs: number; signal?: AbortSignal }) => Promise<string>;
  close: () => void;
}

function startCallbackServer(getExpectedState: () => string | undefined): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    codePromise.catch(() => undefined); // no unhandled rejection if nobody awaits

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        return res.end();
      }
      const err = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      res.writeHead(err || !code ? 400 : 200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">` +
          (err || !code
            ? `<h1>Authentication failed</h1><p>You can close this window.</p>`
            : `<h1>Authentication complete</h1><p>You can close this window and return to HappyVibe.</p>`) +
          `</body>`,
      );
      if (err) return rejectCode(new Error(`OAuth error: ${err}`));
      if (!code) return rejectCode(new Error("OAuth callback missing authorization code"));
      const expected = getExpectedState();
      if (expected && state !== expected) {
        return rejectCode(new Error("OAuth state mismatch - potential CSRF attack"));
      }
      resolveCode(code);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr !== "object" || !addr) {
        server.close();
        return reject(new Error("callback server failed to bind"));
      }
      const port = addr.port;
      resolve({
        redirectUrl: `http://127.0.0.1:${port}/callback`,
        waitForCode: ({ timeoutMs, signal }) =>
          new Promise<string>((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`OAuth timed out after ${timeoutMs}ms`)), timeoutMs);
            timer.unref?.();
            const onAbort = () => rej(new Error("OAuth aborted"));
            if (signal) {
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            }
            codePromise
              .then(res, rej)
              .finally(() => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
              });
          }),
        close: () => server.close(),
      });
    });
  });
}

/**
 * Run the full host-driven OAuth flow, then list tools. Persists an
 * adapter-readable AuthEntry on success. Never leaks the transport, client, or
 * callback server on any path.
 */
export async function authenticate(
  name: string,
  cfg: McpServerConfig,
  agentDir: string,
  deps: AuthDeps,
): Promise<AuthResult> {
  if (!cfg.url) return { ok: false, error: "OAuth requires an http(s) MCP server url" };
  const serverUrl = cfg.url;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let callback: CallbackServer | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  let client: Client | undefined;
  let connected = false;

  try {
    let provider!: HvOAuthProvider;
    callback = await startCallbackServer(() => readFlowState(agentDir, name)?.oauthState);

    // Refresh tokens are client-bound. Our loopback port is fresh per flow, so
    // when the stored DCR client can't be reused for this redirect URL the SDK
    // registers a NEW client — and then attempts a refresh with the OLD
    // client's refresh_token, which the server rejects (Notion: "Client ID
    // mismatch") and the SDK re-throws instead of falling back to authorize
    // (auth.js authInternal: OAuthError !== ServerError). Drop the doomed
    // refresh_token; keep a still-fresh access token (connect succeeds with it
    // directly, no OAuth dance), drop expired tokens entirely.
    //
    // Unchanged in substance by the move to the adapter's store — only where it
    // reads and writes. Getting this wrong shows up as a re-auth that fails with
    // "Client ID mismatch" on a server that worked yesterday.
    const prior = (await deps.store.read([{ name, url: serverUrl }]))[name];
    const priorTokens = prior?.status === "present" ? prior.tokens : undefined;
    const priorClient = prior?.status === "present" ? prior.clientInfo : undefined;
    if (priorTokens && !priorClient?.redirectUris?.includes(callback.redirectUrl)) {
      const fresh =
        priorTokens.expiresAt !== undefined && priorTokens.expiresAt - 60 > Date.now() / 1000;
      if (fresh) {
        await deps.store.writeTokens(name, serverUrl, { ...priorTokens, refreshToken: undefined });
      } else {
        await deps.store.remove(name);
      }
    }

    provider = new HvOAuthProvider(name, serverUrl, agentDir, deps, callback.redirectUrl);

    transport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider });
    client = new Client({ name: "happyvibe", version: "1.0.0" }, { capabilities: {} });

    try {
      await client.connect(transport);
      connected = true;
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
      // The transport called redirectToAuthorization → browser opened. Await callback.
      const code = await callback.waitForCode({ timeoutMs, signal: deps.signal });
      await transport.finishAuth(code); // exchanges code → tokens (persisted via provider.saveTokens)
      // A transport cannot be re-started, so reconnect with a fresh transport +
      // client; the provider now returns the freshly-minted token from disk.
      await transport.close().catch(() => undefined);
      transport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider });
      client = new Client({ name: "happyvibe", version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport);
      connected = true;
    }

    const { tools } = await client.listTools();
    return { ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description })) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (connected && client) client.close().catch(() => undefined);
    else if (transport) transport.close().catch(() => undefined);
    callback?.close();
  }
}

/**
 * Remove all stored OAuth credentials for a server.
 *
 * This is the fix for the worst of the three defects: the old version deleted
 * only main's plaintext file while the adapter's keychain entry survived, so
 * clicking Log out left the running session perfectly signed in. It now removes
 * the credential where the agent actually reads it, and clears our own PKCE/CSRF
 * leftovers as well.
 */
export async function logout(name: string, agentDir: string, store: AdapterStore): Promise<void> {
  await store.remove(name);
  clearFlowState(agentDir, name);
}
