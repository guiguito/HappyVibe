/** §13 round 27 — the Images row and the generate_image prompt, as data (no DOM in the suite). */
export const IMAGES_ROW_COPY = {
  on: "Lets the agent make an image and save it as a new file in your project. Each image costs money on your OpenRouter account; Session cost shows what OpenRouter charged.",
  needsOpenRouter: "Needs an OpenRouter key or sign-in. Add one on",
} as const;

export function imagePromptLines(s: { model: string; path: string }, models: readonly { id: string; name: string }[]): string[] {
  const name = models.find((m) => m.id === s.model)?.name ?? s.model;
  return [`This makes an image with ${name} on your OpenRouter account. It costs money.`, `It saves a new file: ${s.path}`];
}
