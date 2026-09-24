import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// §30: the bundled notes. `?raw` inlines the file into the renderer bundle at
// build time — no new dependency, no change to what gets packaged, and no fs
// read at runtime, which matters because the packaged app has no repo to read
// from. CHANGELOG.md lives at the repo root, four levels up from here.
import changelog from "../../../../CHANGELOG.md?raw";
import { Toggle } from "./Toggle";
import { relativeChecked, useUpdateState } from "./UpdateRow";
import { UPDATE_COPY as C } from "./updateCopy";

/**
 * §30: the Changelog page. Product state, like Stats and Audit log — this does
 * NOT reopen round 8's deletion of the Help nav entry (§7); a changelog is not
 * documentation.
 *
 * The header reports the version you are RUNNING and the pins that were built
 * into it. The pins deliberately appear a second time at the foot of each
 * entry: the two answer different questions — the header is this build, an
 * entry is the build it shipped in — and they diverge on every entry but the
 * newest. That is the point, not a stutter to tidy away.
 *
 * §38 superseded the old "explicitly not here: any update check" — a publish
 * feed exists now, so the header carries *Last checked · Check now* and the
 * auto-download switch. After an update this page simply renders the new
 * build's notes; there is no separate "what's new".
 */
export function ChangelogView(): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight">HappyVibe {__APP_VERSION__}</h1>
        <p className="text-sm text-ink-soft font-mono mt-1">{__RUNTIME_PINS__}</p>
        <UpdateControls />
        <div className="md rounded-2xl bg-card border-2 border-line shadow-sticker-lg px-6 py-5 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{changelog}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

/** §38: the two things a user does about updates, on the page whose subject is "which version am I on". */
function UpdateControls(): React.JSX.Element {
  const s = useUpdateState();
  if (!s) return <div className="mb-8" />;
  if (s.mode === "disabled") return <p className="text-sm text-ink-soft mt-3 mb-8">{C.devOff}</p>;
  const p = s.phase;
  const status =
    p.k === "checking" ? C.checking : p.k === "idle" && p.upToDate ? C.upToDate : relativeChecked(s.lastCheckedAt, Date.now());
  return (
    <div className="mt-3 mb-8 space-y-2 text-sm">
      <p className="text-ink-soft">
        {status}
        {p.k !== "checking" && (
          <>
            {" · "}
            <button type="button" onClick={() => void window.hv.updateCheck()} className="underline cursor-pointer">
              {C.checkNow}
            </button>
          </>
        )}
      </p>
      {/* Only an error the user ASKED for is shown, verbatim (the §27 lesson). */}
      {p.k === "error" && p.manual && <p className="text-ink font-mono text-xs">{p.message}</p>}
      {s.mode === "auto" && (
        <label className="flex items-center gap-3">
          <Toggle on={s.auto} onChange={(v) => void window.hv.updateSetAuto(v)} label={C.auto} />
          <span>{C.auto}</span>
        </label>
      )}
    </div>
  );
}
