/**
 * §13 round 8: the curated one-click catalog. Static and bundled — no network
 * fetch, matching the brand-icon font and §14's curated shortlist. Electron-free
 * so both main (which installs) and the renderer (which browses) can import it;
 * listed in tsconfig.web.json for the renderer side.
 *
 * Every entry was verified against official vendor documentation on 2026-07-31.
 * A stale entry is a release-note fix — the accepted cost of not shipping a
 * marketplace. Re-verify on any material update; the source research's headline
 * finding is four archived servers still taking 380k installs a week.
 *
 * Deliberately NOT shipped:
 * - Slack. GA since Feb 2026 but uses *confidential* OAuth: the client must
 *   present a pre-registered client_id/client_secret and Dynamic Client
 *   Registration is explicitly unsupported. mcpOAuth.ts only implements DCR, so
 *   a Slack tile would be a button that cannot succeed. Revisit if HappyVibe
 *   ever registers its own Slack app.
 * - Figma. Its hosted server (https://mcp.figma.com/mcp) 401s correctly and
 *   advertises a registration_endpoint, but that endpoint returns a plain
 *   "Forbidden" 403 to every well-formed DCR request (verified 2026-08-01 with
 *   and without scope=mcp:connect, with client_secret_post, and with a browser
 *   UA; the x-figma-rest-api-request-id header proves it reached Figma, not a
 *   CDN edge). Figma allowlists pre-registered clients, so our DCR flow cannot
 *   complete. Same class as Slack. Its local Dev Mode server
 *   (http://127.0.0.1:3845/mcp) is unauthenticated but needs the desktop app
 *   running with Dev Mode enabled — a third transport shape we do not model.
 */
import type { McpServerConfig } from "./mcp";
import { mcpSecretPlaceholder } from "./mcpSecretName";

export type McpCatalogCategory =
  | "Code" | "Design" | "Data" | "Browser" | "Productivity" | "Automation";

export interface McpCatalogInput {
  id: string;
  label: string;
  /** Shown under the field — where to get the value. */
  hint: string;
  /** true → safeStorage-encrypted, referenced by placeholder. Never written to disk in the clear. */
  secret: boolean;
  /** Blank is allowed — `build` supplies a default (e.g. the vendor's cloud
      endpoint when the user isn't pointing at a self-hosted instance). */
  optional?: boolean;
}

export interface McpCatalogEntry {
  /** The mcpServers key. Must satisfy isValidServerName. */
  key: string;
  name: string;
  category: McpCatalogCategory;
  /** simple-icons class; undefined falls back to the generic MCP glyph. */
  brand?: string;
  /** One line, on the card. */
  tagline: string;
  /** Two to three sentences, in the confirm dialog. Required — the dialog is
      only worth showing if there is something worth reading. */
  blurb: string;
  docsUrl: string;
  transport: "remote" | "stdio";
  auth: "oauth" | "key" | "none";
  inputs: McpCatalogInput[];
  /**
   * Build the mcpServers config. `secretRef(inputId)` returns the `${VAR}`
   * placeholder for a secret input — the caller never passes the real value
   * into the file. Non-secret values (an instance URL) are inlined literally.
   *
   * A placeholder may only appear in `env` or `headers`: the adapter does not
   * interpolate url/command/args (tests/mcp-adapter-interpolation.test.ts).
   */
  build(values: Record<string, string>, secretRef: (inputId: string) => string): McpServerConfig;
}

/** Bearer header carrying a secret placeholder — the shape most vendors want. */
const bearer = (ref: string): Record<string, string> => ({ Authorization: `Bearer ${ref}` });

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    key: "context7",
    name: "Context7",
    category: "Code",
    // simple-icons has no si-context7; Context7 is an Upstash product.
    brand: "si-upstash",
    tagline: "Live, version-correct docs so the agent stops writing deprecated code",
    blurb:
      "Context7 looks up the current documentation for whatever library you are using and feeds it to the agent mid-task. It is the usual fix for a model confidently writing an API that was removed two versions ago. Needs a free API key.",
    docsUrl: "https://context7.com/docs/resources/all-clients",
    transport: "remote",
    auth: "key",
    inputs: [
      { id: "apiKey", label: "API key", hint: "Free from context7.com → Dashboard", secret: true },
    ],
    build: (_v, ref) => ({ url: "https://mcp.context7.com/mcp", headers: bearer(ref("apiKey")) }),
  },
  {
    key: "github",
    name: "GitHub",
    category: "Code",
    brand: "si-github",
    tagline: "Read repos, issues, PRs and Actions runs",
    blurb:
      "GitHub's official server lets the agent summarise commits, compare branches, read issues and pull requests, and explain why an Actions workflow failed. Authenticate with a personal access token — GitHub does not offer browser sign-in to unregistered apps.",
    docsUrl: "https://github.com/github/github-mcp-server",
    transport: "remote",
    // Token, NOT OAuth: GitHub's authorization-server metadata advertises no
    // registration_endpoint (verified 2026-08-01 at the RFC 8414 path form
    // https://github.com/.well-known/oauth-authorization-server/login/oauth),
    // so our DCR-only flow cannot obtain a client_id — the same dead end that
    // dropped Slack and Figma. The PAT path is real: the server evaluates a
    // bearer token (401 invalid_token "Token is not authorized" for a bad one)
    // rather than rejecting the method. Revisit if HappyVibe registers a
    // GitHub App and can ship a real client_id.
    auth: "key",
    inputs: [
      {
        id: "token",
        label: "Personal access token",
        hint: "github.com → Settings → Developer settings → Personal access tokens. Needs repo + read:org.",
        secret: true,
      },
    ],
    build: (_v, ref) => ({ url: "https://api.githubcopilot.com/mcp/", headers: bearer(ref("token")) }),
  },
  {
    key: "atlassian",
    name: "Jira / Atlassian",
    category: "Productivity",
    brand: "si-atlassian",
    tagline: "Read and update Jira tickets and Confluence pages",
    blurb:
      "Atlassian's Rovo server gives the agent your Jira and Confluence workspace: it can pull a ticket's context before making a change, move a status, or cross-reference a page. You sign in through your browser.",
    docsUrl: "https://www.atlassian.com/platform/remote-mcp-server",
    transport: "remote",
    auth: "oauth",
    inputs: [],
    build: () => ({ url: "https://mcp.atlassian.com/v1/mcp/authv2" }),
  },
  {
    key: "notion",
    name: "Notion",
    category: "Productivity",
    brand: "si-notion",
    tagline: "Read and write your Notion workspace",
    blurb:
      "Lets the agent search your Notion workspace, read pages and write results back — useful for turning a task into a written doc without leaving the chat. Sign-in is through your browser; Notion does not accept pasted tokens.",
    docsUrl: "https://developers.notion.com/docs/get-started-with-mcp",
    transport: "remote",
    auth: "oauth",
    inputs: [],
    build: () => ({ url: "https://mcp.notion.com/mcp" }),
  },
  {
    key: "linear",
    name: "Linear",
    category: "Productivity",
    brand: "si-linear",
    tagline: "Read and update Linear issues and projects",
    blurb:
      "Gives the agent your Linear workspace so it can pull an issue's full context before starting work, and update status or add comments when it finishes. You sign in through your browser.",
    docsUrl: "https://linear.app/docs/mcp",
    transport: "remote",
    auth: "oauth",
    inputs: [],
    build: () => ({ url: "https://mcp.linear.app/mcp" }),
  },
  {
    key: "supabase",
    name: "Supabase",
    category: "Data",
    brand: "si-supabase",
    tagline: "Query and migrate your Supabase database",
    blurb:
      "Lets the agent inspect your Supabase schema, run queries and apply migrations, so it can work against the real database rather than an imagined one. You sign in through your browser.",
    docsUrl: "https://supabase.com/docs/guides/ai-tools/mcp",
    transport: "remote",
    auth: "oauth",
    inputs: [
      {
        id: "instanceUrl",
        label: "Instance URL",
        hint: "Leave blank for Supabase Cloud. Developing against the local CLI? Use http://localhost:54321/mcp",
        secret: false,
        optional: true,
      },
    ],
    // The docs give a real second endpoint for the local CLI, so this is a
    // plain URL swap — no transport change, and the cloud default still makes
    // it a one-click install for everyone who ignores the field.
    build: (v) => ({ url: v.instanceUrl?.trim() || "https://mcp.supabase.com/mcp" }),
  },
  {
    key: "neon",
    name: "Neon",
    category: "Data",
    brand: "si-neon",
    tagline: "Serverless Postgres the agent can create, query and migrate",
    blurb:
      "Neon gives the agent a real Postgres database it can provision, query and migrate on the spot — including branching a database to try a change safely. You sign in through your browser.",
    docsUrl: "https://neon.com/docs/ai/neon-mcp-server",
    transport: "remote",
    auth: "oauth",
    inputs: [],
    build: () => ({ url: "https://mcp.neon.tech/mcp" }),
  },
  {
    key: "firecrawl",
    name: "Firecrawl",
    category: "Data",
    // simple-icons ships no si-firecrawl — generic MCP glyph.
    tagline: "Scrape JavaScript-heavy pages the agent otherwise can't read",
    blurb:
      "Firecrawl fetches and cleans modern web pages, including ones that only render through JavaScript, and hands the agent readable text instead of raw markup. Useful when you want it to research a site rather than guess at it. Needs a free API key. This connects to Firecrawl Cloud — self-hosting runs a local server instead, so add it with \u201cAdd server\u201d below.",
    docsUrl: "https://docs.firecrawl.dev/mcp-server/connect",
    transport: "remote",
    auth: "key",
    inputs: [
      { id: "apiKey", label: "API key", hint: "From your Firecrawl dashboard → API Keys", secret: true },
    ],
    // Header form only. Firecrawl still accepts the key in the URL path but its
    // own docs call that legacy — and a path key cannot be a placeholder,
    // so it would have to be written into mcp.json in the clear.
    build: (_v, ref) => ({ url: "https://mcp.firecrawl.dev/v2/mcp", headers: bearer(ref("apiKey")) }),
  },
  {
    key: "composio",
    name: "Composio",
    category: "Automation",
    // simple-icons ships no si-composio — generic MCP glyph.
    tagline: "One connection to hundreds of app integrations",
    blurb:
      "Composio is an aggregator: you connect your accounts once on their dashboard and the agent reaches all of them through a single server, discovering tools on demand so it does not flood the context window. Needs an API key.",
    docsUrl: "https://docs.composio.dev/docs/composio-connect",
    transport: "remote",
    auth: "key",
    inputs: [
      { id: "apiKey", label: "API key", hint: "From your Composio dashboard", secret: true },
    ],
    build: (_v, ref) => ({
      url: "https://connect.composio.dev/mcp",
      headers: { "x-consumer-api-key": ref("apiKey") },
    }),
  },
  {
    key: "n8n",
    name: "n8n",
    category: "Automation",
    brand: "si-n8n",
    tagline: "Run and edit your own n8n workflows from the agent",
    // NB: this is n8n's OFFICIAL built-in server (/mcp-server/http), which
    // surfaces YOUR workflows. It is not the community czlonkowski/n8n-mcp,
    // which teaches the agent n8n's node catalogue so it can author workflows —
    // a different product, stdio, and a candidate for its own entry later. The
    // blurb described that one by mistake while shipping this endpoint.
    blurb:
      "n8n's built-in server exposes the workflows you have marked as available in MCP, so the agent can search them, trigger and test runs, and create or edit workflows and data tables. It always points at your own instance — n8n Cloud included, since every workspace has its own URL.",
    docsUrl: "https://docs.n8n.io/connect/connect-to-n8n-mcp-server",
    transport: "remote",
    auth: "key",
    inputs: [
      {
        id: "instanceUrl",
        label: "Your n8n URL",
        hint: "Your n8n base URL, shown on the Instance-level MCP page — cloud workspaces look like https://<name>.app.n8n.cloud",
        secret: false,
      },
      {
        id: "token",
        label: "MCP access token",
        hint: "n8n → Settings → Instance-level MCP → Connection details → Access Token",
        secret: true,
      },
    ],
    // The instance URL is the user's own non-secret value, so it is inlined
    // literally — the adapter would not interpolate a placeholder in `url`.
    build: (v, ref) => ({
      url: `${v.instanceUrl.trim().replace(/\/+$/, "")}/mcp-server/http`,
      headers: bearer(ref("token")),
    }),
  },
  {
    key: "playwright",
    name: "Playwright",
    category: "Browser",
    // simple-icons v16 no longer ships si-playwright — generic MCP glyph.
    // Pinned by the brand-icon existence test in tests/tool-label.test.ts.
    tagline: "Drive a real browser — run and repair end-to-end tests",
    blurb:
      "Playwright gives the agent a real browser it can navigate, click through and read, using the page's accessibility tree rather than screenshots — structured and cheap on tokens. Runs on your machine, so it needs Node installed.",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
    transport: "stdio",
    auth: "none",
    inputs: [],
    build: () => ({ command: "npx", args: ["-y", "@playwright/mcp@latest"] }),
  },
  {
    key: "chrome_devtools",
    name: "Chrome DevTools",
    category: "Browser",
    brand: "si-googlechrome",
    tagline: "Inspect pages, read the console, record performance traces",
    blurb:
      "Chrome's own server lets the agent open a page, read the console and network activity, and record a real performance trace — so it can diagnose a slow page instead of speculating. Runs on your machine, so it needs Node installed.",
    docsUrl: "https://developer.chrome.com/blog/chrome-devtools-mcp",
    transport: "stdio",
    auth: "none",
    inputs: [],
    build: () => ({ command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] }),
  },
  {
    key: "shadcn",
    name: "shadcn",
    category: "Design",
    brand: "si-shadcnui",
    tagline: "Pull real shadcn/ui components instead of invented markup",
    blurb:
      "Connects the agent to the shadcn component registry so it installs and composes the actual components rather than hallucinating similar-looking markup. Reads your project on disk, so it needs Node installed.",
    docsUrl: "https://ui.shadcn.com/docs/mcp",
    transport: "stdio",
    auth: "none",
    inputs: [],
    build: () => ({ command: "npx", args: ["shadcn@latest", "mcp"] }),
  },
];

export function catalogEntry(key: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.key === key);
}

/**
 * Split a filled-in catalog form into (a) the config to write and (b) the
 * secrets to encrypt. Secrets are referenced from the config by `${…}`
 * placeholder and never appear in it.
 */
export function buildCatalogInstall(
  entry: McpCatalogEntry,
  values: Record<string, string>,
): { cfg: McpServerConfig; secrets: { inputId: string; value: string }[] } {
  for (const input of entry.inputs) {
    if (input.optional) continue;
    if (!values[input.id]?.trim()) throw new Error(`${input.label} is required`);
  }
  const cfg = entry.build(values, (id) => mcpSecretPlaceholder(entry.key, id));
  const secrets = entry.inputs
    .filter((i) => i.secret)
    .map((i) => ({ inputId: i.id, value: values[i.id] }));
  return { cfg, secrets };
}
