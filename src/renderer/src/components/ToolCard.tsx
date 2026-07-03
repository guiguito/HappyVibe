import { useState } from "react";

export interface ToolCardData {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: "running" | "done" | "error";
  result?: unknown;
}

export function ToolCard({ card }: { card: ToolCardData }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const icon = card.status === "running" ? "⏳" : card.status === "done" ? "✅" : "❌";
  return (
    <div className="tool-card">
      <div onClick={() => setOpen(!open)}>
        {icon} <b>{card.toolName}</b> <code>{JSON.stringify(card.args).slice(0, 120)}</code>
      </div>
      {open && <pre className="tool-raw">{JSON.stringify(card.result ?? card.args, null, 2)}</pre>}
    </div>
  );
}
