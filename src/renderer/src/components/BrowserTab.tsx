import { useCallback, useEffect, useRef, useState } from "react";
import { describeBrowserError, resolveTypedUrl } from "../browserError";
import { paneIsCovered, paneViewRect, rectsOverlap, type Candidate } from "../browserCoverage";

/** Half the divider drag strip, so the page never sits under it. */
const DIVIDER_INSET = 6;
/** How far inside our own rect the coverage samples sit. */

/** What the injected picker resolves with (mirrors PickedElement in main). */
interface PickedElement {
  selector: string;
  outerHTML: string;
  label: string;
  /** Viewport-relative, in CSS pixels — where to pin the comment popup. */
  rect?: { x: number; y: number; width: number; height: number };
}

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
 *    top — so anything that must appear ABOVE it is handled by HIDING the view.
 *    The rule is GEOMETRIC, not a class list: we hit-test our own rect and hide
 *    whenever something else is on top of it. The first version matched
 *    `.hv-overlay`, which turned out to be on 4 components out of ~35 floating
 *    surfaces — every dropdown, autocomplete, drawer and hand-rolled confirm was
 *    swallowing its own clicks, and the pane `+` menu (the one that got
 *    reported) shares neither the class NOR the styling of the others, so no
 *    selector would have found it. Hit-testing needs nothing from them.
 *  - STATES: loading/failed/blocked/crashed render HERE, over the placeholder,
 *    because the view shows nothing useful in any of them. §28: never a blank.
 */
export function BrowserTab({
  browserId,
  info,
  gridArea,
  hidden,
  edges,
  drawerWidth = 0,
  onPicked,
}: {
  browserId: string;
  info: HvBrowserInfo | undefined;
  gridArea?: string;
  hidden: boolean;
  /**
   * Width of the right-hand drawer when it is open, else 0.
   *
   * The drawer is the ONE overlay this pane makes room for instead of hiding
   * under. Everything else that floats — menus, autocompletes, dialogs — is
   * transient and arbitrarily placed, so hiding is right for them. The drawer
   * is a persistent rectangle pinned to the right edge, and hiding the whole
   * page to show a file tree beside it is a bad trade: you opened the drawer to
   * work WITH the page, not instead of it.
   */
  drawerWidth?: number;
  /** Which sides of this pane touch a divider — the view insets away from them. */
  edges?: { left: boolean; top: boolean; right: boolean; bottom: boolean };
  /**
   * §28 picker: the user clicked an element and wrote a comment. Returns false
   * when there is no chat to put it in, so the popup can say so rather than
   * swallowing what they typed.
   */
  onPicked?: (payload: {
    selector: string; outerHTML: string; label: string; comment: string;
    /** A crop of the element from the still, so the chat SHOWS what was meant. */
    thumbnail?: string;
  }) => boolean;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  // Read inside the bounds pusher without re-subscribing it on every render.
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const drawerRef = useRef(drawerWidth);
  drawerRef.current = drawerWidth;

  /**
   * The rect the view actually occupies: the placeholder, inset away from the
   * pane dividers and away from the drawer.
   *
   * ONE function on purpose. The bounds we push and the points we hit-test have
   * to describe the same rectangle — if they drift, the page either covers
   * something we did not sample or hides for something it no longer reaches.
   */
  const effectiveRect = useCallback(
    (el: HTMLElement) =>
      paneViewRect(el.getBoundingClientRect(), edgesRef.current, DIVIDER_INSET, drawerRef.current, window.innerWidth),
    [],
  );
  const [urlDraft, setUrlDraft] = useState(info?.url ?? "");
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  /** A scheme we refuse to open, named so the bar can say which. */
  const [schemeError, setSchemeError] = useState<string | null>(null);
  /** There is no chat to file a comment into — said out loud, never swallowed. */
  const [noChat, setNoChat] = useState(false);
  /** Is anything covering our rect? While true the view MUST be hidden. */
  const [covered, setCovered] = useState(false);

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
      // §28 round 1: keep the page off the pane dividers (the drag strip is 10px
      // centred on the boundary, so half lies inside this pane and a composited
      // view over it makes the divider ungrabbable), and §7 round 13: keep it
      // out from under the drawer so both can be on screen at once.
      void window.hv.browserBounds(browserId, effectiveRect(el));
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
  }, [browserId, edges, drawerWidth, effectiveRect]);

  /**
   * "Is anything on top of us?", asked geometrically — by RECTANGLE.
   *
   * A composited view swallows the clicks meant for whatever is drawn over it,
   * so anything above the pane means the page must get out of the way.
   *
   * This replaces a 3×3 point sample, and the gaps were the whole problem. Nine
   * points miss a small, edge-anchored surface: the onboarding card (bottom
   * right, inset 24px) fell between them, and so did the pane `+` menu dropping
   * in from the top edge — reported as a menu rendering clipped at the page's
   * top, because the view never moved. `elementFromPoint` is also blind to
   * `pointer-events: none`, which the voice pill sets. Rectangles have neither
   * failure mode.
   *
   * Candidates are found WITHOUT a marker list, which is the property the
   * geometric rule exists for: this app is styled entirely with Tailwind, so
   * every floating surface carries `absolute` or `fixed` as a literal class
   * word. That catches the dropdown nobody remembered to mark, and the one that
   * does not exist yet. `[class~=]` matches a whole word, so `absolute` does not
   * also match some future `absolute-something`.
   */
  useEffect(() => {
    let raf = 0;
    const check = (): void => {
      const el = host.current;
      if (!el) return;
      // The rect the view ACTUALLY occupies — it stops short of the drawer, so
      // the drawer is not something to hide from (see paneViewRect).
      const e = effectiveRect(el);
      const view = { left: e.x, top: e.y, right: e.x + e.width, bottom: e.y + e.height };
      // A drawer wider than the pane leaves nothing to show.
      if (e.width < 1 || e.height < 1) {
        setCovered(true);
        return;
      }
      const nodes = document.querySelectorAll<HTMLElement>('[class~="absolute"], [class~="fixed"]');
      const candidates: Candidate[] = [];
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        // Cheap rejects first; getComputedStyle only for what actually overlaps.
        if (rect.width < 1 || rect.height < 1) continue;
        const isSelf = el.contains(node) || node.contains(el);
        const isDrawer = !!node.closest("[data-hv-drawer]");
        if (isSelf || isDrawer) continue;
        if (!rectsOverlap(view, rect)) continue;
        const cs = getComputedStyle(node);
        candidates.push({
          rect,
          isSelf: false,
          isDrawer: false,
          visible: cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0",
        });
      }
      setCovered(paneIsCovered(view, candidates));
    };
    // Coalesced: streaming text mutates the body continuously, and one pass per
    // frame is the most this can ever cost.
    //
    // rAF alone is not enough. The platform PAUSES it while the window is
    // occluded, and this decides whether a dialog is reachable — a correctness
    // question must not hang on a clock someone else can stop. So a timer races
    // it and whichever fires first does the work.
    let timer: ReturnType<typeof setTimeout> | 0 = 0;
    const run = (): void => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      raf = 0;
      timer = 0;
      check();
    };
    const schedule = (): void => {
      if (raf || timer) return;
      raf = requestAnimationFrame(run);
      timer = setTimeout(run, 200);
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      mo.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
    // `drawerWidth` is a dependency because opening the drawer does not mutate
    // anything this observer watches — the placeholder never resizes, since the
    // drawer is an overlay — so without it the samples would keep testing the
    // old rect.
  }, [drawerWidth, effectiveRect]);

  // One place decides whether the view is on screen: hidden tab, something drawn
  // over us, or the comment popup (which shows a frozen still instead).
  useEffect(() => {
    void window.hv.browserVisible(browserId, !hidden && !covered && !picked);
  }, [browserId, hidden, covered, picked]);

  // Hide it on unmount too, or a closed tab leaves a page floating over the app.
  useEffect(() => () => void window.hv.browserVisible(browserId, false), [browserId]);

  const go = (): void => {
    setEditing(false);
    const resolved = resolveTypedUrl(urlDraft);
    if (!resolved) return;
    if ("unsupported" in resolved) {
      // Say it, rather than prefixing `https://` onto `file:` and letting the
      // navigation die silently inside will-navigate.
      setSchemeError(resolved.unsupported);
      return;
    }
    setSchemeError(null);
    void window.hv.browserNavigate(browserId, resolved.url);
  };

  const startPick = (): void => {
    setPicking(true);
    void window.hv
      .browserPick(browserId)
      .then((res) => {
        setPicking(false);
        if (!res) return;
        // main captured the page while it was still visible; we show that still
        // under the popup, because the live view would cover the popup itself.
        setFrozen(res.imageBase64 ? `data:image/png;base64,${res.imageBase64}` : null);
        setPicked(res.element);
      })
      .catch(() => setPicking(false));
  };

  const cancelPick = (): void => {
    setPicking(false);
    setPicked(null);
    setFrozen(null);
    setNoChat(false);
    setComment("");
    void window.hv.browserPickCancel(browserId);
  };

  /**
   * Cut the element out of the still we already captured.
   *
   * The still is a device-pixel capture of the view and `rect` is in CSS pixels,
   * so the scale comes from the image's natural width over the box it is drawn
   * in — the same box the capture covered. A little padding keeps the element
   * from looking like it was sliced out of context.
   */
  const cropThumbnail = async (): Promise<string | undefined> => {
    const rect = picked?.rect;
    if (!frozen || !rect || !host.current) return undefined;
    try {
      const box = host.current.getBoundingClientRect();
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("still failed to decode"));
        img.src = frozen;
      });
      const scale = img.naturalWidth / (box.width || 1);
      const PAD = 8;
      const sx = Math.max(0, (rect.x - PAD) * scale);
      const sy = Math.max(0, (rect.y - PAD) * scale);
      const sw = Math.min(img.naturalWidth - sx, (rect.width + PAD * 2) * scale);
      const sh = Math.min(img.naturalHeight - sy, (rect.height + PAD * 2) * scale);
      if (sw < 2 || sh < 2) return undefined;
      // Bounded: this rides the message payload, and a full-page element would
      // otherwise ship a megabyte to say "this button".
      const k = Math.min(1, 640 / sw, 640 / sh);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sw * k));
      canvas.height = Math.max(1, Math.round(sh * k));
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } catch {
      return undefined; // a missing picture must never cost the comment
    }
  };

  const sendComment = async (): Promise<void> => {
    if (!picked) return;
    const thumbnail = await cropThumbnail();
    const delivered = onPicked?.({ ...picked, comment: comment.trim(), thumbnail }) ?? false;
    if (!delivered) {
      // Nowhere to send it. Keep the popup and the typed text; losing both
      // without a word is what this replaces.
      setNoChat(true);
      return;
    }
    setNoChat(false);
    setPicked(null);
    setFrozen(null);
    setComment("");
  };

  const state = info?.state ?? "loading";

  return (
    <div
      className="relative min-h-0 min-w-0 flex flex-col overflow-hidden bg-paper"
      style={{ gridArea, display: hidden ? "none" : "flex" }}
    >
      {/* Top bar — the ordinary browser controls, in the ordinary order. */}
      {/* §28 round 1: h-11 px-3 is shared with the chat and editor bars so the
          three pane headers line up with each other and with the 44px tab strip
          (STRIP_PX, paneGrid.ts) instead of each being content-sized. */}
      <div className="flex items-center gap-1.5 border-b-2 border-line px-3 h-11 shrink-0">
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
            setSchemeError(null);
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
        <BarButton
          label={picking ? "Cancel picking" : "Comment on an element"}
          active={picking || !!picked}
          onClick={picking || picked ? cancelPick : startPick}
        >
          {/* A speech bubble with a pointer: "say something about this thing". */}
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </BarButton>
      </div>

      {schemeError && (
        // Said plainly instead of prefixing `https://` onto it and letting the
        // navigation die inside will-navigate with nothing on screen.
        <div className="border-b-2 border-berry/50 bg-berry-soft px-3 py-1.5 text-[12px] font-semibold text-berry shrink-0">
          HappyVibe&apos;s browser only opens http and https — not {schemeError}:
        </div>
      )}
      {/* The page goes HERE — main puts the composited view over this box. */}
      {/* `data-covered` mirrors the decision that hides the view. The page is not
          in the DOM, so without it there is no way to ask "is something on top of
          me?" from outside — which is exactly the question that was wrong twice. */}
      <div ref={host} data-covered={covered ? "true" : "false"} className="relative min-h-0 flex-1">
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
        {state === "failed" && (() => {
          // §28 round 1: a sentence, and a button that changes something. The raw
          // Chromium string stays underneath as `detail` for whoever needs it.
          const copy = describeBrowserError(info?.url ?? "", info?.errorCode, info?.error);
          return (
            <StateCard
              tone="berry"
              title={copy.title}
              body={copy.body}
              detail={info?.error}
              action={
                copy.retryAs
                  ? { label: copy.retryLabel ?? "Retry", onClick: () => void window.hv.browserNavigate(browserId, copy.retryAs!) }
                  : { label: "Try again", onClick: () => void window.hv.browserReload(browserId) }
              }
            />
          );
        })()}
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
          // §28 round 1: pinned to the element instead of a centred dialog.
          //
          // The page underneath is a STILL, captured by main at the moment of the
          // click. That is not decoration: a composited WebContentsView has no
          // z-index, so a popup over the LIVE page cannot be seen at all — the
          // page has to go, and a frozen frame is what keeps the user looking at
          // what they just clicked instead of at a blank pane.
          <>
            {frozen && <img src={frozen} alt="" className="absolute inset-0 h-full w-full object-fill select-none" draggable={false} />}
            <div className="absolute inset-0 bg-ink/10" onMouseDown={cancelPick} />
            {picked.rect && (
              // The same tangerine outline the injected picker drew, redrawn here
              // because the picker tore its own highlight down when it resolved.
              <div
                className="pointer-events-none absolute rounded-[3px] border-2 border-tangerine bg-tangerine/10"
                style={{ left: picked.rect.x, top: picked.rect.y, width: picked.rect.width, height: picked.rect.height }}
              />
            )}
            <div
              className="absolute z-10 flex items-center gap-1.5 rounded-xl border-2 border-line-strong bg-paper px-2 py-1 shadow-pop"
              style={popupStyle(picked.rect, host.current)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* No label chip: the outline already says which element this is,
                  and naming it again in the popup was one more thing to read for
                  no information. The label still travels in the payload for the
                  composer chip and the message. */}
              <input
                autoFocus
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendComment();
                  if (e.key === "Escape") cancelPick();
                }}
                placeholder="What should it do?"
                className="w-64 min-w-0 bg-transparent text-[13px] outline-none"
                aria-label={`Comment on ${picked.label}`}
              />
              <button
                type="button"
                onClick={() => void sendComment()}
                aria-label="Add this comment to the composer"
                title="Add to the composer"
                className="shrink-0 size-7 flex items-center justify-center rounded-lg text-tangerine hover:bg-paper-deep/40 cursor-pointer"
              >
                <SendIcon />
              </button>
            </div>
            {noChat && (
              <div
                className="absolute z-10 rounded-lg border-2 border-berry/50 bg-berry-soft px-2 py-1 text-[11px] font-semibold text-berry"
                style={noticeStyle(picked.rect, host.current)}
              >
                Open a chat first — there is nowhere to send this.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Put the pill beside the element: under it by default, above when that would
 * fall out of the pane, and clamped horizontally so it is never half off-screen.
 * No rect (a page that moved the element) ⇒ centred, which is still usable.
 */
function popupStyle(
  rect: { x: number; y: number; width: number; height: number } | undefined,
  host: HTMLDivElement | null,
): React.CSSProperties {
  if (!rect || !host) return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  const box = host.getBoundingClientRect();
  const PILL_W = 300;
  const PILL_H = 44;
  const GAP = 8;
  const below = rect.y + rect.height + GAP;
  const top = below + PILL_H < box.height ? below : Math.max(GAP, rect.y - PILL_H - GAP);
  const left = Math.max(GAP, Math.min(rect.x, box.width - PILL_W - GAP));
  return { left, top };
}

/** Just under the pill, so the reason sits with the thing that refused. */
function noticeStyle(
  rect: { x: number; y: number; width: number; height: number } | undefined,
  host: HTMLDivElement | null,
): React.CSSProperties {
  const base = popupStyle(rect, host);
  const top = typeof base.top === "number" ? base.top + 44 : undefined;
  return top === undefined ? { left: "50%", top: "60%", transform: "translate(-50%, 0)" } : { left: base.left, top };
}

/** The composer's paper plane (ChatView SendIcon), so "send" looks like "send". */
function SendIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

function BarButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Pressed look for a toggle — the same tangerine fill FileTab's pill uses. */
  active?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      // The icon has no text, so this IS its accessible name.
      aria-label={label}
      aria-pressed={active}
      className={`shrink-0 rounded-lg border-2 p-1 disabled:opacity-40 disabled:cursor-default cursor-pointer ${
        active ? "border-ink/80 bg-tangerine text-paper" : "border-line bg-card text-ink hover:bg-paper-deep"
      }`}
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
  detail,
  action,
}: {
  tone: "berry";
  title: string;
  body: string;
  /** The raw diagnostic, kept visible but demoted below the plain sentence. */
  detail?: string;
  action: { label: string; onClick: () => void };
}): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-paper p-6">
      <div className={`max-w-md rounded-2xl border-2 border-${tone} bg-card p-4 text-center shadow-pop`}>
        <div className="mb-1 font-bold">{title}</div>
        <div className="mb-3 text-sm text-ink-soft break-words">{body}</div>
        {detail && <div className="mb-3 font-mono text-[11px] text-ink-soft/80 break-all">{detail}</div>}
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
