import { useEffect, useRef, useState } from "react";

/**
 * §28 — the browser pane's CHROME. The page itself is not in this DOM.
 *
 * A WebContentsView composites OVER the renderer, so what this component
 * renders is a top bar plus an empty placeholder; main positions the real view
 * to cover exactly that placeholder. Everything below follows from that:
 *
 *  - BOUNDS: a ResizeObserver on the placeholder pushes its window-space rect to
 *    main. Scroll/resize/split-drag all end up here.
 *  - VISIBILITY: the view has no z-index relative to our DOM — it is always on
 *    top — so anything that must appear ABOVE it (the permission modal, any
 *    dialog) is handled by HIDING the view. One MutationObserver watches for
 *    `.hv-overlay`, which every Radix overlay in the app already carries, so a
 *    new dialog inherits the behaviour without touching this file.
 *  - STATES: loading/failed/blocked/crashed render HERE, over the placeholder,
 *    because the view shows nothing useful in any of them. §28: never a blank.
 */
export function BrowserTab({
  browserId,
  info,
  gridArea,
  hidden,
  onPicked,
}: {
  browserId: string;
  info: HvBrowserInfo | undefined;
  gridArea?: string;
  hidden: boolean;
  /** §28 picker: the user clicked an element and wrote a comment. */
  onPicked?: (payload: { selector: string; outerHTML: string; label: string; comment: string }) => void;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const [urlDraft, setUrlDraft] = useState(info?.url ?? "");
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ selector: string; outerHTML: string; label: string } | null>(null);
  const [comment, setComment] = useState("");
  /** Any modal open? While true the view MUST be hidden (the z-order rule). */
  const [overlay, setOverlay] = useState(false);

  // The URL bar follows the page unless the user is mid-edit — typing must
  // never be overwritten by a redirect landing.
  useEffect(() => {
    if (!editing) setUrlDraft(info?.url ?? "");
  }, [info?.url, editing]);

  // Bounds: measure the placeholder, tell main. rAF-batched via the observer's
  // own callback, and re-run on scroll because a pane can move without resizing.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const push = (): void => {
      const r = el.getBoundingClientRect();
      void window.hv.browserBounds(browserId, { x: r.x, y: r.y, width: r.width, height: r.height });
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    window.addEventListener("resize", push);
    // A split-drag moves siblings without resizing THIS element, so also watch
    // the layout container's mutations.
    const mo = new MutationObserver(push);
    if (el.parentElement) mo.observe(el.parentElement, { attributes: true, attributeFilter: ["style", "class"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", push);
    };
  }, [browserId]);

  /**
   * The modal-wins watcher. `.hv-overlay` is on every Radix overlay in the app
   * (PermissionModal included), so this one rule covers dialogs that do not
   * exist yet — which is the point: a permission prompt appearing UNDER the
   * page would be a security control the user cannot reach.
   */
  useEffect(() => {
    const check = (): void => setOverlay(!!document.querySelector(".hv-overlay"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // One place decides whether the view is on screen: hidden tab, another view
  // in front, or a modal up.
  useEffect(() => {
    void window.hv.browserVisible(browserId, !hidden && !overlay && !picked);
  }, [browserId, hidden, overlay, picked]);

  // Hide it on unmount too, or a closed tab leaves a page floating over the app.
  useEffect(() => () => void window.hv.browserVisible(browserId, false), [browserId]);

  const go = (): void => {
    setEditing(false);
    const url = urlDraft.trim();
    if (url) void window.hv.browserNavigate(browserId, url);
  };

  const startPick = (): void => {
    setPicking(true);
    void window.hv
      .browserPick(browserId)
      .then((el) => {
        setPicking(false);
        if (el) setPicked(el);
      })
      .catch(() => setPicking(false));
  };

  const cancelPick = (): void => {
    setPicking(false);
    setPicked(null);
    setComment("");
    void window.hv.browserPickCancel(browserId);
  };

  const sendComment = (): void => {
    if (picked) onPicked?.({ ...picked, comment: comment.trim() });
    setPicked(null);
    setComment("");
  };

  const state = info?.state ?? "loading";

  return (
    <div
      className="relative min-h-0 min-w-0 flex flex-col overflow-hidden bg-paper"
      style={{ gridArea, display: hidden ? "none" : "flex" }}
    >
      {/* Top bar — the ordinary browser controls, in the ordinary order. */}
      <div className="flex items-center gap-1 border-b-2 border-line px-2 py-1.5 shrink-0">
        <BarButton label="Back" disabled={!info?.canGoBack} onClick={() => void window.hv.browserBack(browserId)}>
          <path d="M15 18l-6-6 6-6" />
        </BarButton>
        <BarButton label="Forward" disabled={!info?.canGoForward} onClick={() => void window.hv.browserForward(browserId)}>
          <path d="M9 18l6-6-6-6" />
        </BarButton>
        <BarButton label="Reload" onClick={() => void window.hv.browserReload(browserId)}>
          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
          <path d="M21 3v6h-6" />
        </BarButton>
        <input
          value={urlDraft}
          onChange={(e) => {
            setEditing(true);
            setUrlDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
            if (e.key === "Escape") {
              setEditing(false);
              setUrlDraft(info?.url ?? "");
            }
          }}
          onBlur={() => setEditing(false)}
          placeholder="Enter a URL"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border-2 border-line bg-card px-2 py-1 font-mono text-[12px] outline-none focus:border-line-strong"
        />
        <button
          type="button"
          onClick={picking || picked ? cancelPick : startPick}
          aria-pressed={picking || !!picked}
          title="Pick an element and comment on it"
          className={`shrink-0 rounded-lg border-2 px-2 py-1 text-[12px] font-bold cursor-pointer ${
            picking || picked ? "border-ink/80 bg-tangerine text-paper" : "border-line bg-card hover:bg-paper-deep"
          }`}
        >
          {picking ? "Pick an element…" : "Comment"}
        </button>
      </div>

      {/* The page goes HERE — main puts the composited view over this box. */}
      <div ref={host} className="relative min-h-0 flex-1">
        {state === "loading" && (
          <div className="absolute inset-x-0 top-0 h-0.5 bg-tangerine animate-pulse" />
        )}
        {state === "blocked" && (
          <StateCard
            tone="berry"
            title={`Blocked: ${info?.blockedHost ?? "that site"}`}
            body="The agent's browser only reaches localhost without your say-so. Allowing this adds the host for this pane."
            action={{ label: `Allow ${info?.blockedHost ?? "it"}`, onClick: () => void window.hv.browserAllowBlocked(browserId) }}
          />
        )}
        {state === "failed" && (
          <StateCard
            tone="berry"
            title="The page did not load"
            body={info?.error ?? "Chromium gave no reason."}
            action={{ label: "Try again", onClick: () => void window.hv.browserReload(browserId) }}
          />
        )}
        {state === "crashed" && (
          <StateCard
            tone="berry"
            title="The page crashed"
            body="Its renderer process went away. Reloading starts it again."
            action={{ label: "Reload", onClick: () => void window.hv.browserReload(browserId) }}
          />
        )}
        {picking && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t-2 border-line-strong bg-paper/95 px-3 py-1.5 text-[12px] font-bold text-ink-soft">
            Hover to highlight a component, click to comment on it. Esc or Cancel to stop.
          </div>
        )}
        {picked && (
          // The view is hidden while this is up (see the visibility effect), so
          // the popup is an ordinary DOM child rather than an overlay fight.
          <div className="absolute inset-0 flex items-center justify-center bg-ink/40 p-4">
            <div className="w-full max-w-md rounded-2xl border-2 border-ink/80 bg-card p-4 shadow-pop">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-soft">Comment on this element</div>
              <div className="mb-3 truncate rounded-lg border-2 border-line bg-paper px-2 py-1 font-mono text-[11px]">{picked.label}</div>
              <textarea
                autoFocus
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendComment();
                  if (e.key === "Escape") cancelPick();
                }}
                rows={3}
                placeholder="What is wrong with it, or what should it do?"
                className="mb-3 w-full resize-none rounded-lg border-2 border-line bg-paper px-2 py-1.5 text-sm outline-none focus:border-line-strong"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={cancelPick} className="rounded-xl border-2 border-ink/80 bg-card px-3 py-1.5 text-sm font-bold cursor-pointer hover:bg-paper-deep">
                  Cancel
                </button>
                <button type="button" onClick={sendComment} className="rounded-xl border-2 border-ink/80 bg-honey px-3 py-1.5 text-sm font-bold cursor-pointer hover:brightness-105">
                  Add to composer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="shrink-0 rounded-lg border-2 border-line bg-card p-1 text-ink hover:bg-paper-deep disabled:opacity-40 disabled:cursor-default cursor-pointer"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

/** §28: every non-ready state says what happened and offers the way out. */
function StateCard({
  tone,
  title,
  body,
  action,
}: {
  tone: "berry";
  title: string;
  body: string;
  action: { label: string; onClick: () => void };
}): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-paper p-6">
      <div className={`max-w-md rounded-2xl border-2 border-${tone} bg-card p-4 text-center shadow-pop`}>
        <div className="mb-1 font-bold">{title}</div>
        <div className="mb-3 text-sm text-ink-soft break-words">{body}</div>
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-xl border-2 border-ink/80 bg-honey px-3 py-1.5 text-sm font-bold cursor-pointer hover:brightness-105"
        >
          {action.label}
        </button>
      </div>
    </div>
  );
}
