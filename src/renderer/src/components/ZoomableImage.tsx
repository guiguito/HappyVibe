import { useEffect, useState } from "react";
import { ipcMessage } from "../ipcError";

/**
 * Click-to-zoom image + lightbox overlay (feedback round 3 #6).
 *
 * §7 round 12 moved this out of Transcript.tsx: images now appear in three
 * places — a user's attachment, a restored attachment, and a tool result's
 * screenshot — and the third lives in ToolCard, which Transcript imports.
 * Importing back would have been a cycle, so the component owns its own file
 * and there is still exactly ONE lightbox for every image in the app.
 *
 * `src` is always a data URL: the renderer's CSP is `img-src 'self' data:`, so
 * an http(s) or file:// source renders as nothing at all.
 *
 * The open view offers Copy and Save… for whatever it shows — main does both (a real image on
 * the clipboard, a save dialog), because the renderer can't write files and a JPEG can't go
 * through the web clipboard API as-is.
 */
export const ZOOM_ACTIONS = { copy: "Copy", copied: "Copied", save: "Save…" } as const;

export function ZoomableImage({ src, alt = "image" }: { src: string; alt?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (e: React.MouseEvent, run: () => Promise<unknown>): void => {
    e.stopPropagation(); // a click on a button must not close the view
    setError(null);
    run().catch((err: unknown) => setError(ipcMessage(err)));
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        className="max-h-24 max-w-40 rounded-lg border-2 border-paper/60 object-cover cursor-zoom-in"
      />
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/80 p-8 cursor-zoom-out"
        >
          <img src={src} alt={`${alt} (zoomed)`} className="hv-dialog-flow max-h-full max-w-full rounded-xl shadow-2xl" />
          <div className="absolute top-4 right-4 flex items-center gap-2 cursor-default" onClick={(e) => e.stopPropagation()}>
            {error && <span className="rounded-lg bg-berry-soft px-2 py-1 text-xs font-semibold text-berry">{error}</span>}
            <button
              type="button"
              onClick={(e) =>
                act(e, async () => {
                  await window.hv.imageCopy(src);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
              className="rounded-full border-2 border-paper/70 bg-card px-3 py-1 text-sm font-bold text-ink hover:border-paper cursor-pointer"
            >
              {copied ? ZOOM_ACTIONS.copied : ZOOM_ACTIONS.copy}
            </button>
            <button
              type="button"
              onClick={(e) => act(e, () => window.hv.imageSaveAs(src, alt))}
              className="rounded-full border-2 border-paper/70 bg-card px-3 py-1 text-sm font-bold text-ink hover:border-paper cursor-pointer"
            >
              {ZOOM_ACTIONS.save}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
