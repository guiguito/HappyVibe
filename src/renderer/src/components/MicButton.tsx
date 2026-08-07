import React from "react";

/**
 * §27/§3.1. The composer's microphone chip, in five states.
 *
 * Same `shrink-0 … rounded-full px-2.5 py-1.5` idiom as the Plan toggle beside
 * it, so the control row reads as one row of chips.
 */
export type MicState = "unactivated" | "downloading" | "ready" | "recording" | "transcribing";

interface Props {
  state: MicState;
  /** 0..1, only meaningful while downloading. */
  progress?: number;
  /** 0..1 RMS, only meaningful while recording. */
  level?: number;
  onClick: () => void;
  /** Shown in the tooltip so the gesture is discoverable without the docs. */
  hint?: string;
}

function MicGlyph(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

/** A ring that fills clockwise. Plain SVG — no chart dependency for one arc. */
function ProgressRing({ value }: { value: number }): React.JSX.Element {
  const r = 9;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <circle cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <circle
        cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} transform="rotate(-90 11 11)"
      />
    </svg>
  );
}

const LABEL: Record<MicState, string> = {
  unactivated: "Set up voice input",
  downloading: "Downloading the voice model — click for details",
  ready: "Dictate",
  recording: "Recording — click to stop, Escape to discard",
  transcribing: "Transcribing…",
};

export function MicButton({ state, progress = 0, level = 0, onClick, hint }: Props): React.JSX.Element {
  const base = "shrink-0 flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-1.5 transition-colors";

  const tone =
    state === "recording"
      ? "bg-rose-soft text-rose"
      : state === "ready"
        ? "text-ink-soft hover:bg-paper-deep/40 hover:text-ink"
        : state === "unactivated"
          ? // Styled as unavailable, but LIVE — see the `disabled` note below.
            "text-ink-soft/45 hover:bg-paper-deep/30 hover:text-ink-soft"
          : "text-ink-soft";

  return (
    <button
      type="button"
      // §3.1: this must NEVER carry the HTML `disabled` attribute, not even in
      // the unactivated state. A disabled button swallows click events, and the
      // whole activation flow depends on that first click being received. The
      // one genuinely inert state is `transcribing`, which is inert because
      // there is nothing to click, and it uses aria-disabled + a no-op.
      aria-disabled={state === "transcribing" || undefined}
      aria-pressed={state === "recording"}
      aria-label={LABEL[state]}
      title={hint ? `${LABEL[state]} — ${hint}` : LABEL[state]}
      onClick={() => {
        if (state === "transcribing") return;
        onClick();
      }}
      className={`${base} ${tone} ${state === "transcribing" ? "cursor-default" : "cursor-pointer"}`}
    >
      {state === "downloading" ? (
        <ProgressRing value={progress} />
      ) : state === "transcribing" ? (
        <span
          aria-hidden
          className="size-3 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      ) : (
        <MicGlyph />
      )}

      {state === "recording" && (
        // A real level meter, driven by the worklet's RMS. Without it a user
        // cannot tell a dead microphone from a slow model — the largest
        // reported support burden across shipping dictation products.
        <span aria-hidden className="flex items-end gap-[2px] h-3 w-6">
          {[0.35, 0.7, 1, 0.7, 0.35].map((w, i) => (
            <span
              key={i}
              className="flex-1 rounded-full bg-current"
              style={{ height: `${Math.max(12, Math.min(100, level * w * 320))}%` }}
            />
          ))}
        </span>
      )}
    </button>
  );
}
