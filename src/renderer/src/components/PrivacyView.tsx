import { useCallback, useEffect, useState } from "react";
import { Section } from "./Section";
import { HowItWorks } from "./HowItWorks";
import type { HvCrashInfo } from "../hv";
import { REVEAL_IN_FILE_MANAGER } from "../platformCopy";

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
 */
const smallBtn =
  "rounded-lg border-2 px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

export function PrivacyView(): React.JSX.Element {
  const [on, setOn] = useState(true);
  const [stats, setStats] = useState(true);
  const [info, setInfo] = useState<HvCrashInfo | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reset, setReset] = useState<{ blockers: Array<{ path: string; reason: string }> } | null>(null);

  // After an opt-out the report is gone; the button must not stay on "Hide".
  useEffect(() => {
    if (!info?.lastReport) setShowReport(false);
  }, [info]);

  const refresh = useCallback(() => {
    void window.hv.crashInfo().then(setInfo);
  }, []);

  useEffect(() => {
    void window.hv.getCrashReports().then(setOn);
    void window.hv.getUsageStats().then(setStats);
    refresh();
    // A report can land while the page is open; the "last report" block is the
    // page's own evidence, so it must not be a snapshot taken at mount.
    return window.hv.onCrashSent(() => refresh());
  }, [refresh]);

  const toggle = (): void => {
    const next = !on;
    setOn(next);
    // No "takes effect on next launch" caveat anywhere on this page, and that
    // is a claim the code has to earn: the client is always initialised, so
    // `setCrashReports` starts and stops reporting immediately.
    void window.hv.setCrashReports(next).then(refresh);
  };

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
        <div className="rounded-xl border-2 border-line bg-card p-4 flex items-start justify-between gap-4">
          <div>
            <div className="font-bold">Send anonymous usage statistics</div>
            <p className="text-sm text-ink-soft mt-0.5">
              The app also checks HappyVibe&apos;s server for settings, such as whether the free web service is
              available. That check carries a random device ID so gradual changes reach the same devices. Turning
              statistics off doesn&apos;t stop it, but the ID is replaced with a new one that isn&apos;t linked to your
              statistics.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !stats;
              setStats(next);
              void window.hv.setUsageStats(next).then(refresh); // off also forgets the kept crash report
            }}
            className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer ${
              stats ? "bg-leaf text-paper border-leaf" : "bg-card text-ink border-line hover:border-leaf"
            }`}
          >
            {stats ? "On" : "Off"}
          </button>
        </div>
        <div className="mt-4">
          <HowItWorks copy="usageStats" />
        </div>
      </Section>

      <Section icon="audit" title="Crash reports" subtitle="Automatic, and content-free by design.">
        <div className="rounded-xl border-2 border-line bg-card p-4 flex items-start justify-between gap-4">
          <div>
            <div className="font-bold">Send crash reports</div>
            <p className="text-sm text-ink-soft mt-0.5">
              When HappyVibe itself breaks, send a short technical report so it can be fixed. Never your prompts,
              your files or your keys.
            </p>
          </div>
          <button
            type="button"
            onClick={toggle}
            className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer ${
              on ? "bg-leaf text-paper border-leaf" : "bg-card text-ink border-line hover:border-leaf"
            }`}
          >
            {on ? "On" : "Off"}
          </button>
        </div>

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
