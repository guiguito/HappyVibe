import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Tools that never need approval in the spike.
const SAFE_TOOLS = new Set(["read", "grep", "glob", "list", "ls"]);
const sessionGrants = new Set<string>();

function summarize(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "bash" && typeof input.command === "string") return input.command.slice(0, 300);
  return JSON.stringify(input).slice(0, 300);
}

// ── B3 auth (docs/validation/s0.2.md) ──────────────────────────────────────
// Every UI payload is structured JSON following the hv.permission title
// convention, so the renderer can render device codes / auth URLs properly.
// notify carries the JSON in `message`; input/select carry it in `title`.
const authPayload = (o: Record<string, unknown>): string => JSON.stringify({ kind: "hv.auth", ...o });

// Providers hv-auth-status always reports on (PRD curated list), even when
// nothing is configured. Extra providers found in auth.json ride along.
const STATUS_PROVIDERS = [
  "anthropic", "github-copilot", "openai-codex", // OAuth ladder rung 1
  "ollama", // rung 2 (configured via models.json)
  "deepseek", "openai", "google", "openrouter", // BYOK rung 3 (anthropic above)
];

const loginAborts = new Map<string, AbortController>();

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName as string;
    if (SAFE_TOOLS.has(tool) || sessionGrants.has(tool)) return;

    const title = JSON.stringify({
      kind: "hv.permission",
      tool,
      summary: summarize(tool, (event.input ?? {}) as Record<string, unknown>),
    });
    // Surfaces as extension_ui_request over RPC (verified by D1 probe).
    // NO timeout: permission prompts wait indefinitely by design.
    const choice = await ctx.ui.select(title, ["Allow", "Allow for session", "Deny"]);

    if (choice === "Allow for session") { sessionGrants.add(tool); return; }
    if (choice === "Allow") return;
    return { block: true, reason: "User denied this action in HappyVibe" };
  });

  pi.registerCommand("hv-auth-status", {
    description: "HappyVibe: report provider auth status (never leaks credential values)",
    handler: async (_args, ctx) => {
      const auth = ctx.modelRegistry.authStorage;
      const ids = new Set([...STATUS_PROVIDERS, ...auth.list()]);
      const providers: Record<string, unknown> = {};
      // getProviderAuthStatus also accounts for models.json apiKey (Ollama).
      for (const id of ids) providers[id] = ctx.modelRegistry.getProviderAuthStatus(id);
      ctx.ui.notify(authPayload({ stage: "status", providers }), "info");
    },
  });

  pi.registerCommand("hv-login", {
    description: "HappyVibe: OAuth login. Usage: /hv-login <provider>",
    handler: async (args, ctx) => {
      const provider = args.trim();
      const auth = ctx.modelRegistry.authStorage;
      if (!auth.getOAuthProviders().some((p) => p.id === provider)) {
        ctx.ui.notify(authPayload({ stage: "error", provider, message: `Unknown OAuth provider: ${provider}` }), "error");
        return;
      }
      const ac = new AbortController();
      loginAborts.set(provider, ac);
      try {
        // AuthStorage.login persists to auth.json AND updates the in-memory
        // credential map — no respawn needed afterwards (s0.2 §2).
        await auth.login(provider, {
          signal: ac.signal,
          onAuth: (info) =>
            ctx.ui.notify(authPayload({ stage: "auth_url", provider, url: info.url, instructions: info.instructions }), "info"),
          onDeviceCode: (i) =>
            ctx.ui.notify(authPayload({
              stage: "device_code", provider,
              userCode: i.userCode, verificationUri: i.verificationUri,
              intervalSeconds: i.intervalSeconds, expiresInSeconds: i.expiresInSeconds,
            }), "info"),
          onProgress: (message) => ctx.ui.notify(authPayload({ stage: "progress", provider, message }), "info"),
          onPrompt: async (p) => {
            const v = await ctx.ui.input(
              authPayload({ stage: "prompt", provider, message: p.message, placeholder: p.placeholder }),
              p.placeholder,
            );
            if (v === undefined) throw new Error("Login cancelled");
            return v;
          },
          onManualCodeInput: async () => {
            const v = await ctx.ui.input(authPayload({ stage: "manual_code", provider, message: "Paste the authorization code" }));
            if (v === undefined) throw new Error("Login cancelled");
            return v;
          },
          onSelect: async (p) => {
            const label = await ctx.ui.select(
              authPayload({ stage: "select", provider, message: p.message }),
              p.options.map((o) => o.label),
            );
            return p.options.find((o) => o.label === label)?.id;
          },
        });
        ctx.ui.notify(authPayload({ stage: "success", provider }), "info");
      } catch (e) {
        ctx.ui.notify(authPayload({ stage: "error", provider, message: e instanceof Error ? e.message : String(e) }), "error");
      } finally {
        loginAborts.delete(provider);
      }
    },
  });

  pi.registerCommand("hv-login-cancel", {
    description: "HappyVibe: cancel an in-flight /hv-login. Usage: /hv-login-cancel <provider>",
    handler: async (args) => { loginAborts.get(args.trim())?.abort(); },
  });

  pi.registerCommand("hv-logout", {
    description: "HappyVibe: remove stored credentials. Usage: /hv-logout <provider>",
    handler: async (args, ctx) => {
      const provider = args.trim();
      ctx.modelRegistry.authStorage.logout(provider);
      ctx.ui.notify(authPayload({ stage: "logged_out", provider }), "info");
    },
  });
}
