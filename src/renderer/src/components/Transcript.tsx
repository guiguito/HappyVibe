import { memo, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCard, type ToolCardData } from "./ToolCard";

// Perf: `id` is a stable key assigned at append time (see App.appendItem). Keying
// on it instead of the array index lets React.memo skip re-parsing committed
// markdown when new items arrive or the live streaming bubble updates.
export type TranscriptItem = { id?: number } & (
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; card: ToolCardData }
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
}: {
  it: TranscriptItem;
  onRetry?: () => void;
}): React.JSX.Element {
  if (it.kind === "tool") return <ToolCard card={it.card} />;
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
  if (it.kind === "assistant") return <AssistantBubble text={it.text} />;
  return (
    <div className="self-end max-w-[85%]">
      <div className="bg-tangerine text-paper rounded-2xl rounded-br-md px-4 py-2.5 shadow-sticker border-2 border-tangerine-deep whitespace-pre-wrap text-[0.95rem]">
        {it.text}
      </div>
    </div>
  );
});

// The assistant bubble is shared by committed messages and the live streaming
// bubble so their rendering (and markdown) stays byte-identical.
export function AssistantBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-tangerine mb-1">agent</div>
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  );
}

export function Transcript({
  items,
  busy,
  streaming,
  onRetry,
}: {
  items: TranscriptItem[];
  busy: boolean;
  /** Perf: in-progress assistant text, rendered as one live bubble outside `items`. */
  streaming?: string;
  onRetry?: () => void;
}): React.JSX.Element {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, busy, streaming]);

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
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-6 py-6 flex flex-col gap-4">
        {items.map((it, i) => (
          <MessageItem key={it.id ?? i} it={it} onRetry={onRetry} />
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
