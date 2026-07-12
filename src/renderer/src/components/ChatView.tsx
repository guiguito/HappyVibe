import { useEffect, useState } from "react";
import { Transcript, type TranscriptItem } from "./Transcript";
import { AgentsMdPanel } from "./AgentsMdPanel";
import { TokenGauge } from "./TokenGauge";
import { ContextPanel } from "./ContextPanel";
import { emptyQueue, type QueueState } from "../queue";
import { computeGauge, type ContextSnapshot, type SessionStats } from "../context";
import { formatElapsed, type DelegationRun } from "../agents";
import {
  attachmentUrl, resolveModelTier, supportsVision, type ImageAttachment, type ModelRef, type ModelTier,
} from "../composer";

/** V2.A: chip subtext — which tier of session → workspace → global won. */
const TIER_LABEL: Record<ModelTier, string> = {
  session: "session override",
  workspace: "workspace default",
  global: "global default",
};

export function ChatView({
  workspace,
  sessionId,
  title,
  sessionModel = null,
  items,
  streaming,
  busy,
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
}: {
  workspace: string | null;
  sessionId: string | null;
  title: string | null;
  /** W2.1: this session's persisted model override (from SessionMeta). */
  sessionModel?: ModelRef | null;
  items: TranscriptItem[];
  streaming?: string;
  busy: boolean;
  crashed: number | null;
  turns: number;
  queue?: QueueState;
  /** W1.2: active subagent runs (stacking floating cards; done ones fade out). */
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
}): React.JSX.Element {
  const [input, setInput] = useState("");
  // ── W2.1: model chip + attach menu state ─────────────────────────
  const [models, setModels] = useState<HvModel[] | null>(null);
  const [workspaceModel, setWorkspaceModel] = useState<ModelRef | null>(null);
  const [defaultModel, setDefaultModel] = useState<ModelRef | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
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
  // B5: non-blocking auto-suggest banner, shown once per session when the gauge
  // first hits the red zone. Never auto-compacts.
  const [suggestDismissed, setSuggestDismissed] = useState<Set<string>>(new Set());
  const gauge = computeGauge(stats, fallbackWindow);
  const suggestCompact = gauge?.zone === "red" && sessionId != null && !suggestDismissed.has(sessionId) && !contextOpen;

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
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="font-bold truncate" title={title ?? undefined}>{title ?? "Session"}</span>
          <span className="text-xs text-ink-soft truncate shrink-0" title={workspace}>
            {workspace.split("/").filter(Boolean).pop()}
          </span>
        </div>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-tangerine">
            <span className="size-2 rounded-full bg-tangerine animate-pulse" />
            working
          </span>
        )}
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

      {/* B6: always-visible top-level delegation signal. The main chat goes
          silent during a delegation (main agent is blocked); this makes it
          obvious WHO is running and that progress is happening. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* W1.2: floating run cards — the delegation lives OUTSIDE the chat
            flow: sticky overlay at the top of the chat area, never scrolls
            away. Concurrent runs stack; a finished run shows its outcome,
            then fades (App removes it ~2.5s after tool_execution_end). */}
        {delegations.length > 0 && (
          <div className="absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 px-6 pt-3 pointer-events-none">
            {delegations.map((run) => (
              <DelegationCard key={run.toolCallId} run={run} />
            ))}
          </div>
        )}
        <Transcript items={items} streaming={streaming} busy={busy} onRetry={onRetry} workspace={workspace} onOpenFile={onOpenFile} />
      </div>

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
              title="Queued messages are kept even if you press Stop."
            >
              queued · kept on stop
            </span>
            {queue.steering.map((m, i) => (
              <span
                key={`s-${i}`}
                title={`Steering: delivered between tool calls — ${m}`}
                className="max-w-56 truncate rounded-full border-2 border-honey bg-honey-soft px-2.5 py-0.5 text-xs font-semibold"
              >
                ↪ {m}
              </span>
            ))}
            {queue.followUp.map((m, i) => (
              <span
                key={`f-${i}`}
                title={`Follow-up: runs after this turn — ${m}`}
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
                <div className="fixed inset-0 z-10" onClick={() => setModelMenuOpen(false)} />
                <div className="absolute bottom-full left-0 mb-2 z-20 w-72 max-h-72 overflow-y-auto rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm">
                  {(models ?? []).map((m) => {
                    const active = resolved != null && m.provider === resolved.provider && m.id === resolved.modelId;
                    return (
                      <button
                        key={`${m.provider}/${m.id}`}
                        type="button"
                        onClick={() => void pickModel(m)}
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
                </div>
              </>
            )}
          </div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={busy ? "Steer the agent — lands between tool calls…" : "Ask for a change…"}
            className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-[0.95rem] focus:outline-none placeholder:text-ink-soft/60"
          />
          {busy && (
            <>
              <button
                type="button"
                onClick={onAbort}
                aria-label="Stop"
                title="Stop the agent"
                className="rounded-xl border-2 border-berry text-berry px-3 py-2 hover:bg-berry-soft cursor-pointer"
              >
                <StopIcon />
              </button>
              <button
                type="button"
                disabled={!input.trim()}
                title="Queue for after this turn"
                onClick={() => submit("followUp")}
                className="rounded-xl border-2 border-line-strong text-ink-soft font-bold text-sm px-4 py-2 enabled:hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40"
              >
                Queue
              </button>
            </>
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

/**
 * W1.2: one floating run card — agent name, intent/task headline, live status
 * with an elapsed timer while running; brief success/fail state then a ~2s
 * fade-out (App removes the run shortly after). Distinct from the in-flow
 * compact subagent call line, which stays in the transcript as the record.
 */
function DelegationCard({ run }: { run: DelegationRun }): React.JSX.Element {
  const running = run.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return (
    <div
      className={`w-full max-w-xl flex items-center gap-3 rounded-xl border-2 bg-card px-4 py-2.5 shadow-sticker-lg text-sm font-semibold transition-opacity duration-[1500ms] ${
        running ? "border-sky/60 opacity-100" : run.status === "done" ? "border-leaf/60 opacity-0 delay-700" : "border-berry/60 opacity-0 delay-700"
      }`}
    >
      <span
        className={`size-2.5 rounded-full shrink-0 ${running ? "bg-sky animate-pulse" : run.status === "done" ? "bg-leaf" : "bg-berry"}`}
      />
      <span className="flex-1 min-w-0 truncate">
        <span className="font-black text-tangerine-deep">{run.agent}</span>
        {run.label && <span className="text-ink-soft font-medium"> — {run.label}</span>}
      </span>
      {running ? (
        <span className="font-mono text-xs text-ink-soft tabular-nums shrink-0" title="Elapsed time">
          working · {formatElapsed(now - run.startedAt)}
        </span>
      ) : (
        <span className={`text-[11px] font-bold uppercase tracking-wide shrink-0 ${run.status === "done" ? "text-leaf" : "text-berry"}`}>
          {run.status === "done" ? "done" : "failed"}
        </span>
      )}
    </div>
  );
}
