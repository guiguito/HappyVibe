import { useCallback, useEffect, useState } from "react";
import { Section } from "./Section";
import { HowItWorks } from "./HowItWorks";
import { GoTo } from "./GoTo";
import { LockLine } from "./LockLine";
import type { HvCrashInfo } from "../hv";
import { REVEAL_IN_FILE_MANAGER } from "../platformCopy";
import { usePrivacy } from "../privacy";
import { MODEL_LIST_REFRESH_HOURS, type SwitchKey } from "../../../main/privacySwitches";

/**
 * §37 — the one page that answers "what does this app send".
 *
 * Named Privacy rather than Crash reports on purpose: a usage-analytics switch
 * belongs on exactly this surface, and naming a sidebar destination after its
 * first block means renaming a destination later. Crash reports is block one.
 *
 * There are no test buttons here, in development or otherwise. `hv:crash-test`
 * exists and the GUI pass drives it from electron-debug — four controls that
 * render only in dev would be UI built for a test, on a page whose whole job is
 * to be believable to a user.
 *
 * Privacy round (2026-10-09): every connection the app makes on its own has a
 * switch here (updates on Changelog, the web service on Built-in tools, listed
 * read-only under Other connections). An env lock shows it off and disabled with
 * the lock line, never hidden, and the page never names a variable.
 */
const smallBtn =
  "rounded-lg border-2 px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

/** The page's words, pinned by tests/privacy-page.test.ts and quoted by the guide. */
export const PRIVACY_COPY = {
  feedbackTitle: "Feedback",
  feedbackSubtitle: "Things you choose to send us. Nothing leaves until you press Send or tap a rating.",
  feedbackButton: "Show the feedback button",
  feedbackButtonBody: "The megaphone in the sidebar, which opens a short form.",
  pulse: "Ask how a session is going",
  pulseBody: "Once per chat session, a one-tap rating above the message box.",
  remoteTitle: "Remote settings",
  remoteSubtitle:
    "HappyVibe checks a small list of settings we can change without a release, for now only whether the free web service is available.",
  remoteSwitch: "Receive remote settings",
  remoteBody:
    "The check carries a random device ID so gradual changes reach the same devices. Turning statistics off doesn't stop it, but the ID is replaced with a new one that isn't linked to your statistics.",
  remoteCost: "Off, HappyVibe uses its built-in settings and we can't pause the free web service for you if it's overloaded.",
  modelTitle: "Model list",
  modelSubtitle: `Pi, the engine inside HappyVibe, asks pi.dev for newly released models when a session starts, at most every ${MODEL_LIST_REFRESH_HOURS} hours. The first time the agent searches files, it also downloads two search tools from GitHub if they aren't installed.`,
  modelSwitch: "Check for new models",
  modelCost:
    "Off: models released after this version of HappyVibe only appear once you update, and if the search tools aren't on this computer yet, the agent can't download them, so its file search stops working. Applies to new sessions.",
  otherTitle: "Other connections",
  otherSubtitle: "What this page doesn't control, and where you can.",
  updates: "Updates",
  freeWeb: "Free web service",
  provider: "Your model provider",
  providerBody: "Your conversations go to the model you picked. Nothing on this page changes that.",
  on: "On",
  off: "Off",
  locked: "Locked",
} as const;
const C = PRIVACY_COPY;

/** The page's On/Off pill; disabled under an env lock. */
function Pill({ on, locked, onChange }: { on: boolean; locked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => onChange(!on)}
      className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-default ${
        on ? "bg-leaf text-paper border-leaf" : "bg-card text-ink border-line hover:border-leaf"
      }`}
    >
      {on ? C.on : C.off}
    </button>
  );
}

/** One switch row: label, body, optional cost line, the pill, and the lock line when held off. */
function SwitchRow({
  label,
  body,
  cost,
  on,
  locked,
  onChange,
}: {
  label: string;
  body?: string;
  cost?: string;
  on: boolean;
  locked: boolean;
  onChange: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border-2 border-line bg-card p-4 flex items-start justify-between gap-4">
      <div>
        <div className="font-bold">{label}</div>
        {body && <p className="text-sm text-ink-soft mt-0.5">{body}</p>}
        {cost && <p className="text-xs text-ink-soft mt-1">{cost}</p>}
        {locked && <LockLine />}
      </div>
      <Pill on={on} locked={locked} onChange={onChange} />
    </div>
  );
}

export function PrivacyView(): React.JSX.Element {
  const [privacy, reloadPrivacy] = usePrivacy();
  const [info, setInfo] = useState<HvCrashInfo | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reset, setReset] = useState<{ blockers: Array<{ path: string; reason: string }> } | null>(null);
  // A channel with no key can't send, so its feedback switches would be noise (§20).
  const [feedbackAvailable, setFeedbackAvailable] = useState(false);
  const [web, setWeb] = useState<{ on: boolean; mode: "default" | "custom" } | null>(null);
  const isOn = (k: SwitchKey): boolean => !!privacy?.on[k];
  const isLocked = (k: SwitchKey): boolean => !!privacy?.locked.includes(k);
  const state = (k: SwitchKey): string => (isLocked(k) ? C.locked : isOn(k) ? C.on : C.off);

  // After an opt-out the report is gone; the button must not stay on "Hide".
  useEffect(() => {
    if (!info?.lastReport) setShowReport(false);
  }, [info]);

  const refresh = useCallback(() => {
    void window.hv.crashInfo().then(setInfo);
  }, []);

  useEffect(() => {
    refresh();
    void window.hv.feedbackInfo().then((f) => setFeedbackAvailable(f.available));
    void Promise.all([window.hv.builtinsGet(), window.hv.webServiceGet()]).then(([b, w]) =>
      setWeb({ on: (b as { web?: boolean }).web !== false, mode: w.mode }),
    );
    // A report can land while the page is open; the "last report" block is the
    // page's own evidence, so it must not be a snapshot taken at mount.
    return window.hv.onCrashSent(() => refresh());
  }, [refresh]);

  // No "takes effect on next launch" caveat anywhere on this page, and that is a
  // claim the code has to earn: every client is always initialised (or started
  // live), so each switch acts immediately — the model list from the next session.
  const setPrivacy = (k: SwitchKey) => (v: boolean) => void window.hv.privacySet(k, v);

  return (
    // The page scrolls like every other settings page — it outgrew the window
    // once Usage statistics joined Crash reports.
    <div className="flex-1 overflow-y-auto">
    <div className="mx-auto w-full max-w-3xl p-8">
      <h1 className="font-black text-3xl tracking-tight mb-1">Privacy</h1>
      <p className="text-sm text-ink-soft mb-6">
        What leaves this machine, and how to stop it. Everything else — your sessions, your files, your keys, your
        audit log and your Stats page — stays here.
      </p>

      {/* §39: live in both directions; off forgets this installation (D11). */}
      <Section
        icon="stats"
        title="Usage statistics"
        subtitle="Which features get used, where setup gets stuck, and whether the app is reliable. Never what you type, your files or your projects."
      >
        <SwitchRow
          label="Send anonymous usage statistics"
          on={isOn("usageStats")}
          locked={isLocked("usageStats")}
          // off also forgets the kept crash report
          onChange={(v) => void window.hv.setUsageStats(v).then(() => { reloadPrivacy(); refresh(); })}
        />
        <div className="mt-4">
          <HowItWorks copy="usageStats" />
        </div>
      </Section>

      <Section icon="audit" title="Crash reports" subtitle="Automatic, and content-free by design.">
        <SwitchRow
          label="Send crash reports"
          body="When HappyVibe itself breaks, send a short technical report so it can be fixed. Never your prompts, your files or your keys."
          on={isOn("crashReports")}
          locked={isLocked("crashReports")}
          onChange={(v) => void window.hv.setCrashReports(v).then(() => { reloadPrivacy(); refresh(); })}
        />

        <div className="mt-4">
          <HowItWorks copy="crashReports" />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            className={`${smallBtn} bg-card border-line hover:border-leaf disabled:opacity-40 disabled:cursor-default`}
            disabled={!info?.lastReport}
            onClick={() => setShowReport((v) => !v)}
          >
            {showReport ? "Hide the last report" : "Show the last report"}
          </button>
          <button
            type="button"
            className={`${smallBtn} bg-card border-line hover:border-leaf`}
            onClick={() => void window.hv.crashReveal()}
          >
            {REVEAL_IN_FILE_MANAGER}
          </button>
          {!info?.lastReport && (
            <span className="text-xs text-ink-soft">Nothing has been sent from this computer yet.</span>
          )}
        </div>

        {showReport && info?.lastReport && (
          <pre className="mt-3 max-h-80 overflow-auto rounded-xl border-2 border-line bg-paper-deep p-3 text-xs">
            {JSON.stringify(info.lastReport, null, 2)}
          </pre>
        )}
      </Section>

      {(feedbackAvailable || isLocked("feedback")) && (
        <Section icon="audit" title={C.feedbackTitle} subtitle={C.feedbackSubtitle}>
          <div className="space-y-2">
            <SwitchRow label={C.feedbackButton} body={C.feedbackButtonBody} on={isOn("feedback")} locked={isLocked("feedback")} onChange={setPrivacy("feedback")} />
            <SwitchRow label={C.pulse} body={C.pulseBody} on={isOn("sessionPulse")} locked={isLocked("sessionPulse")} onChange={setPrivacy("sessionPulse")} />
          </div>
        </Section>
      )}

      <Section icon="stats" title={C.remoteTitle} subtitle={C.remoteSubtitle}>
        <SwitchRow
          label={C.remoteSwitch}
          body={C.remoteBody}
          cost={C.remoteCost}
          on={isOn("remoteConfig")}
          locked={isLocked("remoteConfig")}
          onChange={setPrivacy("remoteConfig")}
        />
      </Section>

      <Section icon="stats" title={C.modelTitle} subtitle={C.modelSubtitle}>
        <SwitchRow label={C.modelSwitch} cost={C.modelCost} on={isOn("modelList")} locked={isLocked("modelList")} onChange={setPrivacy("modelList")} />
      </Section>

      {/* D8: what the page doesn't own, read-only, each linking to where it's controlled. */}
      <Section icon="audit" title={C.otherTitle} subtitle={C.otherSubtitle}>
        <ul className="rounded-xl border-2 border-line bg-card divide-y-2 divide-line text-sm">
          <li className="p-3 flex justify-between gap-3">
            <span className="font-bold">{C.updates}</span>
            <span>
              {state("updateCheck")} · <GoTo view="changelog" />
            </span>
          </li>
          <li className="p-3 flex justify-between gap-3">
            <span className="font-bold">{C.freeWeb}</span>
            <span>
              {isLocked("defaultWeb") ? C.locked : web?.on && web.mode === "default" ? C.on : C.off} · <GoTo view="builtinTools" />
            </span>
          </li>
          <li className="p-3">
            <div className="flex justify-between gap-3">
              <span className="font-bold">{C.provider}</span>
              <GoTo view="models" />
            </div>
            <p className="text-ink-soft mt-0.5">{C.providerBody}</p>
          </li>
        </ul>
      </Section>

      {/* §17 round 25: the only way back to a clean slate — reinstalling keeps this data. */}
      <Section icon="audit" title="Clear all data" subtitle="Start over as if HappyVibe were just installed.">
        <button
          type="button"
          className={`${smallBtn} bg-berry text-paper border-berry`}
          onClick={() => void window.hv.resetCheck().then((b) => setReset({ blockers: b }))}
        >
          Clear all data…
        </button>
      </Section>
    </div>
    {reset && <ResetDialog blockers={reset.blockers} onClose={() => setReset(null)} />}
    </div>
  );
}

const dialogBtn = "px-2.5 py-1 rounded-lg border border-line font-bold text-xs cursor-pointer hover:bg-card";

/** Refuses outright over unsaved worktrees; otherwise one red confirm. */
function ResetDialog({ blockers: initial, onClose }: { blockers: Array<{ path: string; reason: string }>; onClose: () => void }): React.JSX.Element {
  const [blockers, setBlockers] = useState(initial);
  // Git refused DURING removal: sessions were stopped and other worktrees may be gone.
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    const r = await window.hv.resetAll();
    // On success the app quits; only a refusal comes back.
    if (!r.ok) {
      setBlockers(r.blockers);
      setPartial(!!r.removed);
    }
    setBusy(false);
  };
  return (
    <div className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/40 px-6">
      <div className="hv-dialog-flow w-full max-w-lg rounded-2xl border-2 border-line-strong bg-paper shadow-sticker-lg p-5">
        {blockers.length > 0 ? (
          <>
            <h2 className="font-black text-lg tracking-tight">
              {partial ? "Some worktrees couldn't be removed" : "Some worktrees have unsaved work"}
            </h2>
            <ul className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
              {blockers.map((b) => (
                <li key={b.path} className="rounded-xl border border-line px-3 py-2 text-xs">
                  <span className="font-mono break-all">{b.path}</span>
                  <span className="block text-ink-soft mt-0.5">{b.reason}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink-soft mt-3">
              {partial
                ? "Your sessions were stopped and other worktrees may already be gone. Your other data wasn't touched. Fix what git says above, then try again."
                : "Commit or discard their changes, then try again. Nothing was deleted."}
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" className={dialogBtn} onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-black text-lg tracking-tight">Clear all data?</h2>
            <p className="text-sm text-ink-soft mt-1">
              This removes every chat, workspace, setting, sign-in and API key, and the app&apos;s worktrees (their
              branches stay in your repositories). HappyVibe then closes and reopens on its first-run screen.
            </p>
            <p className="text-sm text-ink-soft mt-2">
              Folders inside your projects are not touched — if you want them gone, delete{" "}
              <code className="font-mono">.pi-subagents/</code> and <code className="font-mono">.agents/plans/</code>{" "}
              yourself.
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" className={dialogBtn} onClick={onClose} disabled={busy}>Cancel</button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-lg border-2 border-berry bg-berry text-paper font-bold text-xs cursor-pointer disabled:opacity-50"
                disabled={busy}
                onClick={() => void confirm()}
              >
                Clear all data
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
