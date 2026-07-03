import { ToolCard, type ToolCardData } from "./ToolCard";

export type TranscriptItem =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; card: ToolCardData };

export function Transcript({ items }: { items: TranscriptItem[] }): React.JSX.Element {
  return (
    <div className="transcript">
      {items.map((it, i) => {
        if (it.kind === "tool") {
          return (
            <div key={i} className="msg msg-tool">
              <ToolCard card={it.card} />
            </div>
          );
        }
        return (
          <div key={i} className={`msg msg-${it.kind}`}>
            <b>{it.kind === "user" ? "You" : "Agent"}:</b> <pre>{it.text}</pre>
          </div>
        );
      })}
    </div>
  );
}
