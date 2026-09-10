import { useEffect, useRef, useState } from "react";
import { EmojiChoice } from "./EmojiChoice";
import { PULSE_COPY as C } from "../sessionPulse";
import { pulseShape } from "../feedbackForm";

/**
 * §34 — "How is this session going?", once per session, ever.
 *
 * NOT a `Banner`: those carry three tones for things that are WRONG (a crash, a
 * red-zone context), and §20 refuses to let non-warnings through them. This is
 * an invitation, so it is its own row with its own copy record.
 *
 * The emoji, their labels and their order come from the published Session
 * Rating form, so reordering or relabelling the scale in Inlet changes what
 * renders here with no HappyVibe release.
 */

type Phase =
  | { k: "loading" }
  | { k: "ready"; form: HvFormDefinition; shape: NonNullable<ReturnType<typeof pulseShape>> }
  | { k: "invite" }
  | { k: "thanks" }
  | { k: "gone" };

const THANKS_MS = 2_000;

export function SessionPulse({
  sessionId,
  hidden,
  facts,
  onAsked,
  onDone,
  onOpenDialog,
}: {
  sessionId: string;
  /**
   * The agent is streaming — render nothing, but STAY MOUNTED.
   *
   * Unmounting instead was the first cut, and it shipped a bug the unit tests
   * could not see: the answered/dismissed state lives in this component, so the
   * next turn remounted it, showed the row again to someone who had just rated,
   * and re-stamped `pulseAskedAt`. Hiding is a render decision, not a lifecycle
   * one.
   */
  hidden: boolean;
  /** Read LAZILY, at tap time: the numbers must describe the session as it is when rated. */
  facts: () => HvSessionFacts;
  onAsked: () => void;
  /** Answered or dismissed — App remembers, so a later turn cannot bring it back. */
  onDone: () => void;
  onOpenDialog: () => void;
}): React.JSX.Element | null {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Asked-at-SHOW. Fired once, on first render, so a user who quits with the
   * row up is never asked again — the pulse's whole value is that it does not
   * become a nag.
   */
  useEffect(() => {
    onAsked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    void window.hv.feedbackPulseForm().then((r) => {
      if (!live) return;
      if (!r.ok) {
        setPhase({ k: "gone" });
        return;
      }
      const shape = pulseShape(r.form);
      setPhase(shape ? { k: "ready", form: r.form, shape } : { k: "invite" });
    });
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sessionId]);

  /** Sends nothing, logs nothing. It already counted as asked when it appeared. */
  const dismiss = (): void => {
    setPhase({ k: "gone" });
    onDone();
  };

  const pick = async (optionId: string, form: HvFormDefinition, questionId: string): Promise<void> => {
    setPhase({ k: "thanks" });
    onDone();
    timer.current = setTimeout(() => setPhase({ k: "gone" }), THANKS_MS);
    const r = await window.hv.feedbackPulseSend({ sessionId, formVersion: form.formVersion, questionId, optionId, session: facts() });
    // A failed rating is not worth a dialog: the user gave one tap, and the row
    // is already gone. It is in the console for a bug report and nowhere else.
    if (!r.ok) console.warn("[feedback] pulse send failed:", r.kind, r.message);
  };

  if (hidden || phase.k === "gone" || phase.k === "loading") return null;

  return (
    <div className="flex items-center gap-3 px-6 py-2 border-b-2 border-line bg-paper text-sm">
      {phase.k === "thanks" && <span className="font-bold">{C.thanks}</span>}
      {phase.k === "ready" && (
        <>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold">{C.question}</span>
            {/* Not decoration: the payload builder this describes is tested. */}
            <span className="text-xs text-ink-soft">{C.disclosure}</span>
          </div>
          <EmojiChoice size="sm" options={phase.shape.options} onPick={(id) => void pick(id, phase.form, phase.shape.questionId)} />
        </>
      )}
      {phase.k === "invite" && (
        <button type="button" onClick={onOpenDialog} className="font-semibold underline cursor-pointer">
          {C.invite}
        </button>
      )}
      {phase.k !== "thanks" && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={C.dismiss}
          title={C.dismiss}
          className="ml-auto text-ink-soft hover:text-ink cursor-pointer"
        >
          ✕
        </button>
      )}
    </div>
  );
}
