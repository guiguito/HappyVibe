import { useEffect, useRef } from "react";
import { GUIDE_COPY } from "../docsLinks";

/**
 * Docs in the app (2026-09-29): the user guide as a page of the app. It takes the whole window —
 * no bar of our own: the guide's header already carries the HappyVibe brand, so all that is added
 * is one large circled cross at the top right, which closes the page.
 *
 * An iframe and not a browser pane on purpose: a pane is a native view that paints above every
 * dialog and permission prompt, and an iframe is plain DOM. The renderer CSP allows exactly one
 * frame origin (index.html); main sends any link that would leave the guide to the system browser
 * (`frameNavAction`). Offline the frame is blank, and the cross is the way out.
 *
 * Esc closes it too. With focus in the app that is a plain keydown (skipped when a dialog already used
 * the key); with focus INSIDE the frame the app never sees the key, so main forwards it and this acts
 * only when the frame holds focus.
 *
 * `nonce` is the frame's key: opening a deep link again reloads it, even when the address is the
 * same one the reader has since clicked away from.
 */
export function GuideView({ url, nonce, onClose }: { url: string; nonce: number; onClose: () => void }): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    const off = window.hv.onEscapeKey(() => {
      if (document.activeElement === frame.current) onClose();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, [onClose]);
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <iframe
        ref={frame}
        key={nonce}
        title={GUIDE_COPY.title}
        src={url}
        sandbox="allow-scripts allow-same-origin"
        className="flex-1 min-h-0 w-full bg-paper"
      />
      {/* right-6 clears the frame's own scrollbar; z-10 keeps it above the guide's sticky header. */}
      <button
        type="button"
        onClick={onClose}
        title={GUIDE_COPY.close}
        aria-label={GUIDE_COPY.close}
        className="absolute top-3 right-6 z-10 flex size-11 rounded-full items-center justify-center border-2 border-line-strong bg-card text-ink shadow-sticker hover:bg-paper-deep cursor-pointer"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
