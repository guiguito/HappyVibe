import { useCallback, useEffect, useState } from "react";
import { Section } from "./Section";
import { HowItWorks } from "./HowItWorks";
import type { HvCrashInfo } from "../hv";

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
  const [info, setInfo] = useState<HvCrashInfo | null>(null);
  const [showReport, setShowReport] = useState(false);

  const refresh = useCallback(() => {
    void window.hv.crashInfo().then(setInfo);
  }, []);

  useEffect(() => {
    void window.hv.getCrashReports().then(setOn);
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
    <div className="mx-auto w-full max-w-3xl p-8">
      <h1 className="font-black text-3xl tracking-tight mb-1">Privacy</h1>
      <p className="text-sm text-ink-soft mb-6">
        What leaves this machine, and how to stop it. Everything else — your sessions, your files, your keys, your
        audit log and your stats — stays here.
      </p>

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
            Reveal crash reports
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
    </div>
  );
}
