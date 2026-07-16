import { useCallback, useEffect, useState } from "react";
import { Transcript, type TranscriptItem } from "./Transcript";
import { AgentsMdPanel } from "./AgentsMdPanel";
import { TokenGauge } from "./TokenGauge";
import { ContextPanel } from "./ContextPanel";
import { emptyQueue, type QueueState } from "../queue";
import { computeGauge, type ContextSnapshot, type SessionStats } from "../context";
import { delegationHint, formatElapsed, traceFor, type DelegationRun, type SubagentTrace } from "../agents";
import { SubagentTraceView, ToolIcon } from "./ToolCard";
import {
  attachmentUrl, resolveModelTier, supportsVision, type ImageAttachment, type ModelRef, type ModelTier,
} from "../composer";

/** Round 3 #3: pasting more than this many characters asks for confirmation. */
const PASTE_CONFIRM_CHARS = 100_000;

/** V2.A: chip subtext — which tier of session → workspace → global won. */
const TIER_LABEL: Record<ModelTier, string> = {
  session: "session override",
  workspace: "workspace default",
  global: "global default",
};

export function ChatView({
  workspace,
  sessionId,
  sessionModel = null,
  items,
  streaming,
  busy,
  waking = false,
  crashed,
  turns,
  queue = emptyQueue,
  delegations = [],
  contextSnapshot = null,
  fallbackWindow,
  onSend,
  onAbort,
  onRestart,
  onRetry,
  onOpenFolder,
  onCompact,
  onOpenFile,
  onRewind,
}: {
  workspace: string | null;
  sessionId: string | null;
  /** W2.1: this session's persisted model override (from SessionMeta). */
  sessionModel?: ModelRef | null;
  items: TranscriptItem[];
  streaming?: string;
  busy: boolean;
  /** Round 3 #2: session is resuming from hibernation — show a loader. */
  waking?: boolean;
  crashed: number | null;
  turns: number;
  queue?: QueueState;
  /** V2.C1: active subagent runs (sticky in-flow section; done ones slide away). */
  delegations?: DelegationRun[];
  contextSnapshot?: ContextSnapshot | null;
  fallbackWindow?: number | null;
  onSend: (msg: string, behavior?: "followUp", images?: ImageAttachment[]) => void;
  onAbort: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onOpenFolder: () => void;
  onCompact: () => void;
  /** W2.2: open a workspace-relative file in an editor tab (clickable card paths). */
  onOpenFile?: (relPath: string) => void;
  /** Round 3 #11: truncate the conversation at a user message (App-side). */
  onRewind?: (it: TranscriptItem) => void;
}): React.JSX.Element {
  const [input, setInput] = useState("");
  const [pendingRewind, setPendingRewind] = useState<TranscriptItem | null>(null); // #11 confirm
  // Stable identity so MessageItem's memo isn't busted on every composer keystroke.
  const openRewind = useCallback((it: TranscriptItem) => setPendingRewind(it), []);
  // ── W2.1: model chip + attach menu state ─────────────────────────
  const [models, setModels] = useState<HvModel[] | null>(null);
  const [workspaceModel, setWorkspaceModel] = useState<ModelRef | null>(null);
  const [defaultModel, setDefaultModel] = useState<ModelRef | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState(""); // #5: filter box when >5 models
  const [pendingPaste, setPendingPaste] = useState<string | null>(null); // #3: large-paste confirm
  const [searchOpen, setSearchOpen] = useState(false); // #8: in-conversation search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(0); // #1: active match index
  const [searchTotal, setSearchTotal] = useState(0);
  const onSearchTotal = useCallback((n: number) => {
    setSearchTotal(n);
    setSearchActive((a) => (n === 0 ? 0 : Math.min(a, n - 1)));
  }, []);
  const stepMatch = (dir: 1 | -1): void => {
    if (searchTotal === 0) return;
    setSearchActive((a) => (a + dir + searchTotal) % searchTotal);
  };
  const [offerAgentsMd, setOfferAgentsMd] = useState(false); // #7: one-time AGENTS.md banner
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  // Honest fallback: live set_model failed → override persisted, applies on next spawn.
  const [restartHint, setRestartHint] = useState(false);
  // V2.A: fetch every resolution tier, and REFETCH whenever provider/model
  // config changes (key added/removed, OAuth login/logout, default/workspace
  // model edits) — the mount-only fetch left the list and chip stale.
  useEffect(() => {
    setWorkspaceModel(null);
    const refetch = (): void => {
      window.hv.listModels().then(setModels).catch(() => setModels([]));
      window.hv.getProviders().then((p) => setDefaultModel(p.defaultModel)).catch(() => {});
      if (workspace) window.hv.getWorkspaceModel(workspace).then(setWorkspaceModel).catch(() => {});
    };
    refetch();
    return window.hv.onProvidersChanged(refetch);
  }, [workspace]);
  // Session switch: attachments and the restart hint belong to the old session.
  useEffect(() => {
    setAttachments([]);
    setRestartHint(false);
    setModelMenuOpen(false);
    setAttachMenuOpen(false);
  }, [sessionId]);
  const resolution = resolveModelTier(sessionModel, workspaceModel, defaultModel);
  const resolved = resolution?.ref ?? null;
  const vision = supportsVision(models, resolved);
  const modelName = resolved
    ? models?.find((m) => m.provider === resolved.provider && m.id === resolved.modelId)?.name ?? resolved.modelId
    : null;

  const pickModel = async (m: HvModel): Promise<void> => {
    setModelMenuOpen(false);
    if (!sessionId) return;
    if (resolved && m.provider === resolved.provider && m.id === resolved.modelId) return;
    try {
      const { live } = await window.hv.setSessionModel(sessionId, { provider: m.provider, modelId: m.id });
      setRestartHint(!live);
    } catch {
      /* unknown session (closed mid-click) — nothing to do */
    }
  };

  const attachImage = async (): Promise<void> => {
    setAttachMenuOpen(false);
    const img = await window.hv.pickImage();
    if (img) setAttachments((p) => [...p, img]);
  };
  const [agentsMdOpen, setAgentsMdOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  // Fetched once per agent_end (turns bump); shared by the gauge and the panel.
  const [stats, setStats] = useState<SessionStats | null>(null);
  // Perf: `turns` bumps once per agent_end / compaction — during a burst of
  // turns this fired an RPC each time. Debounce 500ms trailing so we fetch once
  // after activity settles; still guarantees a final fetch.
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    const t = setTimeout(() => {
      window.hv.getStats(sessionId).then((s) => live && setStats(s as SessionStats | null));
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [turns, sessionId]);
  // #8: ⌘F / Ctrl-F opens in-conversation search; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  // #7: on opening a workspace with no AGENTS.md, offer to create one — once per
  // workspace (dismissal remembered in localStorage so it never nags).
  useEffect(() => {
    if (!workspace) return;
    if (localStorage.getItem(`hv:agentsmd-dismissed:${workspace}`)) return;
    let live = true;
    void window.hv.readAgentsMd(workspace).then((c) => {
      if (live) setOfferAgentsMd(c === null);
    });
    return () => { live = false; };
  }, [workspace]);

  // B5: non-blocking auto-suggest banner, shown once per session when the gauge
  // first hits the red zone. Never auto-compacts.
  const [suggestDismissed, setSuggestDismissed] = useState<Set<string>>(new Set());
  const gauge = computeGauge(stats, fallbackWindow);
  const suggestCompact = gauge?.zone === "red" && sessionId != null && !suggestDismissed.has(sessionId) && !contextOpen;

  // #8: filter the transcript by search text (message kinds that carry text).

  if (!workspace || !sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-6 size-16 rounded-2xl bg-honey border-2 border-ink/80 shadow-pop -rotate-3 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="size-8 rotate-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
          </div>
          <h1 className="font-black text-3xl tracking-tight">Pick a project, make a vibe.</h1>
          <p className="text-ink-soft mt-2 mb-7">
            Add a workspace, then hit <span className="font-bold text-tangerine">+</span> next to it in the sidebar
            to start a session.
          </p>
          <button
            type="button"
            onClick={onOpenFolder}
            className="rounded-xl bg-tangerine text-paper font-bold px-6 py-3 border-2 border-tangerine-deep shadow-pop transition-all hover:brightness-105 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none cursor-pointer"
          >
            Add a workspace folder…
          </button>
        </div>
      </div>
    );
  }

  const queued = queue.steering.length + queue.followUp.length;
  // V2.C1: while a delegation runs, the composer stays fully enabled but
  // anything typed queues behind the blocking subagent call — say so honestly
  // (placeholder + tooltip suffix on the queued chips).
  const hint = delegationHint(delegations);

  const submit = (behavior?: "followUp"): void => {
    if (!input.trim()) return;
    onSend(input, behavior, attachments.length ? attachments : undefined);
    setInput("");
    setAttachments([]);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b-2 border-line bg-paper">
        {/* Session title + workspace removed — the tab strip already names the
            session and the sidebar shows the workspace (redundant here). */}
        <div className="flex-1 min-w-0" />
        {busy && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-tangerine">
            <span className="size-2 rounded-full bg-tangerine animate-pulse" />
            working
          </span>
        )}
        <button
          type="button"
          onClick={() => setSearchOpen((o) => !o)}
          title="Search this conversation (⌘F)"
          aria-label="Search this conversation"
          className="text-sm rounded-full border-2 border-line bg-card px-2.5 py-1 text-ink-soft hover:border-honey hover:text-ink cursor-pointer transition-colors"
        >
          ⌕
        </button>
        <button
          type="button"
          onClick={() => setAgentsMdOpen(true)}
          title="Edit AGENTS.md — project context for the agent (applies to new or restarted sessions)"
          className="font-mono text-[11px] rounded-full border-2 border-line bg-card px-3 py-1 text-ink-soft hover:border-honey hover:text-ink cursor-pointer transition-colors"
        >
          AGENTS.md
        </button>
        <TokenGauge stats={stats} fallbackWindow={fallbackWindow} onOpen={() => setContextOpen(true)} />
      </header>

      {/* Crash banner */}
      {crashed !== null && (
        <div className="flex items-center gap-3 px-6 py-2.5 bg-berry-soft border-b-2 border-berry/40 text-sm font-semibold text-berry">
          <span className="flex-1">The agent process stopped (code {crashed}).</span>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-lg bg-berry text-paper font-bold text-xs px-3 py-1.5 border-2 border-berry hover:brightness-110 cursor-pointer"
          >
            Restart agent
          </button>
        </div>
      )}

      {/* B5: red-zone auto-suggest (once per session, non-blocking). */}
      {suggestCompact && (
        <div className="flex items-center gap-3 px-6 py-2.5 bg-berry-soft border-b-2 border-berry/40 text-sm font-semibold text-berry">
          <span className="flex-1">Context is {gauge!.percent}% full. Open the context panel to review or compact.</span>
          <button
            type="button"
            onClick={() => setContextOpen(true)}
            className="rounded-lg bg-berry text-paper font-bold text-xs px-3 py-1.5 border-2 border-berry hover:brightness-110 cursor-pointer"
          >
            Review context
          </button>
          <button
            type="button"
            onClick={() => sessionId && setSuggestDismissed((p) => new Set(p).add(sessionId))}
            className="text-xs font-bold text-ink-soft hover:text-ink cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* V2.C1: the delegation run lives OUTSIDE the chat flow — a sticky
          in-flow section at the top of the transcript scroll container: it
          scrolls naturally but pins while subagents run. The main chat goes
          silent during a delegation (main agent is blocked); this makes it
          obvious WHO is running, that progress is happening, and — clicked —
          WHAT the child is doing (live trace, from the in-flow tool card). */}
      {/* Round 3 #7: proactively offer to create AGENTS.md when the workspace has none. */}
      {offerAgentsMd && (
        <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-line bg-honey-soft text-sm text-ink">
          <span className="font-bold flex-1">No AGENTS.md found — add project context so the agent understands this codebase?</span>
          <button
            type="button"
            onClick={() => { setOfferAgentsMd(false); setAgentsMdOpen(true); }}
            className="rounded-lg bg-tangerine text-paper font-bold text-xs px-3 py-1 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105"
          >
            Generate one
          </button>
          <button
            type="button"
            onClick={() => {
              if (workspace) localStorage.setItem(`hv:agentsmd-dismissed:${workspace}`, "1");
              setOfferAgentsMd(false);
            }}
            className="rounded-lg bg-card text-ink-soft font-bold text-xs px-3 py-1 border-2 border-line shadow-sticker cursor-pointer hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Round 3 #11: rewind confirm — files are NOT rolled back (chat-only V1). */}
      {pendingRewind !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" onClick={() => setPendingRewind(null)}>
          <div className="w-full max-w-md rounded-2xl border-2 border-line-strong bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold text-ink mb-1">Rewind to this message?</div>
            <p className="text-sm text-ink-soft mb-4">
              Every message after this point will be removed from the conversation and the agent's context, and this
              message will move back into the composer so you can edit and resend it. <strong>Files on disk are not
              rolled back.</strong>
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRewind(null)}
                className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const it = pendingRewind;
                  onRewind?.(it);
                  setInput("text" in it && typeof it.text === "string" ? it.text : "");
                  setPendingRewind(null);
                }}
                className="rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105"
              >
                Rewind
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Round 3 #3: large-paste confirm. */}
      {pendingPaste !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" onClick={() => setPendingPaste(null)}>
          <div className="w-full max-w-md rounded-2xl border-2 border-line-strong bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold text-ink mb-1">Paste {pendingPaste.length.toLocaleString()} characters?</div>
            <p className="text-sm text-ink-soft mb-4">That's a large amount of text to add to the composer. Insert it anyway?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingPaste(null)}
                className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setInput((prev) => prev + pendingPaste); setPendingPaste(null); }}
                className="rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105"
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
      {/* #1: in-conversation search strip — highlights matches, next/prev nav. */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-line bg-paper-deep/40">
          <span className="text-ink-soft">⌕</span>
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
            }}
            placeholder="Search this conversation…"
            className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-ink-soft/60"
          />
          {searchQuery.trim() && (
            <span className="text-xs text-ink-soft font-medium shrink-0 tabular-nums">
              {searchTotal === 0 ? "0/0" : `${searchActive + 1}/${searchTotal}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => stepMatch(-1)}
            disabled={searchTotal === 0}
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            className="text-ink-soft hover:text-ink cursor-pointer font-bold px-1 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => stepMatch(1)}
            disabled={searchTotal === 0}
            aria-label="Next match"
            title="Next match (Enter)"
            className="text-ink-soft hover:text-ink cursor-pointer font-bold px-1 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
            aria-label="Close search"
            className="text-ink-soft hover:text-ink cursor-pointer font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}
      {/* Round 3 #2 (fixed round 4): loader while the session opens/resumes —
          shown for any not-yet-running open, not just hibernated resumes. */}
      {waking && items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-ink-soft">
          <span className="size-8 rounded-full border-[3px] border-line border-t-tangerine animate-spin" />
          <span className="text-sm font-bold">Opening session…</span>
        </div>
      ) : (
        <Transcript
          items={items}
          streaming={streaming}
          busy={busy}
          header={delegations.length > 0 ? <DelegationSection runs={delegations} items={items} /> : undefined}
          onRetry={onRetry}
          workspace={workspace}
          onOpenFile={onOpenFile}
          onRewind={onRewind && !busy ? openRewind : undefined}
          searchQuery={searchOpen ? searchQuery : ""}
          searchActiveIndex={searchActive}
          onSearchTotal={onSearchTotal}
        />
      )}

      {/* Composer */}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
        className="px-6 pb-5 pt-2"
      >
        {/* Queued messages (Pi queue_update). Abort preserves the queue — chips stay after Stop. */}
        {queued > 0 && (
          <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-1.5 px-1 pb-2">
            <span
              className="text-[10px] font-bold uppercase tracking-widest text-ink-soft"
              title="Queued messages are kept even if you press Stop. Pi can't unqueue messages yet."
            >
              queued · kept on stop
            </span>
            {queue.steering.map((m, i) => (
              <span
                key={`s-${i}`}
                title={`Queued — Pi can't unqueue messages yet. Delivered between tool calls: ${m}${hint ? `\n${hint}.` : ""}`}
                className="max-w-56 truncate rounded-full border-2 border-honey bg-honey-soft px-2.5 py-0.5 text-xs font-semibold"
              >
                ↪ {m}
              </span>
            ))}
            {queue.followUp.map((m, i) => (
              <span
                key={`f-${i}`}
                title={`Queued — Pi can't unqueue messages yet. Runs after this turn: ${m}${hint ? `\n${hint}.` : ""}`}
                className="max-w-56 truncate rounded-full border-2 border-sky/50 bg-card px-2.5 py-0.5 text-xs font-semibold"
              >
                ⏭ {m}
              </span>
            ))}
          </div>
        )}
        {/* W2.1: attached-image chips — thumbnail + remove, sent with the next prompt. */}
        {attachments.length > 0 && (
          <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-2 px-1 pb-2">
            {attachments.map((a, i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 rounded-xl border-2 border-line-strong bg-card pl-1 pr-2 py-1 shadow-sticker"
                title={a.name}
              >
                <img src={attachmentUrl(a)} alt={a.name} className="size-8 rounded-lg object-cover border border-line" />
                <span className="max-w-32 truncate text-xs font-semibold">{a.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
                  className="text-ink-soft hover:text-berry font-bold text-sm leading-none cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {/* W2.1: honest fallback — live switch failed, override applies at next spawn. */}
        {restartHint && (
          <div className="max-w-3xl mx-auto px-1 pb-1.5 text-[11px] font-semibold text-ink-soft">
            Model saved — applies when this session restarts.
          </div>
        )}
        <div className="max-w-3xl mx-auto flex gap-2 items-center rounded-2xl bg-card border-2 border-line-strong shadow-sticker-lg px-3 py-2 focus-within:border-tangerine transition-colors">
          {/* W2.1: "+" attach menu — always visible; entries gate honestly. */}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Attach"
              aria-expanded={attachMenuOpen}
              onClick={() => { setAttachMenuOpen((o) => !o); setModelMenuOpen(false); }}
              className="size-8 rounded-xl border-2 border-line-strong text-ink-soft font-black text-lg leading-none hover:bg-paper-deep/40 hover:text-ink cursor-pointer transition-colors"
            >
              +
            </button>
            {attachMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAttachMenuOpen(false)} />
                <div className="absolute bottom-full left-0 mb-2 z-20 w-56 rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm font-semibold">
                  <button
                    type="button"
                    disabled={!vision}
                    onClick={attachImage}
                    title={vision ? "Attach an image to your next message" : `${modelName ?? "This model"} doesn't support image input`}
                    className="w-full text-left px-3 py-2 enabled:hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40"
                  >
                    Attach image
                    {!vision && <span className="block text-[10px] font-medium text-ink-soft">model has no vision</span>}
                  </button>
                  <button
                    type="button"
                    disabled
                    title="File import is coming soon"
                    className="w-full text-left px-3 py-2 opacity-40"
                  >
                    Attach file
                    <span className="block text-[10px] font-medium text-ink-soft">coming soon</span>
                  </button>
                </div>
              </>
            )}
          </div>
          {/* W2.1: current-model chip + per-session override dropdown (session → workspace → global). */}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Change model for this session"
              aria-expanded={modelMenuOpen}
              onClick={() => { setModelMenuOpen((o) => !o); setAttachMenuOpen(false); }}
              title={resolved ? `Model: ${resolved.provider}/${resolved.modelId}${resolution ? ` (${TIER_LABEL[resolution.tier]})` : ""}` : "No model configured"}
              className="max-w-44 text-left font-mono text-[11px] rounded-full border-2 border-line bg-paper px-2.5 py-1 text-ink-soft hover:border-honey hover:text-ink cursor-pointer transition-colors"
            >
              <span className="block truncate">{modelName ?? "model…"}</span>
              {/* V2.A: tier-source subtext — honest about WHERE the model came from. */}
              {resolution && (
                <span className="block truncate font-sans text-[9px] font-semibold leading-tight text-ink-soft/80">
                  {TIER_LABEL[resolution.tier]}
                </span>
              )}
            </button>
            {modelMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => { setModelMenuOpen(false); setModelFilter(""); }} />
                <div className="absolute bottom-full left-0 mb-2 z-20 w-72 max-h-80 overflow-hidden flex flex-col rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm">
                  {/* #5: mini search bar once the list is long enough to warrant it. */}
                  {(models ?? []).length > 5 && (
                    <input
                      autoFocus
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder="Search models…"
                      className="mx-2 mb-1 px-2 py-1 rounded-lg border-2 border-line bg-paper text-[13px] focus:outline-none focus:border-tangerine"
                    />
                  )}
                  <div className="overflow-y-auto">
                    {(() => {
                      const q = modelFilter.trim().toLowerCase();
                      const shown = (models ?? []).filter(
                        (m) => !q || `${m.name} ${m.provider} ${m.id}`.toLowerCase().includes(q),
                      );
                      return (
                        <>
                          {shown.map((m) => {
                            const active = resolved != null && m.provider === resolved.provider && m.id === resolved.modelId;
                            return (
                              <button
                                key={`${m.provider}/${m.id}`}
                                type="button"
                                onClick={() => { setModelFilter(""); void pickModel(m); }}
                                className={`w-full text-left px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer ${active ? "font-bold text-tangerine-deep" : "font-medium"}`}
                              >
                                <span className="block truncate">{m.name}</span>
                                <span className="block truncate font-mono text-[10px] text-ink-soft">{m.provider}/{m.id}</span>
                              </button>
                            );
                          })}
                          {(models ?? []).length === 0 && (
                            <div className="px-3 py-2 text-xs text-ink-soft font-medium">
                              {models === null ? "Loading models…" : "No models — configure a provider in Settings."}
                            </div>
                          )}
                          {(models ?? []).length > 0 && shown.length === 0 && (
                            <div className="px-3 py-2 text-xs text-ink-soft font-medium">No models match “{modelFilter}”.</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              // #3: guard against accidentally pasting a huge blob.
              const t = e.clipboardData.getData("text");
              if (t.length > PASTE_CONFIRM_CHARS) {
                e.preventDefault();
                setPendingPaste(t);
              }
            }}
            placeholder={hint ?? (busy ? "Steer the agent — lands between tool calls…" : "Ask for a change…")}
            className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-[0.95rem] focus:outline-none placeholder:text-ink-soft/60"
          />
          {/* V2.A: no separate Queue button — send/Enter steers while busy
              (App keeps the followUp behavior plumbing; it just has no UI). */}
          {busy && (
            <button
              type="button"
              onClick={onAbort}
              aria-label="Stop"
              title="Stop the agent"
              className="rounded-xl border-2 border-berry text-berry px-3 py-2 hover:bg-berry-soft cursor-pointer"
            >
              <StopIcon />
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label={busy ? "Steer" : "Send"}
            title={busy ? "Steer — lands between tool calls" : "Send"}
            className="rounded-xl bg-tangerine text-paper px-4 py-2 border-2 border-tangerine-deep shadow-sticker transition-all enabled:hover:brightness-105 enabled:active:translate-x-[2px] enabled:active:translate-y-[2px] enabled:active:shadow-none enabled:cursor-pointer disabled:opacity-40"
          >
            <SendIcon />
          </button>
        </div>
      </form>
      {agentsMdOpen && <AgentsMdPanel workspace={workspace} sessionId={sessionId} onClose={() => setAgentsMdOpen(false)} />}
      {contextOpen && (
        <ContextPanel
          sessionId={sessionId}
          snapshot={contextSnapshot}
          stats={stats}
          fallbackWindow={fallbackWindow}
          turns={turns}
          onClose={() => setContextOpen(false)}
          onCompact={onCompact}
        />
      )}
    </div>
  );
}

/** W2.1: inline paper-plane icon (no icon lib — strict self CSP). */
function SendIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

/** W2.1: inline stop-square icon. */
function StopIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** V2.C1: outcome dwell before a finished run's card slides away. App removes
    the run ~2.5s after tool_execution_end, so collapse (~350ms) finishes first. */
const OUTCOME_LINGER_MS = 1100;

/**
 * V2.C1: sticky in-flow delegation section — first child of the transcript
 * scroll container (`position: sticky; top: 0`): scrolls naturally, pins at
 * the top while subagents run. Concurrent runs stack vertically. Above the
 * transcript content (z-20), below modals/panels (z-40+).
 */
function DelegationSection({ runs, items }: { runs: DelegationRun[]; items: TranscriptItem[] }): React.JSX.Element {
  return (
    <div className="sticky top-0 z-20 px-6">
      <div className="max-w-3xl mx-auto w-full flex flex-col">
        {runs.map((run) => (
          <DelegationRunCard key={run.toolCallId} run={run} trace={traceFor(items, run.toolCallId)} />
        ))}
      </div>
    </div>
  );
}

/**
 * V2.C1: one run card — robot icon, agent name, intent, live elapsed, status,
 * with a shimmer bar while working. Clicking toggles the LIVE child transcript
 * inline (same trace the in-flow SubagentCard renders — the expansion scrolls
 * within a max-height so it never fights the sticky pinning). On completion:
 * brief done/failed state, then a height-collapse slide-away; the in-flow call
 * line + result remain in the transcript as the record.
 */
function DelegationRunCard({ run, trace }: { run: DelegationRun; trace?: SubagentTrace }): React.JSX.Element {
  const running = run.status === "running";
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  // Outcome shown briefly, then slide away (grid-rows height transition — the
  // whole card, top padding included, collapses to 0 before App removes it).
  useEffect(() => {
    if (running) return;
    const t = setTimeout(() => setLeaving(true), OUTCOME_LINGER_MS);
    return () => clearTimeout(t);
  }, [running]);
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-350 ease-in-out ${
        leaving ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
      }`}
    >
      <div className="overflow-hidden min-h-0">
        <div className="pt-3">
          <div
            className={`rounded-xl border-2 bg-card shadow-sticker-lg overflow-hidden ${
              running ? "border-sky/60" : run.status === "done" ? "border-leaf/60" : "border-berry/60"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              title={open ? "Collapse the live subagent transcript" : "See what the subagent is doing"}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold cursor-pointer hover:bg-paper-deep/40 transition-colors"
            >
              <span
                className={`size-2.5 rounded-full shrink-0 ${running ? "bg-sky animate-pulse" : run.status === "done" ? "bg-leaf" : "bg-berry"}`}
              />
              <ToolIcon kind="robot" className="size-4 shrink-0 text-sky" />
              <span className="flex-1 min-w-0 truncate">
                <span className="font-black text-tangerine-deep">{run.agent}</span>
                {run.label && <span className="text-ink-soft font-medium"> — {run.label}</span>}
              </span>
              {running ? (
                <span className="font-mono text-xs text-ink-soft tabular-nums shrink-0" title="Elapsed time">
                  working · {formatElapsed(now - run.startedAt)}
                </span>
              ) : (
                <span
                  className={`text-[11px] font-bold uppercase tracking-wide shrink-0 ${run.status === "done" ? "text-leaf" : "text-berry"}`}
                >
                  {run.status === "done" ? "done" : "failed"}
                </span>
              )}
              <span className="shrink-0 text-[11px] text-ink-soft" aria-hidden>
                {open ? "▾" : "▸"}
              </span>
            </button>
            {running && !open && <div className="h-1 hv-shimmer" aria-hidden />}
            {open && (
              <div className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2.5 max-h-72 overflow-y-auto flex flex-col gap-3">
                <SubagentTraceView results={trace?.results ?? []} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
