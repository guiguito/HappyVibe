import { useEffect, useState } from "react";

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
 */
export function ZoomableImage({ src, alt = "image" }: { src: string; alt?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-8 cursor-zoom-out"
        >
          <img src={src} alt={`${alt} (zoomed)`} className="max-h-full max-w-full rounded-xl shadow-2xl" />
        </div>
      )}
    </>
  );
}
