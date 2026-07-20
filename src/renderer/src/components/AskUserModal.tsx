import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { AskAnswer, AskQuestion, AskUserInfo } from "../askUser";

/**
 * V2.B AskUserQuestion picker (PRD "Chat experience"). Blocking like
 * PermissionModal: never closes on escape/outside-click — the only ways out
 * are Submit (all questions answered) or the explicit Dismiss.
 *
 * Layout: >1 question → header-chip tabs; any option with a preview →
 * options list left + monospace preview pane right (single-select only,
 * bridge-enforced). The renderer ALWAYS appends a free-text "Other".
 */

interface QState {
  selected: string[];
  otherOn: boolean;
  other: string;
  note: string;
}

const emptyQ = (): QState => ({ selected: [], otherOn: false, other: "", note: "" });

const answered = (s: QState): boolean => s.selected.length > 0 || (s.otherOn && s.other.trim().length > 0);

const primaryBtn =
  "rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2.5 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-x-0 disabled:active:translate-y-0 disabled:active:shadow-sticker";
const ghostBtn =
  "rounded-xl bg-card text-ink font-bold text-sm px-5 py-2.5 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

function QuestionSection({
  q,
  state,
  onChange,
}: {
  q: AskQuestion;
  state: QState;
  onChange: (next: QState) => void;
}): React.JSX.Element {
  const [previewOf, setPreviewOf] = useState<string | null>(null);
  const hasPreview = q.options.some((o) => o.preview);
  // Preview pane shows the hovered option, else the selected one.
  const previewOpt =
    q.options.find((o) => o.label === previewOf && o.preview) ??
    q.options.find((o) => state.selected.includes(o.label) && o.preview) ??
    null;

  const pick = (label: string): void => {
    if (q.multiSelect) {
      const on = state.selected.includes(label);
      onChange({ ...state, selected: on ? state.selected.filter((l) => l !== label) : [...state.selected, label] });
    } else {
      onChange({ ...state, selected: [label], otherOn: false });
    }
  };
  const pickOther = (): void => {
    if (q.multiSelect) onChange({ ...state, otherOn: !state.otherOn });
    else onChange({ ...state, selected: [], otherOn: true });
  };

  const mark = (on: boolean): React.JSX.Element => (
    <span
      className={`mt-0.5 size-4 shrink-0 border-2 border-ink/80 flex items-center justify-center text-[10px] font-black ${
        q.multiSelect ? "rounded-[5px]" : "rounded-full"
      } ${on ? "bg-tangerine text-paper" : "bg-paper"}`}
    >
      {on ? "✓" : ""}
    </span>
  );

  return (
    <div>
      <p className="font-bold text-sm mb-3">{q.question}</p>
      <div className={hasPreview ? "flex gap-4 items-start" : ""}>
        <div className={`flex flex-col gap-2 ${hasPreview ? "w-1/2 shrink-0" : ""}`}>
          {q.options.map((o) => {
            const on = state.selected.includes(o.label);
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => pick(o.label)}
                onMouseEnter={() => setPreviewOf(o.label)}
                onMouseLeave={() => setPreviewOf(null)}
                className={`rounded-xl border-2 px-3.5 py-2.5 text-left shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                  on ? "border-tangerine-deep bg-honey-soft" : "border-line bg-card hover:bg-paper-deep"
                }`}
              >
                <span className="flex items-start gap-2.5">
                  {mark(on)}
                  <span className="min-w-0">
                    <span className="block font-bold text-sm leading-tight">{o.label}</span>
                    {o.description && <span className="block text-xs text-ink-soft mt-0.5">{o.description}</span>}
                  </span>
                </span>
              </button>
            );
          })}
          {/* Always-appended free-text "Other" — the model never sends one. */}
          <div
            className={`rounded-xl border-2 px-3.5 py-2.5 shadow-sticker cursor-pointer transition-all ${
              state.otherOn ? "border-tangerine-deep bg-honey-soft" : "border-line bg-card hover:bg-paper-deep"
            }`}
            onClick={() => !state.otherOn && pickOther()}
          >
            <span className="flex items-start gap-2.5">
              {mark(state.otherOn)}
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-sm leading-tight">Other</span>
                {state.otherOn && (
                  <input
                    autoFocus
                    value={state.other}
                    onChange={(e) => onChange({ ...state, other: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Type your own answer…"
                    className="mt-1.5 w-full font-mono text-xs rounded-lg border-2 border-line bg-paper px-2.5 py-1.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
                  />
                )}
              </span>
            </span>
          </div>
        </div>
        {hasPreview && (
          <pre className="flex-1 min-w-0 self-stretch font-mono text-xs bg-ink text-paper rounded-xl px-4 py-3 overflow-auto whitespace-pre-wrap break-words max-h-72">
            {previewOpt?.preview ?? "Hover an option to preview it."}
          </pre>
        )}
      </div>
      <input
        value={state.note}
        onChange={(e) => onChange({ ...state, note: e.target.value })}
        placeholder="Add a note (optional)"
        className="mt-3 w-full text-xs rounded-lg border-2 border-line bg-paper px-2.5 py-1.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
      />
    </div>
  );
}

export function AskUserModal({
  ask,
  onSubmit,
  onDismiss,
}: {
  ask: AskUserInfo;
  onSubmit: (answers: AskAnswer[]) => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const [states, setStates] = useState<QState[]>(() => ask.questions.map(emptyQ));
  const [active, setActive] = useState(0);
  const allAnswered = states.every(answered);
  const wide = ask.questions.some((q) => q.options.some((o) => o.preview));

  const submit = (): void =>
    onSubmit(
      ask.questions.map((q, i) => {
        const s = states[i];
        const labels = [...s.selected];
        const other = s.other.trim();
        if (s.otherOn && other) labels.push(other);
        const note = s.note.trim();
        return { question: q.question, header: q.header, answers: labels, ...(note ? { note } : {}) };
      }),
    );

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className={`hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${
            wide ? "w-[min(44rem,calc(100vw-3rem))]" : "w-[min(32rem,calc(100vw-3rem))]"
          } max-h-[calc(100vh-4rem)] overflow-y-auto rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-6 focus:outline-none`}
          // Blocking like permission prompts: only Submit or Dismiss get you out.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="size-10 rounded-xl bg-honey border-2 border-ink/80 flex items-center justify-center -rotate-3 shrink-0">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.33c-.55.21-.9.72-.9 1.31V14" />
                <circle cx="12" cy="17" r="0.5" fill="currentColor" />
              </svg>
            </div>
            <div className="min-w-0">
              <Dialog.Title className="font-bold text-lg leading-tight">The agent needs your call</Dialog.Title>
              {/* The model's intent — why it's asking. */}
              <Dialog.Description className="text-sm text-ink-soft">{ask.intent || "It has a question for you."}</Dialog.Description>
            </div>
          </div>

          {/* Header chips: tabs when >1 question, a plain chip otherwise. */}
          <div className="flex flex-wrap gap-1.5 mt-4 mb-4">
            {ask.questions.map((q, i) => (
              <button
                key={i}
                type="button"
                disabled={ask.questions.length === 1}
                onClick={() => setActive(i)}
                className={`rounded-full border-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  i === active ? "border-tangerine-deep bg-tangerine text-paper" : "border-line bg-paper text-ink-soft"
                } ${ask.questions.length > 1 ? "cursor-pointer" : ""}`}
              >
                {q.header}
                {answered(states[i]) && " ✓"}
              </button>
            ))}
          </div>

          <QuestionSection
            key={active}
            q={ask.questions[active]}
            state={states[active]}
            onChange={(next) => setStates((p) => p.map((s, i) => (i === active ? next : s)))}
          />

          {/* One primary button: it advances ("Next") until the last question,
              then submits ("Submit"). Disabled until the info it needs is filled —
              the current question for Next, every question for Submit. */}
          {(() => {
            const isLast = active === ask.questions.length - 1;
            return (
              <div className="flex items-center justify-between mt-5">
                <button type="button" className={ghostBtn} onClick={onDismiss}>
                  Dismiss
                </button>
                {isLast ? (
                  <button type="button" className={primaryBtn} disabled={!allAnswered} onClick={submit}>
                    Submit
                  </button>
                ) : (
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={!answered(states[active])}
                    onClick={() => setActive(active + 1)}
                  >
                    Next
                  </button>
                )}
              </div>
            );
          })()}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
