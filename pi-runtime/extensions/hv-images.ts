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

export const IMAGE_TOOL_DESCRIPTION =
  "Generate one image from a text prompt and save it as a new file in the workspace. It costs money on the user's OpenRouter account; the user picked the model.";

interface Cost { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: Cost }
interface ImagesReply {
  stopReason: string;
  errorMessage?: string;
  output: Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
  usage?: Usage;
  /** OpenRouter's own charge for this request (`usage.cost` in its response), when it reported one. */
  charged?: number;
}
type Block = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ImageToolResult { content: Block[]; details: Record<string, unknown>; usage?: Usage }

/**
 * Pi prices image output at the model's TEXT rate — 12–20× under what OpenRouter bills
 * (docs/validation/im1.md). So the total is OpenRouter's, split in Pi's proportions (OpenRouter
 * reports only a total). No reported charge → cost zeroed: the ledger then reads "$?" (§19
 * ruling 3) instead of a confident figure that is wrong by an order of magnitude.
 */
export function withCharge(u: Usage | undefined, charged: number | undefined): Usage | undefined {
  if (!u) return undefined;
  const zero: Cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  if (typeof charged !== "number" || !(charged > 0)) return { ...u, cost: zero };
  const t = u.cost?.total ?? 0;
  if (!(t > 0)) return { ...u, cost: { ...zero, output: charged, total: charged } };
  const k = charged / t;
  const c = u.cost;
  return { ...u, cost: { input: c.input * k, output: c.output * k, cacheRead: c.cacheRead * k, cacheWrite: c.cacheWrite * k, total: charged } };
}

/**
 * The whole tool, minus Pi and main: `generate` is ctx.modelRegistry.generateImages (plus the
 * charge OpenRouter reported), `save` is the blocking hv.image-save envelope (MAIN writes —
 * path-confined, never overwriting). The image is ALWAYS returned: the card draws it, and pi-ai
 * replaces it for a model that can't see images ("(tool image omitted…)",
 * transform-messages.js), which leaves that model the path. `usage` rides every outcome where
 * the image was generated, because it was paid for.
 */
export async function runImageTool(d: {
  modelId: string;
  prompt: string;
  path: string;
  generate: (prompt: string) => Promise<ImagesReply | { error: string }>;
  save: (p: { path: string; mimeType: string; data: string; model: string }) => Promise<unknown>;
}): Promise<ImageToolResult> {
  const details = { provider: "openrouter", model: d.modelId, path: d.path };
  const say = (text: string, usage?: Usage): ImageToolResult => ({ content: [{ type: "text", text }], details, ...(usage ? { usage } : {}) });
  const r = await d.generate(d.prompt);
  if ("error" in r) return say(r.error);
  const usage = withCharge(r.usage, r.charged);
  if (r.stopReason !== "stop") return say(`The image model failed: ${r.errorMessage ?? r.stopReason}`, usage);
  const img = r.output.find((b) => b.type === "image" && b.data);
  if (!img?.data) {
    const words = r.output.filter((b) => b.type === "text" && b.text).map((b) => b.text).join(" ").trim();
    return say(`The image model returned no image${words ? `: ${words}` : "."}`, usage);
  }
  const mimeType = img.mimeType ?? "image/png";
  const raw = await d.save({ path: d.path, mimeType, data: img.data, model: d.modelId });
  let ans: { ok?: boolean; path?: string; error?: string } = {};
  try {
    ans = typeof raw === "string" ? JSON.parse(raw) : {};
  } catch {
    /* answered below */
  }
  if (ans.ok === false) return say(ans.error ?? "HappyVibe could not save the image.", usage);
  if (ans.ok !== true) return say("HappyVibe could not save the image.", usage);
  const saved = ans.path ?? d.path;
  return {
    content: [{ type: "text", text: `Saved the image to ${saved}.` }, { type: "image", data: img.data, mimeType }],
    details: { ...details, path: saved },
    ...(usage ? { usage } : {}),
  };
}

/** Main's side of the envelope. Payload on `title` because this is an INPUT. */
export function parseImageSave(r: { method?: string; title?: string }): { path: string; mimeType: string; data: string; model: string } | null {
  if (r.method !== "input") return null;
  try {
    const p = JSON.parse(r.title ?? "") as Record<string, unknown>;
    if (p.kind !== "hv.image-save" || typeof p.path !== "string" || typeof p.data !== "string") return null;
    return { path: p.path, mimeType: typeof p.mimeType === "string" ? p.mimeType : "image/png", data: p.data, model: typeof p.model === "string" ? p.model : "" };
  } catch {
    return null;
  }
}
