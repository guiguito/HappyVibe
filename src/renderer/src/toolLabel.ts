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

/**
 * Name a pi-subagents artifact the model is reading, instead of showing its
 * filename.
 *
 * These files are OUR plumbing surfacing in the user's transcript: from
 * pi-subagents 0.50 the completion payload is truncated at a hardcoded 1,000
 * characters, so the model routinely fetches the full result from disk — and the
 * card read "Reading 7753ae03_code-explorer_0_output.md", which tells the user
 * nothing and looks like a leak.
 *
 * The filename is generated, so it can be parsed rather than guessed:
 * `<runId>_<agent>[_<index>]_<kind>.md` (shared/artifacts.ts getArtifactPaths,
 * where the agent has had non-word characters replaced by `_`). The runId is the
 * first segment; the kind is a fixed suffix; whatever sits between them is the
 * agent, so the label can NAME the agent that did the work.
 *
 * Returns null for anything that is not one of these, so an ordinary file the
 * user asked about keeps its normal "Reading <file>" label and its path chip.
 */
const ARTIFACT_DIRS = ["subagent-artifacts", "pi-subagents-artifacts"];
const ARTIFACT_KINDS: Record<string, (agent: string) => string> = {
  output: (a) => `Reading ${a}'s full report`,
  input: (a) => `Reading the task given to ${a}`,
  transcript: (a) => `Reading ${a}'s transcript`,
  meta: (a) => `Reading ${a}'s run details`,
};

export function describeSubagentArtifact(filePath: string): string | null {
  const parts = filePath.replace(/\/+$/, "").split("/");
  const file = parts.pop() ?? "";
  if (!ARTIFACT_DIRS.includes(parts.pop() ?? "")) return null;
  const m = /^([^_]+)_(.+?)(?:_(\d+))?_(input|output|transcript|meta)\.(?:md|jsonl|json)$/.exec(file);
  if (!m) return null;
  const agent = m[2].trim();
  if (!agent) return null;
  return ARTIFACT_KINDS[m[4]]?.(agent) ?? null;
}


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

/** Just the host. `web_map`/`web_crawl` act on a SITE, so showing a path would
 * suggest they only read that one page. `web_fetch` uses prettyUrl instead,
 * because a page is what it reads. */
const hostOnly = (raw: string): string => {
  try {
    return new URL(raw).host || truncate(raw, 48);
  } catch {
    return truncate(raw, 48);
  }
};

const prettify = (name: string): string => {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The three virtual rule names the bridge gates on: `subagent:<agent>`,
 * `mcp:<server>_<tool>` and `browser:<host>` (happyvibe-bridge.ts `permTool`).
 *
 * They reach here only from PermissionModal — a tool CARD is built from the real
 * tool name (`subagent`, `mcp`, `browser_navigate`), which the switch below
 * handles. The tail of a rule name is an identifier the user typed into an agent
 * file, or a hostname, or a server's own tool id, so it must render verbatim:
 * `prettify` turned "subagent:code-explorer" into "Subagent:code explorer" in the
 * headline of the prompt that grants it. Splitting on the FIRST colon keeps an
 * `mcp:` tool whose own name contains one intact.
 */
const VIRTUAL_RULE: Record<string, { icon: IconKind; kind: string }> = {
  subagent: { icon: "robot", kind: "Sub-agent" },
  mcp: { icon: "wrench", kind: "MCP" },
  // §32: the rule covers §28's browser AND the web tools, so the label is the
  // one word that is true of both — "Browser" became a lie the moment a
  // web_fetch could create the grant.
  //
  // Where this actually renders, checked in the running app rather than
  // assumed: the PERMISSION PROMPT's headline (PermissionModal) and any card
  // whose tool IS a virtual rule. The Permissions page and the audit log
  // deliberately do NOT use it — the first is a rule EDITOR showing the
  // pattern you would type, the second is a RECORD, and both are better off
  // verbatim. (This entry first claimed all three; the GUI pass disproved it.)
  browser: { icon: "globe", kind: "Web" },
};

export function toolLabel(toolName: string, args: unknown): ToolLabel {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const str = (k: string): string | null =>
    typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string) : null;
  const intent = str("intent");

  const colon = toolName.indexOf(":");
  if (colon > 0) {
    const v = VIRTUAL_RULE[toolName.slice(0, colon)];
    const subject = toolName.slice(colon + 1);
    if (v && subject) return { icon: v.icon, label: `${v.kind}: ${subject}` };
  }

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
    // §32 web tools. The card leads with the model's intent (§7); the fallbacks
    // are the app's own vocabulary — Search / Read / Site map / Read a site —
    // and never "scrape" or "crawl", which the UI does not say. The URL rides
    // `path` so ToolCard renders its chip; resolveCardPath already refuses to
    // treat a URL as a file, so the chip cannot offer to open a web page in the
    // code editor.
    case "web_search": {
      const q = str("query");
      return { icon: "search", label: intent ?? (q ? `Searched the web for "${truncate(q, 48)}"` : "Searched the web") };
    }
    case "web_fetch": {
      const url = str("url");
      return {
        icon: "globe",
        label: intent ?? (url ? `Read ${prettyUrl(url)}` : "Read a web page"),
        ...(url ? { path: url } : {}),
      };
    }
    case "web_map": {
      const url = str("url");
      return {
        icon: "globe",
        label: intent ?? (url ? `Listed pages on ${hostOnly(url)}` : "Listed a site's pages"),
        ...(url ? { path: url } : {}),
      };
    }
    case "web_crawl": {
      const url = str("url");
      return {
        icon: "globe",
        label: intent ?? (url ? `Read pages from ${hostOnly(url)}` : "Read pages from a site"),
        ...(url ? { path: url } : {}),
      };
    }
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
    // §31: the model's own sentence leads, the file name is the fallback. The
    // path rides `path` so the card can offer Reveal in Finder — resolveCardPath
    // returns null for a document, which is what stops it offering the editor.
    case "document_read": {
      const p = str("path");
      return {
        icon: "eye",
        label: intent ?? (p ? `Reading ${basename(p)}` : "Reading a document"),
        ...(p ? { path: p } : {}),
      };
    }
    case "read": {
      const p = str("path");
      const artifact = p ? describeSubagentArtifact(p) : null;
      // A sub-agent artifact is app plumbing, not a file of the user's — say what
      // it IS. Path deliberately omitted: the chip opens files in the editor, and
      // this one lives in Application Support, not their project.
      if (artifact) return { icon: "eye", label: artifact };
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
