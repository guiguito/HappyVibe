import { useEffect, useState, type ReactNode } from "react";

/**
 * One expandable row: a switch, a read-only prompt, and an append box.
 *
 * Extracted from BuiltinToolsBlock (§13 round 6) when §19's "On your behalf"
 * page needed the SAME shape for the three model calls the app makes without a
 * session. Two pages, one row — a second copy would drift, and the thing that
 * drifts here is the sentence explaining why the prompt cannot be edited.
 *
 * The rule this row exists to express (PRD §13 round 6): **the built-in prompt
 * is shown read-only, in full, with an append box — never an override.** Seeing
 * the real prompt is the educational point, the same promise as the context
 * panel. And on both pages the consumer PARSES what comes back, so a rewritten
 * prompt breaks that parse silently and reads to the user as "it stopped
 * working".
 *
 * The prompt is fetched LAZILY, once, on first expand — a page of these must
 * not cost N IPC round-trips at mount for text nobody has asked to see.
 */

/**
 * §19: fired when an assistant task's switch/model/append changes.
 *
 * Surfaces that read those settings can outlive a trip to Settings — the
 * Changes panel does — so a plain refetch-on-mount leaves a control showing a
 * state the app no longer has. Declared here, beside the row that changes them,
 * so both sides spell it the same way.
 */
export const ASSISTANT_TASKS_CHANGED = "hv:assistant-tasks-changed";

/** The one statement of the append-never-override rule. Exported so a test can
    pin that it exists in exactly one place. */
export const APPEND_HELP =
  "The built-in prompt above can't be edited — it's shown so you can see exactly what the agent is told. Your " +
  'additions are appended after it. Add preferences (e.g. \'always list affected files\'), not contradictions.';

export function TogglePill({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm ${
        disabled
          ? "cursor-not-allowed opacity-50 bg-card text-ink-soft border-line"
          : `cursor-pointer ${on ? "bg-leaf text-paper border-leaf" : "bg-card text-ink border-line hover:border-leaf"}`
      }`}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

export function PromptRow({
  title,
  subtitle,
  on,
  onToggle,
  toggleDisabled,
  loadPrompt,
  promptNote,
  append,
  onSaveAppend,
  error,
  right,
}: {
  title: string;
  subtitle: ReactNode;
  on: boolean;
  /** Called with the state the user asked for. The caller decides — Plan mode
      confirms before turning off, the assistant tasks just save. */
  onToggle: (next: boolean) => void;
  toggleDisabled?: boolean;
  /** Fetched once, on first expand. */
  loadPrompt: () => Promise<string>;
  /** What is substituted into the prompt at call time (a diff, a message). */
  promptNote?: string;
  /** Omit BOTH of these for a read-only row with no append box. */
  append?: string;
  onSaveAppend?: (value: string) => Promise<void>;
  error?: string | null;
  /** Rendered left of the switch — the model picker, on the §19 page. */
  right?: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptError, setPromptError] = useState(false);
  const [draft, setDraft] = useState(append ?? "");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open && prompt === null && !promptError) {
      loadPrompt()
        .then(setPrompt)
        .catch(() => setPromptError(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prompt, promptError]);

  // The append arriving late (the page loads its config after mount) must reach
  // the box — but never over something the user has already typed.
  useEffect(() => {
    if (!dirty) setDraft(append ?? "");
  }, [append, dirty]);

  const save = async (): Promise<void> => {
    if (!onSaveAppend) return;
    setSaveError(null);
    try {
      await onSaveAppend(draft);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      // Don't leave an optimistic pill standing over a write that failed.
      setSaveError(e instanceof Error ? e.message : "Could not save.");
    }
  };

  return (
    <div className="border-b border-line last:border-b-0">
      {/* A row WITHOUT a picker keeps the original single line (All Tools).
          A row WITH one drops the controls to their own line: measured in the
          running app, a 224px picker plus the switch left 190px of a 524px row
          for the text, which wrapped two sentences to four words a line. */}
      <div className={`w-full px-4 py-3 ${right ? "" : "flex items-center gap-3"}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`${right ? "w-full" : "flex-1 min-w-0"} text-left flex items-start gap-2.5 cursor-pointer`}
        >
          <span className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-90" : ""} leading-6`}>›</span>
          <span className="min-w-0">
            <span className="font-bold block">{title}</span>
            <span className="text-xs text-ink-soft">{subtitle}</span>
          </span>
        </button>
        {right ? (
          <div className="mt-2 flex items-center justify-end gap-3">
            {right}
            <TogglePill on={on} disabled={toggleDisabled} onClick={() => onToggle(!on)} />
          </div>
        ) : (
          <TogglePill on={on} disabled={toggleDisabled} onClick={() => onToggle(!on)} />
        )}
      </div>
      {(error || saveError) && (
        <p className="px-4 pb-2 -mt-1 text-xs font-semibold text-berry">{error ?? saveError}</p>
      )}

      {open && (
        <div className="px-4 pb-4 pt-0 flex flex-col gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-2">
              built-in prompt (read-only)
            </div>
            {promptError ? (
              <p className="text-sm text-berry">Could not load the built-in prompt.</p>
            ) : prompt === null ? (
              <p className="text-sm text-ink-soft">Loading…</p>
            ) : (
              <pre className="font-mono text-xs bg-ink text-paper rounded-xl px-4 py-3 overflow-auto whitespace-pre-wrap break-words max-h-72 select-text">
                {prompt}
              </pre>
            )}
            {promptNote && prompt !== null && !promptError && (
              <p className="text-xs text-ink-soft mt-1.5">{promptNote}</p>
            )}
          </div>

          {onSaveAppend && (
            <>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-2">your additions</div>
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDirty(true);
                    setSaved(false);
                  }}
                  rows={4}
                  placeholder="Extra preferences appended after the built-in prompt above…"
                  className="w-full font-mono text-xs rounded-xl border-2 border-line bg-paper px-3 py-2.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60 resize-y"
                />
              </div>

              <div className="flex items-center gap-2">
                <p className="text-xs text-ink-soft flex-1">{APPEND_HELP}</p>
                {saved && <span className="text-xs font-bold text-leaf shrink-0">Saved.</span>}
                <button
                  type="button"
                  disabled={!dirty}
                  onClick={() => void save()}
                  className="shrink-0 rounded-lg border-2 px-3 py-1.5 font-bold text-xs cursor-pointer bg-tangerine text-paper border-tangerine-deep enabled:hover:brightness-105 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
