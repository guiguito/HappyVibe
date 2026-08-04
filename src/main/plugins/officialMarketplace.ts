/**
 * §25: the one marketplace HappyVibe ships knowing about.
 *
 * Electron-free on purpose — `config.ts` imports electron, and the release-time
 * generator (tools/plugin-catalog) needs this constant without pulling in the
 * whole app. config.ts re-exports it so callers there are unchanged.
 */
export const OFFICIAL_MARKETPLACE_ID = "claude-plugins-official";

export const OFFICIAL_MARKETPLACE_URL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";

export const OFFICIAL_MARKETPLACE = {
  id: OFFICIAL_MARKETPLACE_ID,
  url: OFFICIAL_MARKETPLACE_URL,
};
