import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCard, type ToolCardData } from "./ToolCard";

export type TranscriptItem =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; card: ToolCardData };

export function Transcript({ items, busy }: { items: TranscriptItem[]; busy: boolean }): React.JSX.Element {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, busy]);

  if (items.length === 0) {
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
        {items.map((it, i) => {
          if (it.kind === "tool") {
            return <ToolCard key={i} card={it.card} />;
          }
          if (it.kind === "assistant") {
            return (
              <div key={i}>
                <div className="text-[11px] font-bold uppercase tracking-widest text-tangerine mb-1">agent</div>
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{it.text}</ReactMarkdown>
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="self-end max-w-[85%]">
              <div className="bg-tangerine text-paper rounded-2xl rounded-br-md px-4 py-2.5 shadow-sticker border-2 border-tangerine-deep whitespace-pre-wrap text-[0.95rem]">
                {it.text}
              </div>
            </div>
          );
        })}
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
