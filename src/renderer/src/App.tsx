import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar, type View } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SettingsView } from "./components/SettingsView";
import { type TranscriptItem } from "./components/Transcript";
import { PermissionModal } from "./components/PermissionModal";
import { WorkspaceSettingsModal } from "./components/WorkspaceSettingsModal";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import {
  dropSession,
  headFor,
  parseDangerous,
  parsePermission,
  pendingCounts,
  type PermissionChoice,
  type QueuedPrompt,
} from "./permission";
import { answersSummary, parseAskUser, type AskAnswer } from "./askUser";
import { AskUserModal } from "./components/AskUserModal";
import { applyQueueUpdate, emptyQueue, type QueueState } from "./queue";
import { parseContextAck, parseContextFiles, parseContextSnapshot, type ContextSnapshot } from "./context";
import { AgentsView } from "./components/AgentsView";
import { delegationLabel, isSubagentTool, mergeTrace, parseAgents, parseTools, traceFromEnd, traceFromUpdate, type AgentInfo, type DelegationRun, type ToolInfo } from "./agents";
import { applyDelta, updateToolCard } from "./streaming";
import { attachmentUrl, buildImages, type ImageAttachment } from "./composer";
import {
  activateTab, allFiles, bufferKey, CHAT_TAB, closeTab, emptyTabs, moveTab, openFile, splitPane, unsplit,
  type TabId, type WorkspaceTabs,
} from "./tabs";
import { TabStrip } from "./components/TabStrip";
import { FileTree } from "./components/FileTree";
import { FileTab } from "./components/FileTab";
import { AgentsMdPanel } from "./components/AgentsMdPanel";
import type { SessionStats } from "./context";
import { basename as tabBasename } from "./tabs";

type KeyState = "loading" | "missing" | "present";
export type SessionStatus = "running" | "crashed" | "waking";

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
  // W1.2/V2.C1: active subagent delegations per session, keyed by toolCallId
  // (multiple concurrent runs stack). During delegation the main chat goes
  // silent (main agent is blocked), so these drive the sticky run section at
  // the top of the chat scroll area — the run lives OUTSIDE the chat flow (PRD
  // "Subagents"). Completed runs linger ~2.5s (outcome + slide-away) before removal.
  const [delegations, setDelegations] = useState<Record<string, Record<string, DelegationRun>>>({});
  const [error, setError] = useState<string | null>(null);
  // B7: onboarding wow-flow overlay. Shown once for a brand-new user's first
  // session (no prior sessions), re-openable from the Help affordance.
  const [onboarding, setOnboarding] = useState(false);
  // W1.4: workspace whose settings modal is open (gear on a sidebar workspace row).
  const [wsSettings, setWsSettings] = useState<string | null>(null);
  // W2.2: center tabs (chat + open files), PER-WORKSPACE — switching sessions
  // within a workspace keeps them; another workspace has its own set. The
  // docked file-tree pane is a global toggle (closed by default).
  const [tabsByWs, setTabsByWs] = useState<Record<string, WorkspaceTabs>>({});
  const [treeOpen, setTreeOpen] = useState(false);
  // WS7: chat controls lifted from the removed ChatView header into the tab strip.
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [selStats, setSelStats] = useState<SessionStats | null>(null);
  // AGENTS.md editor — opened from the "+" menu (root) or the file tree (any path).
  const [agentsMd, setAgentsMd] = useState<string | null>(null); // relPath, or null = closed
  // bufferKey(ws, rel) → unsaved edits (feeds the tab-strip dirty dot; the
  // buffers themselves live in the always-mounted FileTab components).
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const seenOnboarding = useRef(true); // assume seen until config says otherwise
  const streaming = useRef<Record<string, boolean>>({});
  // Set when the user grants a permission; the next matching
  // tool_execution_start in that session adopts it so the outcome shows on the card.
  const pendingApproval = useRef<Record<string, { tool: string; choice: "Allow" | "Allow for session" } | null>>({});

  // #11 rewind: set when the user rewinds to a message; consumed by the next
  // context snapshot to drop the truncated tail from Pi's context.
  const pendingRewind = useRef<Record<string, { msgCount: number; toolIds: Set<string> }>>({});

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
  // Id of the in-progress "Compacting context…" notice per session, so
  // compaction_end resolves it in place ("Compaction complete") instead of
  // leaving a stale ongoing line + appending a second item.
  const compactionNotice = useRef<Record<string, number>>({});

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
    // B7: has the user seen the wow-flow? (drives auto-show on first session)
    void window.hv.getOnboardingSeen().then((seen) => { seenOnboarding.current = seen; });

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
      if (info) setUiQueue((q) => [...q, { kind: "permission", req: r, info }]);
      // V2.B: ask_user questions queue through the same machinery (badges,
      // headFor routing). Kind-based parse — hv.auth inputs stay untouched.
      const ask = parseAskUser(r);
      if (ask) setUiQueue((q) => [...q, { kind: "askUser", req: r, ask }]);
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
        if (snap) {
          setContextSnapshots((p) => ({ ...p, [sid]: snap }));
          // #11 rewind: a fresh snapshot was requested to drop the truncated tail
          // from Pi's context (chat-only; files are NOT rolled back). Match the
          // trailing removable conversation items by count and tools by exact id.
          const pr = pendingRewind.current[sid];
          if (pr) {
            delete pendingRewind.current[sid];
            const convo = snap.items.filter((i) => i.group === "conversation" && i.removable && i.markKey);
            const keys = convo.slice(-pr.msgCount).map((i) => i.markKey as string);
            for (const i of snap.items) {
              if (i.group === "tool" && i.removable && i.markKey && i.toolCallId && pr.toolIds.has(i.toolCallId)) {
                keys.push(i.markKey);
              }
            }
            if (keys.length > 0) void window.hv.contextRemove(sid, keys);
          }
        }
        const ack = parseContextAck(r);
        // Update the mark set live (remove/restore) without re-fetching the snapshot.
        if (ack) setContextSnapshots((p) => (p[sid] ? { ...p, [sid]: { ...p[sid], marks: ack.marks } } : p));
        // W2.3: live nested AGENTS.md list — patch an existing snapshot's system
        // block (no snapshot yet → the panel's own refresh will carry it).
        const nested = parseContextFiles(r);
        if (nested)
          setContextSnapshots((p) =>
            p[sid]?.system ? { ...p, [sid]: { ...p[sid], system: { ...p[sid].system!, nested } } } : p,
          );
      }
    });

    const offPiExit = window.hv.onPiExit(({ sessionId, code, intentional }) => {
      // Dead Pi: its prompts are unanswerable and dangerous mode never survives a respawn.
      setUiQueue((q) => dropSession(q, sessionId));
      setDangerous((p) => ({ ...p, [sessionId]: false }));
      setBusy((p) => ({ ...p, [sessionId]: false }));
      // Dead Pi won't emit tool_execution_end — drop any dangling delegation cards.
      setDelegations((p) => (p[sessionId] ? { ...p, [sessionId]: {} } : p));
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
        // V2.C1: raise a run card in the sticky section (concurrent runs stack).
        if (isSubagentTool(t.toolName)) {
          const run: DelegationRun = {
            toolCallId: t.toolCallId,
            agent: (t.args as { agent?: string } | undefined)?.agent ?? "subagent",
            label: delegationLabel(t.args),
            startedAt: Date.now(),
            status: "running",
          };
          setDelegations((p) => ({ ...p, [sid]: { ...p[sid], [run.toolCallId]: run } }));
        }
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
        // V2.C1: mark the run done/failed — the card shows the outcome briefly,
        // then slides away; remove it after the animation so the stack shrinks.
        if (isSub) {
          const status = t.isError ? ("error" as const) : ("done" as const);
          setDelegations((p) => {
            const run = p[sid]?.[t.toolCallId];
            return run ? { ...p, [sid]: { ...p[sid], [t.toolCallId]: { ...run, status } } } : p;
          });
          setTimeout(() => {
            setDelegations((p) => {
              if (!p[sid]?.[t.toolCallId]) return p;
              const next = { ...p[sid] };
              delete next[t.toolCallId];
              return { ...p, [sid]: next };
            });
          }, 2_500);
        }
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
      // B5: compaction is slow (Pi's model summarization, not our bug), so show
      // an ONGOING notice that resolves in place — never a scary error box.
      // compaction_end bumps turns so the gauge re-reads (it'll read "pending"
      // until the next LLM response) and the open panel re-fetches its snapshot.
      if (e.type === "compaction_start") {
        commitStream(sid); // flush any live bubble before the notice
        compactionNotice.current[sid] = idCounter.current; // id appendItem will assign next
        appendItem(sid, { kind: "notice", text: "Compacting context…", pending: true });
      }
      if (e.type === "compaction_end") {
        const noticeId = compactionNotice.current[sid];
        delete compactionNotice.current[sid];
        setTranscripts((p) => {
          const items = p[sid];
          if (!items) return p;
          const i = items.findIndex((it) => it.id === noticeId && it.kind === "notice");
          if (i < 0) {
            // No pending notice found (missed start) — append a resolved one.
            return { ...p, [sid]: [...items, { kind: "notice", text: "Compaction complete", pending: false, id: idCounter.current++ }] };
          }
          const next = items.slice();
          next[i] = { ...items[i], kind: "notice", text: "Compaction complete", pending: false };
          return { ...p, [sid]: next };
        });
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
    // MCP config/auth changed → main respawns this session (resumed) to apply it.
    // The intentional exit clears the crash banner (onPiExit); note why it blinked.
    const offReloading = window.hv.onSessionReloading(({ sessionId }) => {
      appendItem(sessionId, {
        kind: "notice",
        text: "Reloading to apply MCP server changes — permission grants and dangerous mode reset to safe defaults.",
      });
    });

    return () => {
      offSessions();
      offUiRequest();
      offPiExit();
      offPiEvent();
      offReloading();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── W2.2: tab/editor handlers ──────────────────────────────────────
  const openFileTab = useCallback((wsId: string, rel: string): void => {
    // WS7: opening any AGENTS.md opens the edition dialog, not a plain editor tab.
    if (tabBasename(rel) === "AGENTS.md") {
      setAgentsMd(rel);
      return;
    }
    setTabsByWs((p) => ({ ...p, [wsId]: openFile(p[wsId] ?? emptyTabs, rel) }));
  }, []);

  // Stable identity so memoized transcript items don't re-render per App
  // update — the current workspace is read through a ref at click time.
  const selectedWsRef = useRef<string | null>(null);
  useEffect(() => {
    selectedWsRef.current = sessions.find((s) => s.id === selectedId)?.workspaceId ?? null;
  }, [selectedId, sessions]);
  const openFileFromCard = useCallback(
    (rel: string): void => {
      if (selectedWsRef.current) openFileTab(selectedWsRef.current, rel);
    },
    [openFileTab]
  );

  // WS7: session context stats for the tab-strip bubble + panel. Fetched once
  // per agent_end (turns bump), debounced; reset search/context on session switch.
  useEffect(() => {
    setSearchOpen(false);
    setContextOpen(false);
    if (!selectedId) { setSelStats(null); return; }
    let live = true;
    const t = setTimeout(() => {
      window.hv.getStats(selectedId).then((s) => live && setSelStats(s as SessionStats | null));
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [selectedId, selectedId ? turns[selectedId] : 0]);

  const closeFileTab = (wsId: string, paneIdx: number, tab: TabId): void => {
    if (tab === CHAT_TAB) return; // chat is never closable
    const key = bufferKey(wsId, tab);
    if (dirtyMap[key] && !window.confirm(`Close ${tab}? Unsaved changes will be lost.`)) return;
    setTabsByWs((p) => ({ ...p, [wsId]: closeTab(p[wsId] ?? emptyTabs, paneIdx, tab) }));
    setDirtyMap((p) => {
      if (!(key in p)) return p;
      const next = { ...p };
      delete next[key];
      return next;
    });
  };
  // WS6: mutate this workspace's tab layout with a pure tabs.ts helper.
  const updateTabs = (wsId: string, fn: (t: WorkspaceTabs) => WorkspaceTabs): void =>
    setTabsByWs((p) => ({ ...p, [wsId]: fn(p[wsId] ?? emptyTabs) }));

  const setDirtyFlag = useCallback((key: string, d: boolean): void => {
    setDirtyMap((p) => (!!p[key] === d ? p : { ...p, [key]: d }));
  }, []);

  const surface = (err: unknown): void =>
    setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));

  const addWorkspace = async (): Promise<void> => {
    const ws = await window.hv.addWorkspace();
    if (ws) setWorkspaces(await window.hv.listWorkspaces());
  };

  const newSession = async (workspaceId: string): Promise<void> => {
    // B7: this user's very first session (nothing in the index yet) + they've
    // never seen the wow-flow → surface it, layered over the real chat.
    const firstEver = sessions.length === 0 && !seenOnboarding.current;
    try {
      const meta = await window.hv.createSession(workspaceId);
      setStatuses((p) => ({ ...p, [meta.id]: "running" }));
      setTranscripts((p) => ({ ...p, [meta.id]: [] }));
      setSelectedId(meta.id);
      setView("chat");
      setError(null);
      if (firstEver) setOnboarding(true);
    } catch (err) {
      surface(err);
    }
  };

  const dismissOnboarding = (): void => {
    setOnboarding(false);
    seenOnboarding.current = true;
    void window.hv.setOnboardingSeen(true);
  };

  const selectSession = async (id: string): Promise<void> => {
    setSelectedId(id);
    setView("chat");
    if (statuses[id] === "running") return;
    // Show a loader while the Pi process starts / the session file loads — for
    // ANY not-yet-running open, not only hibernated resumes (round-4 follow-up:
    // a fresh open showed a static empty state with no loader).
    setStatuses((p) => ({ ...p, [id]: "waking" }));
    try {
      const { messages } = await window.hv.openSession(id);
      setStatuses((p) => ({ ...p, [id]: "running" }));
      if (messages) {
        // Rebuilt from Pi's session file — only adopt when we hold nothing newer.
        // Reconstructs tool cards too (intent + result persist in the session
        // file); reconstructed cards are "done" and render collapsed by default.
        // Stable ids (like appendItem) keep rewind (#11) + React keys working.
        const items: TranscriptItem[] = messages.map((m) =>
          m.kind === "tool"
            ? {
                kind: "tool",
                id: idCounter.current++,
                card: {
                  toolCallId: m.toolCallId,
                  toolName: m.toolName,
                  args: m.args,
                  status: m.error ? "error" : "done",
                  result: m.result,
                },
              }
            : { kind: m.kind, text: m.text, id: idCounter.current++ },
        );
        setTranscripts((p) => {
          if (p[id]?.length) return p;
          // Rebuild the tool index so any late tool_execution_end still matches.
          const map = new Map<string, number>();
          items.forEach((it, i) => {
            if (it.kind === "tool") map.set(it.card.toolCallId, i);
          });
          toolIndex.current[id] = map;
          return { ...p, [id]: items };
        });
      }
      setError(null);
    } catch (err) {
      setStatuses((p) => {
        if (p[id] !== "waking") return p;
        const next = { ...p };
        delete next[id];
        return next;
      });
      surface(err);
    }
  };

  const send = async (msg: string, behavior?: "followUp", attachments?: ImageAttachment[]): Promise<void> => {
    if (!selectedId) return;
    const sid = selectedId;
    // W2.1: attached images ride the RPC `images` param (ImageContent[]).
    const images = attachments?.length ? buildImages(attachments) : undefined;
    // B2: while the agent runs, a bare prompt errors — Enter/send steers
    // (V2.A: the Queue button is gone; the followUp behavior plumbing stays).
    // The message shows as a chip (queue_update) and only joins the
    // transcript when Pi delivers it.
    if (busy[sid]) {
      try {
        await window.hv.promptSession(sid, msg, behavior ?? "steer", images);
      } catch (err) {
        surface(err);
      }
      return;
    }
    appendItem(sid, { kind: "user", text: msg, images: attachments?.map(attachmentUrl) });
    streaming.current[sid] = false;
    setBusy((p) => ({ ...p, [sid]: true }));
    try {
      await window.hv.promptSession(sid, msg, undefined, images);
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
    if (uiReq?.kind !== "permission") return;
    const sid = uiReq.req.sessionId;
    const tool = uiReq.info.tool;
    // Round 3 #13: persistent grants aren't understood by the bridge — respond
    // with a plain "Allow" for this call and write a tool-layer allow rule at the
    // chosen scope (workspace path, or global). The rules reload covers future calls.
    let bridgeChoice: "Allow" | "Allow for session" | "Deny" = "Deny";
    if (choice === "Allow for workspace" || choice === "Always allow") {
      const ws = choice === "Allow for workspace" ? (sessions.find((s) => s.id === sid)?.workspaceId ?? null) : null;
      void window.hv.addPermissionRule(ws, tool);
      bridgeChoice = "Allow";
    } else {
      bridgeChoice = choice;
    }
    window.hv.respondPermission(uiReq.req.id, bridgeChoice);
    if (sid) {
      if (bridgeChoice === "Deny") {
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
        pendingApproval.current[sid] = { tool: uiReq.info.tool, choice: bridgeChoice as "Allow" | "Allow for session" };
      }
    }
    // Pop the answered prompt (not necessarily the global head — B4 queues are per-session).
    setUiQueue((q) => q.filter((e) => e.req.id !== uiReq.req.id));
  };

  // V2.B: answer/dismiss an ask_user question. Submit echoes the choices into
  // the transcript as a user-style item so the conversation reads coherently;
  // Dismiss maps to {cancelled:true} → the bridge tells the model to proceed.
  const respondAskUser = (answers: AskAnswer[] | null): void => {
    if (uiReq?.kind !== "askUser") return;
    window.hv.respondInput(uiReq.req.id, answers ? JSON.stringify(answers) : null);
    const sid = uiReq.req.sessionId;
    if (sid && answers) appendItem(sid, { kind: "user", text: answersSummary(answers) });
    setUiQueue((q) => q.filter((e) => e.req.id !== uiReq.req.id));
  };

  // #11 rewind: truncate the transcript at (and after) a user message and best-
  // effort drop the matching tail from Pi's context. The composer repopulation is
  // done in ChatView (which owns the input). Chat-only — files are NOT reverted.
  const rewindTo = (it: TranscriptItem): void => {
    if (it.id == null) return;
    // ids are globally unique (one monotonic counter), so locate the owning
    // session by the item's id rather than trusting selectedId — robust even if
    // the session changed while the confirm dialog was open.
    const sid =
      (selectedId && (transcripts[selectedId] ?? []).some((x) => x.id === it.id) && selectedId) ||
      Object.keys(transcripts).find((k) => transcripts[k].some((x) => x.id === it.id));
    if (!sid) return;
    const items = transcripts[sid] ?? [];
    const idx = items.findIndex((x) => x.id === it.id);
    if (idx < 0) return;
    const tail = items.slice(idx);
    const msgCount = tail.filter((x) => x.kind === "user" || x.kind === "assistant").length;
    const toolIds = new Set(
      tail.flatMap((x) => (x.kind === "tool" ? [x.card.toolCallId] : [])),
    );
    setTranscripts((p) => ({ ...p, [sid]: (p[sid] ?? []).slice(0, idx) }));
    pendingRewind.current[sid] = { msgCount, toolIds };
    void window.hv.contextSnapshot(sid);
  };

  if (keyState === "loading") {
    return <div className="h-full flex items-center justify-center text-ink-soft">…</div>;
  }

  const needsSetup = keyState === "missing";
  const activeView: View = needsSetup ? "settings" : view;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  // ── W2.2/WS6: current workspace's tab state + dirty flags for the strip ──
  const wsId = selected?.workspaceId ?? null;
  const wsTabs = (wsId ? tabsByWs[wsId] : undefined) ?? emptyTabs;
  const dirtyForWs: Record<string, boolean> = {};
  if (wsId) for (const f of allFiles(wsTabs)) dirtyForWs[f] = !!dirtyMap[bufferKey(wsId, f)];
  // Every open file across ALL workspaces stays mounted (hidden) so unsaved
  // buffers survive session/workspace/view switches.
  const openFileEntries = Object.entries(tabsByWs).flatMap(([w, t]) => allFiles(t).map((f) => [w, f] as const));
  // WS6: which pane's content cell a tab occupies when it's that pane's active
  // tab. Content is mounted flat and placed via CSS grid-area (never reparented).
  const AREAS = ["contentA", "contentB"] as const;
  const areaFor = (tab: TabId): string | null => {
    const p = wsTabs.panes.findIndex((pane) => pane.active === tab);
    return p >= 0 ? AREAS[p] : null;
  };
  const chatArea = selected ? areaFor(CHAT_TAB) : "contentA";
  // Divider between the two split panes (left border for v, top border for h).
  const paneDivider = (area?: string | null): string =>
    area === "contentB" ? (wsTabs.split === "v" ? "border-l-2 border-line" : "border-t-2 border-line") : "";
  // v5.1: a persistent `toolbar` area is pinned top-right (strip row only);
  // content spans under it. The file tree is a separate absolute overlay (below),
  // so opening it never shrinks the panes. Content stays mounted-flat (WS6).
  const TREE = treeOpen && !!wsId;
  const gridStyle: React.CSSProperties =
    wsTabs.split === "v"
      ? {
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto",
          gridTemplateRows: "auto minmax(0,1fr)",
          gridTemplateAreas: '"stripA stripB toolbar" "contentA contentB contentB"',
        }
      : wsTabs.split === "h"
        ? {
            gridTemplateColumns: "minmax(0,1fr) auto",
            gridTemplateRows: "auto minmax(0,1fr) auto minmax(0,1fr)",
            gridTemplateAreas: '"stripA toolbar" "contentA contentA" "stripB stripB" "contentB contentB"',
          }
        : {
            gridTemplateColumns: "minmax(0,1fr) auto",
            gridTemplateRows: "auto minmax(0,1fr)",
            gridTemplateAreas: '"stripA toolbar" "contentA contentA"',
          };

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
        onWorkspaceSettings={setWsSettings}
        onNewSession={newSession}
        onSelectSession={selectSession}
        onRenameSession={(id, title) => window.hv.renameSession(id, title)}
        onArchiveSession={(id, archived) => window.hv.archiveSession(id, archived)}
        onDeleteSession={async (id) => {
          // V2.C2: deleting the selected session falls back to no-selection.
          if (selectedId === id) setSelectedId(null);
          await window.hv.deleteSession(id); // sessions-changed broadcast refreshes the list
        }}
        onOpenHelp={() => setOnboarding(true)}
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
        {activeView === "settings" && (
          <SettingsView
            firstRun={needsSetup}
            onSaved={() => {
              setKeyState("present");
              setView("chat");
            }}
            sessionId={selectedId}
            sessions={sessions}
            workspaces={workspaces}
          />
        )}
        {activeView === "agents" && (
          <AgentsView
            agents={agents}
            tools={tools}
            sessionId={selectedId}
            workspaceId={selected?.workspaceId ?? null}
          />
        )}
        {/* W2.2: the chat area stays MOUNTED (hidden) on other views so open
            editor buffers and chat state survive a Settings detour. Center is
            tabbed: chat tab + file tabs; the docked file tree sits to the
            right IN FLOW (ContextPanel is a fixed overlay above it, z-40). */}
        <div className={`flex-1 min-h-0 ${activeView === "chat" ? "flex" : "hidden"}`}>
          <div
            className="flex-1 min-w-0 min-h-0 grid relative"
            style={gridStyle}
            onDragOver={(e) => e.dataTransfer.types.includes("application/x-hv-relpath") && e.preventDefault()}
            onDrop={(e) => {
              const rel = e.dataTransfer.getData("application/x-hv-relpath");
              if (rel && wsId) { e.preventDefault(); openFileTab(wsId, rel); }
            }}
          >
            {selected && wsId && (
              <div style={{ gridArea: "stripA" }} className="min-w-0 h-11">
                <TabStrip
                  pane={wsTabs.panes[0]}
                  paneIndex={0}
                  sessionTitle={selected.title}
                  dirty={dirtyForWs}
                  onSelect={(tab) => updateTabs(wsId, (t) => activateTab(t, 0, tab))}
                  onClose={(tab) => closeFileTab(wsId, 0, tab)}
                  onMoveTab={(tab, to) => updateTabs(wsId, (t) => moveTab(t, tab, to))}
                  chatBusy={!!(selectedId && busy[selectedId])}
                />
              </div>
            )}
            {/* v5.1: persistent top-right toolbar — split + file-panel controls,
                always visible regardless of split state. */}
            {selected && wsId && (
              <div style={{ gridArea: "toolbar" }} className="h-11 flex items-stretch border-b-2 border-line bg-paper">
                <CenterToolbar
                  split={wsTabs.split}
                  treeOpen={treeOpen}
                  onSplit={(dir) => updateTabs(wsId, (t) => splitPane(t, dir))}
                  onUnsplit={() => updateTabs(wsId, unsplit)}
                  onToggleTree={() => setTreeOpen((o) => !o)}
                />
              </div>
            )}
            {selected && wsId && wsTabs.split && wsTabs.panes[1] && (
              <div style={{ gridArea: "stripB" }} className={`min-w-0 h-11 ${wsTabs.split === "v" ? "border-l-2 border-line" : "border-t-2 border-line"}`}>
                <TabStrip
                  pane={wsTabs.panes[1]}
                  paneIndex={1}
                  sessionTitle={selected.title}
                  dirty={dirtyForWs}
                  onSelect={(tab) => updateTabs(wsId, (t) => activateTab(t, 1, tab))}
                  onClose={(tab) => closeFileTab(wsId, 1, tab)}
                  onMoveTab={(tab, to) => updateTabs(wsId, (t) => moveTab(t, tab, to))}
                  chatBusy={!!(selectedId && busy[selectedId])}
                />
              </div>
            )}
            {/* WS6: empty-pane placeholder (a split pane with no active tab). */}
            {selected && wsTabs.split && wsTabs.panes[1] && wsTabs.panes[1].active === null && (
              <div style={{ gridArea: "contentB" }} className={`min-h-0 flex items-center justify-center text-sm text-ink-soft ${paneDivider("contentB")}`}>
                Open a file or drag a tab here.
              </div>
            )}
            <div
              style={{ gridArea: chatArea ?? undefined }}
              className={`min-h-0 min-w-0 flex-col ${paneDivider(chatArea)} ${activeView === "chat" && chatArea ? "flex" : "hidden"}`}
            >
              <ChatView
            workspace={selected?.workspaceId ?? null}
            sessionId={selectedId}
            sessionModel={selected?.model ?? null}
            items={(selectedId ? transcripts[selectedId] : undefined) ?? []}
            streaming={(selectedId ? streamText[selectedId] : undefined) || undefined}
            busy={(selectedId && busy[selectedId]) || false}
            waking={(selectedId && statuses[selectedId] === "waking") || false}
            crashed={selectedId && statuses[selectedId] === "crashed" ? (crashCodes[selectedId] ?? -1) : null}
            turns={(selectedId && turns[selectedId]) || 0}
            queue={(selectedId ? queues[selectedId] : undefined) ?? emptyQueue}
            delegations={selectedId ? Object.values(delegations[selectedId] ?? {}) : []}
            contextSnapshot={(selectedId ? contextSnapshots[selectedId] : undefined) ?? null}
            fallbackWindow={fallbackWindow}
            stats={selStats}
            searchOpen={searchOpen}
            onSearchOpenChange={setSearchOpen}
            contextOpen={contextOpen}
            onContextOpenChange={setContextOpen}
            onOpenAgentsMd={() => setAgentsMd("AGENTS.md")}
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
                onOpenFile={openFileFromCard}
                onOpenMcp={() => setView("agents")}
                onRewind={rewindTo}
              />
            </div>
            {openFileEntries.map(([w, f]) => {
              const area = wsId === w ? areaFor(f) : null;
              return (
                <FileTab
                  key={bufferKey(w, f)}
                  workspace={w}
                  relPath={f}
                  active={activeView === "chat" && wsId === w && area !== null}
                  gridArea={area ?? undefined}
                  className={paneDivider(area)}
                  onDirtyChange={(d) => setDirtyFlag(bufferKey(w, f), d)}
                />
              );
            })}
            {/* v5.1: file tree is a right-side OVERLAY drawer (top below the tab
                bar, h-11) — it overlays the content instead of a grid column, so
                opening it never shrinks the panes. Below the ContextPanel (z-40). */}
            {TREE && (
              <div className="absolute top-11 right-0 bottom-0 w-64 z-30 border-l-2 border-line bg-paper shadow-sticker-lg">
                <FileTree key={wsId} workspace={wsId!} onOpenFile={(rel) => openFileTab(wsId!, rel)} onClose={() => setTreeOpen(false)} />
              </div>
            )}
          </div>
        </div>
      </main>
      {uiReq?.kind === "permission" && <PermissionModal req={uiReq.req} info={uiReq.info} onChoice={respondPermission} />}
      {uiReq?.kind === "askUser" && (
        <AskUserModal key={uiReq.req.id} ask={uiReq.ask} onSubmit={respondAskUser} onDismiss={() => respondAskUser(null)} />
      )}
      {wsSettings && <WorkspaceSettingsModal workspace={wsSettings} onClose={() => setWsSettings(null)} />}
      {onboarding && <OnboardingOverlay onDismiss={dismissOnboarding} />}
      {/* WS7: AGENTS.md editor — root from the "+" menu, any AGENTS.md from the tree. */}
      {agentsMd && wsId && (
        <AgentsMdPanel
          workspace={wsId}
          relPath={agentsMd}
          sessionId={selectedId}
          onClose={() => setAgentsMd(null)}
        />
      )}
    </div>
  );
}

/** WS6: the file-tree toggle. */
function FilesToggle({ treeOpen, onToggle }: { treeOpen: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={treeOpen}
      aria-label={treeOpen ? "Hide the file tree" : "Browse workspace files"}
      title={treeOpen ? "Hide the file tree" : "Browse workspace files"}
      className={`shrink-0 flex items-center border-l-2 border-line px-3 cursor-pointer transition-colors ${
        treeOpen ? "text-tangerine-deep bg-paper-deep/50" : "text-ink-soft hover:text-ink hover:bg-paper-deep/40"
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}

/** v5.1: persistent top-right toolbar — split controls + file-panel toggle. */
function CenterToolbar({
  split,
  treeOpen,
  onSplit,
  onUnsplit,
  onToggleTree,
}: {
  split: "h" | "v" | null;
  treeOpen: boolean;
  onSplit: (dir: "h" | "v") => void;
  onUnsplit: () => void;
  onToggleTree: () => void;
}): React.JSX.Element {
  const btn = "shrink-0 flex items-center border-l-2 border-line px-2.5 text-ink-soft hover:text-ink hover:bg-paper-deep/40 cursor-pointer transition-colors";
  return (
    <div className="flex items-stretch">
      <button type="button" onClick={() => onSplit("v")} aria-pressed={split === "v"} title="Split — side by side" aria-label="Split vertically"
        className={`${btn} ${split === "v" ? "text-tangerine-deep bg-paper-deep/50" : ""}`}>
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" />
        </svg>
      </button>
      <button type="button" onClick={() => onSplit("h")} aria-pressed={split === "h"} title="Split — stacked" aria-label="Split horizontally"
        className={`${btn} ${split === "h" ? "text-tangerine-deep bg-paper-deep/50" : ""}`}>
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18" />
        </svg>
      </button>
      {split && (
        <button type="button" onClick={onUnsplit} title="Close split" aria-label="Close split" className={btn}>
          <span className="text-sm font-bold leading-none">⊟</span>
        </button>
      )}
      <FilesToggle treeOpen={treeOpen} onToggle={onToggleTree} />
    </div>
  );
}
