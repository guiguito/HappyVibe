/** Electron-free RPC command builders (vitest-importable, like the rest of pi/). */

export type PromptBehavior = "steer" | "followUp";

/**
 * Build a `prompt` command. While the agent is streaming, Pi errors on a bare
 * prompt — it must carry `streamingBehavior: "steer" | "followUp"` (docs/rpc.md).
 */
export function promptCommand(
  message: string,
  behavior?: PromptBehavior
): { type: "prompt"; message: string; streamingBehavior?: PromptBehavior } {
  return behavior ? { type: "prompt", message, streamingBehavior: behavior } : { type: "prompt", message };
}
