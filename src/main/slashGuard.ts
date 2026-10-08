import { RESERVED_SLASH_COMMANDS } from "./promptTemplates/view";

/**
 * PRD §10 round 28 — Pi runs a registered extension command the moment a prompt names it,
 * before any bridge hook, even mid-turn. Main is the only choke point, so a typed one is
 * refused here (electron-free, so the test can import it). Scheduled runs share promptSession.
 */
/** The red banner's Turn off — the one reserved command the UI itself sends. */
export const ALLOWED_TYPED = "/hv-dangerous off";

export function slashRefusal(text: string): string | null {
  const t = text.trim();
  if (t === ALLOWED_TYPED) return null;
  const name = /^\/(\S+)/.exec(t)?.[1];
  if (!name || !RESERVED_SLASH_COMMANDS.has(name)) return null;
  if (name === "mcp") return "/mcp is managed from the MCP page.";
  if (name === "agents") return "/agents is managed from the Agents page.";
  if (name === "hv-login" || name === "hv-logout" || name === "hv-login-cancel") return "Sign-ins are managed from Models.";
  if (name === "hv-dangerous") return "Bypass is turned on in Settings, with Bypass ALL permissions.";
  return `/${name} is internal to HappyVibe and can't be typed.`;
}
