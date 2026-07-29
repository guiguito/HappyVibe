import { useEffect, useState } from "react";
import { Section } from "./Section";

/** §13 round 6: the App Tools page's top block — global on/off for the two
    built-in custom tools (plan mode, ask_user). Kept in its own file/component
    (per the task's org note) since Plan mode's expanded prompt+append panel
    would make AllToolsView.tsx unwieldy inline. */
interface Builtins {
  plan: boolean;
  askUser: boolean;
  planAppend: string;
}

const HINT =
  "The built-in prompt above can't be edited — it's shown so you can see exactly what the agent is told. Your " +
  'additions are appended after it. Add preferences (e.g. \'always list affected files\'), not contradictions.';

function TogglePill({ on, onClick }: { on: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer ${
        on ? "bg-leaf text-paper border-leaf" : "bg-card text-ink border-line hover:border-leaf"
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
  const [append, setAppend] = useState(builtins.planAppend);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open && prompt === null) void window.hv.builtinPrompt("plan").then((r) => setPrompt(r.text));
  }, [open, prompt]);

  const save = async (): Promise<void> => {
    await window.hv.builtinsSet({ planAppend: append });
    onChange({ planAppend: append });
    setDirty(false);
    setSaved(true);
  };

  const turnOn = (): void => {
    void window.hv.builtinsSet({ plan: true });
    onChange({ plan: true });
  };
  const turnOff = (): void => {
    setConfirming(false);
    void window.hv.builtinsSet({ plan: false });
    onChange({ plan: false });
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

      {open && (
        <div className="px-4 pb-4 pt-0 flex flex-col gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-2">
              built-in prompt (read-only)
            </div>
            {prompt === null ? (
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
              plan_start / plan_complete / plan_status_update tools. Live sessions respawn to apply it — permission
              grants and dangerous mode reset to safe defaults for those sessions.
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
    it) — just a toggle, no expand, no confirm (not consequential like plan). */
function AskUserRow({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): React.JSX.Element {
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">Ask user</span>
        <span className="text-xs text-ink-soft">Lets the agent pause mid-turn to ask you a clarifying question.</span>
      </div>
      <TogglePill on={on} onClick={() => onChange(!on)} />
    </div>
  );
}

export function BuiltinToolsBlock(): React.JSX.Element | null {
  const [builtins, setBuiltins] = useState<Builtins | null>(null);

  useEffect(() => {
    void window.hv.builtinsGet().then(setBuiltins);
  }, []);

  if (!builtins) return null;

  const patch = (p: Partial<Builtins>): void => setBuiltins((b) => (b ? { ...b, ...p } : b));

  return (
    <Section
      icon="tools"
      title="Built-in Custom Tools"
      subtitle="App-provided tools implemented as ordinary tool calls, not part of Pi core. Both are on by default — turn either off if you don't want the agent to have it."
    >
      <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden">
        <PlanModeRow builtins={builtins} onChange={patch} />
        <AskUserRow on={builtins.askUser} onChange={(on) => {
          void window.hv.builtinsSet({ askUser: on });
          patch({ askUser: on });
        }} />
      </div>
    </Section>
  );
}
