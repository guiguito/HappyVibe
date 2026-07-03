export type TranscriptItem = { kind: "user" | "assistant"; text: string };

export function Transcript({ items }: { items: TranscriptItem[] }): React.JSX.Element {
  return (
    <div className="transcript">
      {items.map((it, i) => (
        <div key={i} className={`msg msg-${it.kind}`}>
          <b>{it.kind === "user" ? "You" : "Agent"}:</b> <pre>{it.text}</pre>
        </div>
      ))}
    </div>
  );
}
