import { DOCS_BASE } from "../../main/docsBase";
import type { View } from "./components/Sidebar";

/**
 * Docs round (2026-09-28): each sidebar screen's page in the user guide (docs/guide).
 * Flat, named after the screen's label, so regrouping the sidebar never breaks a
 * URL. tests/docs-links.test.ts pins one entry per NAV screen.
 */
export const DOC_SLUG: Partial<Record<View, string>> = {
  models: "models",
  builtinTools: "built-in-tools",
  memory: "memory",
  plugins: "plugins",
  skills: "skills",
  promptTemplates: "prompts",
  mcp: "mcp",
  agents: "agents",
  sysprompt: "system-prompt",
  permissions: "permissions",
  tools: "agent-tools",
  terminal: "terminal",
  voice: "voice",
  onBehalf: "ai-autofill",
  shortcuts: "keyboard-shortcuts",
  privacy: "privacy",
  stats: "stats",
  audit: "audit-log",
  changelog: "changelog",
  // Everyday-use round (2026-09-29): a sidebar destination outside NAV, rendered in the same wrapper.
  schedules: "schedules",
};

/**
 * A page of the guide. Docs in the app (2026-09-29): no `?embed=1` — that flag hid the site's
 * title for a browser pane, and the in-app guide wants the HappyVibe header it carries.
 */
export const docUrl = (slug: string, anchor?: string): string => `${DOCS_BASE}${slug}/${anchor ? `#${anchor}` : ""}`;

/** The guide's front page — the Help menu's target. */
export const docsIndexUrl = DOCS_BASE;

/** The User guide page's own copy (GuideView, and the settings row that opens it). */
export const GUIDE_COPY = { title: "User guide", close: "Close the guide" } as const;

/** The label on a model-call error card that links to a guide page. */
export const ERROR_GUIDE_LABEL = "Read the guide ↗";
