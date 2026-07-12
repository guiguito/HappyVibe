/**
 * W2.1 chat-bar logic (pure, vitest-importable).
 *
 * Model hierarchy (PRD "Providers & models"): session → workspace → global.
 * The same resolution runs main-side at spawn (ipc.ts spawnOpts) — kept in
 * sync by hand like hv.d.ts (separate tsconfig roots).
 */

export interface ModelRef {
  provider: string;
  modelId: string;
}

/** Attached image, as returned by hv:pick-image (base64, no data: prefix). */
export interface ImageAttachment {
  data: string;
  mimeType: string;
  name: string;
}

/** RPC ImageContent — the `images` element shape for prompt/steer (docs/rpc.md). */
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** Which tier of the hierarchy won the resolution (V2.A: chip subtext). */
export type ModelTier = "session" | "workspace" | "global";

export function resolveModelTier(
  session: ModelRef | null | undefined,
  workspace: ModelRef | null | undefined,
  global: ModelRef | null | undefined
): { ref: ModelRef; tier: ModelTier } | null {
  if (session) return { ref: session, tier: "session" };
  if (workspace) return { ref: workspace, tier: "workspace" };
  if (global) return { ref: global, tier: "global" };
  return null;
}

export function resolveModel(
  session: ModelRef | null | undefined,
  workspace: ModelRef | null | undefined,
  global: ModelRef | null | undefined
): ModelRef | null {
  return resolveModelTier(session, workspace, global)?.ref ?? null;
}

/**
 * True iff the resolved model accepts image input (Model.input includes
 * "image"). Unknown model / no list yet → false: the honest default is a
 * disabled attach button, never a send that the provider will reject.
 */
export function supportsVision(
  models: Array<{ provider: string; id: string; input?: string[] }> | null,
  ref: ModelRef | null
): boolean {
  if (!models || !ref) return false;
  const m = models.find((x) => x.provider === ref.provider && x.id === ref.modelId);
  return m?.input?.includes("image") ?? false;
}

/** Attachments → the RPC `images` param (ImageContent[]). */
export function buildImages(attachments: ImageAttachment[]): ImageContent[] {
  return attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType }));
}

/** Renderable data URL for a thumbnail chip / transcript bubble. */
export function attachmentUrl(a: { data: string; mimeType: string }): string {
  return `data:${a.mimeType};base64,${a.data}`;
}
