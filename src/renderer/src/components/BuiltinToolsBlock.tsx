import { useEffect, useState } from "react";
import { DOCUMENT_FAMILY_LIST } from "../../../../pi-runtime/extensions/hv-document";
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
  /** §32: the grouped Web tools entry — all four tools or none. */
  web: boolean;
  /** §31: Documents — `document_read` plus the `read` hint. */
  document: boolean;
  /** §33: Memory — the three tools, the policy and both indexes. */
  memory: boolean;
  /** §35: the four schedule tools. The scheduler runs regardless — see SchedulesRow. */
  schedules: boolean;
  /** §33: the user's append to the memory policy (never an override — PromptRow's rule). */
  memoryAppend: string;
}

/** Plan mode's row. The prompt panel and the append box are PromptRow's, shared
    with §19's "AI autofill" page; what stays here is the one thing this row
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
          className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/60 p-8"
          onClick={() => setConfirming(false)}
        >
          <div
            className="hv-dialog-flow w-full max-w-md rounded-2xl border-2 border-berry bg-card p-5 shadow-sticker-lg"
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
      // "Terminal" is also a nav page — the USER's shell, its font and its
      // settings. This row is the AGENT's three terminal tools. Same word, two
      // meanings, so this one says whose.
      title="Agent terminal — 3 tools"
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
        <span className="font-bold block">Agent browser — 10 tools</span>
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

/**
 * §32's row. The **Web service** sub-block lives here because this is where the
 * web tools are DISCUSSED — the §28 precedent, where Clear browsing data sits
 * beside the browser switch for the same reason.
 *
 * It is also the one control on this page that does NOT need a respawn: main
 * reads the service per call, because the Pi child never sees the URL or the
 * key. The row says so, since every other control here discloses the opposite.
 *
 * The word "Firecrawl" appears exactly once in this file, in the helper text
 * under the custom URL, and only once "Your own" is chosen — §32's vocabulary
 * rule, with its one deliberate exception for the person who has to know what
 * to run.
 */
/**
 * §33 — Memory. Three tools plus a POLICY the model reads every turn, which is why this row
 * carries the prompt panel and an append box (Plan mode's shape) where Terminal, Browser, Web
 * and Documents only carry a switch: those inject a one-line steer, this injects a paragraph.
 *
 * The prompt panel shows the three tool DESCRIPTIONS beside the policy, and that is not
 * decoration — measured, the policy is 242 tokens and the three schemas are 743, so a panel
 * showing only the policy would understate the saving by three quarters.
 *
 * The switch is the same `builtinTools.memory` key the Memory page switches. One source, two
 * surfaces, so they cannot disagree about whether memory is on.
 */
function MemoryRow({
  on,
  append,
  onChange,
  onAppend,
}: {
  on: boolean;
  append: string;
  onChange: (on: boolean) => void;
  onAppend: (v: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <>
      <PromptRow
        title="Memory — 3 tools"
        subtitle={
          <>
            Lets the agent remember durable facts about you and about each project, across sessions. Saving and
            forgetting ask you first; you can read, edit and delete every memory on the Memory page. Turning this off
            saves the policy and three tool schemas from every turn. {RESPAWN_NOTE}
          </>
        }
        on={on}
        onToggle={onChange}
        loadPrompt={() => window.hv.builtinPrompt("memory").then((r) => r.text)}
        append={append}
        onSaveAppend={onAppend}
      />
      <div className="px-4 pb-3 -mt-1">
        <HowItWorks copy="memory" />
      </div>
    </>
  );
}

function WebRow({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): React.JSX.Element {
  const [svc, setSvc] = useState<{ mode: "default" | "custom"; baseUrl?: string; hasKey: boolean } | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [test, setTest] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.hv.webServiceGet().then((s) => {
      setSvc(s);
      setUrl(s.baseUrl ?? "");
    });
  }, []);

  const mode = svc?.mode ?? "default";
  const setMode = (m: "default" | "custom"): void => {
    setSaved(false);
    setTest(null);
    void window.hv.webServiceSet({ mode: m }).then(() => setSvc((s) => (s ? { ...s, mode: m } : s)));
  };
  // "Your own" with nothing typed resolves to HappyVibe's service, by design —
  // a half-saved setting must not break every web tool. But that makes both
  // buttons LIE if they act on it: Save would report "Saved." for a service
  // that is not yours, and Test would answer "Connected." about the default
  // one. So the row refuses instead, which is the only place that knows the
  // user picked "Your own" and typed nothing.
  const missingUrl = mode === "custom" && !url.trim();

  const save = (): void => {
    setSaved(false);
    setTest(null);
    if (missingUrl) {
      setTest("Enter the address of your service first.");
      return;
    }
    void window.hv
      .webServiceSet({ mode: "custom", baseUrl: url, ...(key ? { key } : {}) })
      .then(() => {
        setSaved(true);
        // Never keep a secret in renderer state after it is stored.
        setKey("");
        setSvc((s) => (s ? { ...s, baseUrl: url, hasKey: s.hasKey || Boolean(key) } : s));
      });
  };
  const runTest = (): void => {
    setSaved(false);
    if (missingUrl) {
      setTest("Enter the address of your service first.");
      return;
    }
    setTest("Testing…");
    // An unsaved URL is testable on purpose: check before committing.
    void window.hv
      .webServiceTest(mode === "custom" ? { baseUrl: url, ...(key ? { key } : {}) } : {})
      .then((r) => setTest(r.ok ? "Connected." : r.reason));
  };

  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <span className="font-bold block">Web tools — 4 tools</span>
          <span className="text-xs text-ink-soft">
            Lets the agent search the web and read any public page as clean text, list a site&apos;s pages, or read a
            whole section of one. Reading a new site asks you first, under the same rules as the agent&apos;s browser.
            Turning this off saves the context cost of four tool schemas.
          </span>
          <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>
        </div>
        <TogglePill on={on} onClick={() => onChange(!on)} />
      </div>
      {/* ponytail: native <details> — the HowItWorks / McpCatalogSection idiom,
          no disclosure state to manage. */}
      <details className="mt-2">
        <summary className="cursor-pointer select-none text-xs font-bold text-ink-soft hover:text-ink">
          Web service
        </summary>
        <div className="mt-2 space-y-2 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={mode === "default"} onChange={() => setMode("default")} />
            HappyVibe&apos;s service
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} />
            Your own
          </label>
          {mode === "custom" && (
            <div className="pl-5 space-y-1.5">
              <input
                className="w-full rounded-lg border-2 border-line bg-paper px-2 py-1"
                placeholder="API URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
              />
              <input
                className="w-full rounded-lg border-2 border-line bg-paper px-2 py-1"
                type="password"
                placeholder={svc?.hasKey ? "API key (saved — type to replace)" : "API key (optional)"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <p className="text-ink-soft">
                Firecrawl-compatible API, v2 — e.g. https://firecrawl.example.com. Applies to the next call, so
                nothing restarts.
              </p>
              <button
                type="button"
                onClick={save}
                className="rounded-lg border-2 border-line bg-paper px-2 py-1 font-bold cursor-pointer hover:bg-paper-deep"
              >
                Save
              </button>
              {saved && <span className="ml-2 font-semibold text-leaf">Saved.</span>}
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={runTest}
              className="rounded-lg border-2 border-line bg-paper px-2 py-1 font-bold cursor-pointer hover:bg-paper-deep"
            >
              Test
            </button>
            {test && (
              <span className={`ml-2 font-semibold ${test === "Connected." ? "text-leaf" : test === "Testing…" ? "text-ink-soft" : "text-berry"}`}>
                {test}
              </span>
            )}
          </div>
        </div>
      </details>
      <HowItWorks copy="webTools" />
    </div>
  );
}

/**
 * §31 — ONE entry for one tool, so none of the grouping arguments above apply.
 *
 * The row reads "Documents", not "Agent documents": the `Agent …` prefix on the
 * terminal and browser rows exists only to dodge a nav collision (Terminal is a
 * page, Browser is a tab kind), and there is no Documents page to collide with.
 *
 * Turning it off does three things, and the description says all three because
 * only one of them is on this page: the tool unregisters at the next spawn, the
 * composer's Attach document row disables WITH ITS REASON, and the `read` hint
 * stops firing. Where it is OBSERVED is the Agent tools page, which lists what
 * the session actually registered.
 */
function DocumentsRow({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">Documents — 1 tool</span>
        <span className="text-xs text-ink-soft">
          Lets the agent read {DOCUMENT_FAMILY_LIST} files as Markdown, converted on this machine — nothing is sent
          anywhere. Also turns on <span className="font-semibold">Attach document</span> in the chat bar. Scanned PDF
          pages can&apos;t be read, and the agent is told which ones they are. Saves the context cost of one tool schema.
        </span>
        <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>
      </div>
      <TogglePill on={on} onClick={() => onChange(!on)} />
    </div>
  );
}

/**
 * §35. The switch removes the model's four schedule tools; it does NOT stop the
 * scheduler, and the copy has to say so or a user turning it off to quieten the
 * agent would reasonably expect their 9 a.m. review to stop arriving.
 */
function SchedulesRow({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="font-bold block">Schedules — 4 tools</span>
        <span className="text-xs text-ink-soft">
          Lets the agent list this workspace&apos;s schedules and propose new ones. Creating, changing and deleting always
          open the drawer or a permission prompt for you first — the agent never writes a schedule on its own. Turning
          this off takes the four tools away from the agent; your schedules keep running.
        </span>
        <span className="text-xs text-ink-soft block mt-0.5">{RESPAWN_NOTE}</span>
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
        <WebRow
          on={builtins.web}
          onChange={(on) => {
            setAskUserError(null);
            void window.hv.builtinsSet({ web: on }).then(
              () => patch({ web: on }),
              (e) => setAskUserError(e instanceof Error ? e.message : "Could not save."),
            );
          }}
        />
        <MemoryRow
          on={builtins.memory}
          append={builtins.memoryAppend}
          onChange={(on) => {
            setAskUserError(null);
            void window.hv.builtinsSet({ memory: on }).then(
              () => patch({ memory: on }),
              (e) => setAskUserError(e instanceof Error ? e.message : "Could not save."),
            );
          }}
          onAppend={async (v) => {
            await window.hv.builtinsSet({ memoryAppend: v });
            patch({ memoryAppend: v });
          }}
        />
        <SchedulesRow
          on={builtins.schedules}
          onChange={(on) => {
            setAskUserError(null);
            void window.hv.builtinsSet({ schedules: on }).then(
              () => patch({ schedules: on }),
              (e) => setAskUserError(e instanceof Error ? e.message : "Could not save."),
            );
          }}
        />
        <DocumentsRow
          on={builtins.document}
          onChange={(on) => {
            setAskUserError(null);
            void window.hv.builtinsSet({ document: on }).then(
              () => patch({ document: on }),
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
