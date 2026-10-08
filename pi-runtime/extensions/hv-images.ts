/**
 * §13 round 27 — generate_image. Pure and IMPORT-FREE: the bridge, main, the renderer and the
 * provider-catalog generator all read it, and the renderer must never reach Node.
 */
export const IMAGE_TOOL = "generate_image";

export interface ImageModelInfo { id: string; name: string; input: number; output: number }

/**
 * Pi prices an image call from its catalogue (pi-ai api/openrouter-images.js), not from what
 * OpenRouter charges. Only a model with BOTH rates can show a real cost; at Pi 1.0.2, 39 of
 * the 59 are $0 there (billed per image) and would read as free — §19 ruling 3 forbids that.
 */
export function isPricedImageModel(m: { cost?: { input?: number; output?: number } }): boolean {
  const i = m.cost?.input;
  const o = m.cost?.output;
  return typeof i === "number" && typeof o === "number" && i > 0 && o > 0;
}

/** Cheapest first: the output rate (an image is billed as output), then input, then id. */
export function byPrice(a: ImageModelInfo, b: ImageModelInfo): number {
  return a.output - b.output || a.input - b.input || a.id.localeCompare(b.id);
}

/** The session's model: the user's choice while it is still priced, else the cheapest. Never invented. */
export function resolveImageModel(models: readonly ImageModelInfo[], stored: string | undefined): string | null {
  if (stored && models.some((m) => m.id === stored)) return stored;
  return [...models].sort(byPrice)[0]?.id ?? null;
}
