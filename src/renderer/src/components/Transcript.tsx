import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCard, ToolIcon, type ToolCardData } from "./ToolCard";
import { PlanCard, type PlanCardData } from "./PlanCard";
import { splitMentionSegments, stripInjectedBlocks } from "../mentions";

// Feedback round 3 #4: user messages longer than this render collapsed with a
// "Show more" toggle. ponytail: single char threshold ~ "10 pages"; tune if needed.
const LONG_MESSAGE_CHARS = 3000;

/** Copy-to-clipboard button (feedback round 3 #9). Brief "Copied" ack. */
function CopyButton({ text, label }: { text: string; label: string }): React.JSX.Element {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="rounded-lg border-2 border-line bg-card p-1 text-ink-soft hover:text-ink hover:bg-paper-deep cursor-pointer shadow-sticker"
    >
      <ToolIcon kind={done ? "check" : "copy"} className="size-3.5" />
    </button>
  );
}

/** Rewind button (feedback round 3 #11) — only rendered when onRewind is wired. */
function RewindButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label="Rewind to this message"
      title="Rewind to this message (removes everything after; files are not rolled back)"
      onClick={onClick}
      className="rounded-lg border-2 border-line bg-card p-1 text-ink-soft hover:text-ink hover:bg-paper-deep cursor-pointer shadow-sticker"
    >
      <ToolIcon kind="rewind" className="size-3.5" />
    </button>
  );
}

/** Click-to-zoom image + lightbox overlay (feedback round 3 #6). */
function ZoomableImage({ src }: { src: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <img
        src={src}
        alt="attached image"
        onClick={() => setOpen(true)}
        className="max-h-24 max-w-40 rounded-lg border-2 border-paper/60 object-cover cursor-zoom-in"
      />
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-8 cursor-zoom-out"
        >
          <img src={src} alt="attached image (zoomed)" className="max-h-full max-w-full rounded-xl shadow-2xl" />
        </div>
      )}
    </>
  );
}

// Perf: `id` is a stable key assigned at append time (see App.appendItem). Keying
// on it instead of the array index lets React.memo skip re-parsing committed
// markdown when new items arrive or the live streaming bubble updates.
export type TranscriptItem = { id?: number } & (
  // W2.1: `images` = data URLs of attached images (user bubbles only).
  | { kind: "user" | "assistant"; text: string; images?: string[] }
  | { kind: "tool"; card: ToolCardData }
  // §23: the plan-ready card (read from the workspace plan file).
  | { kind: "plan"; card: PlanCardData }
  // B2: provider errors / session crashes as first-class transcript items.
  | { kind: "error"; text: string; retriable?: boolean }
  // A neutral, warm status line (not an error). `pending` shows an ongoing
  // spinner (e.g. "Compacting context…") that resolves in place on completion.
  | { kind: "notice"; text: string; pending?: boolean }
);

// Perf: memoized so a committed assistant message only re-parses markdown when
// its own props change — not on every delta of the live streaming bubble.
const MessageItem = memo(function MessageItem({
  it,
  onRetry,
  workspace,
  onOpenFile,
  onRewind,
}: {
  it: TranscriptItem;
  onRetry?: () => void;
  /** W2.2: session workspace + open-in-editor for clickable card paths. */
  workspace?: string | null;
  onOpenFile?: (relPath: string) => void;
  /** Round 3 #11: rewind to a user message (only wired for user items). */
  onRewind?: (it: TranscriptItem) => void;
}): React.JSX.Element {
  if (it.kind === "tool") return <ToolCard card={it.card} workspace={workspace} onOpenFile={onOpenFile} />;
  if (it.kind === "plan") return <PlanCard card={it.card} onOpenFile={onOpenFile} />;
  if (it.kind === "error") {
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-berry/50 bg-berry-soft px-3.5 py-2.5 shadow-sticker">
        <span className="size-2.5 rounded-full bg-berry shrink-0" />
        <span className="flex-1 min-w-0 text-sm font-semibold text-berry break-words">{it.text}</span>
        {it.retriable && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-lg bg-berry text-paper font-bold text-xs px-3 py-1.5 border-2 border-berry hover:brightness-110 cursor-pointer"
          >
            Restart &amp; resend
          </button>
        )}
      </div>
    );
  }
  if (it.kind === "notice") {
    return (
      <div className="flex items-center gap-2.5 self-center rounded-full border-2 border-line bg-card px-3.5 py-1.5 text-xs font-semibold text-ink-soft shadow-sticker">
        {it.pending ? (
          <span className="size-2 rounded-full bg-honey animate-pulse shrink-0" />
        ) : (
          <span className="size-2 rounded-full bg-leaf shrink-0" />
        )}
        <span>{it.text}</span>
      </div>
    );
  }
  if (it.kind === "assistant") {
    return (
      <div className="group">
        <AssistantBubble text={it.text} />
        <div className="flex justify-start mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyButton text={it.text} label="Copy answer" />
        </div>
      </div>
    );
  }
  return <UserBubble it={it} onRewind={onRewind} />;
});

/** User message bubble: zoomable images, long-message collapse (#4),
    per-message copy (#9) and optional rewind (#11). */
function UserBubble({
  it,
  onRewind,
}: {
  it: TranscriptItem;
  onRewind?: (it: TranscriptItem) => void;
}): React.JSX.Element {
  // F3: strip the hidden @file context blocks so the bubble (and copy/search)
  // shows only what the user wrote; @tokens render as chips.
  const text = stripInjectedBlocks("text" in it ? it.text : "");
  const images = "images" in it ? it.images : undefined;
  const [expanded, setExpanded] = useState(false);
  const long = text.length > LONG_MESSAGE_CHARS;
  const collapsed = long && !expanded;
  return (
    <div className="self-end max-w-[85%] group">
      <div className="bg-tangerine text-paper rounded-2xl rounded-br-md px-4 py-2.5 shadow-sticker border-2 border-tangerine-deep whitespace-pre-wrap text-[0.95rem]">
        {/* W2.1: attached images ride the same bubble; click to zoom (#6). */}
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((src, i) => (
              <ZoomableImage key={i} src={src} />
            ))}
          </div>
        )}
        <div className={collapsed ? "relative max-h-64 overflow-hidden" : undefined}>
          {splitMentionSegments(text).map((seg, i) =>
            seg.kind === "mention" ? (
              <span key={i} className="rounded-md bg-paper/25 px-1 font-semibold">{seg.value}</span>
            ) : (
              <span key={i}>{seg.value}</span>
            ),
          )}
          {collapsed && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-tangerine" />
          )}
        </div>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-[11px] font-bold text-paper/80 hover:text-paper underline cursor-pointer"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
      <div className="flex justify-end gap-1.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={text} label="Copy message" />
        {onRewind && <RewindButton onClick={() => onRewind(it)} />}
      </div>
    </div>
  );
}

// The assistant bubble is shared by committed messages and the live streaming
// bubble so their rendering (and markdown) stays byte-identical.
/** Code-block wrapper with a hover copy button (feedback round 3 #12).
    Overrides react-markdown's `pre` renderer; reads the rendered text so we
    don't have to walk the markdown children. */
function PreBlock(props: React.HTMLAttributes<HTMLPreElement>): React.JSX.Element {
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="relative group/code">
      <pre ref={ref} {...props} />
      <button
        type="button"
        aria-label="Copy code"
        title="Copy code"
        onClick={() => {
          void navigator.clipboard.writeText(ref.current?.innerText ?? "");
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
        className="absolute top-2 right-2 rounded-md border border-line bg-card p-1 text-ink-soft hover:text-ink opacity-0 group-hover/code:opacity-100 transition-opacity cursor-pointer"
      >
        <ToolIcon kind={done ? "check" : "copy"} className="size-3.5" />
      </button>
    </div>
  );
}

const MD_COMPONENTS = { pre: PreBlock };

export function AssistantBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-tangerine mb-1">agent</div>
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</ReactMarkdown>
      </div>
    </div>
  );
}

export function Transcript({
  items,
  busy,
  streaming,
  header,
  onRetry,
  workspace,
  onOpenFile,
  onRewind,
  searchQuery,
  searchActiveIndex,
  onSearchTotal,
}: {
  items: TranscriptItem[];
  busy: boolean;
  /** Perf: in-progress assistant text, rendered as one live bubble outside `items`. */
  streaming?: string;
  /** V2.C1: sticky in-flow section (delegation runs) — first child of the
      scroll container so it scrolls naturally yet pins at the top. */
  header?: React.ReactNode;
  onRetry?: () => void;
  /** W2.2: session workspace + open-in-editor for clickable card paths. */
  workspace?: string | null;
  onOpenFile?: (relPath: string) => void;
  /** Round 3 #11: rewind a user message (removes everything after + re-edits). */
  onRewind?: (it: TranscriptItem) => void;
  /** Round 4 #1: in-conversation search — highlight matches (not filter). */
  searchQuery?: string;
  searchActiveIndex?: number;
  onSearchTotal?: (n: number) => void;
}): React.JSX.Element {
  const bottom = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, busy, streaming]);

  // Round 4 #1: highlight search matches in-place via the CSS Custom Highlight
  // API — no DOM mutation, works uniformly across user text, markdown, and code.
  // The active match gets its own highlight + is scrolled into view.
  useEffect(() => {
    const cssHighlights = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!cssHighlights || !HighlightCtor) return; // unsupported runtime → no-op
    cssHighlights.delete("hv-search");
    cssHighlights.delete("hv-search-active");
    const q = (searchQuery ?? "").trim();
    if (!q || !scrollRef.current) {
      onSearchTotal?.(0);
      return;
    }
    const ql = q.toLowerCase();
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(scrollRef.current, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const lower = text.toLowerCase();
      for (let idx = lower.indexOf(ql); idx !== -1; idx = lower.indexOf(ql, idx + q.length)) {
        const r = document.createRange();
        r.setStart(node, idx);
        r.setEnd(node, idx + q.length);
        ranges.push(r);
      }
    }
    onSearchTotal?.(ranges.length);
    if (ranges.length === 0) return;
    const active = (((searchActiveIndex ?? 0) % ranges.length) + ranges.length) % ranges.length;
    const rest = ranges.filter((_, i) => i !== active);
    if (rest.length) cssHighlights.set("hv-search", new HighlightCtor(...rest));
    cssHighlights.set("hv-search-active", new HighlightCtor(ranges[active]));
    ranges[active].startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
    return () => {
      cssHighlights.delete("hv-search");
      cssHighlights.delete("hv-search-active");
    };
  }, [searchQuery, searchActiveIndex, items, streaming, onSearchTotal]);

  if (items.length === 0 && !streaming) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-4 size-14 rounded-2xl bg-honey border-2 border-ink/80 shadow-pop rotate-3 flex items-center justify-center">
            <span className="text-2xl font-black text-ink -rotate-3">hv</span>
          </div>
          <p className="font-bold text-lg">Ready when you are.</p>
          <p className="text-sm text-ink-soft mt-1">
            Ask for a change and the agent gets to work. Anything risky knocks first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {header}
      <div className="max-w-3xl mx-auto w-full px-6 py-6 flex flex-col gap-4">
        {items.map((it, i) => (
          <MessageItem key={it.id ?? i} it={it} onRetry={onRetry} workspace={workspace} onOpenFile={onOpenFile} onRewind={onRewind} />
        ))}
        {/* Perf: the in-progress turn renders here, outside `items`, so a delta
            re-renders only this bubble — committed messages stay memoized. */}
        {streaming && <AssistantBubble text={streaming} />}
        {busy && (
          <div className="flex items-center gap-2 text-ink-soft text-sm">
            <span className="size-2 rounded-full bg-honey animate-bounce [animation-delay:0ms]" />
            <span className="size-2 rounded-full bg-honey animate-bounce [animation-delay:120ms]" />
            <span className="size-2 rounded-full bg-honey animate-bounce [animation-delay:240ms]" />
          </div>
        )}
        <div ref={bottom} />
      </div>
    </div>
  );
}
