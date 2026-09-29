import { externalDocUrl, GUIDE_COPY } from "../docsLinks";

/**
 * Docs in the app (2026-09-29): the user guide as a page of the app. The whole page content is
 * this — a slim bar over an iframe of the deployed guide.
 *
 * An iframe and not a browser pane on purpose: a pane is a native view that paints above every
 * dialog and permission prompt, and an iframe is plain DOM. The renderer CSP allows exactly one
 * frame origin (index.html); main sends any link that would leave the guide to the system browser
 * (`frameNavAction`). Offline the frame is blank, and "Open in browser" is the way out.
 *
 * `nonce` is the frame's key: opening a deep link again reloads it, even when the address is the
 * same one the reader has since clicked away from.
 */
export function GuideView({ url, nonce, onBack }: { url: string; nonce: number; onBack: () => void }): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-3 border-b-2 border-line px-4 py-2">
        <button type="button" onClick={onBack} className="text-[13px] font-bold text-ink-soft hover:text-ink cursor-pointer">
          {GUIDE_COPY.back}
        </button>
        <span className="font-black text-sm">{GUIDE_COPY.title}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void window.hv.openExternal(externalDocUrl(url))}
          className="text-[13px] font-bold text-ink-soft hover:text-ink cursor-pointer"
        >
          {GUIDE_COPY.external}
        </button>
      </div>
      <iframe
        key={nonce}
        title={GUIDE_COPY.title}
        src={url}
        sandbox="allow-scripts allow-same-origin"
        className="flex-1 min-h-0 w-full bg-paper"
      />
    </div>
  );
}
