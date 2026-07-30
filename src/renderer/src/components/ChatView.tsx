import { useCallback, useEffect, useRef, useState } from "react";
import { Transcript, type TranscriptItem } from "./Transcript";
import { tailToolCallIds, type RewindScope } from "../rewind";
import { ModelSelect } from "./ModelSelect";
import { ContextBubble } from "./ContextBubble";
import { ContextPanel } from "./ContextPanel";
import { CostBubble } from "./CostBubble";
import { CostPanel } from "./CostPanel";
import { emptyQueue, type QueueState } from "../queue";
import { computeGauge, type ContextSnapshot, type SessionStats } from "../context";
import { delegationHint, formatElapsed, traceFor, type DelegationRun, type SubagentTrace } from "../agents";
import { SubagentTraceView, ToolIcon } from "./ToolCard";
import {
  attachmentUrl, dropUnknownProvider, resolveModelTier, supportsVision, type ImageAttachment, type ModelRef, type ModelTier,
} from "../composer";
import {
  activeCommandQuery, activeMentionQuery, completeCommand, completeMention, extractMentions, filterCommands,
  filterEntries, mentionLabel, type MentionEntry,
} from "../mentions";

/** Round 3 #3: pasting more than this many characters asks for confirmation. */
const PASTE_CONFIRM_CHARS = 100_000;

/** Stable empty ledger so the pill renders before the first fetch lands. */
const emptyLedger: HvLedgerTotal = {
  calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, metered: 0, plan: 0, unknown: 0,
};

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
  onStopRun,
  contextSnapshot = null,
  fallbackWindow,
  stats = null,
  searchOpen,
  onSearchOpenChange,
  contextOpen,
  onContextOpenChange,
  costCalls = [],
  costTotal = emptyLedger,
  costOpen,
  onCostOpenChange,
  planEnabled = false,
  sessionSkills,
  onTogglePlan,
  onOpenAgentsMd,
  onSend,
  onAbort,
  onRestart,
  onRetry,
  onOpenFolder,
  onCompact,
  onOpenFile,
  onOpenMcp,
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
  /** Interrupt a running async subagent (stop button on its card). */
  onStopRun?: (runId: string) => void;
  contextSnapshot?: ContextSnapshot | null;
  fallbackWindow?: number | null;
  /** WS7: stats/search/context are lifted to App so the controls live in the tab strip. */
  stats?: SessionStats | null;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  contextOpen: boolean;
  onContextOpenChange: (open: boolean) => void;
  /** Cost ledger for the spend pill + its drill-in. Totalled in main (calls.ts). */
  costCalls?: HvApiCall[];
  costTotal?: HvLedgerTotal;
  costOpen: boolean;
  onCostOpenChange: (open: boolean) => void;
  /** §23: plan-mode toggle state + setter (composer chip). */
  planEnabled?: boolean;
  /** §14 round 6: skills this session loaded, each flagged if the agent used it. */
  sessionSkills?: Array<{ name: string; scope: string; used: boolean }>;
  onTogglePlan?: (on: boolean) => void;
  onOpenAgentsMd: () => void;
  onSend: (msg: string, behavior?: "followUp", images?: ImageAttachment[], mentions?: string[]) => void;
  onAbort: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onOpenFolder: () => void;
  onCompact: () => void;
  /** W2.2: open a workspace-relative file in an editor tab (clickable card paths). */
  onOpenFile?: (relPath: string) => void;
  /** v5: navigate to the MCP page (from the composer "+" menu). */
  onOpenMcp?: () => void;
  /** Round 3 #11: truncate the conversation at a user message (App-side). */
  onRewind?: (it: TranscriptItem, scope: RewindScope) => void;
}): React.JSX.Element {
  const [input, setInput] = useState("");
  // Composer row aligns centered on one line; when the textarea wraps to multiple
  // lines the controls pin to the top instead (all on the same horizontal line).
  const [multiline, setMultiline] = useState(false);
  // F4: auto-growing textarea — reset to auto then clamp to scrollHeight (~8 lines).
  const taRef = useRef<HTMLTextAreaElement>(null);
  const autoGrow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const sh = el.scrollHeight;
    el.style.height = `${Math.min(sh, 192)}px`;
    setMultiline(sh > 44); // one line ≈ 36px; > 44 means it wrapped
  }, []);
  useEffect(() => { autoGrow(); }, [input, autoGrow]);
  // F3: @file mentions — label→relPath map for the composed text, a recursive
  // workspace index (fetched lazily, invalidated on fs change / workspace switch),
  // and the live dropdown state.
  const mentionMap = useRef<Map<string, string>>(new Map());
  const mentionIndex = useRef<MentionEntry[] | null>(null);
  const [mention, setMention] = useState<{ start: number; items: MentionEntry[]; sel: number } | null>(null);
  useEffect(() => {
    mentionIndex.current = null;
    mentionMap.current = new Map();
    setMention(null);
    return window.hv.onFsChanged((p) => { if (p.workspaceId === workspace) mentionIndex.current = null; });
  }, [workspace]);
  const ensureMentionIndex = useCallback(async (): Promise<MentionEntry[]> => {
    if (mentionIndex.current) return mentionIndex.current;
    if (!workspace) return [];
    try {
      const list = await window.hv.fsListRecursive(workspace);
      mentionIndex.current = list;
      return list;
    } catch {
      return [];
    }
  }, [workspace]);
  const refreshMention = useCallback(async (text: string, caret: number): Promise<void> => {
    const q = activeMentionQuery(text, caret);
    if (!q) { setMention(null); return; }
    const items = filterEntries(await ensureMentionIndex(), q.query);
    setMention({ start: q.start, items, sel: 0 });
  }, [ensureMentionIndex]);
  const pickMention = (entry: MentionEntry): void => {
    const el = taRef.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? input.length;
    const label = mentionLabel(entry.rel, mentionMap.current);
    mentionMap.current.set(label, entry.rel);
    const done = completeMention(input, mention.start, caret, label);
    setInput(done.text);
    setMention(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(done.caret, done.caret); autoGrow(); });
  };

  // §14 round 6: `/skill:<name>` autocomplete. Pi already registers a command per
  // loaded skill; get_commands is a pure query so this costs no model turn. The
  // list only changes on respawn, so it's cached per session.
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  const commandCache = useRef<string[] | null>(null);
  const [command, setCommand] = useState<{ items: string[]; sel: number; end: number } | null>(null);
  const ensureCommands = useCallback(async (): Promise<string[]> => {
    if (commandCache.current) return commandCache.current;
    if (!sessionId) return [];
    const sid = sessionId; // capture: this fetch must not populate another session's cache
    try {
      const all = await window.hv.listCommands(sid);
      // V1: skills only — other Pi commands aren't part of HappyVibe's surface yet.
      const names = all.filter((c) => c.source === "skill").map((c) => c.name);
      // The user may have switched sessions while this was in flight. Serving A's
      // commands in B would send a command B's Pi doesn't have.
      if (sid !== sessionIdRef.current) return [];
      commandCache.current = names;
      return names;
    } catch {
      return []; // not live yet (e.g. hibernated) — deliberately NOT cached, so it retries
    }
  }, [sessionId]);
  const refreshCommand = useCallback(async (text: string, caret: number): Promise<void> => {
    const q = activeCommandQuery(text, caret);
    if (!q) { setCommand(null); return; }
    const items = filterCommands(await ensureCommands(), q.query);
    // `end` pins the span this menu was built for, so a later caret move can't
    // make pickCommand replace the wrong slice.
    setCommand({ items, sel: 0, end: caret });
  }, [ensureCommands]);
  const pickCommand = (name: string): void => {
    const el = taRef.current;
    if (!el || !command) return;
    const done = completeCommand(input, command.end, name);
    setInput(done.text);
    setCommand(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(done.caret, done.caret); autoGrow(); });
  };
  // A respawn re-registers commands (main refires /hv-tools) — drop the cache.
  useEffect(() => { commandCache.current = null; }, [sessionId]);
  const [pendingRewind, setPendingRewind] = useState<TranscriptItem | null>(null); // #11 confirm
  // Stable identity so MessageItem's memo isn't busted on every composer keystroke.
  const openRewind = useCallback((it: TranscriptItem) => setPendingRewind(it), []);
  // §9 round 7: rewind scope + the affected-file preview behind it. `undefined`
  // = still loading, `null` = no snapshot for this message.
  const [rewindScope, setRewindScope] = useState<RewindScope>("conversation");
  const [rewindPreview, setRewindPreview] = useState<
    { willRestore: string[]; willDelete: string[]; stale: string[] } | null | undefined
  >(undefined);
  useEffect(() => {
    if (pendingRewind === null || sessionId === null) {
      setRewindPreview(undefined);
      setRewindScope("conversation"); // every open starts at the safe default
      return;
    }
    const idx = items.findIndex((x) => x.id === pendingRewind.id);
    if (idx < 0) {
      setRewindPreview(null);
      return;
    }
    void window.hv.rewindPreview(sessionId, tailToolCallIds(items, idx)).then(setRewindPreview);
  }, [pendingRewind, sessionId, items]);
  // ── W2.1: model chip + attach menu state ─────────────────────────
  const [models, setModels] = useState<HvModel[] | null>(null);
  const [workspaceModel, setWorkspaceModel] = useState<ModelRef | null>(null);
  const [defaultModel, setDefaultModel] = useState<ModelRef | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [pendingPaste, setPendingPaste] = useState<string | null>(null); // #3: large-paste confirm
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
  const [mcpSubOpen, setMcpSubOpen] = useState(false); // v5: "+" menu MCP submenu
  const [mcpServers, setMcpServers] = useState<{ name: string; state: string }[] | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  // v5: pull the cached MCP status when the submenu opens (read-only; no re-sweep).
  useEffect(() => {
    if (!mcpSubOpen) return;
    window.hv.mcpStatus()
      .then((list) => setMcpServers(list.map((s) => ({ name: s.name, state: s.state }))))
      .catch(() => setMcpServers([]));
  }, [mcpSubOpen]);
  // Honest fallback: live set_model failed → override persisted, applies on next spawn.
  const [restartHint, setRestartHint] = useState(false);
  /** §16: provider set main filters spawn refs with — see resolveSpawnModel. */
  const [knownProviders, setKnownProviders] = useState<string[]>([]);
  // V2.A: fetch every resolution tier, and REFETCH whenever provider/model
  // config changes (key added/removed, OAuth login/logout, default/workspace
  // model edits) — the mount-only fetch left the list and chip stale.
  useEffect(() => {
    setWorkspaceModel(null);
    const refetch = (): void => {
      window.hv.listModels().then(setModels).catch(() => setModels([]));
      window.hv.getProviders()
        .then((p) => { setDefaultModel(p.defaultModel); setKnownProviders(p.knownProviders); })
        .catch(() => {});
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
  // §16 (2026-07-30): a tier pinned to a provider that no longer exists (deleted
  // custom endpoint) must not win resolution — drop it so the chip shows the
  // tier actually in effect. The list comes from MAIN (hv:get-providers) because
  // main filters spawns with the same set; deriving it from `models` instead was
  // wrong — that list is auth-filtered, so an unauthenticated-but-existing
  // provider was dropped here while main still spawned with it, and the chip
  // named a model the agent was not running. Empty (not fetched yet) → keep
  // every ref, so nothing resets during startup.
  const resolution = resolveModelTier(
    dropUnknownProvider(sessionModel, knownProviders),
    dropUnknownProvider(workspaceModel, knownProviders),
    dropUnknownProvider(defaultModel, knownProviders),
  );
  const resolved = resolution?.ref ?? null;
  const vision = supportsVision(models, resolved);
  const modelName = resolved
    ? models?.find((m) => m.provider === resolved.provider && m.id === resolved.modelId)?.name ?? resolved.modelId
    : null;
  // Chip shows the bare model name — strip any leading "Provider: " prefix Pi bakes
  // into the display name (e.g. "Z.ai: GLM 5.2" → "GLM 5.2").
  const modelLabel = modelName?.replace(/^[^:]+:\s+/, "") ?? null;

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
  // #8: ⌘F / Ctrl-F opens in-conversation search; Escape closes it. searchOpen
  // is lifted to App (WS7 — the toggle lives in the tab strip).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        // v5.1: when the code editor is focused, ⌘F is its search, not the chat's.
        if (document.activeElement?.closest(".cm-editor")) return;
        e.preventDefault();
        onSearchOpenChange(true);
      } else if (e.key === "Escape" && searchOpen) {
        onSearchOpenChange(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, onSearchOpenChange]);

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
    const mentions = extractMentions(input, mentionMap.current);
    onSend(input, behavior, attachments.length ? attachments : undefined, mentions.length ? mentions : undefined);
    setInput("");
    setAttachments([]);
    mentionMap.current = new Map();
    setMention(null);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* v5.1: search + context bubble live IN the chat (a thin right-aligned bar
          at the top of this pane) — not a floating overlay that could bleed over
          an adjacent split pane. */}
      <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b-2 border-line bg-paper shrink-0">
        {/* §23: compact plan-mode indicator (left) — read-only badge with a
            wrap-up nudge and one-click exit. Replaces the full-width banner. */}
        {((sessionSkills?.length ?? 0) > 0 || planEnabled) && (
        <div className="mr-auto flex items-center gap-1.5">
        {sessionSkills && sessionSkills.length > 0 && <SkillsChip skills={sessionSkills} />}
        {planEnabled && (
          <div className="flex items-center gap-1.5">
            <span
              className="flex items-center gap-1 rounded-full bg-sky-soft text-sky text-[11px] font-bold px-2 py-0.5"
              title="Plan mode — read-only. I can explore and draft a plan but can't change anything. Tip: planning loves your smartest model."
            >
              <span aria-hidden>🧭</span> Plan mode
            </span>
            {sessionId && (
              <button
                type="button"
                onClick={() =>
                  void window.hv.promptSession(
                    sessionId,
                    "Finalize the implementation plan now. If a material decision remains, ask me via ask_user. Otherwise call plan_complete alone as your final action with the complete decision-ready plan.",
                  )
                }
                title="Ask the agent to finalize the plan now"
                className="text-[11px] font-semibold text-sky/80 hover:text-sky cursor-pointer"
              >
                Wrap up
              </button>
            )}
            {onTogglePlan && (
              <button
                type="button"
                onClick={() => onTogglePlan(false)}
                title="Exit plan mode"
                aria-label="Exit plan mode"
                className="text-sky/70 hover:text-sky cursor-pointer leading-none text-sm"
              >
                ✕
              </button>
            )}
          </div>
        )}
        </div>
        )}
        <button
          type="button"
          onClick={() => onSearchOpenChange(!searchOpen)}
          aria-pressed={searchOpen}
          title="Search this conversation (⌘F)"
          aria-label="Search this conversation"
          className={`text-sm rounded-full border-2 px-2.5 py-0.5 cursor-pointer transition-colors ${
            searchOpen ? "border-tangerine bg-honey-soft text-tangerine-deep" : "border-line bg-card text-ink-soft hover:border-honey hover:text-ink"
          }`}
        >
          ⌕
        </button>
        <CostBubble total={costTotal} onOpen={() => onCostOpenChange(true)} />
        <ContextBubble stats={stats} fallbackWindow={fallbackWindow} onOpen={() => onContextOpenChange(true)} />
      </div>
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
            onClick={() => onContextOpenChange(true)}
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
            onClick={() => { setOfferAgentsMd(false); onOpenAgentsMd(); }}
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
            <p className="text-sm text-ink-soft mb-3">
              Everything after this point is removed from the conversation and the agent's context, and this
              message moves back into the composer so you can edit and resend it.
            </p>
            <div className="flex flex-col gap-1.5 mb-3">
              {([
                ["conversation", "Conversation only", "Files on disk are left exactly as they are."],
                ["both", "Conversation and files", "Also roll the workspace back to before this message."],
                ["files", "Files only", "Roll the workspace back, keep the conversation."],
              ] as const).map(([value, label, hint]) => (
                <label
                  key={value}
                  className="flex gap-2 items-start cursor-pointer rounded-xl border-2 border-line p-2 hover:bg-paper-deep"
                >
                  <input
                    type="radio"
                    name="rewind-scope"
                    className="mt-1"
                    checked={rewindScope === value}
                    onChange={() => setRewindScope(value)}
                  />
                  <span>
                    <span className="block text-sm font-bold text-ink">{label}</span>
                    <span className="block text-xs text-ink-soft">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {rewindScope !== "conversation" && (
              <div className="text-xs text-ink-soft mb-4 rounded-xl bg-paper-deep p-2">
                {rewindPreview === undefined ? (
                  "Checking which files would change…"
                ) : rewindPreview === null ? (
                  rewindScope === "files"
                    ? "No snapshot for this message, and the conversation is being kept — this would do nothing."
                    : "No snapshot for this message — no files will change."
                ) : (
                  <>
                    <div>
                      <strong>{rewindPreview.willRestore.length}</strong> restored,{" "}
                      <strong>{rewindPreview.willDelete.length}</strong> removed.
                    </div>
                    {rewindPreview.stale.length > 0 && (
                      <div className="mt-1">
                        {rewindPreview.stale.length} changed since and will be left alone:{" "}
                        {rewindPreview.stale.slice(0, 3).join(", ")}
                        {rewindPreview.stale.length > 3 ? "…" : ""}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
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
                // Gated on "would this do nothing", not on "is this a steer":
                // files-only with no anchor is the one combination whose entire
                // outcome is a notice saying nothing happened. The other scopes
                // still truncate the conversation, so they stay live. This also
                // covers turns whose capture failed, not just steers (a steer
                // has no snapshot of its own — see hv:prompt-session).
                disabled={rewindScope === "files" && rewindPreview === null}
                onClick={() => {
                  const it = pendingRewind;
                  onRewind?.(it, rewindScope);
                  // "Files only" leaves the conversation alone, so the composer
                  // must not be repopulated with a message that is still there.
                  if (rewindScope !== "files") {
                    setInput("text" in it && typeof it.text === "string" ? it.text : "");
                  }
                  setPendingRewind(null);
                }}
                className="rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker enabled:cursor-pointer enabled:hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed"
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
            onClick={() => { onSearchOpenChange(false); setSearchQuery(""); }}
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
          header={delegations.length > 0 ? <DelegationSection runs={delegations} items={items} onStopRun={onStopRun} /> : undefined}
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
        <div className={`max-w-3xl mx-auto flex gap-1.5 ${multiline ? "items-start" : "items-center"} rounded-2xl bg-card border-2 border-line-strong shadow-sticker-lg px-2 py-1.5 focus-within:border-tangerine transition-colors`}>
          {/* W2.1: "+" attach menu — always visible; entries gate honestly. */}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Attach"
              aria-expanded={attachMenuOpen}
              onClick={() => { setAttachMenuOpen((o) => !o); setModelMenuOpen(false); }}
              className="size-8 rounded-xl text-ink-soft font-black text-lg leading-none hover:bg-paper-deep/40 hover:text-ink cursor-pointer transition-colors"
            >
              +
            </button>
            {attachMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => { setAttachMenuOpen(false); setMcpSubOpen(false); }} />
                <div className="absolute bottom-full left-0 mb-2 z-20 w-60 rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm font-semibold">
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
                  {/* WS7: AGENTS.md editor (replaces the removed header chip). */}
                  <button
                    type="button"
                    onClick={() => { setAttachMenuOpen(false); onOpenAgentsMd(); }}
                    className="w-full text-left px-3 py-2 hover:bg-paper-deep/40 cursor-pointer"
                  >
                    Edit AGENTS.md
                    <span className="block text-[10px] font-medium text-ink-soft">project context for the agent</span>
                  </button>
                  {/* v5: MCP submenu — connected servers (read-only) + Manage shortcut. */}
                  <button
                    type="button"
                    onClick={() => setMcpSubOpen((o) => !o)}
                    aria-expanded={mcpSubOpen}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-paper-deep/40 cursor-pointer"
                  >
                    <span className="flex-1 text-left">MCP</span>
                    <span className="text-[11px] text-ink-soft" aria-hidden>{mcpSubOpen ? "▾" : "▸"}</span>
                  </button>
                  {mcpSubOpen && (
                    <div className="border-t border-line bg-paper-deep/30 py-1">
                      {mcpServers === null ? (
                        <div className="px-3 py-1.5 text-[11px] font-medium text-ink-soft">Loading…</div>
                      ) : mcpServers.length === 0 ? (
                        <div className="px-3 py-1.5 text-[11px] font-medium text-ink-soft">No MCP servers connected.</div>
                      ) : (
                        mcpServers.map((s) => (
                          <div key={s.name} className="flex items-center gap-2 px-3 py-1.5">
                            <span
                              className={`size-2 rounded-full shrink-0 ${
                                s.state === "connected" ? "bg-leaf" : s.state === "checking" ? "bg-honey" : "bg-berry"
                              }`}
                              title={s.state}
                            />
                            <span className="flex-1 min-w-0 truncate text-[12px] font-medium">{s.name}</span>
                            <span className="text-[9px] uppercase tracking-wide text-ink-soft">{s.state}</span>
                          </div>
                        ))
                      )}
                      <button
                        type="button"
                        onClick={() => { setAttachMenuOpen(false); setMcpSubOpen(false); onOpenMcp?.(); }}
                        className="w-full text-left px-3 py-1.5 text-[12px] font-bold text-tangerine-deep hover:bg-paper-deep/40 cursor-pointer"
                      >
                        Manage…
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {/* W2.1: current-model chip + per-session override dropdown (session → workspace → global).
              WS1: shared ModelSelect (controlled open so a session switch force-closes it). */}
          <div className="shrink-0">
            <ModelSelect
              models={models ?? []}
              loading={models === null}
              value={resolved ? { provider: resolved.provider, modelId: resolved.modelId } : null}
              onPick={(m) => void pickModel(m)}
              open={modelMenuOpen}
              onOpenChange={(o) => { setModelMenuOpen(o); if (o) setAttachMenuOpen(false); }}
              direction="up"
              renderTrigger={({ toggle }) => (
                <button
                  type="button"
                  aria-label="Change model for this session"
                  aria-expanded={modelMenuOpen}
                  onClick={toggle}
                  title={resolved ? `Model: ${resolved.provider}/${resolved.modelId}${resolution ? ` (${TIER_LABEL[resolution.tier]})` : ""}` : "No model configured"}
                  className="max-w-44 text-left font-mono text-[11px] rounded-full px-2.5 py-1.5 text-ink-soft hover:bg-paper-deep/40 hover:text-ink cursor-pointer transition-colors"
                >
                  <span className="block truncate">{modelLabel ?? "model…"}</span>
                </button>
              )}
            />
          </div>
          {/* §23: plan-mode toggle — read-only "think first" for this session. */}
          {onTogglePlan && (
            <button
              type="button"
              aria-pressed={planEnabled}
              onClick={() => onTogglePlan(!planEnabled)}
              title={planEnabled ? "Plan mode on — read-only. Click to exit." : "Plan mode — explore and draft a plan before changing anything"}
              className={`shrink-0 flex items-center gap-1 text-[11px] font-bold rounded-full px-2.5 py-1.5 cursor-pointer transition-colors ${
                planEnabled
                  ? "bg-sky-soft text-sky"
                  : "text-ink-soft hover:bg-paper-deep/40 hover:text-sky"
              }`}
            >
              <span aria-hidden>🧭</span>
              <span>Plan</span>
            </button>
          )}
          <div className="relative flex-1 min-w-0">
            {/* F3: @file autocomplete — opens above the composer, styled like the attach menu. */}
            {mention && mention.items.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 z-30 w-full max-w-md max-h-64 overflow-y-auto rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm">
                {mention.items.map((it, i) => {
                  const base = it.rel.split(/[\\/]/).pop() ?? it.rel;
                  return (
                    <button
                      key={it.rel}
                      type="button"
                      // preventDefault keeps the textarea focused so the caret survives the pick.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickMention(it)}
                      className={`w-full text-left px-3 py-1.5 cursor-pointer ${i === mention.sel ? "bg-honey-soft" : "hover:bg-paper-deep/40"}`}
                    >
                      <span className="font-semibold">{base}{it.kind === "dir" ? "/" : ""}</span>
                      <span className="block truncate text-[11px] font-medium text-ink-soft">{it.rel}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* §14 round 6: /skill: command menu — same placement/styling as @file. */}
            {command && command.items.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 z-30 w-full max-w-md max-h-64 overflow-y-auto rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm">
                {command.items.map((name, i) => (
                  <button
                    key={name}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickCommand(name)}
                    className={`w-full text-left px-3 py-1.5 cursor-pointer ${i === command.sel ? "bg-honey-soft" : "hover:bg-paper-deep/40"}`}
                  >
                    <span className="font-semibold">/{name}</span>
                    <span className="block truncate text-[11px] font-medium text-ink-soft">Load this skill</span>
                  </button>
                ))}
                <p className="px-3 pt-1 text-[10px] text-ink-soft">Tab to complete · Enter to send</p>
              </div>
            )}
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const c = e.target.selectionStart ?? e.target.value.length;
                void refreshMention(e.target.value, c);
                void refreshCommand(e.target.value, c);
              }}
              onBlur={() => { window.setTimeout(() => { setMention(null); setCommand(null); }, 120); }}
              onKeyDown={(e) => {
                // §14 round 6: while the /command dropdown is open it owns the nav keys.
                if (command && command.items.length > 0) {
                  const n = command.items.length;
                  if (e.key === "ArrowDown") { e.preventDefault(); setCommand((c) => c && { ...c, sel: (c.sel + 1) % n }); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setCommand((c) => c && { ...c, sel: (c.sel - 1 + n) % n }); return; }
                  if (e.key === "Tab") { e.preventDefault(); pickCommand(command.items[command.sel]); return; }
                  if (e.key === "Escape") { e.preventDefault(); setCommand(null); return; }
                  // Enter SENDS (the typed command already works verbatim) — Tab completes.
                }
                // F3: while the @-dropdown is open it owns the nav keys.
                if (mention) {
                  const n = mention.items.length;
                  if (e.key === "ArrowDown" && n) { e.preventDefault(); setMention((m) => m && { ...m, sel: (m.sel + 1) % n }); return; }
                  if (e.key === "ArrowUp" && n) { e.preventDefault(); setMention((m) => m && { ...m, sel: (m.sel - 1 + n) % n }); return; }
                  if ((e.key === "Tab" || e.key === "Enter") && n) { e.preventDefault(); pickMention(mention.items[mention.sel]); return; }
                  if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
                }
                // F4: Enter sends, Shift+Enter inserts a newline. Never send mid-IME
                // composition (e.g. accented input, CJK) — that Enter commits text.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              onPaste={(e) => {
                // #3: guard against accidentally pasting a huge blob.
                const t = e.clipboardData.getData("text");
                if (t.length > PASTE_CONFIRM_CHARS) {
                  e.preventDefault();
                  setPendingPaste(t);
                }
              }}
              placeholder={hint ?? (busy ? "Steer the agent — lands between tool calls…" : "Ask for a change… (@ to add a file)")}
              className="w-full resize-none bg-transparent px-2 py-1.5 text-[0.95rem] leading-relaxed focus:outline-none placeholder:text-ink-soft/60"
            />
          </div>
          {/* V2.A: no separate Queue button — send/Enter steers while busy
              (App keeps the followUp behavior plumbing; it just has no UI). */}
          {busy && (
            <button
              type="button"
              onClick={onAbort}
              aria-label="Stop"
              title="Stop the agent"
              className="shrink-0 size-8 flex items-center justify-center rounded-xl text-berry hover:bg-berry-soft cursor-pointer transition-colors"
            >
              <StopIcon />
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label={busy ? "Steer" : "Send"}
            title={busy ? "Steer — lands between tool calls" : "Send"}
            className="shrink-0 size-8 flex items-center justify-center rounded-xl text-tangerine hover:bg-paper-deep/40 transition-colors enabled:cursor-pointer disabled:opacity-40"
          >
            <SendIcon />
          </button>
        </div>
      </form>
      {contextOpen && sessionId && (
        <ContextPanel
          sessionId={sessionId}
          snapshot={contextSnapshot}
          stats={stats}
          fallbackWindow={fallbackWindow}
          turns={turns}
          onClose={() => onContextOpenChange(false)}
          onCompact={onCompact}
        />
      )}
      {costOpen && sessionId && (
        <CostPanel calls={costCalls} total={costTotal} onClose={() => onCostOpenChange(false)} />
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
function DelegationSection({ runs, items, onStopRun }: { runs: DelegationRun[]; items: TranscriptItem[]; onStopRun?: (runId: string) => void }): React.JSX.Element {
  return (
    <div className="sticky top-0 z-20 px-6">
      <div className="max-w-3xl mx-auto w-full flex flex-col">
        {runs.map((run) => (
          <DelegationRunCard
            key={run.id}
            run={run}
            // Foreground runs stream their child transcript onto the in-flow tool
            // card; async (detached) runs have none — their live progress rides
            // run.live from the status poller instead.
            trace={run.kind === "fg" && run.toolCallId ? traceFor(items, run.toolCallId) : undefined}
            onStopRun={onStopRun}
          />
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
function DelegationRunCard({ run, trace, onStopRun }: { run: DelegationRun; trace?: SubagentTrace; onStopRun?: (runId: string) => void }): React.JSX.Element {
  const running = run.status === "running";
  const attention = running && run.live?.activityState === "needs_attention";
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
  // Border: sky while working, amber if it needs attention, leaf on success,
  // berry on failed/stopped.
  const border = attention ? "border-tangerine/70" : running ? "border-sky/60" : run.status === "done" ? "border-leaf/60" : "border-berry/60";
  const dot = attention ? "bg-tangerine animate-pulse" : running ? "bg-sky animate-pulse" : run.status === "done" ? "bg-leaf" : "bg-berry";
  const canStop = running && run.kind === "async" && onStopRun;
  const currentTool = run.live?.currentTool;
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-350 ease-in-out ${
        leaving ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
      }`}
    >
      <div className="overflow-hidden min-h-0">
        <div className="pt-3">
          <div className={`rounded-xl border-2 bg-card shadow-sticker-lg overflow-hidden ${border}`}>
            <div className="w-full flex items-start gap-3 px-4 py-2.5 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                title={open ? "Collapse the subagent details" : "See what the subagent is doing"}
                className="flex-1 min-w-0 flex items-start gap-3 text-left cursor-pointer"
              >
                <span className={`mt-1 size-2.5 rounded-full shrink-0 ${dot}`} />
                <ToolIcon kind="robot" className="mt-0.5 size-4 shrink-0 text-sky" />
                {/* v5: intent wraps instead of clipping with an ellipsis. */}
                <span className="flex-1 min-w-0 break-words">
                  <span className="font-black text-tangerine-deep">{run.agent}</span>
                  {run.label && <span className="text-ink-soft font-medium"> — {run.label}</span>}
                </span>
              </button>
              {running ? (
                <span className="font-mono text-xs text-ink-soft tabular-nums shrink-0" title="Elapsed time">
                  {attention ? "needs attention" : currentTool ? currentTool : "working"} · {formatElapsed(now - run.startedAt)}
                </span>
              ) : (
                <span
                  className={`text-[11px] font-bold uppercase tracking-wide shrink-0 ${run.status === "done" ? "text-leaf" : "text-berry"}`}
                >
                  {run.status === "done" ? "done" : run.status === "interrupted" ? "stopped" : "failed"}
                </span>
              )}
              {canStop && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onStopRun!(run.id); }}
                  title="Stop this subagent"
                  className="shrink-0 rounded-md border border-berry/50 text-berry px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide hover:bg-berry/10 cursor-pointer"
                >
                  ◼ Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-hidden
                tabIndex={-1}
                className="shrink-0 text-[11px] text-ink-soft cursor-pointer"
              >
                {open ? "▾" : "▸"}
              </button>
            </div>
            {running && !open && <div className={`h-1 ${attention ? "bg-tangerine/40" : "hv-shimmer"}`} aria-hidden />}
            {open && (
              <div className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2.5 max-h-72 overflow-y-auto flex flex-col gap-3">
                {run.kind === "fg" ? (
                  <SubagentTraceView results={trace?.results ?? []} />
                ) : (
                  // Detached run: no child transcript on the parent stream — show
                  // the live status snapshot from the poller instead.
                  <div className="text-xs text-ink-soft flex flex-col gap-1">
                    {run.live?.turnCount != null && <div>turn {run.live.turnCount}{currentTool ? ` · ${currentTool}` : ""}</div>}
                    {(run.live?.recentTools ?? []).slice(-8).map((t, i) => (
                      <div key={i} className="font-mono truncate">
                        {t.tool}{t.args ? ` ${t.args}` : ""}
                      </div>
                    ))}
                    {!run.live?.turnCount && !(run.live?.recentTools ?? []).length && <div>working in the background…</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * §14 round 6: which skills this session loaded, and which the agent actually
 * reached for. One chip answers both — what was available, and what got used.
 */
function SkillsChip({ skills }: { skills: Array<{ name: string; scope: string; used: boolean }> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const used = skills.filter((s) => s.used).length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${skills.length} skill${skills.length === 1 ? "" : "s"} loaded for this session, ${used} used so far`}
        className="flex items-center gap-1 rounded-full bg-plum-soft text-plum text-[11px] font-bold px-2 py-0.5 cursor-pointer hover:brightness-105"
      >
        <span aria-hidden>🧠</span> {used}/{skills.length} skills
      </button>
      {open && <div className="fixed inset-0 z-20" onMouseDown={() => setOpen(false)} />}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-30 w-64 rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1.5 text-sm">
          {skills.map((s) => (
            <div key={`${s.scope}:${s.name}`} className="flex items-baseline gap-2 px-3 py-1">
              <span className={`flex-1 min-w-0 truncate ${s.used ? "font-bold" : "font-medium text-ink-soft"}`}>{s.name}</span>
              {s.used && <span className="text-[10px] font-bold text-leaf shrink-0">used</span>}
              <span className="text-[10px] text-ink-soft shrink-0">{s.scope}</span>
            </div>
          ))}
          <p className="px-3 pt-1 text-[10px] text-ink-soft">
            Loaded for this session. Type <span className="font-mono">/skill:</span> to load one now.
          </p>
        </div>
      )}
    </div>
  );
}
