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
import { applyQueueUpdate, emptyQueue, type QueueState } from "./queue";
import { parseContextAck, parseContextSnapshot, type ContextSnapshot } from "./context";
import { AgentsView } from "./components/AgentsView";
import { isSubagentTool, mergeTrace, parseAgents, parseTools, traceFromEnd, traceFromUpdate, type AgentInfo, type ToolInfo } from "./agents";
import { applyDelta, updateToolCard } from "./streaming";

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
  // B2: pending steering/follow-up queue per session (mirrors Pi queue_update).
  const [queues, setQueues] = useState<Record<string, QueueState>>({});
  const queueRef = useRef<Record<string, QueueState>>({});
  // Per-session permission prompt queues (B4): the modal shows the focused
  // session's oldest pending prompt; the rest badge the sidebar + dock.
  const [uiQueue, setUiQueue] = useState<QueuedPrompt[]>([]);
  // Sessions currently in /hv-dangerous mode (bridge-notified, never persisted).
  const [dangerous, setDangerous] = useState<Record<string, boolean>>({});
  // B5: latest context breakdown snapshot per session (from hv.context notify).
  const [contextSnapshots, setContextSnapshots] = useState<Record<string, ContextSnapshot>>({});
  // B5: the default model's context window — fallback for the estimated gauge.
  const [fallbackWindow, setFallbackWindow] = useState<number | null>(null);
  // B6: agent + tool inventories (from hv.agents / hv.tools notifies).
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streaming = useRef<Record<string, boolean>>({});
  // Set when the user grants a permission; the next matching
  // tool_execution_start in that session adopts it so the outcome shows on the card.
  const pendingApproval = useRef<Record<string, { tool: string; choice: "Allow" | "Allow for session" } | null>>({});

  // Perf: in-progress assistant text lives HERE, keyed by sid, outside
  // `transcripts` — so a delta doesn't copy the whole transcript array and
  // Transcript doesn't re-parse committed markdown. `streamText` is the render
  // mirror (one update per frame via rAF); `streamRef` holds the latest buffer.
  const [streamText, setStreamText] = useState<Record<string, string>>({});
  const streamRef = useRef<Record<string, string>>({});
  const rafRef = useRef<number | null>(null);
  // Stable, monotonic id per committed item (see appendItem) so Transcript can
  // key on identity instead of the array index and skip re-parsing.
  const idCounter = useRef(0);
  // Perf: toolCallId → position in transcripts[sid], so tool_execution_update/
  // _end update the card in O(1) instead of mapping the whole array.
  const toolIndex = useRef<Record<string, Map<string, number>>>({});

  const appendItem = (sid: string, item: TranscriptItem): void =>
    setTranscripts((p) => {
      const items = p[sid] ?? [];
      const withId = { ...item, id: idCounter.current++ };
      if (withId.kind === "tool") {
        (toolIndex.current[sid] ??= new Map()).set(withId.card.toolCallId, items.length);
      }
      return { ...p, [sid]: [...items, withId] };
    });

  // Perf: coalesce text deltas to one React update per frame. Deltas accumulate
  // in streamRef; a single rAF mirrors the whole map into streamText.
  const scheduleFlush = (): void => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setStreamText({ ...streamRef.current });
    });
  };

  // Commit the in-progress streaming bubble as ONE assistant transcript item,
  // then clear the buffer. Called on agent_end and on every interrupt that
  // ends the current bubble (tool start, queue delivery, message_end error) —
  // preserving today's ordering: the committed assistant text lands before the
  // item that interrupted it.
  const commitStream = (sid: string): void => {
    const text = streamRef.current[sid];
    streaming.current[sid] = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (!text) return;
    delete streamRef.current[sid];
    setStreamText((p) => {
      if (!(sid in p)) return p;
      const next = { ...p };
      delete next[sid];
      return next;
    });
    appendItem(sid, { kind: "assistant", text });
  };

  useEffect(() => {
    // B3: any configured provider (BYOK key, OAuth login, local Ollama) passes the gate.
    window.hv.hasAnyProvider().then((ok) => setKeyState(ok ? "present" : "missing"));
    window.hv.listWorkspaces().then(setWorkspaces);
    window.hv.listSessions().then(setSessions);

    // B5: default model's context window feeds the estimated-gauge fallback.
    void (async () => {
      try {
        const { defaultModel } = await window.hv.getProviders();
        if (!defaultModel) return;
        const models = await window.hv.listModels();
        const m = models.find((x) => x.provider === defaultModel.provider && x.id === defaultModel.modelId);
        if (m?.contextWindow) setFallbackWindow(m.contextWindow);
      } catch { /* no provider configured yet — gauge just shows nothing */ }
    })();

    const offSessions = window.hv.onSessionsChanged(setSessions);

    // Only hv.permission select prompts open the modal. Other ui-requests
    // (setStatus etc.) are fire-and-forget — routing them here was a CRITICAL bug.
    const offUiRequest = window.hv.onUiRequest((r) => {
      const info = parsePermission(r);
      if (info) setUiQueue((q) => [...q, { req: r, info }]);
      const dng = parseDangerous(r);
      if (dng !== null && r.sessionId) setDangerous((p) => ({ ...p, [r.sessionId!]: dng }));
      // B6: agent/tool inventories are fire-and-forget (never open the modal).
      const ags = parseAgents(r);
      if (ags) setAgents(ags);
      const tls = parseTools(r);
      if (tls) setTools(tls);
      // B5: hv.context is fire-and-forget (never opens the modal).
      const sid = r.sessionId;
      if (sid) {
        const snap = parseContextSnapshot(r);
        if (snap) setContextSnapshots((p) => ({ ...p, [sid]: snap }));
        const ack = parseContextAck(r);
        // Update the mark set live (remove/restore) without re-fetching the snapshot.
        if (ack) setContextSnapshots((p) => (p[sid] ? { ...p, [sid]: { ...p[sid], marks: ack.marks } } : p));
      }
    });

    const offPiExit = window.hv.onPiExit(({ sessionId, code, intentional }) => {
      // Dead Pi: its prompts are unanswerable and dangerous mode never survives a respawn.
      setUiQueue((q) => dropSession(q, sessionId));
      setDangerous((p) => ({ ...p, [sessionId]: false }));
      setBusy((p) => ({ ...p, [sessionId]: false }));
      if (!intentional) {
        setCrashCodes((p) => ({ ...p, [sessionId]: code ?? -1 }));
        // B2: crash lands in the transcript too, with a retriable action.
        appendItem(sessionId, {
          kind: "error",
          text: `The session crashed (code ${code ?? -1}).`,
          retriable: true,
        });
      }
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
        commitStream(sid); // flush the live bubble before the tool card (order preserved)
        const pending = pendingApproval.current[sid];
        const approval = pending?.tool === t.toolName ? pending.choice : undefined;
        if (approval) pendingApproval.current[sid] = null;
        appendItem(sid, {
          kind: "tool",
          card: { toolCallId: t.toolCallId, toolName: t.toolName, args: t.args, status: "running", approval },
        });
      }
      // B6: subagent delegation streams the child transcript live through
      // tool_execution_update.partialResult (s0.3). Merge it onto the card.
      if (e.type === "tool_execution_update") {
        const t = e as unknown as { toolCallId: string; toolName?: string; partialResult?: unknown };
        if (isSubagentTool(t.toolName)) {
          const trace = traceFromUpdate(t.partialResult);
          const idx = toolIndex.current[sid] ??= new Map();
          setTranscripts((p) => ({
            ...p,
            [sid]: updateToolCard(p[sid] ?? [], idx, t.toolCallId, (card) => ({ ...card, trace })),
          }));
        }
      }
      if (e.type === "tool_execution_end") {
        const t = e as unknown as { toolCallId: string; toolName?: string; result: unknown; isError: boolean };
        const isSub = isSubagentTool(t.toolName);
        const idx = toolIndex.current[sid] ??= new Map();
        setTranscripts((p) => ({
          ...p,
          [sid]: updateToolCard(p[sid] ?? [], idx, t.toolCallId, (card) => ({
            ...card,
            status: t.isError ? ("error" as const) : ("done" as const),
            result: t.result,
            // The end lacks the transcript — merge the outcome onto the
            // live trace so messages captured during _update survive.
            ...(isSub ? { trace: mergeTrace(card.trace, traceFromEnd(t.result)) } : {}),
          })),
        }));
      }
      const ame = (e as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (e.type === "message_update" && ame?.type === "text_delta" && ame.delta) {
        // Perf: accumulate in the ref (O(1)) and repaint one live bubble per
        // frame — no transcript-array copy, no committed-markdown re-parse.
        streamRef.current[sid] = applyDelta(streamRef.current, sid, ame.delta, streaming.current[sid]);
        streaming.current[sid] = true;
        scheduleFlush();
      }
      if (e.type === "agent_end") {
        commitStream(sid); // finalize the live bubble into the transcript
        setBusy((p) => ({ ...p, [sid]: false }));
        setTurns((p) => ({ ...p, [sid]: (p[sid] ?? 0) + 1 }));
      }
      // B5: compaction streams as a transcript notice; a fresh snapshot lands
      // on the next panel open. Bump turns so the gauge re-reads post-compaction.
      if (e.type === "compaction_start") {
        appendItem(sid, { kind: "error", text: "Compacting the conversation to free context…" });
      }
      if (e.type === "compaction_end") {
        appendItem(sid, { kind: "error", text: "Compaction complete — older turns were summarized." });
        setTurns((p) => ({ ...p, [sid]: (p[sid] ?? 0) + 1 }));
      }
      // B2: pending steering/follow-up queue. Messages that leave the queue
      // were delivered to the agent — append them as user items right there,
      // keeping transcript order truthful.
      if (e.type === "queue_update") {
        const { queue, delivered } = applyQueueUpdate(queueRef.current[sid] ?? emptyQueue, e);
        queueRef.current[sid] = queue;
        setQueues((p) => ({ ...p, [sid]: queue }));
        for (const text of delivered) {
          commitStream(sid); // flush any live bubble before the delivered user item
          appendItem(sid, { kind: "user", text });
        }
      }
      // B2: provider errors (model call failed) as distinct transcript items.
      // "aborted" is the user's own Stop — no error item for that.
      if (e.type === "message_end") {
        const m = (e as { message?: { role?: string; stopReason?: string; errorMessage?: string } }).message;
        if (m?.role === "assistant" && m.stopReason === "error") {
          commitStream(sid); // flush any partial bubble before the error item
          appendItem(sid, { kind: "error", text: m.errorMessage || "The model call failed." });
        }
      }
    });

    // Cleanup: without this, StrictMode's dev double-mount leaves two
    // listeners registered and every stream delta renders twice.
    return () => {
      offSessions();
      offUiRequest();
      offPiExit();
      offPiEvent();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
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

  const send = async (msg: string, behavior?: "followUp"): Promise<void> => {
    if (!selectedId) return;
    const sid = selectedId;
    // B2: while the agent runs, a bare prompt errors — Enter steers, the Queue
    // button follows up. The message shows as a chip (queue_update) and only
    // joins the transcript when Pi delivers it.
    if (busy[sid]) {
      try {
        await window.hv.promptSession(sid, msg, behavior ?? "steer");
      } catch (err) {
        surface(err);
      }
      return;
    }
    appendItem(sid, { kind: "user", text: msg });
    streaming.current[sid] = false;
    setBusy((p) => ({ ...p, [sid]: true }));
    try {
      await window.hv.promptSession(sid, msg);
    } catch (err) {
      setBusy((p) => ({ ...p, [sid]: false }));
      surface(err);
    }
  };

  // B2: "restart & resend" for a crashed session — restart the agent, then
  // resend the last user message (if any).
  const retryCrash = async (): Promise<void> => {
    if (!selectedId) return;
    const sid = selectedId;
    const lastUser = [...(transcripts[sid] ?? [])].reverse().find((it) => it.kind === "user");
    setStatuses((p) => {
      const next = { ...p };
      delete next[sid];
      return next;
    });
    await selectSession(sid);
    if (lastUser && lastUser.kind === "user") await send(lastUser.text);
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
        ) : activeView === "agents" ? (
          <AgentsView
            agents={agents}
            tools={tools}
            sessionId={selectedId}
            workspaceId={selected?.workspaceId ?? null}
          />
        ) : (
          <ChatView
            workspace={selected?.workspaceId ?? null}
            sessionId={selectedId}
            title={selected?.title ?? null}
            items={(selectedId ? transcripts[selectedId] : undefined) ?? []}
            streaming={(selectedId ? streamText[selectedId] : undefined) || undefined}
            busy={(selectedId && busy[selectedId]) || false}
            crashed={selectedId && statuses[selectedId] === "crashed" ? (crashCodes[selectedId] ?? -1) : null}
            turns={(selectedId && turns[selectedId]) || 0}
            queue={(selectedId ? queues[selectedId] : undefined) ?? emptyQueue}
            contextSnapshot={(selectedId ? contextSnapshots[selectedId] : undefined) ?? null}
            fallbackWindow={fallbackWindow}
            onSend={send}
            onRetry={retryCrash}
            onCompact={() => selectedId && void window.hv.compactSession(selectedId)}
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
