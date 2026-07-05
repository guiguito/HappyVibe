import { useEffect, useRef, useState } from "react";
import { Sidebar, type View } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SettingsView } from "./components/SettingsView";
import { type TranscriptItem } from "./components/Transcript";
import { PermissionModal } from "./components/PermissionModal";
import { parsePermission, type PermissionChoice, type PermissionInfo, type UiRequest } from "./permission";

type KeyState = "loading" | "missing" | "present";

export default function App(): React.JSX.Element {
  const [keyState, setKeyState] = useState<KeyState>("loading");
  const [view, setView] = useState<View>("chat");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [uiReq, setUiReq] = useState<{ req: UiRequest; info: PermissionInfo } | null>(null);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState(0);
  const [crashed, setCrashed] = useState<number | null>(null);
  const streaming = useRef(false);
  // Set when the user grants a permission; the next matching
  // tool_execution_start adopts it so the outcome shows on the card.
  const pendingApproval = useRef<{ tool: string; choice: "Allow" | "Allow for session" } | null>(null);

  useEffect(() => {
    // B3: any configured provider (BYOK key, OAuth login, local Ollama) passes the gate.
    window.hv.hasAnyProvider().then((ok) => setKeyState(ok ? "present" : "missing"));

    // Only hv.permission select prompts open the modal. Other ui-requests
    // (setStatus etc.) are fire-and-forget — routing them here was a CRITICAL bug.
    const offUiRequest = window.hv.onUiRequest((r) => {
      const info = parsePermission(r);
      if (info) setUiReq({ req: r, info });
    });
    const offPiExit = window.hv.onPiExit(({ code }) => {
      setCrashed(code ?? -1);
      setBusy(false);
    });
    const offPiEvent = window.hv.onPiEvent((e) => {
      if (e.type === "tool_execution_start") {
        const t = e as { toolCallId: string; toolName: string; args: unknown };
        streaming.current = false;
        const approval =
          pendingApproval.current?.tool === t.toolName ? pendingApproval.current.choice : undefined;
        if (approval) pendingApproval.current = null;
        setItems((p) => [
          ...p,
          {
            kind: "tool",
            card: { toolCallId: t.toolCallId, toolName: t.toolName, args: t.args, status: "running", approval },
          },
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
      if (e.type === "agent_end") {
        streaming.current = false;
        setBusy(false);
        setTurns((t) => t + 1);
      }
    });
    // Cleanup: without this, StrictMode's dev double-mount leaves two
    // listeners registered and every stream delta renders twice.
    return () => {
      offUiRequest();
      offPiExit();
      offPiEvent();
    };
  }, []);

  const openFolder = async (): Promise<void> => {
    const ws = await window.hv.pickFolder();
    if (!ws) return;
    await window.hv.startSession(ws);
    setWorkspace(ws);
    setItems([]);
    setTurns(0);
    setCrashed(null);
    setBusy(false);
    setUiReq(null);
    streaming.current = false;
    pendingApproval.current = null;
    setView("chat");
  };

  const send = async (msg: string): Promise<void> => {
    setItems((p) => [...p, { kind: "user", text: msg }]);
    streaming.current = false;
    setBusy(true);
    await window.hv.prompt(msg);
  };

  const respondPermission = (choice: PermissionChoice): void => {
    if (!uiReq) return;
    window.hv.respondPermission(uiReq.req.id, choice);
    if (choice === "Deny") {
      // A denied call never reaches tool_execution_start — show the outcome as its own card.
      setItems((p) => [
        ...p,
        {
          kind: "tool",
          card: {
            toolCallId: `denied-${uiReq.req.id}`,
            toolName: uiReq.info.tool,
            args: uiReq.info.summary,
            status: "denied",
          },
        },
      ]);
    } else {
      pendingApproval.current = { tool: uiReq.info.tool, choice };
    }
    setUiReq(null);
  };

  if (keyState === "loading") {
    return <div className="h-full flex items-center justify-center text-ink-soft">…</div>;
  }

  const needsSetup = keyState === "missing";
  const activeView: View = needsSetup ? "settings" : view;

  return (
    <div className="h-full flex">
      <Sidebar
        workspace={workspace}
        view={activeView}
        onNavigate={(v) => !needsSetup && setView(v)}
        onSwitchFolder={openFolder}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        {activeView === "settings" ? (
          <SettingsView
            firstRun={needsSetup}
            onSaved={() => {
              setKeyState("present");
              setView("chat");
            }}
          />
        ) : (
          <ChatView
            workspace={workspace}
            items={items}
            busy={busy}
            crashed={crashed}
            turns={turns}
            onSend={send}
            onAbort={() => window.hv.abort()}
            onRestart={async () => {
              setCrashed(null);
              await window.hv.restartPi();
            }}
            onOpenFolder={openFolder}
          />
        )}
      </main>
      {uiReq && <PermissionModal req={uiReq.req} info={uiReq.info} onChoice={respondPermission} />}
    </div>
  );
}
