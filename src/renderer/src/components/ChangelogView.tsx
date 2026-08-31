import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// §30: the bundled notes. `?raw` inlines the file into the renderer bundle at
// build time — no new dependency, no change to what gets packaged, and no fs
// read at runtime, which matters because the packaged app has no repo to read
// from. CHANGELOG.md lives at the repo root, four levels up from here.
import changelog from "../../../../CHANGELOG.md?raw";

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
 * Explicitly not here: any check for a newer version. That needs a publish feed
 * the app does not have, and claiming to know would be a lie.
 */
export function ChangelogView(): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight">HappyVibe {__APP_VERSION__}</h1>
        <p className="text-sm text-ink-soft font-mono mt-1 mb-8">{__RUNTIME_PINS__}</p>
        <div className="md rounded-2xl bg-card border-2 border-line shadow-sticker-lg px-6 py-5 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{changelog}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
