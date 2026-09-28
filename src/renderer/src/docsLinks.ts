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
export const docUrl = (slug: string): string => `https://happyvibe.dev/docs/${slug}/?embed=1`;
