/**
 * W1.1 — human headlines for tool cards (PRD "Chat experience": tool calls
 * never show raw technical calls by default).
 *
 * Pure (toolName, args) → {icon, label}; unit-tested in tests/tool-label.test.ts.
 * Registered tools carry a model-written required `intent` param (wired in
 * happyvibe-bridge.ts) which always wins; Pi's built-in tools can't gain one
 * (hard-coded schemas — unknown params are stripped/rejected before tool_call),
 * so their labels are derived here from tool + args.
 * Arg names verified against pi-coding-agent dist/core/tools/*.js.
 */

import { describeCommand } from "./describeCommand";
import { unwrapMcpCall } from "../../../pi-runtime/extensions/hv-mcp";

export type IconKind =
  | "terminal"
  | "edit"
  | "file-plus"
  | "eye"
  | "search"
  | "folder"
  | "robot"
  | "wrench"
  | "copy"
  | "rewind"
  | "check"
  | "book"
  | "globe";

export interface ToolLabel {
  icon: IconKind;
  label: string;
  /** W2.2: file the call touches (edit/write/read) — makes the card path clickable. */
  path?: string;
  /** V2.A: destructive bash command (rm/rmdir) — the card badges it. */
  destructive?: boolean;
  /** Round 4 #4: simple-icons brand class (e.g. "si-github") when an MCP call's
      server maps to a known product — the card renders it instead of the icon. */
  brand?: string;
}

/** Round 4 #4: MCP server key → simple-icons class (curated). Unknown → generic
    MCP glyph. Keys are normalized (lowercased, non-alphanumerics stripped). */
export const BRAND_ICONS: Record<string, string> = {
  github: "si-github",
  gitlab: "si-gitlab",
  notion: "si-notion",
  linear: "si-linear",
  jira: "si-jira",
  atlassian: "si-atlassian",
  confluence: "si-confluence",
  figma: "si-figma",
  sentry: "si-sentry",
  vercel: "si-vercel",
  netlify: "si-netlify",
  cloudflare: "si-cloudflare",
  stripe: "si-stripe",
  supabase: "si-supabase",
  firebase: "si-firebase",
  postgresql: "si-postgresql",
  postgres: "si-postgresql",
  mongodb: "si-mongodb",
  redis: "si-redis",
  docker: "si-docker",
  kubernetes: "si-kubernetes",
  gcp: "si-googlecloud",
  googlecloud: "si-googlecloud",
  google: "si-google",
  googledrive: "si-googledrive",
  gmail: "si-gmail",
  googlecalendar: "si-googlecalendar",
  anthropic: "si-anthropic",
  huggingface: "si-huggingface",
  discord: "si-discord",
  telegram: "si-telegram",
  asana: "si-asana",
  trello: "si-trello",
  airtable: "si-airtable",
  intercom: "si-intercom",
  posthog: "si-posthog",
  sqlite: "si-sqlite",
  puppeteer: "si-puppeteer",
  // Round 8 (curated catalog). Only classes that ship in simple-icons v16 —
  // firecrawl and composio have none, so they keep the generic MCP glyph.
  n8n: "si-n8n",
  neon: "si-neon",
  shadcn: "si-shadcnui",
  chrome: "si-googlechrome",
  // Context7 is an Upstash product; simple-icons has si-upstash, not si-context7.
  context7: "si-upstash",
  upstash: "si-upstash",
};

// Brand keys long enough to prefix-match a server-key variant without risking
// false hits (avoids short keys like "aws"/"gcp" matching inside words).
const LONG_BRAND_KEYS = Object.keys(BRAND_ICONS)
  .filter((k) => k.length >= 5)
  .sort((a, b) => b.length - a.length); // longest first: "googledrive" before "google"

/**
 * Round 4 #4: resolve a brand icon from an MCP tool identifier. Works for both
 * the proxy tool name ("notion_fetch") and direct-mode tool names, and tolerates
 * server-key variants ("notionApi_create-pages", "notion-mcp_fetch"). Tokenizes
 * on non-alphanumerics, matching an exact token first, then a ≥5-char prefix.
 */
export function brandIconFor(identifier: string | undefined): string | undefined {
  if (!identifier) return undefined;
  const tokens = identifier.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const tok of tokens) {
    if (BRAND_ICONS[tok]) return BRAND_ICONS[tok];
  }
  for (const tok of tokens) {
    for (const key of LONG_BRAND_KEYS) {
      if (tok.startsWith(key)) return BRAND_ICONS[key];
    }
  }
  return undefined;
}

const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;

/** Collapse whitespace and cap at `n` chars with an ellipsis. */
const truncate = (s: string, n = 60): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** "fetch_url-fast" → "Fetch url fast" */
/**
 * §28: a URL for a card headline — host + a short path. The whole URL is in the
 * permission prompt and the audit log; a card is a headline, not a record.
 */
const prettyUrl = (raw: string): string => {
  try {
    const u = new URL(raw);
    const tail = u.pathname === "/" ? "" : u.pathname;
    return truncate(`${u.host}${tail}`, 48);
  } catch {
    return truncate(raw, 48);
  }
};

const prettify = (name: string): string => {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function toolLabel(toolName: string, args: unknown): ToolLabel {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const str = (k: string): string | null =>
    typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string) : null;
  const intent = str("intent");

  switch (toolName) {
    case "bash": {
      // V2.A: parsed explanation ("Installing dependencies…", "Deleting X" +
      // destructive flag) — falls back to "Running: <cmd>" for unknown commands.
      const cmd = str("command");
      if (!cmd) return { icon: "terminal", label: "Running a command" };
      const d = describeCommand(cmd);
      return { icon: "terminal", label: d.label, ...(d.destructive ? { destructive: true } : {}) };
    }
    // §26 part 2. The CARD leads with the model's intent (§7); the permission
    // MODAL never does — it reconstructs {command} from the bridge's factual
    // summary, so `intent` is absent there and the describeCommand fallback runs.
    case "terminal_run": {
      const cmd = str("command");
      if (intent) return { icon: "terminal", label: intent };
      if (!cmd) return { icon: "terminal", label: "Running a command in a terminal" };
      const d = describeCommand(cmd);
      return { icon: "terminal", label: d.label, ...(d.destructive ? { destructive: true } : {}) };
    }
    case "terminal_kill":
      return { icon: "terminal", label: intent ?? "Stopping a terminal" };
    case "terminal_read":
      return { icon: "terminal", label: "Reading terminal output" };
    // §28: the browser's ten.
    //
    // Round 15 REVERSES §28's URL-first rule, for the CARD only. §28 headlined
    // the URL even when the model wrote an intent — "where the agent went is the
    // fact worth reading" — which buried the customer-facing sentence in the
    // details JSON while every other registered tool led with it. The intent is
    // the headline now and the URL rides `path`, so ToolCard's existing chip
    // (PathActions) renders it verbatim beside the label: nothing is hidden,
    // it is just no longer the headline.
    //
    // The safety half is untouched and is what makes this safe: the permission
    // MODAL summarizes as the URL (the bridge's `summarize()` special-case,
    // like bash/terminal_run) and never sees `intent`, so a benign-sounding
    // sentence still cannot mask where the agent is going at approval time.
    case "browser_open":
    case "browser_navigate": {
      const url = str("url");
      if (intent) return { icon: "globe", label: intent, ...(url ? { path: url } : {}) };
      if (url) return { icon: "globe", label: `${toolName === "browser_open" ? "Opening" : "Going to"} ${prettyUrl(url)}` };
      return { icon: "globe", label: "Opening a page" };
    }
    case "browser_screenshot":
      return { icon: "globe", label: intent ?? "Taking a screenshot of the page" };
    case "browser_get_text":
      return { icon: "globe", label: intent ?? "Reading the page" };
    case "browser_read_console":
      return { icon: "globe", label: intent ?? "Reading the page console" };
    case "browser_read_network":
      return { icon: "globe", label: intent ?? "Reading the page network log" };
    case "browser_click": {
      const sel = str("selector");
      return { icon: "globe", label: intent ?? (sel ? `Clicking ${truncate(sel)}` : "Clicking in the page") };
    }
    case "browser_type": {
      const sel = str("selector");
      return { icon: "globe", label: intent ?? (sel ? `Typing into ${truncate(sel)}` : "Typing in the page") };
    }
    case "browser_evaluate":
      return { icon: "globe", label: intent ?? "Running JavaScript in the page" };
    case "browser_close":
      return { icon: "globe", label: intent ?? "Closing the browser" };
    case "edit": {
      const p = str("path");
      // W2.2: the path itself moved out of the label into the card's
      // interactive path chip (ToolCard PathActions) — label keeps the basename.
      return { icon: "edit", label: p ? `Editing ${basename(p)}` : "Editing a file", path: p ?? undefined };
    }
    case "write": {
      const p = str("path");
      return { icon: "file-plus", label: p ? `Creating ${basename(p)}` : "Creating a file", path: p ?? undefined };
    }
    case "read": {
      const p = str("path");
      return { icon: "eye", label: p ? `Reading ${basename(p)}` : "Reading a file", path: p ?? undefined };
    }
    case "grep":
    case "find": {
      const pattern = str("pattern");
      return { icon: "search", label: pattern ? `Searching for ${truncate(pattern)}` : "Searching" };
    }
    case "ls": {
      const p = str("path");
      return { icon: "folder", label: `Listing ${p ? basename(p) : "the current directory"}` };
    }
    case "mcp": {
      // Prefer the model-authored intent (injected on the proxy tool via
      // requireIntent); fall back to the factual unwrapped display. #4: show the
      // server's brand icon when recognized, else the generic MCP glyph.
      const info = unwrapMcpCall(a);
      return { icon: "wrench", label: intent ?? info.display, brand: brandIconFor(info.mcpTool ?? info.server) };
    }
    case "subagent":
      return { icon: "robot", label: intent ?? `Delegating to ${str("agent") ?? "a subagent"}` };
    case "use_skill": {
      // §14: loading a skill. Model-authored intent wins (requireIntent); the
      // skill name is the honest fallback headline.
      const name = str("name");
      return { icon: "book", label: intent ?? (name ? `Using skill: ${name}` : "Using a skill") };
    }
    default:
      // Unknown/registered tool: the intent it carries, else a prettified name.
      // #4: direct-mode MCP tools land here (not the `mcp` proxy) with names like
      // "notion_create-pages" — surface their brand icon too.
      return { icon: "wrench", label: intent ?? prettify(toolName), brand: brandIconFor(toolName) };
  }
}
