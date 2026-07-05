import { useEffect, useRef, useState } from "react";
import { Sidebar, type View } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SettingsView } from "./components/SettingsView";
import { type TranscriptItem } from "./components/Transcript";
import { PermissionModal } from "./components/PermissionModal";
import { AuditView } from "./components/AuditView";
import {
  dropSession,
  headFor,
  parseDangerous,
  parsePermission,
  pendingCounts,
  type PermissionChoice,
  type QueuedPrompt,
} from "./permission";

type KeyState = "loading" | "missing" | "present";
export type SessionStatus = "running" | "crashed";

export default function App(): React.JSX.Element {
  const [keyState, setKeyState] = useState<KeyState>("loading");
  const [view, setView] = useState<View>("chat");
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptItem[]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const [turns, setTurns] = useState<Record<string, number>>({});
  const [crashCodes, setCrashCodes] = useState<Record<string, number>>({});
  // Per-session permission prompt queues (B4): the modal shows the focused
  // session's oldest pending prompt; the rest badge the sidebar + dock.
  const [uiQueue, setUiQueue] = useState<QueuedPrompt[]>([]);
  // Sessions currently in /hv-dangerous mode (bridge-notified, never persisted).
  const [dangerous, setDangerous] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const streaming = useRef<Record<string, boolean>>({});
  // Set when the user grants a permission; the next matching
  // tool_execution_start in that session adopts it so the outcome shows on the card.
  const pendingApproval = useRef<Record<string, { tool: string; choice: "Allow" | "Allow for session" } | null>>({});

  const appendItem = (sid: string, item: TranscriptItem): void =>
    setTranscripts((p) => ({ ...p, [sid]: [...(p[sid] ?? []), item] }));

  useEffect(() => {
    // B3: any configured provider (BYOK key, OAuth login, local Ollama) passes the gate.
    window.hv.hasAnyProvider().then((ok) => setKeyState(ok ? "present" : "missing"));
    window.hv.listWorkspaces().then(setWorkspaces);
    window.hv.listSessions().then(setSessions);

    const offSessions = window.hv.onSessionsChanged(setSessions);

    // Only hv.permission select prompts open the modal. Other ui-requests
    // (setStatus etc.) are fire-and-forget — routing them here was a CRITICAL bug.
    const offUiRequest = window.hv.onUiRequest((r) => {
      const info = parsePermission(r);
      if (info) setUiQueue((q) => [...q, { req: r, info }]);
      const dng = parseDangerous(r);
      if (dng !== null && r.sessionId) setDangerous((p) => ({ ...p, [r.sessionId!]: dng }));
    });

    const offPiExit = window.hv.onPiExit(({ sessionId, code, intentional }) => {
      // Dead Pi: its prompts are unanswerable and dangerous mode never survives a respawn.
      setUiQueue((q) => dropSession(q, sessionId));
      setDangerous((p) => ({ ...p, [sessionId]: false }));
      setBusy((p) => ({ ...p, [sessionId]: false }));
      if (!intentional) setCrashCodes((p) => ({ ...p, [sessionId]: code ?? -1 }));
      setStatuses((p) => {
        const next = { ...p };
        if (intentional) delete next[sessionId];
        else next[sessionId] = "crashed";
        return next;
      });
    });

    const offPiEvent = window.hv.onPiEvent((e) => {
      const sid = e.sessionId as string | undefined;
      if (!sid) return;
      if (e.type === "tool_execution_start") {
        const t = e as unknown as { toolCallId: string; toolName: string; args: unknown };
        streaming.current[sid] = false;
        const pending = pendingApproval.current[sid];
        const approval = pending?.tool === t.toolName ? pending.choice : undefined;
        if (approval) pendingApproval.current[sid] = null;
        appendItem(sid, {
          kind: "tool",
          card: { toolCallId: t.toolCallId, toolName: t.toolName, args: t.args, status: "running", approval },
        });
      }
      if (e.type === "tool_execution_end") {
        const t = e as unknown as { toolCallId: string; result: unknown; isError: boolean };
        setTranscripts((p) => ({
          ...p,
          [sid]: (p[sid] ?? []).map((it) =>
            it.kind === "tool" && it.card.toolCallId === t.toolCallId
              ? { ...it, card: { ...it.card, status: t.isError ? ("error" as const) : ("done" as const), result: t.result } }
              : it
          ),
        }));
      }
      const ame = (e as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (e.type === "message_update" && ame?.type === "text_delta" && ame.delta) {
        setTranscripts((prev) => {
          const items = prev[sid] ?? [];
          const last = items[items.length - 1];
          if (streaming.current[sid] && last?.kind === "assistant") {
            return { ...prev, [sid]: [...items.slice(0, -1), { kind: "assistant", text: last.text + ame.delta }] };
          }
          streaming.current[sid] = true;
          return { ...prev, [sid]: [...items, { kind: "assistant", text: ame.delta! }] };
        });
      }
      if (e.type === "agent_end") {
        streaming.current[sid] = false;
        setBusy((p) => ({ ...p, [sid]: false }));
        setTurns((p) => ({ ...p, [sid]: (p[sid] ?? 0) + 1 }));
      }
    });

    // Cleanup: without this, StrictMode's dev double-mount leaves two
    // listeners registered and every stream delta renders twice.
    return () => {
      offSessions();
      offUiRequest();
      offPiExit();
      offPiEvent();
    };
  }, []);

  const surface = (err: unknown): void =>
    setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));

  const addWorkspace = async (): Promise<void> => {
    const ws = await window.hv.addWorkspace();
    if (ws) setWorkspaces(await window.hv.listWorkspaces());
  };

  const newSession = async (workspaceId: string): Promise<void> => {
    try {
      const meta = await window.hv.createSession(workspaceId);
      setStatuses((p) => ({ ...p, [meta.id]: "running" }));
      setTranscripts((p) => ({ ...p, [meta.id]: [] }));
      setSelectedId(meta.id);
      setView("chat");
      setError(null);
    } catch (err) {
      surface(err);
    }
  };

  const selectSession = async (id: string): Promise<void> => {
    setSelectedId(id);
    setView("chat");
    if (statuses[id] === "running") return;
    try {
      const { messages } = await window.hv.openSession(id);
      setStatuses((p) => ({ ...p, [id]: "running" }));
      if (messages) {
        // Rebuilt from Pi's session file — only adopt when we hold nothing newer.
        setTranscripts((p) => (p[id]?.length ? p : { ...p, [id]: messages.map((m) => ({ kind: m.role, text: m.text })) }));
      }
      setError(null);
    } catch (err) {
      surface(err);
    }
  };

  const send = async (msg: string): Promise<void> => {
    if (!selectedId) return;
    appendItem(selectedId, { kind: "user", text: msg });
    streaming.current[selectedId] = false;
    setBusy((p) => ({ ...p, [selectedId]: true }));
    try {
      await window.hv.promptSession(selectedId, msg);
    } catch (err) {
      setBusy((p) => ({ ...p, [selectedId]: false }));
      surface(err);
    }
  };

  // macOS dock badge mirrors total unanswered permission prompts.
  useEffect(() => {
    window.hv.setBadgeCount(uiQueue.length);
  }, [uiQueue.length]);

  // Selecting a session surfaces ITS oldest pending prompt (B4 routing).
  const uiReq = headFor(uiQueue, selectedId);
  const respondPermission = (choice: PermissionChoice): void => {
    if (!uiReq) return;
    const sid = uiReq.req.sessionId;
    window.hv.respondPermission(uiReq.req.id, choice);
    if (sid) {
      if (choice === "Deny") {
        // A denied call never reaches tool_execution_start — show the outcome as its own card.
        appendItem(sid, {
          kind: "tool",
          card: {
            toolCallId: `denied-${uiReq.req.id}`,
            toolName: uiReq.info.tool,
            args: uiReq.info.summary,
            status: "denied",
          },
        });
      } else {
        pendingApproval.current[sid] = { tool: uiReq.info.tool, choice };
      }
    }
    // Pop the answered prompt (not necessarily the global head — B4 queues are per-session).
    setUiQueue((q) => q.filter((e) => e.req.id !== uiReq.req.id));
  };

  if (keyState === "loading") {
    return <div className="h-full flex items-center justify-center text-ink-soft">…</div>;
  }

  const needsSetup = keyState === "missing";
  const activeView: View = needsSetup ? "settings" : view;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="h-full flex">
      <Sidebar
        workspaces={workspaces}
        sessions={sessions}
        statuses={statuses}
        pending={pendingCounts(uiQueue)}
        selectedId={selectedId}
        view={activeView}
        onNavigate={(v) => !needsSetup && setView(v)}
        onAddWorkspace={addWorkspace}
        onRemoveWorkspace={async (ws) => {
          await window.hv.removeWorkspace(ws);
          setWorkspaces(await window.hv.listWorkspaces());
        }}
        onNewSession={newSession}
        onSelectSession={selectSession}
        onRenameSession={(id, title) => window.hv.renameSession(id, title)}
        onArchiveSession={(id, archived) => window.hv.archiveSession(id, archived)}
        onCloseSession={(id) => window.hv.closeSession(id)}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        {error && (
          <div className="flex items-center gap-3 px-6 py-2.5 bg-honey-soft border-b-2 border-honey/60 text-sm font-semibold">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs font-bold text-ink-soft hover:text-ink cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
        {/* B4: permanent dangerous-mode warning with one-click off. */}
        {activeView === "chat" && selectedId && dangerous[selectedId] && (
          <div className="flex items-center gap-3 px-6 py-2.5 bg-berry-soft border-b-2 border-berry/60 text-sm font-semibold text-berry">
            <span className="flex-1">
              Dangerous mode is ON for this session — every tool call runs without asking.
            </span>
            <button
              type="button"
              onClick={() => void window.hv.promptSession(selectedId, "/hv-dangerous off")}
              className="text-xs font-bold rounded-lg border-2 border-berry px-2.5 py-1 hover:bg-berry hover:text-paper cursor-pointer"
            >
              Turn off
            </button>
          </div>
        )}
        {activeView === "settings" ? (
          <SettingsView
            firstRun={needsSetup}
            onSaved={() => {
              setKeyState("present");
              setView("chat");
            }}
          />
        ) : activeView === "audit" ? (
          <AuditView sessions={sessions} workspaces={workspaces} />
        ) : (
          <ChatView
            workspace={selected?.workspaceId ?? null}
            sessionId={selectedId}
            title={selected?.title ?? null}
            items={(selectedId ? transcripts[selectedId] : undefined) ?? []}
            busy={(selectedId && busy[selectedId]) || false}
            crashed={selectedId && statuses[selectedId] === "crashed" ? (crashCodes[selectedId] ?? -1) : null}
            turns={(selectedId && turns[selectedId]) || 0}
            onSend={send}
            onAbort={() => selectedId && window.hv.abortSession(selectedId)}
            onRestart={async () => {
              if (!selectedId) return;
              setStatuses((p) => {
                const next = { ...p };
                delete next[selectedId];
                return next;
              });
              await selectSession(selectedId);
            }}
            onOpenFolder={addWorkspace}
          />
        )}
      </main>
      {uiReq && <PermissionModal req={uiReq.req} info={uiReq.info} onChoice={respondPermission} />}
    </div>
  );
}
