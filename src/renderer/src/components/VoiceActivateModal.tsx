import React from "react";

/**
 * §27/§3.2. First use — a small modal, not a settings page.
 *
 * It states the size, the one-time nature, and the privacy promise, and it
 * NEVER names the model (§12): attribution lives in the Voice page's licenses
 * block, so the product surface says "voice model" and nothing more.
 */
interface Props {
  open: boolean;
  /** "671 MB" — comes from the manifest so copy and download cannot drift. */
  size: string;
  onDownload: () => void;
  onMoreOptions: () => void;
  onClose: () => void;
}

export function VoiceActivateModal({
  open,
  size,
  onDownload,
  onMoreOptions,
  onClose,
}: Props): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-activate-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border-2 border-line-strong bg-card p-5 shadow-sticker-lg"
      >
        <h2 id="voice-activate-title" className="text-base font-bold flex items-center gap-2">
          <span aria-hidden>🎙️</span> Set up voice input
        </h2>
        <p className="mt-3 text-sm leading-relaxed">
          Voice input needs a <strong>{size}</strong> speech model. It runs entirely on your
          machine; your voice never leaves this computer.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          A one-time download. You can keep working while it finishes — the microphone becomes
          available when it is ready.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onMoreOptions}
            className="text-[13px] font-semibold text-ink-soft hover:text-ink px-3 py-2 rounded-xl hover:bg-paper-deep/40 cursor-pointer transition-colors"
          >
            More options
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-semibold px-3 py-2 rounded-xl hover:bg-paper-deep/40 cursor-pointer transition-colors"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="text-[13px] font-bold px-4 py-2 rounded-xl bg-sky-soft text-sky hover:brightness-95 cursor-pointer transition-all"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
