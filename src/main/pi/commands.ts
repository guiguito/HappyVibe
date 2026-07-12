/** Electron-free RPC command builders (vitest-importable, like the rest of pi/). */

export type PromptBehavior = "steer" | "followUp";

/** RPC ImageContent (docs/rpc.md): the optional `images` element on prompt/steer/follow_up. */
export interface PromptImage {
  type: "image";
  data: string; // base64, no data: prefix
  mimeType: string;
}

/**
 * Build a `prompt` command. While the agent is streaming, Pi errors on a bare
 * prompt — it must carry `streamingBehavior: "steer" | "followUp"` (docs/rpc.md).
 * W2.1: optional `images` ride along (ImageContent[], same field on all behaviors).
 */
export function promptCommand(
  message: string,
  behavior?: PromptBehavior,
  images?: PromptImage[]
): { type: "prompt"; message: string; streamingBehavior?: PromptBehavior; images?: PromptImage[] } {
  return {
    type: "prompt",
    message,
    ...(behavior ? { streamingBehavior: behavior } : {}),
    ...(images?.length ? { images } : {}),
  };
}
