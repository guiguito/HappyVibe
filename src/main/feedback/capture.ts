import type { NativeImage } from "electron";

/**
 * §34 — the "attach a picture of this window" capture.
 *
 * Inlet's decoded-pixel ceiling (limits.ts attachmentMaxPixels). A 6K display at
 * 2× exceeds it, and a rejected upload would cost the user their whole report.
 */
export const MAX_PIXELS = 25_000_000;

/**
 * The dialog shows a thumbnail of the EXACT image that will be sent, so the user
 * agrees to something they have seen. The renderer CSP is `img-src 'self' data:`
 * with no `blob:`, so it travels as a data: URL — keep it small.
 */
export const THUMB_WIDTH = 400;

/** Pure: the largest same-aspect size inside a pixel budget. */
export function fitWithin(w: number, h: number, maxPixels: number): { width: number; height: number } {
  const W = Math.max(1, Math.floor(w));
  const H = Math.max(1, Math.floor(h));
  if (W * H <= maxPixels) return { width: W, height: H };
  const k = Math.sqrt(maxPixels / (W * H));
  return { width: Math.max(1, Math.floor(W * k)), height: Math.max(1, Math.floor(H * k)) };
}

export interface Capture {
  png: Buffer;
  width: number;
  height: number;
  /** data:image/png;base64,… — see THUMB_WIDTH for why it is not a blob URL. */
  thumbnail: string;
}

/**
 * Captured at OPEN, before the dialog paints — what the user was looking at when
 * they decided to give feedback, which is the moment that matters. No frame
 * timing games, no hide-then-shoot.
 *
 * Held in memory by the caller and dropped when the dialog closes: never written
 * to disk, never uploaded unless the box is ticked.
 *
 * Known limit, accepted in the PRD: `capturePage` renders the window's own web
 * contents, so an embedded browser pane (its own WebContentsView) appears as its
 * blank placeholder. `desktopCapturer` would capture real pixels but costs a
 * macOS Screen Recording permission prompt — the wrong trade for a feedback form.
 */
export async function captureWindow(win: { webContents: { capturePage(): Promise<NativeImage> } }): Promise<Capture> {
  let img = await win.webContents.capturePage();
  const size = img.getSize();
  const fit = fitWithin(size.width, size.height, MAX_PIXELS);
  if (fit.width !== size.width) img = img.resize({ width: fit.width, height: fit.height, quality: "good" });
  const thumb = img.resize({ width: Math.min(THUMB_WIDTH, fit.width), quality: "good" });
  return {
    png: img.toPNG(),
    width: fit.width,
    height: fit.height,
    thumbnail: `data:image/png;base64,${thumb.toPNG().toString("base64")}`,
  };
}
