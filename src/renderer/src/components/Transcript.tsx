import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
        if (it.kind === "assistant") {
          return (
            <div key={i} className="msg msg-assistant">
              <b>Agent</b>
              <div className="md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{it.text}</ReactMarkdown>
              </div>
            </div>
          );
        }
        return (
          <div key={i} className="msg msg-user">
            <b>You:</b> <pre>{it.text}</pre>
          </div>
        );
      })}
    </div>
  );
}
