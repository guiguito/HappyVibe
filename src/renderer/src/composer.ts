/**
 * W2.1 chat-bar logic (pure, vitest-importable).
 *
 * Model hierarchy (PRD "Providers & models"): session → workspace → global.
 * The same resolution runs main-side at spawn (ipc.ts spawnOpts) — kept in
 * sync by hand like hv.d.ts (separate tsconfig roots).
 */

import { documentFamily, isDocumentPath } from "../../../pi-runtime/extensions/hv-document";

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
 * Drop a model ref whose provider no longer exists (a deleted custom endpoint,
 * PRD §16 2026-07-30) so tier resolution falls through to the default instead
 * of pinning a session to a provider Pi cannot load.
 *
 * An EMPTY `known` list means "model list not loaded yet", not "everything is
 * gone" — returning null there would silently reset every session at startup.
 *
 * Mirrored in main: ipc.ts spawnOpts. Change both or neither.
 */
export function dropUnknownProvider(
  ref: ModelRef | null | undefined,
  known: string[]
): ModelRef | null {
  if (!ref) return null;
  if (known.length === 0) return ref;
  return known.includes(ref.provider) ? ref : null;
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

/** True for the file types the composer will attach. Non-images are ignored
 *  rather than refused: pasting a screenshot alongside text is normal, and the
 *  text half must still land. */
/**
 * §31: a document the user attached. Same shape main's DocumentChip returns, on
 * purpose — the IPC hands one straight over, so a second shape would be a
 * translation layer with nothing to translate.
 */
export type DocumentAttachment = HvDocumentChip & {
  /**
   * Still converting. The chip is on screen with its name and a spinner, and
   * the size arrives when main answers — the alternative was an empty composer
   * for however long the conversion took.
   */
  pending?: boolean;
};

/** The app's chars→tokens rule, the same one the context panel uses. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function documentSize(n: number): string {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What the composer chip says BEFORE send — §9's cost promise, one surface
 * earlier (decision B).
 *
 * No page count: none exists on a successful conversion (docs/validation/ad1.md
 * §3.1). When the document could not be converted the chip shows the SENTENCE
 * instead of a size, so the user reads the same words the model will.
 */
export function documentChipLabel(d: DocumentAttachment): string {
  // A pending chip says only what is known: the file name. The spinner beside
  // it carries "working", so the label must not invent a size to fill space.
  if (d.pending) return d.name;
  // A failed document is NOT a chip — its message goes to the composer's notice
  // line, in full (documentErrorUserMessage). A chip truncates at a fixed
  // width, so a red pill was an unreadable sentence and no way to act on it.
  return [
    d.name,
    documentFamily(d.format),
    `${documentSize(d.bytes)} as Markdown (~${Math.round(estimateTokens(d.bytes) / 1000)}k tokens)`,
  ].join(" · ");
}

/**
 * The document files in a drop or paste, as OS paths.
 *
 * Non-documents are skipped rather than refused, exactly like the image path
 * above: dropping a folder of mixed files should attach what it can.
 */
export function filesToDocumentPaths(files: ArrayLike<File>, pathOf: (f: File) => string): string[] {
  return Array.from(files)
    .filter((f) => isDocumentPath(f.name))
    .map(pathOf)
    .filter((p) => !!p);
}

export function isAttachableImage(file: { type?: string }): boolean {
  return typeof file.type === "string" && file.type.startsWith("image/");
}

/**
 * §7 round 12 — a pasted or dropped image becomes an ordinary attachment.
 *
 * Attaching used to be the "+" file picker only, which is the one path that
 * needs a trip through main; a File already in the renderer just needs its
 * bytes. Returns null for anything that is not an image, so callers can map
 * over a whole DataTransfer without filtering twice.
 */
export async function fileToAttachment(file: File): Promise<ImageAttachment | null> {
  if (!isAttachableImage(file)) return null;
  const buf = new Uint8Array(await file.arrayBuffer());
  // btoa over a big string blows the argument limit, so chunk it.
  let binary = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return { data: btoa(binary), mimeType: file.type, name: file.name || "pasted image" };
}

/** Every image in a paste/drop, in order. Non-images are skipped. */
export async function filesToAttachments(files: ArrayLike<File>): Promise<ImageAttachment[]> {
  const out = await Promise.all(Array.from(files).map(fileToAttachment));
  return out.filter((a): a is ImageAttachment => a !== null);
}
