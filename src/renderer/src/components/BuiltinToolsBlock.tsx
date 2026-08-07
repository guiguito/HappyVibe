import { useEffect, useState } from "react";
import { Section } from "./Section";

/** Minor 3: same phrase used in the Plan-off confirm modal and in the live
    hv:session-reloading notice (App.tsx) — reused verbatim so every control
    that triggers the respawn discloses it the same way, not a bespoke one-off. */
const RESPAWN_NOTE = "Live sessions respawn to apply this — permission grants and dangerous mode reset to safe defaults for those sessions.";

/** §13 round 6: the App Tools page's top block — global on/off for the two
    built-in custom tools (plan mode, ask_user). Kept in its own file/component
    (per the task's org note) since Plan mode's expanded prompt+append panel
    would make AllToolsView.tsx unwieldy inline. */
interface Builtins {
  plan: boolean;
  askUser: boolean;
  planAppend: string;
  /** §26 part 2: the grouped Terminal entry — all three tools or none. */
  terminal: boolean;
}

const HINT =
  "The built-in prompt above can't be edited — it's shown so you can see exactly what the agent is told. Your " +
  'additions are appended after it. Add preferences (e.g. \'always list affected files\'), not contradictions.';

function TogglePill({
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

/** Plan mode's row: toggle (with an off-confirm) + an expandable panel showing
    the real, unmodified built-in prompt (read-only) and the append textarea. */
function PlanModeRow({
  builtins,
  onChange,
}: {
  builtins: Builtins;
  onChange: (p: Partial<Builtins>) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptError, setPromptError] = useState(false);
  const [append, setAppend] = useState(builtins.planAppend);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && prompt === null && !promptError) {
      void window.hv.builtinPrompt("plan")
        .then((r) => setPrompt(r.text))
        .catch(() => setPromptError(true));
    }
  }, [open, prompt, promptError]);

  // Minor 2: don't leave the optimistic patch standing if the write failed —
  // revert it and surface why, instead of a pill that shows a state that was
  // never actually saved to disk.
  const save = async (): Promise<void> => {
    setError(null);
    try {
      await window.hv.builtinsSet({ planAppend: append });
      onChange({ planAppend: append });
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  };

  const turnOn = (): void => {
    setError(null);
    void window.hv.builtinsSet({ plan: true }).then(
      () => onChange({ plan: true }),
      (e) => setError(e instanceof Error ? e.message : "Could not turn on Plan mode."),
    );
  };
  const turnOff = (): void => {
    setConfirming(false);
    setError(null);
    void window.hv.builtinsSet({ plan: false }).then(
      () => onChange({ plan: false }),
      (e) => setError(e instanceof Error ? e.message : "Could not turn off Plan mode."),
    );
  };

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="w-full px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 min-w-0 text-left flex items-center gap-2.5 cursor-pointer"
        >
          <span className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          <span className="min-w-0">
            <span className="font-bold block">Plan mode</span>
            <span className="text-xs text-ink-soft">
              Lets the agent draft and track a step-by-step plan before acting.
            </span>
          </span>
        </button>
        <TogglePill on={builtins.plan} onClick={() => (builtins.plan ? setConfirming(true) : turnOn())} />
      </div>
      {error && <p className="px-4 pb-2 -mt-1 text-xs font-semibold text-berry">{error}</p>}

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
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-2">your additions</div>
            <textarea
              value={append}
              onChange={(e) => {
                setAppend(e.target.value);
                setDirty(true);
                setSaved(false);
              }}
              rows={4}
              placeholder="Extra preferences appended after the built-in prompt above…"
              className="w-full font-mono text-xs rounded-xl border-2 border-line bg-paper px-3 py-2.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60 resize-y"
            />
          </div>

          <div className="flex items-center gap-2">
            <p className="text-xs text-ink-soft flex-1">{HINT}</p>
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
        </div>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8"
          onClick={() => setConfirming(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border-2 border-berry bg-card p-5 shadow-sticker-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-bold text-berry mb-1">Turn off Plan mode?</div>
            <p className="text-sm text-ink-soft mb-4">
              This removes the plan controls from chat (the top-bar indicator and composer chip) and unregisters the
              plan_start / plan_complete / plan_status_update tools. {RESPAWN_NOTE}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={turnOff}
                className="rounded-xl bg-berry text-paper font-bold text-sm px-4 py-2 border-2 border-berry shadow-sticker cursor-pointer hover:brightness-105"
              >
                Turn off
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ask user has no injected prompt to show (per brief: no prompt editing for
    it) — just a toggle, no expand, no confirm (not consequential like plan).
    Important 3: while Plan mode is on, this toggle is disabled — Plan mode's
    prompt and its required-tools list both hard-depend on ask_user, so letting
    the user turn it off here would silently leave the model told to use a tool
    that no longer exists (parseBuiltins repairs the pair defensively, but the
    UI shouldn't invite the broken state in the first place). */
function AskUserRow({
  on,
  planOn,
  onChange,
}: {
  on: boolean;
  planOn: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">Ask user</span>
        <span className="text-xs text-ink-soft">Lets the agent pause mid-turn to ask you a clarifying question.</span>
        {planOn && (
          <span className="text-xs text-ink-soft block mt-0.5">
            Locked on — Plan mode depends on it. Turn off Plan mode first if you want to disable this.
          </span>
        )}
        {!planOn && <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>}
      </div>
      <TogglePill on={on} disabled={planOn} onClick={() => !planOn && onChange(!on)} />
    </div>
  );
}

/**
 * §26 part 2 — ONE entry for three tools, following Plan mode's precedent.
 *
 * A per-tool switch would be actively harmful: an agent that can terminal_run
 * but not terminal_read starts processes it cannot observe, and one that can
 * run and read but not terminal_kill cannot clean up. Those are not
 * configurations anyone wants, so they are not reachable.
 *
 * There is deliberately no promotion path on turning it off. HV_BUILTINS
 * resolves at SPAWN and this write respawns nothing, so the toggle cannot take
 * tools away from a session that is currently running. On a later unrelated
 * respawn the tools simply do not register, the card stops being fed, and the
 * PTY keeps running as an ordinary workspace terminal — still in the terminal
 * list, still openable as a tab. Do not build one.
 */
function TerminalRow({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptError, setPromptError] = useState(false);

  useEffect(() => {
    if (open && prompt === null && !promptError) {
      void window.hv.builtinPrompt("terminal")
        .then((r) => setPrompt(r.text))
        .catch(() => setPromptError(true));
    }
  }, [open, prompt, promptError]);

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="w-full px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 min-w-0 text-left flex items-center gap-2.5 cursor-pointer"
        >
          <span className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          <span className="min-w-0">
            <span className="font-bold block">Terminal — 3 tools</span>
            {/* Honest about the trade: this is not a safety improvement. With
                the group off the model does not stop wanting a dev server — it
                goes back to `npm run dev &> /tmp/log &`, where you cannot see
                or stop it. Round 6's driver was context, so say what it costs. */}
            <span className="text-xs text-ink-soft">
              Lets the agent run long-running commands in terminals you can watch, type into and stop. Turning this
              off doesn&apos;t stop it wanting to — it goes back to backgrounding commands in bash, where you can
              neither see nor stop them. Saves the context cost of three tool schemas.
            </span>
          </span>
        </button>
        <TogglePill on={on} onClick={() => onChange(!on)} />
      </div>
      {open && (
        <div className="px-4 pb-4 pt-0">
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
        </div>
      )}
    </div>
  );
}

export function BuiltinToolsBlock({
  onPlanChange,
}: {
  /** Important 1: lets App keep the composer chip's visibility in sync as soon
      as Plan mode is toggled here, without waiting for a page nav/refetch. */
  onPlanChange?: (on: boolean) => void;
} = {}): React.JSX.Element | null {
  const [builtins, setBuiltins] = useState<Builtins | null>(null);
  const [askUserError, setAskUserError] = useState<string | null>(null);

  useEffect(() => {
    void window.hv.builtinsGet().then(setBuiltins);
  }, []);

  useEffect(() => {
    if (builtins) onPlanChange?.(builtins.plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builtins?.plan]);

  if (!builtins) return null;

  const patch = (p: Partial<Builtins>): void => setBuiltins((b) => (b ? { ...b, ...p } : b));

  return (
    <Section
      icon="tools"
      title="Built-in Custom Tools"
      // "Both" was written when there were two entries; §26 made it three.
      subtitle="App-provided tools implemented as ordinary tool calls, not part of Pi core. All are on by default — turn any of them off if you don't want the agent to have it."
    >
      <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden">
        <PlanModeRow builtins={builtins} onChange={patch} />
        <AskUserRow
          on={builtins.askUser}
          planOn={builtins.plan}
          onChange={(on) => {
            setAskUserError(null);
            void window.hv.builtinsSet({ askUser: on }).then(
              () => patch({ askUser: on }),
              (e) => setAskUserError(e instanceof Error ? e.message : "Could not save."),
            );
          }}
        />
        {askUserError && <p className="px-4 pb-2 -mt-1 text-xs font-semibold text-berry">{askUserError}</p>}
        <TerminalRow
          on={builtins.terminal}
          onChange={(on) => {
            setAskUserError(null);
            void window.hv.builtinsSet({ terminal: on }).then(
              () => patch({ terminal: on }),
              (e) => setAskUserError(e instanceof Error ? e.message : "Could not save."),
            );
          }}
        />
      </div>
    </Section>
  );
}
