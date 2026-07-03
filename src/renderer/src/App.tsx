import { useEffect, useRef, useState } from "react";
import { Transcript, type TranscriptItem } from "./components/Transcript";

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<"loading" | "setup" | "folder" | "chat">("loading");
  const [keyInput, setKeyInput] = useState("");
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [input, setInput] = useState("");
  const streaming = useRef(false);

  useEffect(() => {
    window.hv.getApiKey().then((k) => setScreen(k ? "folder" : "setup"));
    window.hv.onPiEvent((e) => {
      if (e.type === "tool_execution_start") {
        const t = e as { toolCallId: string; toolName: string; args: unknown };
        streaming.current = false;
        setItems((p) => [
          ...p,
          { kind: "tool", card: { toolCallId: t.toolCallId, toolName: t.toolName, args: t.args, status: "running" } },
        ]);
      }
      if (e.type === "tool_execution_end") {
        const t = e as { toolCallId: string; result: unknown; isError: boolean };
        setItems((p) =>
          p.map((it) =>
            it.kind === "tool" && it.card.toolCallId === t.toolCallId
              ? { ...it, card: { ...it.card, status: t.isError ? ("error" as const) : ("done" as const), result: t.result } }
              : it
          )
        );
      }
      const ame = (e as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (e.type === "message_update" && ame?.type === "text_delta" && ame.delta) {
        setItems((prev) => {
          const last = prev[prev.length - 1];
          if (streaming.current && last?.kind === "assistant") {
            return [...prev.slice(0, -1), { kind: "assistant", text: last.text + ame.delta }];
          }
          streaming.current = true;
          return [...prev, { kind: "assistant", text: ame.delta! }];
        });
      }
      if (e.type === "agent_end") streaming.current = false;
    });
  }, []);

  if (screen === "loading") return <p>…</p>;
  if (screen === "setup") return (
    <div className="screen">
      <h1>HappyVibe Spike</h1>
      <input placeholder="DeepSeek API key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
      <button disabled={!keyInput.startsWith("sk-")} onClick={async () => { await window.hv.setApiKey(keyInput); setScreen("folder"); }}>Save</button>
    </div>
  );
  if (screen === "folder") return (
    <div className="screen">
      <button onClick={async () => {
        const ws = await window.hv.pickFolder();
        if (ws) { await window.hv.startSession(ws); setScreen("chat"); }
      }}>Open a project folder…</button>
    </div>
  );
  return (
    <div className="chat">
      <Transcript items={items} />
      <form onSubmit={async (ev) => {
        ev.preventDefault();
        setItems((p) => [...p, { kind: "user", text: input }]);
        streaming.current = false;
        const msg = input; setInput("");
        await window.hv.prompt(msg);
      }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask for a change…" />
        <button type="submit">Send</button>
        <button type="button" onClick={() => window.hv.abort()}>Abort</button>
      </form>
    </div>
  );
}
