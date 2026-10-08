/**
 * A picture the renderer shows, as bytes — for its zoom view's Copy and Save… (§7). Pure, so the
 * renderer-to-main trust boundary is tested: only a raster image data URL gets through (no
 * http, no file://, no SVG — nativeImage can't paste it and it can carry script).
 */
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function parseImageDataUrl(url: unknown): { mime: string; ext: string; bytes: Buffer } | null {
  if (typeof url !== "string") return null;
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m || !EXT[m[1]]) return null;
  const bytes = Buffer.from(m[2], "base64");
  return bytes.length ? { mime: m[1], ext: EXT[m[1]], bytes } : null;
}
