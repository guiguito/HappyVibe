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

/** `?embed=1` hides the site title, so the page reads as part of the app (docs/guide/astro.config.mjs). */
export const docUrl = (slug: string, anchor?: string): string => `${DOCS_BASE}${slug}/?embed=1${anchor ? `#${anchor}` : ""}`;

/** Docs in the app (2026-09-29): the guide's front page — the Help menu's target. */
export const docsIndexUrl = `${DOCS_BASE}?embed=1`;

/** The same page for the system browser: without `?embed=1`, so the site's title shows. */
export const externalDocUrl = (url: string): string => {
  const u = new URL(url);
  u.searchParams.delete("embed");
  return u.href;
};

/** The User guide page's own copy (GuideView, and the settings row that opens it). */
export const GUIDE_COPY = { title: "User guide", back: "← Back", external: "Open in browser ↗" } as const;

/** The label on a model-call error card that links to a guide page. */
export const ERROR_GUIDE_LABEL = "Read the guide ↗";
