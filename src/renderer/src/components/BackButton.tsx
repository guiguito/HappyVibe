import { forwardRef } from "react";

/** The one back glyph (a chevron-left). BrowserTab's toolbar draws it inside its own BarButton. */
export const BACK_PATH = "M15 18l-6-6 6-6";

/**
 * Every in-app back control (2026-10-10): an icon, no text. `label` is BOTH the tooltip and the
 * accessible name. No `absolute`/`fixed`: the browser-coverage check reads those as overlays.
 * The ring is keyboard-only (`focus-visible`) and INSET, so a scroll box can't clip half of it.
 */
export const BackButton = forwardRef<HTMLButtonElement, { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; className?: string }>(
  function BackButton({ label, onClick, disabled, className = "" }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:text-ink hover:bg-paper-deep cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tangerine disabled:opacity-40 disabled:cursor-default ${className}`}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={BACK_PATH} />
        </svg>
      </button>
    );
  },
);
