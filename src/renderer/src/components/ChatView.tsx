import { useCallback, useEffect, useRef, useState } from "react";
import { Transcript, type TranscriptItem } from "./Transcript";
import { hasRestorable, tailToolCallIds, type RewindScope } from "../rewind";
import { matchesBinding } from "../shortcuts";
import { ModelSelect } from "./ModelSelect";
import { ContextBubble } from "./ContextBubble";
import { PlanCard, type PlanCardData } from "./PlanCard";
import { ContextPanel } from "./ContextPanel";
import { CostBubble } from "./CostBubble";
import { CostPanel } from "./CostPanel";
import { emptyQueue, type QueueState } from "../queue";
import { computeGauge, type ContextSnapshot, type GaugeZone, type SessionStats } from "../context";
import { childGauge } from "../subagentGauge";
import { agentBlurb, delegationHint, formatElapsed, isStoppableChild, sortAgents, traceFor, type AgentInfo, type DelegationRun, type SubagentTrace } from "../agents";
import { promotedKeys, toRunAvatars, RUN_STATE_RING, type RunAvatar } from "../runRail";
import { costEstimateLabel, fmtNum } from "../analytics-format";
import { SubagentTraceView, ToolIcon } from "./ToolCard";
import { TerminalRunCard, TerminalTail, type TerminalRun } from "./TerminalRunCard";
import { type IconKind } from "../toolLabel";
import { insertAtComposer } from "../composerText";
import { MicButton } from "./MicButton";
import { VoiceActivateModal } from "./VoiceActivateModal";
import { VoiceOverlay } from "./VoiceOverlay";
import { useDictation } from "../voice/useDictation";
// Electron-free main module, imported rather than restated — the same pattern
// TerminalView uses for DEFAULT_TERMINAL_SETTINGS. A hand-copied size is
// exactly the kind of thing that drifts from what actually downloads.
import { VOICE_MODEL_SIZE_LABEL } from "../../../main/voice/manifest";
import {
  attachmentUrl, documentChipLabel, dropUnknownProvider, filesToAttachments, filesToDocumentPaths,
  isAttachableImage, resolveModelTier, supportsVision,
  type DocumentAttachment, type ImageAttachment, type ModelRef, type ModelTier,
} from "../composer";
import {
  activeCommandQuery, activeMentionQuery, commandSubtitle, completeCommand, completeMention, composerCommands, extractMentions, filterCommands,
  agentMentionItems, filterEntries, mentionLabel, type MentionEntry, type SlashCommand,
} from "../mentions";
import { DOCUMENT_FAMILY_LIST } from "../../../../pi-runtime/extensions/hv-document";
import { Banner } from "./Banner";

/** §20 round 17 — red-zone dismissals persist per session (Principle 5: never nag). */
const REDZONE_KEY = "hv:redzone-dismissed:";

/** Round 3 #3: pasting more than this many characters asks for confirmation. */
/** §21: the file tree drags this — a tab/file gesture, not an image. */
const FILETREE_DRAG_MIME = "application/x-hv-relpath";

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

/**
 * §23 round 9 — the active-plan pill.
 *
 * Any plan the session has is reachable here EXCEPT a cancelled one (nothing to
 * read, nothing to do). An implemented plan still gets a pill: the transcript
 * route to it may have been compacted away, and reporting its REAL status is
 * the whole point — the bug this replaced claimed "draft" for exactly that case.
 */
export function showsPlanPill(status: string): boolean {
  return status !== "cancelled";
}

/** The pill's text. Never says "ready" for a plan that is not a draft. */
export function planPillLabel(status: string, done: number, total: number): string {
  if (status === "implemented") return "Plan implemented";
  if (status === "implementing") return `Implementing ${done}/${total}`;
  return "Plan ready";
}

export function ChatView({
  workspace,
  sessionId,
  sessionModel = null,
  sessionThinking = null,
  items,
  thinking,
  streaming,
  busy,
  waking = false,
  crashed,
  turns,
  queue = emptyQueue,
  delegations = [],
  onStopRun,
  onStopChild,
  agents,
  terminalRuns = [],
  terminalSettings,
  onStopTerminal,
  onOpenTerminalAsTab,
  contextSnapshot = null,
  fallbackWindow,
  stats = null,
  searchOpen,
  onSearchOpenChange,
  searchKey,
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
  pageRefs,
  onDropPageRef,
  onClearPageRefs,
  onAbort,
  onRestart,
  onRetry,
  onOpenFolder,
  onCompact,
  onOpenFile,
  onOpenMcp,
  onOpenVoice,
  voiceSettings,
  onRewind,
  onLoadEarlier,
  activePlan,
  composerInsert,
  visible = true,
}: {
  workspace: string | null;
  sessionId: string | null;
  /** W2.1: this session's persisted model override (from SessionMeta). */
  sessionModel?: ModelRef | null;
  /** §16 round 16: this session's stored thinking override, null = follow the global default. */
  sessionThinking?: string | null;
  items: TranscriptItem[];
  /** §7 round 16: this session's live reasoning, if it is thinking now. */
  thinking?: string;
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
  /** §12 (2026-08-29): the agent roster, for @agent and the delegate chip. */
  agents?: AgentInfo[] | null;
  /** §12: interrupt ONE child of a fan-out, leaving its siblings running. */
  onStopChild?: (runId: string, childId: string) => void;
  /** §26 part 2: this session's live agent terminals, as sticky cards. */
  terminalRuns?: TerminalRun[];
  terminalSettings?: HvTerminalSettings | null;
  onStopTerminal?: (terminalId: string) => void;
  /** The agent never opens a tab; this is the human doing it from the card. */
  onOpenTerminalAsTab?: (terminalId: string) => void;
  contextSnapshot?: ContextSnapshot | null;
  fallbackWindow?: number | null;
  /** WS7: stats/search/context are lifted to App so the controls live in the tab strip. */
  stats?: SessionStats | null;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Round 8: the resolved binding for the shared "search" action. */
  searchKey: string;
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
  /**
   * Round 11: text pushed in from outside the composer (the editor's "Send to
   * chat"). Appended on NONCE change, so sending the same selection twice still
   * lands — the same mechanism the rewind-to-composer path uses.
   */
  composerInsert?: { text: string; nonce: number };
  /**
   * This pane is on screen. Every ChatView stays MOUNTED (streaming, and a live
   * dictation, must survive switching tabs), so a component cannot infer this
   * from its own render — App owns the same expression that hides the wrapper.
   * Only the recording indicator reads it, to choose docked vs viewport-fixed.
   */
  visible?: boolean;
  onSend: (msg: string, behavior?: "followUp", images?: ImageAttachment[], mentions?: string[], documents?: string[]) => void;
  /**
   * §28: page-element comments the user picked in the embedded browser. They
   * STACK here and are folded into the next message on send — the user decides
   * when, which is why they live in App (one browser, many chats) and are
   * cleared through a callback rather than owned locally.
   */
  pageRefs?: Array<{ selector: string; label: string; outerHTML: string; comment: string; thumbnail?: string }>;
  onDropPageRef?: (index: number) => void;
  onClearPageRefs?: () => void;
  onAbort: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onOpenFolder: () => void;
  onCompact: () => void;
  /** W2.2: open a workspace-relative file in an editor tab (clickable card paths). */
  onOpenFile?: (relPath: string) => void;
  /** v5: navigate to the MCP page (from the composer "+" menu). */
  onOpenMcp?: () => void;
  /** §27: navigate to the Voice page (the activation modal's "More options"). */
  onOpenVoice?: () => void;
  /** §27 round 2: App-owned voice settings, same shape as terminalSettings.
      Passed rather than fetched so a Voice-page toggle applies immediately. */
  voiceSettings?: HvVoiceSettings | null;
  /** Round 3 #11: truncate the conversation at a user message (App-side). */
  onRewind?: (it: TranscriptItem, scope: RewindScope) => void;
  /** §9 round 9: pull in the pre-compaction history (display only). */
  onLoadEarlier?: () => void;
  /** §23 round 9: the session's active plan — the pill's data, null when none. */
  activePlan?: PlanCardData | null;
}): React.JSX.Element {
  const [input, setInput] = useState("");
  // Composer row aligns centered on one line; when the textarea wraps to multiple
  // lines the controls pin to the top instead (all on the same horizontal line).
  const [multiline, setMultiline] = useState(false);
  // F4: auto-growing textarea — reset to auto then clamp to scrollHeight (~8 lines).
  const taRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Round 2: where the caret must land after a programmatic insert.
   *
   * Setting selectionRange inside the setInput updater would be undone — React
   * has not written the new value to the DOM yet, so the browser puts the caret
   * at the end. It has to happen in an effect, after the commit.
   */
  const nextCaret = useRef<number | null>(null);
  const autoGrow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const sh = el.scrollHeight;
    el.style.height = `${Math.min(sh, 192)}px`;
    setMultiline(sh > 44); // one line ≈ 36px; > 44 means it wrapped
  }, []);
  useEffect(() => { autoGrow(); }, [input, autoGrow]);
  // Restore the caret after a programmatic insert (dictation, Send to chat).
  useEffect(() => {
    const at = nextCaret.current;
    if (at === null) return;
    nextCaret.current = null;
    const el = taRef.current;
    if (!el) return;
    el.setSelectionRange(at, at);
  }, [input]);
  // Round 11: external composer insert (the editor's "Send to chat"). Keyed on
  // the NONCE, so sending the same selection twice still appends; the text itself
  // is deliberately not a dependency.
  // §27: dictation. The transcript lands through the SAME appendToComposer
  // helper as the editor's Send-to-chat, so the two cannot drift.
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [voiceActivateOpen, setVoiceActivateOpen] = useState(false);
  // Round 2: ONE caret-aware insert, shared by dictation and the editor's
  // "Send to chat". Reads the live caret off the textarea, then restores it
  // after React commits — otherwise the caret jumps to the end and the next
  // keystroke lands in the wrong place.
  const insertText = useCallback((text: string) => {
    const el = taRef.current;
    setInput((prev) => {
      const start = el?.selectionStart ?? prev.length;
      const end = el?.selectionEnd ?? start;
      const r = insertAtComposer(prev, text, start, end);
      nextCaret.current = r.caret;
      return r.value;
    });
    el?.focus();
  }, []);

  const dictation = useDictation({
    settings: voiceSettings ?? null,
    onText: insertText,
    onError: setVoiceNotice,
    onNeedsActivation: () => setVoiceActivateOpen(true),
  });
  useEffect(() => {
    if (!voiceNotice) return;
    const t = setTimeout(() => setVoiceNotice(null), 6000);
    return () => clearTimeout(t);
  }, [voiceNotice]);

  // §27: the append rule now lives in composerText.ts, shared with dictation so
  // the two paths cannot land text in different places.
  const lastInsert = useRef(0);
  useEffect(() => {
    const n = composerInsert?.nonce ?? 0;
    if (!n || n === lastInsert.current) return;
    lastInsert.current = n;
    insertText(composerInsert!.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerInsert?.nonce]);
  // F3: @file mentions — label→relPath map for the composed text, a recursive
  // workspace index (fetched lazily, invalidated on fs change / workspace switch),
  // and the live dropdown state.
  const mentionMap = useRef<Map<string, string>>(new Map());
  const mentionIndex = useRef<MentionEntry[] | null>(null);
  const [mention, setMention] = useState<{ start: number; items: MentionEntry[]; sel: number; query: string } | null>(null);
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
    // `query` is kept so the agent rows (rendered above the files) can filter on
    // the same text without re-deriving it from the caret.
    setMention({ start: q.start, items, sel: 0, query: q.query });
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

  /**
   * §12 (2026-08-29): pick an AGENT from the `@` menu.
   *
   * Mirrors pickMention except for the one line that matters: it does NOT write
   * to `mentionMap`. That map is what `extractMentions` resolves on send, so an
   * entry there would make the app try to attach a file called "worker".
   */
  const pickAgentMention = (name: string): void => {
    const el = taRef.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? input.length;
    const next = `${input.slice(0, mention.start)}@${name} ${input.slice(caret)}`;
    const pos = mention.start + name.length + 2;
    setInput(next);
    setMention(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); autoGrow(); });
  };

  // §12 (2026-08-29): the agent rows shown above the file rows in the `@` menu.
  const mentionAgents = mention ? agentMentionItems(agents ?? [], mention.query) : [];

  // §14 round 6: `/skill:<name>` autocomplete. Pi already registers a command per
  // loaded skill; get_commands is a pure query so this costs no model turn. The
  // list only changes on respawn, so it's cached per session.
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  const commandCache = useRef<SlashCommand[] | null>(null);
  const [command, setCommand] = useState<{ items: SlashCommand[]; sel: number; end: number } | null>(null);
  const ensureCommands = useCallback(async (): Promise<SlashCommand[]> => {
    if (commandCache.current) return commandCache.current;
    if (!sessionId) return [];
    const sid = sessionId; // capture: this fetch must not populate another session's cache
    try {
      // §24: skills AND prompt templates — main joins the description/argument
      // hint onto Pi's list, which carries neither.
      const items = composerCommands(await window.hv.listCommands(sid));
      // The user may have switched sessions while this was in flight. Serving A's
      // commands in B would send a command B's Pi doesn't have.
      if (sid !== sessionIdRef.current) return [];
      commandCache.current = items;
      return items;
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
  // §23 round 9: the active-plan panel behind the pill. Only draft/implementing
  // plans get a pill — an implemented or cancelled plan needs no CTA, and the
  // file stays in the tree either way.
  const [planOpen, setPlanOpen] = useState(false);
  // Round 15: bumped on send; Transcript scrolls to the bottom unconditionally
  // when it changes. Starts at 0, whose initial effect run is what makes a
  // freshly opened session land at the bottom rather than at the top.
  const [scrollNonce, setScrollNonce] = useState(0);
  /**
   * §7 round 16 — bumped on send, so Transcript remounts the thinking blocks
   * and any the user opened close again. The decision is explicitly "collapsed
   * by default EACH TIME you send", not just on first render.
   *
   * It lives HERE rather than in App on purpose: ChatView is mounted per
   * session, so sending in one session cannot collapse another's reasoning.
   * A single counter in App would be global and would do exactly that.
   */
  const [collapseNonce, setCollapseNonce] = useState(0);
  const showPlanPill = !!activePlan && showsPlanPill(activePlan.status);
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
  // §31: documents are converted AT PICK TIME, so a chip already knows its cost.
  const [documents, setDocuments] = useState<DocumentAttachment[]>([]);
  const [documentsOn, setDocumentsOn] = useState(true);
  const [documentsHere, setDocumentsHere] = useState(true);
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
    setDocuments([]);
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
  // §16 finding 7 (2026-08-29): nothing resolved and the provider list HAS
  // loaded — an empty knownProviders means "not fetched yet" (the same rule
  // dropUnknownProvider relies on), and main always sends a non-empty set.
  // The app no longer invents a model here, so the composer says so instead of
  // sending into a spawn that will be refused.
  const noModel = resolved === null && knownProviders.length > 0;
  const vision = supportsVision(models, resolved);
  const modelName = resolved
    ? models?.find((m) => m.provider === resolved.provider && m.id === resolved.modelId)?.name ?? resolved.modelId
    : null;
  // Chip shows the bare model name — strip any leading "Provider: " prefix Pi bakes
  // into the display name (e.g. "Z.ai: GLM 5.2" → "GLM 5.2").
  const modelLabel = modelName?.replace(/^[^:]+:\s+/, "") ?? null;

  /**
   * §16 round 16 — the session's thinking effort.
   *
   * `levels` is what THIS session's model supports, re-read whenever the model
   * changes: an empty list means the model cannot think at all, and the pill
   * then does not render — the rule the context gauge follows for a model with
   * no known window, rather than a disabled control standing in for "n/a".
   */
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  /**
   * Seeded from the SESSION, not from nothing: the pill used to start at null
   * and only move when picked, so after a reload it read "default" for a
   * session that had an override — the control lying about the state it owns.
   */
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(sessionThinking);
  useEffect(() => { setThinkingLevel(sessionThinking); }, [sessionThinking, sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    void window.hv.getThinkingLevels(sessionId).then((l) => { if (alive) setThinkingLevels(l); });
    return () => { alive = false; };
  }, [sessionId, resolved?.provider, resolved?.modelId]);

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

  /**
   * §31: whether the Attach document row is offered, and why not when it isn't.
   *
   * Read when the MENU OPENS rather than once on mount. ChatView stays mounted
   * while the user walks to Built-in tools and back, so a mount-only fetch left
   * the row enabled after the switch was turned off — caught in the GUI pass,
   * with the tool already unregistered and the row still inviting a click.
   * Fetching where the value is USED is both correct and less plumbing than
   * pushing the change down from App (the route Plan mode needs, because its
   * pill is on screen continuously).
   *
   * The platform probe rides along; it is memoised in main, so it costs one IPC
   * round trip and never changes at runtime.
   */
  const refreshDocumentAvailability = (): void => {
    void window.hv.builtinsGet().then((b) => setDocumentsOn(b.document));
    void window.hv.documentsAvailable().then(setDocumentsHere);
  };
  useEffect(refreshDocumentAvailability, []);

  const attachDocument = async (): Promise<void> => {
    setAttachMenuOpen(false);
    const picked = await window.hv.pickDocument(sessionId ?? undefined);
    if (picked?.length) setDocuments((p) => [...p, ...picked]);
  };

  /** Drop/paste: the renderer already has an OS path, so main only has to convert. */
  const attachDocumentPaths = async (paths: string[]): Promise<void> => {
    const chips = await Promise.all(paths.map((abs) => window.hv.describeDocument(abs, sessionId ?? undefined)));
    const kept = chips.filter((c): c is DocumentAttachment => !!c);
    if (kept.length) setDocuments((p) => [...p, ...kept]);
  };

  /** §7 round 12: shared by paste and drop — the picker's own path is the only
   *  one that needs a trip through main. */
  const addFiles = async (files: ArrayLike<File>): Promise<void> => {
    const added = await filesToAttachments(files);
    if (added.length) setAttachments((p) => [...p, ...added]);
  };
  // #8: ⌘F / Ctrl-F opens in-conversation search; Escape closes it. searchOpen
  // is lifted to App (WS7 — the toggle lives in the tab strip).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (matchesBinding(e, searchKey)) {
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
  }, [searchOpen, onSearchOpenChange, searchKey]);

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
  const [suggestDismissed, setSuggestDismissed] = useState<Set<string>>(
    // Seeded from localStorage: an in-memory Set re-nagged after every reload,
    // which is exactly what the never-nag rule forbids. Per SESSION, because a
    // different session in the red zone is a warning the user has not seen.
    () => new Set(Object.keys(localStorage).flatMap((k) => (k.startsWith(REDZONE_KEY) ? [k.slice(REDZONE_KEY.length)] : []))),
  );
  const gauge = computeGauge(stats, fallbackWindow);
  const suggestCompact = gauge?.zone === "red" && sessionId != null && !suggestDismissed.has(sessionId) && !contextOpen;

  // #8: filter the transcript by search text (message kinds that carry text).

  if (!workspace || !sessionId) return <ChatWelcome onOpenFolder={onOpenFolder} />;

  const queued = queue.steering.length + queue.followUp.length;
  // V2.C1: while a delegation runs, the composer stays fully enabled but
  // anything typed queues behind the blocking subagent call — say so honestly
  // (placeholder + tooltip suffix on the queued chips).
  const hint = delegationHint(delegations);

  const submit = (behavior?: "followUp"): void => {
    // §28 round 1: a picked element is a message on its own. The comment and the
    // markup carry the whole intent, so requiring typed text as well would make
    // the popup's paper-plane hand you a composer that then refuses to send.
    // §31: a document with no typed text is a real message — the user picked a
    // file precisely so the agent would read it.
    if (!input.trim() && !(pageRefs?.length ?? 0) && !documents.length) return;
    const mentions = extractMentions(input, mentionMap.current);
    // §28: picked elements ride along as fenced blocks — the user's comment
    // first (it is what they mean), the markup after (it is how the agent finds
    // the thing). Page-controlled text needs no untrusted banner here: the human
    // wrote this turn, which is exactly the line §28 draws against tool results.
    const withRefs = (pageRefs?.length ?? 0)
      ? [
          input,
          // The user's sentence stays in the bubble. The selector and the markup
          // go into a <page-element> block, which stripInjectedBlocks cuts from
          // the bubble exactly as it cuts @file context — the model reads them,
          // the person who pointed at the thing never has to.
          ...pageRefs!.map((r) => (r.comment ? `\n\n${r.comment}` : "")),
          ...pageRefs!.map((r) =>
            `\n\n<page-element label="${r.label.replace(/"/g, "'")}" selector="${r.selector.replace(/"/g, "'")}">\n${r.outerHTML}\n</page-element>`,
          ),
        ].join("")
      : input;
    // §28 round 1: the element's picture rides the ORDINARY image pipeline, so
    // the bubble shows it, it zooms, and a vision model sees the thing itself
    // rather than a description of it.
    const refImages = (pageRefs ?? [])
      .flatMap((r) => (r.thumbnail ? [{ name: r.label.slice(0, 40) || "element", mimeType: "image/png", data: r.thumbnail.split(",")[1] ?? "" }] : []))
      .filter((a) => a.data);
    const outgoing = [...attachments, ...refImages];
    onSend(
      withRefs,
      behavior,
      outgoing.length ? outgoing : undefined,
      mentions.length ? mentions : undefined,
      documents.length ? documents.filter((d) => !d.error).map((d) => d.path) : undefined,
    );
    // Round 15: sending is the user saying "I am at the end now", so the view
    // goes to the bottom whatever it was reading. The stream's own follow stays
    // guarded by isNearBottom — that guard exists to protect a reader scrolling
    // back mid-response, which is a different act from pressing send.
    setScrollNonce((n) => n + 1);
    setCollapseNonce((n) => n + 1); // §7 round 16: re-collapse this session's thinking

    onClearPageRefs?.();
    setInput("");
    setAttachments([]);
    setDocuments([]);
    mentionMap.current = new Map();
    setMention(null);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* v5.1: search + context bubble live IN the chat (a thin right-aligned bar
          at the top of this pane) — not a floating overlay that could bleed over
          an adjacent split pane. */}
      <div className="flex items-center justify-end gap-1.5 px-3 h-11 border-b-2 border-line bg-paper shrink-0">
        {/* §23: compact plan-mode indicator (left) — read-only badge with a
            wrap-up nudge and one-click exit. Replaces the full-width banner. */}
        {/* §7 round 12: the MODEL chip lives here, left of the metrics, and the
            existing session badges stack after it. The group is unconditional
            now, because the chip is always present. The Plan toggle deliberately
            stayed in the composer: it is something you flip before typing, not a
            property of the session you read. */}
        <div className="mr-auto flex items-center gap-1.5">
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
              // §7 round 12: the chip moved to the top bar, so the menu opens
              // DOWNWARD — upward from there would open outside the pane.
              direction="down"
              renderTrigger={({ toggle }) => (
                <button
                  type="button"
                  aria-label="Change model for this session"
                  aria-expanded={modelMenuOpen}
                  onClick={toggle}
                  title={resolved ? `Model: ${resolved.provider}/${resolved.modelId}${resolution ? ` (${TIER_LABEL[resolution.tier]})` : ""}` : "No model configured"}
                  // Round 15: the chip had no border and muted ink, so it read
                  // as a disabled label beside the bordered ⌕ / cost / context
                  // controls. Same border+card treatment as those neighbours.
                  className="max-w-44 text-left font-mono text-[11px] rounded-full border-2 border-line bg-card px-2.5 py-1 text-ink hover:border-honey cursor-pointer transition-colors"
                >
                  <span className="block truncate">{modelLabel ?? "model…"}</span>
                </button>
              )}
            />
          </div>
          {/* §16 round 16: the session's thinking level, beside the model it
              belongs to. It does NOT render when the model supports no levels. */}
          {thinkingLevels.length > 0 && sessionId && (
            <ThinkingPill
              levels={thinkingLevels}
              value={thinkingLevel}
              onPick={(l) => {
                setThinkingLevel(l);
                void window.hv.setSessionThinking(sessionId, l).then(({ live }) => setRestartHint(!live));
              }}
            />
          )}
        {sessionSkills && sessionSkills.length > 0 && <SkillsChip skills={sessionSkills} />}
        {agents && agents.length > 0 && <AgentsChip agents={agents} onPick={(name) => insertText(`Ask ${name} to `)} />}
        {/* §23 round 9: the active-plan pill. A plan card lives at its
            plan_complete position in history, so a compaction that ate that
            position would otherwise leave an implementable plan with no way to
            implement it. This is that route, independent of the transcript. */}
        {showPlanPill && activePlan && (
          <button
            type="button"
            onClick={() => setPlanOpen((o) => !o)}
            aria-expanded={planOpen}
            title="The plan for this session — open it to implement, discard, or check progress"
            className="flex items-center gap-1 rounded-full bg-sky-soft text-sky text-[11px] font-bold px-2 py-0.5 hover:brightness-95 cursor-pointer"
          >
            <span aria-hidden>📋</span>
            {planPillLabel(activePlan.status, activePlan.done, activePlan.total)}
          </button>
        )}
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
        <CostBubble total={costTotal} open={costOpen} onToggle={() => onCostOpenChange(!costOpen)} />
        <ContextBubble stats={stats} fallbackWindow={fallbackWindow} open={contextOpen} onToggle={() => onContextOpenChange(!contextOpen)} />
      </div>
      {/* Round 15: everything below the top bar lives in one POSITIONED region,
          so the cost and context panels can be `absolute inset-0` within it —
          i.e. bounded by this pane and starting below the bar their pills sit
          in, the way Files and Changes sit below the top bar they open from.
          As `fixed inset-0` they covered the whole window, dimming a second
          chat that was streaming beside them. */}
      <div className="relative flex-1 flex flex-col min-h-0">
      {/* §23 round 9: the plan behind the pill. PlanCard is self-contained — it
          reads the file and drives Implement / Discard / Reopen through
          window.hv — so it needs nothing here but a place to render. */}
      {planOpen && showPlanPill && activePlan && (
        <div className="border-b-2 border-line bg-paper px-6 py-3 max-h-[50vh] overflow-y-auto">
          <PlanCard card={activePlan} onOpenFile={onOpenFile} />
        </div>
      )}
      {/* Crash banner */}
      {crashed !== null && (
        <Banner tone="danger">
          <span className="flex-1">The agent process stopped (code {crashed}).</span>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-lg bg-berry text-paper font-bold text-xs px-3 py-1.5 border-2 border-berry hover:brightness-110 cursor-pointer"
          >
            Restart agent
          </button>
        </Banner>
      )}

      {/* B5: red-zone auto-suggest (once per session, non-blocking). */}
      {suggestCompact && (
        <Banner
          tone="danger"
          onDismiss={() => {
            if (!sessionId) return;
            localStorage.setItem(`${REDZONE_KEY}${sessionId}`, "1");
            setSuggestDismissed((p) => new Set(p).add(sessionId));
          }}
        >
          <span className="flex-1">Context is {gauge!.percent}% full. Open the context panel to review or compact.</span>
          <button
            type="button"
            onClick={() => onContextOpenChange(true)}
            className="rounded-lg bg-berry text-paper font-bold text-xs px-3 py-1.5 border-2 border-berry hover:brightness-110 cursor-pointer"
          >
            Review context
          </button>
        </Banner>
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
              {((): Array<[RewindScope, string, string]> => {
                const opts: Array<[RewindScope, string, string]> = [
                  ["conversation", "Conversation only", "Files on disk are left exactly as they are."],
                ];
                // §9 round 12: the file scopes exist only when a rewind here
                // would actually restore something. Hidden, not greyed — and
                // hidden while the preview loads, so they appear once and never
                // vanish from under the cursor.
                if (hasRestorable(rewindPreview)) {
                  opts.push(["both", "Conversation and files", "Also roll the workspace back to before this message."]);
                  opts.push(["files", "Files only", "Roll the workspace back, keep the conversation."]);
                }
                return opts;
              })().map(([value, label, hint]) => (
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
            {/* §9 round 12: the loading and no-snapshot branches this block used
                to carry are gone with the options that led here — a file scope
                cannot be selected unless the preview already said yes. */}
            {rewindScope !== "conversation" && rewindPreview && (
              <div className="text-xs text-ink-soft mb-4 rounded-xl bg-paper-deep p-2">
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
                // The "files with no anchor" combination is now unreachable —
                // that scope is not rendered unless there is something to
                // restore — so there is nothing left to disable.
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
      {/* §27: first-use activation. Never names the model (§12). */}
      <VoiceActivateModal
        open={voiceActivateOpen}
        size={VOICE_MODEL_SIZE_LABEL}
        onDownload={() => {
          setVoiceActivateOpen(false);
          void window.hv.voiceDownload();
        }}
        onMoreOptions={() => {
          setVoiceActivateOpen(false);
          onOpenVoice?.();
        }}
        onClose={() => setVoiceActivateOpen(false)}
      />
      {/* §27: a transient composer notice — a denied mic, or a failed engine.
          Deliberately not a modal: dictation failing should not seize the app. */}
      {voiceNotice && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 max-w-md rounded-xl border-2 border-line-strong bg-card px-3 py-2 text-[13px] shadow-sticker-lg">
          <span className="font-semibold">Voice input:</span> {voiceNotice}
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
          thinking={thinking}
          busy={busy}
          scrollNonce={scrollNonce}
          collapseNonce={collapseNonce}
          header={
            delegations.length > 0 || terminalRuns.length > 0 ? (
              // §12/§26 (2026-08-30): ONE rail for both families, replacing the
              // two sibling stacks that used to share this container. `relative`
              // is load-bearing — the rail's expanded overlay is `absolute` and
              // positions against the nearest positioned ancestor, which is this
              // container or nothing.
              <div className="sticky top-0 z-20 px-6 relative max-w-3xl mx-auto w-full">
                <RunRail
                  runs={delegations}
                  terminalRuns={terminalRuns}
                  terminalSettings={terminalSettings}
                  items={items}
                  onStopRun={onStopRun}
                  onStopChild={onStopChild}
                  onStopTerminal={onStopTerminal}
                  onOpenTerminalAsTab={onOpenTerminalAsTab}
                />
              </div>
            ) : undefined
          }
          onRetry={onRetry}
          workspace={workspace}
          sessionId={sessionId}
          onOpenFile={onOpenFile}
          onRewind={onRewind && !busy ? openRewind : undefined}
          onLoadEarlier={onLoadEarlier}
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
        // §7 round 12: drop an image anywhere on the composer to attach it.
        // The file TREE drags its own mime (a "open this file" gesture, which
        // @file already covers) — never treat that as an image drop.
        onDragOver={(ev) => {
          if (ev.dataTransfer.types.includes(FILETREE_DRAG_MIME)) return;
          if (ev.dataTransfer.types.includes("Files")) ev.preventDefault();
        }}
        onDrop={(ev) => {
          if (ev.dataTransfer.types.includes(FILETREE_DRAG_MIME)) return;
          if (!ev.dataTransfer.files.length) return;
          ev.preventDefault();
          void addFiles(ev.dataTransfer.files);
          // §31: a dropped document attaches like one picked from the + menu.
          // Skipped silently when the group is off — the + row is where the
          // reason is shown, and a drop has nowhere to put a sentence.
          if (documentsOn && documentsHere) {
            const docs = filesToDocumentPaths(ev.dataTransfer.files, (f) => window.hv.getPathForFile(f));
            if (docs.length) void attachDocumentPaths(docs);
          }
        }}
        className="relative px-6 pb-5 pt-2"
      >
        {/* Round 2: the recording indicator, docked just above the composer —
            `bottom-full` on this relative form, so it costs the layout nothing
            and never leaves the pane. `visible` decides: a hidden pane cannot
            show it at all, and a hot mic must always be visible somewhere, so
            VoiceOverlay portals itself in that case. */}
        <VoiceOverlay
          open={dictation.recording}
          transcribing={dictation.transcribing}
          level={dictation.level}
          onStop={dictation.stop}
          docked={visible}
        />
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
        {/* §31: document chips. Same shelf and same promise as the images — and
            the label carries the CONTEXT COST, because this is the surface where
            the user decides whether to spend it (§9, one step earlier). */}
        {documents.length > 0 && (
          <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-2 px-1 pb-2">
            {documents.map((d, i) => (
              <span
                key={`${d.path}-${i}`}
                className={`flex items-center gap-1.5 rounded-xl border-2 border-line-strong bg-card px-2 py-1 shadow-sticker text-xs font-semibold ${d.error ? "text-berry" : ""}`}
                title={d.path}
              >
                <span className="max-w-96 truncate">{documentChipLabel(d)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${d.name}`}
                  onClick={() => setDocuments((p) => p.filter((_, j) => j !== i))}
                  className="text-ink-soft hover:text-berry font-bold text-sm leading-none cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {/* §28: picked-element chips. Same shelf as the image attachments and the
            same promise — nothing is sent until the user sends it. */}
        {(pageRefs?.length ?? 0) > 0 && (
          <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-2 px-1 pb-2">
            {pageRefs!.map((ref, i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 rounded-xl border-2 border-line-strong bg-card px-2 py-1 shadow-sticker"
                title={`${ref.label}\n${ref.comment}`}
              >
                <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18" />
                  <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
                </svg>
                <span className="max-w-48 truncate text-xs font-semibold">{ref.comment || ref.label}</span>
                <button
                  type="button"
                  aria-label={`Remove comment on ${ref.label}`}
                  onClick={() => onDropPageRef?.(i)}
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
        {noModel && (
          <div className="max-w-3xl mx-auto px-1 pb-1.5 text-[11px] font-semibold text-berry">
            No model configured — add a provider in Settings → Models to start chatting.
          </div>
        )}
        <div className={`max-w-3xl mx-auto flex gap-1.5 ${multiline ? "items-start" : "items-center"} rounded-2xl bg-card border-2 border-line-strong shadow-sticker-lg px-2 py-1.5 focus-within:border-tangerine transition-colors`}>
          {/* W2.1: "+" attach menu — always visible; entries gate honestly. */}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="Attach"
              aria-expanded={attachMenuOpen}
              onClick={() => {
                setAttachMenuOpen((o) => {
                  if (!o) refreshDocumentAvailability(); // §31: fresh at the moment it is read
                  return !o;
                });
                setModelMenuOpen(false);
              }}
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
                  {/* §31: this row replaces "Attach file — coming soon". Disabled
                      states carry their REASON rather than hiding, which is how a
                      user learns the Built-in tools setting exists at all. */}
                  <button
                    type="button"
                    disabled={!documentsOn || !documentsHere}
                    onClick={attachDocument}
                    title={
                      !documentsHere
                        ? "Document conversion is not available on this platform"
                        : documentsOn
                          ? "Attach a document — converted to Markdown on this machine"
                          : "Turn Documents on in Built-in tools to attach one"
                    }
                    className="w-full text-left px-3 py-2 enabled:hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40"
                  >
                    Attach document
                    <span className="block text-[10px] font-medium text-ink-soft">
                      {!documentsHere
                        ? "not available on this platform"
                        : documentsOn
                          ? DOCUMENT_FAMILY_LIST
                          : "off in Built-in tools"}
                    </span>
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
            {/* F3: @file autocomplete — opens above the composer, styled like the
                attach menu. §12 (2026-08-29): an AGENT match opens it too, so
                `@wor` finds `worker` even where no file matches. */}
            {mention && (mention.items.length > 0 || mentionAgents.length > 0) && (
              <div className="absolute bottom-full left-0 mb-2 z-30 w-full max-w-md max-h-64 overflow-y-auto rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm">
                {/* §12: agents first — they are the rarer, more valuable pick,
                    and the file list is long. Mouse-picked only: the arrow/Tab
                    index below still addresses mention.items (files), which
                    keeps the existing keyboard contract byte-identical. */}
                {mentionAgents.map((a) => (
                  <button
                    key={`agent:${a.name}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickAgentMention(a.name)}
                    className="w-full text-left px-3 py-1.5 cursor-pointer hover:bg-paper-deep/40"
                  >
                    <span className="font-semibold">🤖 @{a.name}</span>
                    <span className="block truncate text-[11px] font-medium text-ink-soft">{agentBlurb(a)}</span>
                  </button>
                ))}
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
            {/* §14 round 6 / §24: /skill: + prompt-command menu — same placement/styling as @file. */}
            {command && command.items.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 z-30 w-full max-w-md max-h-64 overflow-y-auto rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm">
                {command.items.map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickCommand(c.name)}
                    className={`w-full text-left px-3 py-1.5 cursor-pointer ${i === command.sel ? "bg-honey-soft" : "hover:bg-paper-deep/40"}`}
                  >
                    <span className="font-semibold">/{c.name}</span>
                    <span className="block truncate text-[11px] font-medium text-ink-soft">{commandSubtitle(c)}</span>
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
                  if (e.key === "Tab") { e.preventDefault(); pickCommand(command.items[command.sel].name); return; }
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
                // §27: dictation-cancel is LAST in the Escape chain, after the
                // /command menu and the @-mention dropdown above — each of
                // those returns once it has acted, so with a dropdown open the
                // first Escape closes it and a second cancels the recording.
                // The dropdown is the more recent, more local thing the user
                // opened, and a recording survives one extra keypress.
                if (e.key === "Escape" && dictation.cancelOnEscape()) {
                  e.preventDefault();
                  return;
                }
                // §27: every key goes to the gesture reducer so it can ABANDON
                // a hold when another key joins it (right-⌘+S must not dictate).
                dictation.handleKey(e.nativeEvent, "down");
                // F4: Enter sends, Shift+Enter inserts a newline. Never send mid-IME
                // composition (e.g. accented input, CJK) — that Enter commits text.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              onKeyUp={(e) => dictation.handleKey(e.nativeEvent, "up")}
              onPaste={(e) => {
                // §7 round 12: an image on the clipboard attaches. Checked
                // BEFORE the large-text guard — a screenshot paste carries no
                // text, and letting the guard run first swallowed it.
                if (e.clipboardData.files.length > 0) {
                  const imgs = Array.from(e.clipboardData.files).filter(isAttachableImage);
                  if (imgs.length) {
                    e.preventDefault();
                    void addFiles(e.clipboardData.files);
                    return;
                  }
                }
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
          {/* §27 round 12: the mic sits with the OTHER input controls — beside
              Stop and Send — rather than before the textarea. Placement only;
              the chip's semantics (red while recording, click to stop, hidden
              when voice is off) are unchanged. */}
          {dictation.showChip && (
            <MicButton
              state={dictation.micState}
              progress={dictation.progress}
              hint={dictation.hint}
              onClick={dictation.toggle}
            />
          )}
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
            disabled={noModel || (!input.trim() && !(pageRefs?.length ?? 0))}
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

/** The overlay's own marker, so the layout test can find it by name. */
const RUN_RAIL_OVERLAY = "absolute left-0 top-full mt-2 w-full max-w-2xl";

/**
 * §12 / §26 (2026-08-30): both run families as one row of circles.
 *
 * Supersedes V2.C1's stacked delegation section and §26's capped terminal
 * stack. A card was the resting state of something that is mostly BACKGROUND
 * work — ~3 rows each, and the fleet round gave the delegation card a fourth,
 * so two runs plus a terminal pushed the conversation off the screen. The
 * circle is the resting state now; the card is what a click opens, unchanged.
 *
 * Three things are load-bearing and each has a comment where it lives: the
 * overlay is `absolute` inside the sticky container (so it paints OVER the
 * transcript instead of pushing it, which is what "overlay" was asked for) and
 * therefore needs `relative` on that container; dismissal is toggle-only, never
 * a `fixed inset-0` catcher, because browserCoverage.ts would read that as
 * covering every browser pane; and a run needing attention is PROMOTED to a
 * full card rather than waiting behind a click.
 */
function RunRail({
  runs,
  terminalRuns,
  terminalSettings,
  items,
  onStopRun,
  onStopChild,
  onStopTerminal,
  onOpenTerminalAsTab,
}: {
  runs: DelegationRun[];
  terminalRuns: TerminalRun[];
  terminalSettings?: HvTerminalSettings | null;
  items: TranscriptItem[];
  onStopRun?: (runId: string) => void;
  onStopChild?: (runId: string, childId: string) => void;
  onStopTerminal?: (terminalId: string) => void;
  onOpenTerminalAsTab?: (terminalId: string) => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const avatars = toRunAvatars(runs, terminalRuns);
  const promoted = new Set(promotedKeys(avatars));

  // Escape closes the overlay. The only dismissal besides clicking the same
  // circle again — see the class comment on why there is no click-catcher.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A run that disappears (a delegation slides away 2.5s after completion, a
  // terminal is killed) must not leave its overlay open over nothing.
  const keys = avatars.map((a) => a.key).join("|");
  useEffect(() => {
    setOpen((o) => (o && !keys.split("|").includes(o) ? null : o));
    setHover((h) => (h && !keys.split("|").includes(h) ? null : h));
  }, [keys]);

  if (avatars.length === 0) return null;

  const cardFor = (key: string, closable: boolean): React.JSX.Element | null => {
    const run = runs.find((r) => r.id === key);
    if (run) {
      return (
        <DelegationRunCard
          run={run}
          // A PROMOTED card has no circle to return to, so it gets no ✕ — the
          // run needs attention and closing it would hide the one state that
          // must not be dismissible (PRD §12, 2026-08-30).
          onClose={closable ? () => setOpen(null) : undefined}
          // Foreground runs stream their child transcript onto the in-flow tool
          // card; async (detached) runs have none — their live progress rides
          // run.live from the status poller instead.
          trace={run.kind === "fg" && run.toolCallId ? traceFor(items, run.toolCallId) : undefined}
          onStopRun={onStopRun}
          onStopChild={onStopChild}
        />
      );
    }
    const t = terminalRuns.find((x) => x.terminalId === key);
    if (!t || !terminalSettings || !onStopTerminal || !onOpenTerminalAsTab) return null;
    return (
      <TerminalRunCard
        run={t}
        settings={terminalSettings}
        // The rail IS the collapsed state, so the card it opens is the expanded
        // one and ✕ goes back to the circle. Exactly one is ever mounted, which
        // is what makes hosting a live emulator affordable (§26).
        onClose={() => setOpen(null)}
        onStop={onStopTerminal}
        onOpenAsTab={onOpenTerminalAsTab}
      />
    );
  };

  return (
    <div className="w-full flex flex-col">
      {/* Attention takes SPACE, not a click. */}
      {avatars
        .filter((a) => promoted.has(a.key))
        .map((a) => (
          <div key={`promoted-${a.key}`}>{cardFor(a.key, false)}</div>
        ))}
      <div className="pt-3 flex items-center gap-2 flex-wrap">
        {avatars
          .filter((a) => !promoted.has(a.key))
          .map((a) => (
            <div
              key={a.key}
              className="relative"
              onMouseEnter={() => setHover(a.key)}
              onMouseLeave={() => setHover((h) => (h === a.key ? null : h))}
            >
              <button
                type="button"
                onClick={() => setOpen((o) => (o === a.key ? null : a.key))}
                aria-expanded={open === a.key}
                aria-label={`${a.name}${a.caption ? ` — ${a.caption}` : ""} (${a.state})`}
                // The hue is INLINE, not a class: Tailwind's scanner never sees
                // a computed class name and would emit nothing.
                style={{ backgroundColor: `hsl(${a.hue} 70% 92%)`, color: `hsl(${a.hue} 60% 30%)` }}
                className={`size-9 rounded-full border-2 grid place-items-center shadow-sticker cursor-pointer ${RUN_STATE_RING[a.state]}`}
              >
                <ToolIcon kind={(a.kind === "agent" ? "robot" : "terminal") as IconKind} className="size-4" />
              </button>
              {hover === a.key && open !== a.key && (
                // No gap between the circle and this panel: a gap means the
                // mouse leaves on the way in and the STOP inside is
                // unreachable. The `pt-1` is INSIDE the hover target.
                <div className="absolute left-0 top-full pt-1 z-20 w-72">
                  <div className="rounded-lg border-2 border-line bg-card shadow-sticker-lg px-3 py-2 flex flex-col gap-1">
                    <span className="text-sm font-black text-tangerine-deep break-words">{a.name}</span>
                    {a.caption && <span className="text-xs text-ink-soft break-words">{a.caption}</span>}
                    <RunFacts avatar={a} runs={runs} terminalRuns={terminalRuns} />
                    {/* §26 (2026-08-31): what that terminal is actually printing.
                        This was the collapsed card's body; the circle is the
                        collapsed state now, so it lives here. Mounted only while
                        hovered, so it polls in bursts rather than forever. */}
                    {a.kind === "terminal" && <TerminalTail terminalId={a.key} />}
                    <div className="flex items-center gap-2 pt-0.5">
                      {a.state === "working" && (
                        <button
                          type="button"
                          // mousedown, not click: this control lives inside a
                          // surface that can vanish, and a click that arrives
                          // after the unmount lands on nothing.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (a.kind === "agent") onStopRun?.(a.key);
                            else onStopTerminal?.(a.key);
                          }}
                          title={a.kind === "agent" ? "Stop this subagent" : "Stop this terminal and the process in it"}
                          className="rounded-md border border-berry/50 text-berry px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide hover:bg-berry/10 cursor-pointer"
                        >
                          ◼ Stop
                        </button>
                      )}
                      <span className="text-[10px] uppercase tracking-wide text-ink-soft">{a.state}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>
      {open && !promoted.has(open) && <div className={`${RUN_RAIL_OVERLAY} z-20`}>{cardFor(open, true)}</div>}
    </div>
  );
}

/**
 * The numbers the card's header used to carry, now in the hover readout: PRD
 * §12's 2026-08-22 decision put a running delegation's spend "on the line that
 * stops it", and an avatar has no line — this panel is that line.
 */
function RunFacts({
  avatar,
  runs,
  terminalRuns,
}: {
  avatar: RunAvatar;
  runs: DelegationRun[];
  terminalRuns: TerminalRun[];
}): React.JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const run = avatar.kind === "agent" ? runs.find((r) => r.id === avatar.key) : undefined;
  const term = avatar.kind === "terminal" ? terminalRuns.find((t) => t.terminalId === avatar.key) : undefined;
  const startedAt = run?.startedAt ?? term?.startedAt;
  if (startedAt == null) return null;
  const gauge = run && run.status === "running" ? childGauge(run.live?.context) : null;
  return (
    <span className="flex items-center gap-2 flex-wrap font-mono text-[11px] text-ink-soft tabular-nums">
      <span title="Elapsed time">{formatElapsed(now - startedAt)}</span>
      {run?.live?.currentTool && <span className="truncate">{run.live.currentTool}</span>}
      {/* Absent until the child's first turn is billed — never a $0.00 standing
          in for "not measured yet". */}
      {run?.live?.cost && (
        <span>
          {fmtNum(run.live.cost.input + run.live.cost.output)} tok · {costEstimateLabel(run.live.cost)}
        </span>
      )}
      {gauge && (
        <span
          title={`This subagent's context window: ${gauge.label} tokens`}
          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${GAUGE_TONE[gauge.zone]}`}
        >
          {gauge.text}
        </span>
      )}
    </span>
  );
}

/**
 * §12 (2026-08-29): the run card's context pill, in ContextBubble's own zone
 * hues (its rest state — this pill is a readout, not a toggle). Declared as
 * DATA so the renderer suite, which has no DOM, can pin the mapping.
 */
export const GAUGE_TONE: Record<GaugeZone, string> = {
  calm: "border-leaf/60 bg-leaf-soft text-leaf",
  amber: "border-honey/60 bg-honey-soft text-tangerine-deep",
  red: "border-berry/60 bg-berry-soft text-berry",
};

/**
 * V2.C1: one run card — robot icon, agent name, intent, live elapsed, status,
 * with a shimmer bar while working. Clicking toggles the LIVE child transcript
 * inline (same trace the in-flow SubagentCard renders — the expansion scrolls
 * within a max-height so it never fights the sticky pinning). On completion:
 * brief done/failed state, then a height-collapse slide-away; the in-flow call
 * line + result remain in the transcript as the record.
 */
function DelegationRunCard({ run, trace, onClose, onStopRun, onStopChild }: { run: DelegationRun; trace?: SubagentTrace; onClose?: () => void; onStopRun?: (runId: string) => void; onStopChild?: (runId: string, childId: string) => void }): React.JSX.Element {
  const running = run.status === "running";
  const attention = running && run.live?.activityState === "needs_attention";
  /**
   * §12 (2026-08-31): the card IS the expanded state, so there is no collapsed
   * one to toggle back to — the rail's circle is what "collapsed" means now, and
   * a card that opened shut was one click short of showing anything. The header
   * is therefore inert and the top-right control CLOSES (back to the circle)
   * rather than collapsing in place.
   */
  const open = true;
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
  // §12 (2026-08-29): the child's own context gauge — §9's headline
  // differentiator, per child. Null whenever the model has no known window, and
  // the pill then does not render at all rather than showing 0%.
  const gauge = running ? childGauge(run.live?.context) : null;
  /**
   * §12 (2026-08-29): the child's own reasoning, fetched only when asked.
   *
   * The sub-agent card was the app's FIRST thinking surface; round 16 gave the
   * main agent its own (Transcript's ThinkingBlock), so that asymmetry is gone.
   * This one stays distinct: a child's reasoning lives in its own transcript
   * file and is read on demand, where the parent's arrives on the stream.
   * Toggling OFF clears rather than caching, so re-opening a running child
   * re-reads and shows what it is thinking now, not what it thought.
   */
  /**
   * The child's reasoning, interleaved with the calls it produced — shown
   * whenever the card is EXPANDED, with no toggle. Expanding is already the
   * deliberate act; a second click to see why the agent did what it did was
   * ceremony, and the reasoning only makes sense next to the calls anyway.
   *
   * Kept LIVE by keying on `run.live`, which App rebuilds on every status push
   * — and pushes are already rate-limited by `statusUnchanged`, so this re-reads
   * roughly once per child turn or tool rather than on a timer. Measured cost:
   * 0.3-2.7 ms to parse a real transcript (7 KB to 674 KB). Nothing runs while
   * the card is collapsed, which is almost all of the time.
   */
  const [childTrace, setChildTrace] = useState<HvChildTrace[] | null>(null);
  const transcriptPath = run.live?.children?.find((c) => c.transcriptPath)?.transcriptPath;
  useEffect(() => {
    if (!open || !transcriptPath) {
      // Drop it on collapse so reopening shows current work, never a stale read.
      setChildTrace(null);
      return;
    }
    let alive = true;
    void window.hv.subagentThinking(transcriptPath).then((rows) => { if (alive) setChildTrace(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [open, transcriptPath, run.live]);
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
              <span className="flex-1 min-w-0 flex items-start gap-3 text-left">
                <span className={`mt-1 size-2.5 rounded-full shrink-0 ${dot}`} />
                <ToolIcon kind="robot" className="mt-0.5 size-4 shrink-0 text-sky" />
                <span className="flex-1 min-w-0 break-words">
                  <span className="font-black text-tangerine-deep">{run.agent}</span>
                </span>
              </span>
              {/* §12 (2026-08-29): how full this sub-agent's head is. Zones are
                  the session gauge's own (subagentGauge.ts reuses zoneOf), so
                  amber means the same thing on both. Absent when the model has
                  no registered window — no pill, never a 0%. */}
              {gauge && (
                <span
                  title={`This subagent's context window: ${gauge.label} tokens`}
                  className={`shrink-0 font-mono text-[10px] font-bold rounded-full border px-1.5 py-0.5 ${GAUGE_TONE[gauge.zone]}`}
                >
                  {gauge.text}
                </span>
              )}
              {running ? (
                <span className="font-mono text-xs text-ink-soft tabular-nums shrink-0" title="Elapsed time">
                  {attention ? "needs attention" : currentTool ? currentTool : "working"} · {formatElapsed(now - run.startedAt)}
                  {/* §12 (2026-08-22): the spend sits on the STOP control's own
                      line, so "this is getting expensive" and the means to end
                      it are one glance apart rather than a navigation. Absent
                      until the child's first turn is billed — never a $0.00
                      standing in for "not measured yet". */}
                  {run.live?.cost && (
                    <>
                      {" "}
                      · {fmtNum(run.live.cost.input + run.live.cost.output)} tok · {costEstimateLabel(run.live.cost)}
                    </>
                  )}
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
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  title="Close — the run keeps going, and its circle stays in the row"
                  aria-label="Close this run's card"
                  className="shrink-0 text-sm leading-none text-ink-soft hover:text-ink cursor-pointer px-0.5"
                >
                  ✕
                </button>
              )}
            </div>
            {/* §12 (2026-08-29): the intent moved OFF the header row. The header
                now carries the context gauge alongside elapsed/tokens/cost, and
                a fifth figure sharing a line with wrapping prose was unreadable.
                It stays part of the expand control, so the whole card still
                toggles wherever you click it. */}
            {run.label && (
              <p className="w-full text-left px-4 pb-2.5 -mt-1 text-sm font-medium text-ink-soft break-words">
                {run.label}
              </p>
            )}
            {open && (
              <div className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2.5 max-h-72 overflow-y-auto flex flex-col gap-3">
                {run.kind === "fg" ? (
                  <SubagentTraceView results={trace?.results ?? []} cost={run.live?.cost} />
                ) : (
                  // Detached run: no child transcript on the parent stream — show
                  // the live status snapshot from the poller instead.
                  <div className="text-xs text-ink-soft flex flex-col gap-1">
                    {/* §12 (2026-08-29): a fan-out lists its children, each with
                        its own gauge and its own STOP. Rendered ONLY above one
                        child — a single delegation has exactly one step, where
                        this would be the header's STOP under a second name. */}
                    {(run.live?.children?.length ?? 0) > 1 &&
                      run.live!.children!.map((c, i) => {
                        const g = childGauge(c.context);
                        const canStopChild = running && c.childId && isStoppableChild(c.status) && onStopChild;
                        return (
                          <div key={c.childId ?? i} className="flex items-center gap-2">
                            <span className="flex-1 min-w-0 truncate font-semibold text-ink">{c.agent ?? "agent"}</span>
                            {g && (
                              <span
                                title={`${c.agent ?? "This child"}'s context window: ${g.label} tokens`}
                                className={`shrink-0 font-mono text-[10px] font-bold rounded-full border px-1.5 py-0.5 ${GAUGE_TONE[g.zone]}`}
                              >
                                {g.text}
                              </span>
                            )}
                            <span className="shrink-0 text-[10px] uppercase tracking-wide">{c.status ?? "running"}</span>
                            {canStopChild && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onStopChild!(run.id, c.childId!); }}
                                title={`Stop just ${c.agent ?? "this child"} — the others keep going`}
                                aria-label={`Stop ${c.agent ?? "this child"}`}
                                className="shrink-0 rounded-md border border-berry/50 text-berry px-1.5 py-0.5 text-[10px] font-bold hover:bg-berry/10 cursor-pointer"
                              >
                                ◼
                              </button>
                            )}
                          </div>
                        );
                      })}
                    {/* §12 (2026-08-29): the child's reasoning, on request. The
                        toggle only appears once upstream has written the
                        transcript — before that there is nothing to read. */}
                    {/* §12 round 2: thinking INTERLEAVED with the calls it
                        produced, in transcript order — reasoning next to the
                        action it explains. No toggle: expanding the card is the
                        ask. This supersedes the recentTools list below, which
                        it already contains, in order and with the why. */}
                    {childTrace?.map((row, i) =>
                      row.kind === "thinking" ? (
                        <p key={i} className="text-xs text-ink-soft italic border-l-2 border-plum/40 pl-2 whitespace-pre-wrap">{row.text}</p>
                      ) : (
                        <div key={i} className="font-mono text-xs truncate pl-2">
                          <span className="text-ink font-semibold">{row.name}</span>
                          {row.text && <span className="text-ink-soft"> {row.text}</span>}
                        </div>
                      ),
                    )}

                    {run.live?.turnCount != null && <div>turn {run.live.turnCount}{currentTool ? ` · ${currentTool}` : ""}</div>}
                    {!childTrace?.length && (run.live?.recentTools ?? []).slice(-8).map((t, i) => (
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
/**
 * §12 (2026-08-29): the delegate-this affordance, chip half.
 *
 * The agents existed and nothing in the chat flow said so — discovery was a
 * settings page. This is the version a first-time user finds; `@agent` in the
 * composer is the version a hundredth-session user types. Both, deliberately:
 * one is discoverable, the other is fast.
 *
 * Dismissal is a `fixed inset-0` click-catcher, NOT onBlur. A blur-dismissed
 * menu unmounts between mousedown and mouseup and loses its own clicks — twice
 * reported in this app as "none of this menu is clickable" (see CLAUDE.md).
 */
function AgentsChip({ agents, onPick }: { agents: AgentInfo[]; onPick: (name: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${agents.length} subagent${agents.length === 1 ? "" : "s"} you can delegate to`}
        // Quiet by design (2026-08-30): the composer row already carries three
        // filled pills. This one rests as a bare outline and fills on hover, so
        // the model pill stays the loud one. The glyph is the app's own robot —
        // the same one the run card uses — rather than an emoji.
        className="flex items-center gap-1 rounded-full border border-line text-ink-soft text-[11px] font-bold px-2 py-0.5 cursor-pointer hover:bg-honey-soft hover:text-tangerine-deep hover:border-honey/60 transition-colors"
      >
        <ToolIcon kind="robot" className="size-3 shrink-0" /> {agents.length} agents
      </button>
      {open && <div className="fixed inset-0 z-20" onMouseDown={() => setOpen(false)} />}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-30 w-72 max-h-64 overflow-y-auto rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1.5 text-sm">
          {/* Same grouping as the Agents page — one sort, two surfaces. */}
          {sortAgents(agents).map((a) => (
            <button
              key={a.path}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(a.name); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 cursor-pointer hover:bg-paper-deep/40"
            >
              <span className="font-bold">{a.name}</span>
              <span className="block text-[11px] text-ink-soft line-clamp-2">{agentBlurb(a)}</span>
            </button>
          ))}
          <p className="px-3 pt-1 text-[10px] text-ink-soft">
            Or type <span className="font-mono">@</span> in the message box.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * §16 round 16 — the thinking-effort pill, styled as the model chip's twin so
 * the two read as one group.
 *
 * Dismissal is the `fixed inset-0` click-catcher every other menu in the app
 * uses, NOT onBlur: pressing a button does not focus it, so a blur-dismissed
 * menu unmounts between mousedown and mouseup and the click lands on nothing.
 */
function ThinkingPill({
  levels,
  value,
  onPick,
}: {
  levels: string[];
  value: string | null;
  /** `null` clears the session override, so the session follows the global
   *  default again. Without it a level could be set but never unset. */
  onPick: (level: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Change thinking effort for this session"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={`Thinking effort: ${value ?? "default"}`}
        className="font-mono text-[11px] rounded-full border-2 border-line bg-card px-2.5 py-1 text-ink hover:border-honey cursor-pointer transition-colors"
      >
        think: {value ?? "default"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 z-30 rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm">
            {/* Round 16 GUI pass: picking a level was one-way — there was no way
                back to the global default, so a session could only ever be
                pinned. This row is that way back. */}
            <button
              type="button"
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
              title="Follow the default set on the Models page"
              className={`block w-full text-left px-3 py-1 font-mono text-xs hover:bg-paper-deep cursor-pointer border-b border-line ${value === null ? "font-bold" : ""}`}
            >
              default
            </button>
            {levels.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => {
                  onPick(l);
                  setOpen(false);
                }}
                className={`block w-full text-left px-3 py-1 font-mono text-xs hover:bg-paper-deep cursor-pointer ${l === value ? "font-bold" : ""}`}
              >
                {l}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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

/**
 * The no-session center: "Pick a project, make a vibe."
 *
 * Extracted so App can render it directly when NO chat tab is open. Round 5
 * always mounted one ChatView (its chat area fell back to contentA), so this
 * showed on a fresh launch; round 11 renders one ChatView per open chat tab, and
 * with none open the centre was a blank void that read as a crash.
 */
export function ChatWelcome({ onOpenFolder }: { onOpenFolder: () => void }): React.JSX.Element {
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
