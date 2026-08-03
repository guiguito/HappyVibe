import { RESERVED_SLASH_COMMANDS } from "./promptTemplates";

/**
 * §24 import collision refusal — PURE so it is testable without Electron
 * (ipc.ts, its only caller, imports electron at module scope).
 *
 * Pi matches extension commands and RETURNS before it ever expands a prompt
 * template (`core/agent-session.js:799-806`), so a file named after one of the
 * bridge's `/hv-*` commands is dead the moment it lands on disk. Importing one
 * would silently create a command the user can never run, so the import is
 * refused and the conflicting name is handed back for the message.
 *
 * @returns the first colliding command name, or null when the batch is clean.
 */
export function refuseReservedNames(candidates: Array<{ name: string }>): string | null {
  return candidates.find((c) => RESERVED_SLASH_COMMANDS.has(c.name))?.name ?? null;
}
