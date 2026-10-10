import { FAMILY_COPY } from "./toolSwitches";

/** §13 round 27 — the Images row and the generate_image prompt, as data (no DOM in the suite). */
export const IMAGES_ROW_COPY = {
  on: `${FAMILY_COPY.images.what} Each image costs money on your OpenRouter account. The prices below were measured once and are approximate; Session cost shows what OpenRouter actually charged.`,
  needsOpenRouter: "Needs an OpenRouter key or sign-in. Add one on",
} as const;

/** One test image's charge (tools/image-model-probe.mjs) — a guide, never a quote. */
export function fmtPerImage(usd: number): string {
  return `about $${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)} an image`;
}

export function imagePromptLines(
  s: { model: string; path: string },
  models: readonly { id: string; name: string; perImage?: number }[],
): string[] {
  const m = models.find((x) => x.id === s.model);
  const cost = typeof m?.perImage === "number" ? ` It costs money — ${fmtPerImage(m.perImage)}.` : " It costs money.";
  return [`This makes an image with ${m?.name ?? s.model} on your OpenRouter account.${cost}`, `It saves a new file: ${s.path}`];
}
