import React from "react";
import { createPortal } from "react-dom";

/**
 * §27, feedback round 2. The recording indicator, as a bottom-centre overlay.
 *
 * The level meter used to live inside the composer chip, where it was both hard
 * to read and a permanent tax on the width of the control row. It moves here:
 * one glowing element, centred, big enough to see from across the room.
 *
 * TWO placements, because one cannot serve both cases.
 *
 * `docked` (the normal one): in flow above the composer, inside the chat pane.
 * It has to be the default because the alternative is viewport-fixed, and a
 * viewport-fixed overlay overlaps a browser pane in another split — which does
 * not merely look wrong. A WebContentsView composites ABOVE the DOM, so
 * BrowserTab hides the whole page whenever an overlay crosses it (see its
 * coverage note). Docked, the pill lives inside this pane's box and can never
 * cross one: a pane shows chat OR a browser, never both.
 *
 * Undocked: PORTALLED TO document.body, and the portal is not optional there.
 * `position: fixed` is not enough — App gives each pane `display: none` when
 * the active view is not "chat", and a display:none ancestor collapses a fixed
 * child to 0x0 (measured). Without it a live recording became invisible the
 * moment you opened a settings page, and with the chip hidden there would be no
 * indicator anywhere. A hot microphone with no feedback is the exact failure
 * this component exists to prevent — the mic keeps running while the pane is
 * hidden, because ChatView stays MOUNTED. So the fallback covers exactly the
 * case where docking cannot work, and only that case.
 *
 * Several ChatViews are mounted at once (one per chat tab) and only one can be
 * recording, which `useDictation`'s exclusivity token enforces rather than
 * leaves to luck — so exactly one overlay can exist.
 *
 * The glow is driven by the same RMS the worklet already posts at ~30 Hz, so it
 * moves with the voice. That is load-bearing rather than decorative: it is the
 * only thing distinguishing "the microphone is dead" from "the model is slow".
 */
interface Props {
  open: boolean;
  /** 0..1 RMS. Drives the glow and the ring. */
  level: number;
  /** Stop and transcribe. Same action as a second tap. */
  onStop: () => void;
  /** True between stop and the transcript arriving. */
  transcribing?: boolean;
  /** This chat pane is on screen — sit above its composer instead of the viewport. */
  docked?: boolean;
}

export function VoiceOverlay({ open, level, onStop, transcribing = false, docked = false }: Props): React.JSX.Element | null {
  if (!open && !transcribing) return null;

  // Speech peaks around 0.1-0.3 RMS, so scale generously and clamp. `soft` is
  // the eased value the glow uses; the ring uses it too so the two agree.
  const soft = Math.max(0, Math.min(1, level * 3.2));
  const glow = 18 + soft * 46;
  const ring = 1 + soft * 0.22;

  const pill = (
    <div
      // pointer-events-none on the wrapper so the overlay never swallows a click
      // meant for the transcript underneath; the button re-enables its own.
      //
      // Neither variant spans the width. The old one did (`inset-x-0` + a
      // centring flex) and its BOUNDING BOX is what BrowserTab's rectangle check
      // reads — so a pill painted in the middle of the screen "overlapped" a
      // browser pane off in the corner and blanked it. Shrink-to-fit, so the box
      // is the thing you can actually see.
      className={
        docked
          ? "absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-40 pointer-events-none"
          : "fixed bottom-10 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      }
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onStop}
        disabled={transcribing}
        aria-label={transcribing ? "Transcribing…" : "Stop recording"}
        className={`pointer-events-auto flex items-center gap-3 rounded-full border-2 px-5 py-3 backdrop-blur-md transition-colors ${
          transcribing
            ? "border-line-strong bg-card/80 cursor-default"
            : "border-rose/40 bg-rose-soft/70 cursor-pointer hover:bg-rose-soft/90"
        }`}
        style={
          transcribing
            ? undefined
            : {
                // A real glow, sized by the voice. Two shadows: a tight rim and
                // a wide bloom, so it reads as light rather than as a border.
                boxShadow: `0 0 ${glow * 0.5}px rgba(225,90,110,0.55), 0 0 ${glow}px rgba(225,90,110,0.28)`,
              }
        }
      >
        <span className="relative flex items-center justify-center size-7 shrink-0">
          {!transcribing && (
            // The pulsing ring, scaled by level. aria-hidden: the label says it.
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-rose/25"
              style={{ transform: `scale(${ring})`, transition: "transform 60ms linear" }}
            />
          )}
          {transcribing ? (
            <span
              aria-hidden
              className="size-4 rounded-full border-2 border-ink-soft border-t-transparent animate-spin"
            />
          ) : (
            // Translucent mic, so the glow reads through it.
            <svg
              width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              className="relative text-rose/80" aria-hidden
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          )}
        </span>

        <span className="text-left">
          <span className={`block text-[13px] font-bold ${transcribing ? "text-ink-soft" : "text-rose"}`}>
            {transcribing ? "Transcribing…" : "Listening…"}
          </span>
          {!transcribing && (
            <span className="block text-[11px] font-medium text-ink-soft">
              Click to stop · Esc to cancel
            </span>
          )}
        </span>
      </button>
    </div>
  );

  return docked ? pill : createPortal(pill, document.body);
}
