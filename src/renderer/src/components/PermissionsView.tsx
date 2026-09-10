import { useEffect, useState } from "react";
import { PermissionRulesSection } from "./PermissionRulesSection";
import { Section } from "./Section";

/**
 * Round 8: the Permissions section of the old Settings scroll, promoted to its
 * own page. Rules and the bypass toggle stay together — they are one topic.
 */

/** Round 3 #14: global "Bypass ALL permissions" toggle. Enabling requires a
    scary confirm; while active every session shows a red banner. */
function GlobalBypassToggle(): React.JSX.Element {
  const [on, setOn] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { void window.hv.getGlobalBypass().then(setOn); }, []);
  return (
    <div className="mt-6 rounded-xl border-2 border-berry/50 bg-berry-soft/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-bold text-berry">⚠ Bypass ALL permissions</div>
          <p className="text-sm text-ink-soft mt-0.5">
            Auto-approve every action — file writes, shell commands, MCP calls — in every workspace, with no prompts.
            A red banner shows in each session while this is on. Individual workspaces can override this.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (on) { setOn(false); void window.hv.setGlobalBypass(false); }
            else setConfirming(true);
          }}
          className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer ${
            on ? "bg-berry text-paper border-berry" : "bg-card text-ink border-line hover:border-berry"
          }`}
        >
          {on ? "On" : "Off"}
        </button>
      </div>
      {confirming && (
        <div className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/60 p-8" onClick={() => setConfirming(false)}>
          <div className="hv-dialog-flow w-full max-w-md rounded-2xl border-2 border-berry bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold text-berry mb-1">⚠ Auto-approve every action?</div>
            <p className="text-sm text-ink-soft mb-4">
              This turns off ALL permission prompts globally — the agent may write files and run shell commands without
              asking. Only enable this if you fully trust what you're running.
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
                onClick={() => { setConfirming(false); setOn(true); void window.hv.setGlobalBypass(true); }}
                className="rounded-xl bg-berry text-paper font-bold text-sm px-4 py-2 border-2 border-berry shadow-sticker cursor-pointer hover:brightness-105"
              >
                Enable bypass
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PermissionsView(): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Permissions</h1>
        <p className="text-sm text-ink-soft mb-8">
          Global rules for every workspace. Per-workspace overrides live in each workspace&apos;s own
          settings.
        </p>

        <Section icon="permissions" title="Rules" subtitle="Evaluated by the same engine that enforces them.">
          <PermissionRulesSection />
          <GlobalBypassToggle />
        </Section>
      </div>
    </div>
  );
}
