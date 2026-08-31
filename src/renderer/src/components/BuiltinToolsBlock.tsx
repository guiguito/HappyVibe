import { useEffect, useState } from "react";
import { Section } from "./Section";
import { PromptRow, TogglePill } from "./PromptRow";
import { HowItWorks } from "./HowItWorks";

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
  /** §13 round 12: the model-authored `intent` on registered tools. */
  intent: boolean;
  /** §28: the grouped Browser entry — all ten tools or none. */
  browser: boolean;
}

/** Plan mode's row. The prompt panel and the append box are PromptRow's, shared
    with §19's "On your behalf" page; what stays here is the one thing this row
    does differently — turning it OFF asks first, because that unregisters three
    tools and respawns live sessions. */
function PlanModeRow({
  builtins,
  onChange,
}: {
  builtins: Builtins;
  onChange: (p: Partial<Builtins>) => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <>
      <PromptRow
        title="Plan mode"
        subtitle="Lets the agent draft and track a step-by-step plan before acting."
        on={builtins.plan}
        // Turning it OFF asks first: it unregisters three tools and respawns
        // live sessions, so the toggle hands the intent back rather than acting.
        onToggle={(next) => (next ? turnOn() : setConfirming(true))}
        loadPrompt={() => window.hv.builtinPrompt("plan").then((r) => r.text)}
        append={builtins.planAppend}
        onSaveAppend={async (v) => {
          await window.hv.builtinsSet({ planAppend: v });
          onChange({ planAppend: v });
        }}
        error={error}
      />
      <div className="px-4 pb-3 -mt-1">
        <HowItWorks copy="planMode" />
      </div>

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
    </>
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
 * §13 round 12 — the `intent` parameter, as a cost switch.
 *
 * Sized honestly on the row itself, because it decides what the switch is
 * worth: in the default PROXY mode one `mcp` tool stands in front of every
 * server, so intent is injected into five tools and the resting cost is small
 * — what it really costs is the sentence the model writes per call. With a
 * server set to expose tools directly it is injected into every tool that
 * server publishes, and the cost scales with the catalogue.
 *
 * It is not a safety control and the row says so: the permission prompt has
 * always shown the FACTUAL action rather than the model's sentence.
 */
function IntentRow({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">Tool intent</span>
        <span className="text-xs text-ink-soft">
          The one-line &ldquo;why&rdquo; the model writes for each tool card. Turning it off saves the tokens it
          costs to write; cards fall back to a factual label built from the call itself. Permission prompts are
          unaffected — they always show the factual action, never this sentence.
        </span>
        <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>
      </div>
      <TogglePill on={on} onClick={() => onChange(!on)} />
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
 * resolves at SPAWN, and `hv:builtins-set` schedules the same debounced,
 * idle-only, resume-preserving reload the MCP/skills settings use — so live
 * sessions DO respawn to apply it (that is what RESPAWN_NOTE discloses; an
 * earlier version of this comment claimed the write respawned nothing, which
 * was wrong for every key on this page). After the respawn the tools simply do
 * not register, the card stops being fed, and the PTY keeps running as an
 * ordinary workspace terminal — still in the terminal list, still openable as a
 * tab. Nothing is killed, so no promotion path is needed. Do not build one.
 */
function TerminalRow({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <PromptRow
      title="Terminal — 3 tools"
      // Honest about the trade: this is not a safety improvement. With the group
      // off the model does not stop wanting a dev server — it goes back to
      // `npm run dev &> /tmp/log &`, where you cannot see or stop it. Round 6's
      // driver was context, so say what it costs.
      subtitle={
        <>
          Lets the agent run long-running commands in terminals you can watch, type into and stop. Turning this off
          doesn&apos;t stop it wanting to — it goes back to backgrounding commands in bash, where you can neither see
          nor stop them. Saves the context cost of three tool schemas.
        </>
      }
      on={on}
      onToggle={onChange}
      loadPrompt={() => window.hv.builtinPrompt("terminal").then((r) => r.text)}
    />
  );
}


/**
 * §28 — ONE entry for ten tools, following Plan mode's and the terminal's
 * precedent, and for the same reason: an agent that can navigate but not read
 * opens pages nobody can use, and one that can read but not close leaves a pane
 * behind. There is no configuration in between that anyone wants.
 *
 * The Clear-browsing-data button lives here because this is where the browser is
 * DISCUSSED. §28 made the partition persistent so logins survive a restart, and
 * a persistent profile that cannot be emptied is a promise with no way back.
 */
function BrowserRow({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const [cleared, setCleared] = useState(false);
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">Browser — 10 tools</span>
        <span className="text-xs text-ink-soft">
          Lets the agent open a page in a sandboxed browser tab, read it, screenshot it, click and type in it, and
          watch its console and network traffic. It can reach localhost freely; every other site asks you first,
          and that gate is enforced on the network itself, not on the agent&apos;s good behaviour.
        </span>
        <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>
        <button
          type="button"
          onClick={() => {
            setCleared(false);
            void window.hv.browserClearData().then(() => setCleared(true));
          }}
          className="mt-2 rounded-lg border-2 border-line bg-paper px-2 py-1 text-xs font-bold cursor-pointer hover:bg-paper-deep"
        >
          Clear browsing data
        </button>
        {cleared && <span className="ml-2 text-xs font-semibold text-leaf">Cleared.</span>}
      </div>
      <TogglePill on={on} onClick={() => onChange(!on)} />
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
        <BrowserRow
          on={builtins.browser}
          onChange={(on) => {
            setAskUserError(null);
            void window.hv.builtinsSet({ browser: on }).then(
              () => patch({ browser: on }),
              (e) => setAskUserError(e instanceof Error ? e.message : "Could not save."),
            );
          }}
        />
        <IntentRow
          on={builtins.intent}
          onChange={(on) => {
            setAskUserError(null);
            void window.hv.builtinsSet({ intent: on }).then(
              () => patch({ intent: on }),
              (e) => setAskUserError(e instanceof Error ? e.message : "Could not save."),
            );
          }}
        />
      </div>
    </Section>
  );
}
