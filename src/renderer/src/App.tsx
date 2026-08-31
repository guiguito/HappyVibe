import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChangesPanel } from "./components/ChangesPanel";
import { RightRail, type DrawerPanel } from "./components/RightRail";
import { badgeTint, clampDrawer, summarise } from "./gitui";
import { Sidebar, type View } from "./components/Sidebar";
import { ChatView, ChatWelcome } from "./components/ChatView";
import { ModelsView } from "./components/ModelsView";
import { PermissionsView } from "./components/PermissionsView";
import { SystemPromptView } from "./components/SystemPromptView";
import { OnBehalfView } from "./components/OnBehalfView";
import { DashboardView } from "./components/DashboardView";
import { AuditView } from "./components/AuditView";
import { ChangelogView } from "./components/ChangelogView";
import { type TranscriptItem } from "./components/Transcript";
import { type PlanCardData } from "./components/PlanCard";
import { PermissionModal } from "./components/PermissionModal";
import { describeProviderError, retryNoticeText } from "./providerError";
import { rewindActions, tailToolCallIds, type RewindScope } from "./rewind";
import { WorkspaceSettingsView } from "./components/WorkspaceSettingsView";
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { ShortcutsView } from "./components/ShortcutsView";
import { eventToBinding, formatBinding, resolveBindings, type ShortcutId } from "./shortcuts";
import {
  dropSession,
  headFor,
  parseDangerous,
  parsePermission,
  parsePlan,
  parsePlanBlocked,
  pendingCounts,
  type PermissionChoice,
  type QueuedPrompt,
} from "./permission";
import { answersSummary, parseAskUser, type AskAnswer } from "./askUser";
import { AskUserModal } from "./components/AskUserModal";
import { applyQueueUpdate, emptyQueue, type QueueState } from "./queue";
import { parseContextAck, parseContextFiles, parseContextSnapshot, type ContextSnapshot } from "./context";
import { AgentsView } from "./components/AgentsView";
import { SkillsView } from "./components/SkillsView";
import { PromptTemplatesView } from "./components/PromptTemplatesView";
import { PluginsView } from "./components/PluginsView";
import { applyPromptTemplatePair } from "./promptTemplatePair";
import { toTranscriptItems } from "./restoreMap";
import { McpView } from "./components/McpView";
import { AllToolsView } from "./components/AllToolsView";
import { asyncResultInfo, delegationLabel, isSubagentQuery, isSubagentTool, mergeTrace, parseAgents, parseBrowserEvent, parseSubagentEvent, parseTerminalEvent, parseTools, runLabel, traceFromEnd, traceFromUpdate, type AgentInfo, type DelegationChild, type DelegationRun, type SubagentEvent, type ToolInfo } from "./agents";
import { applyDelta, updateToolCard, mergeIntoLastAssistant } from "./streaming";
import { attachmentUrl, buildImages, type ImageAttachment } from "./composer";
import {
  activateTab, allChats, chatTabCount, visibleChats, allFiles, allTerminals, bufferKey, chatTab, closePane, closeSessionTabs, closeTab, emptyTabs, focusPane,
  isChatTab, isTermTab, liveSlots, moveTab, openChat, openFile, openTerminal, paneOf, sessionOf, setSize, splitAt, splitOptions, termTab, terminalOf,
  allBrowsers, browserOf, browserTab, isBrowserTab, openBrowserTab,
  type TabId, type WorkspaceTabs,
} from "./tabs";
import { TabStrip } from "./components/TabStrip";
import { TerminalTab } from "./components/TerminalTab";
import { BrowserTab } from "./components/BrowserTab";
import { TerminalView } from "./components/TerminalView";
import { VoiceView } from "./components/VoiceView";
import { restoreLayout } from "./layoutPersist";
import { buildGridStyle, paneEdges, paneNeighbours, topRightSlot } from "./paneGrid";
import { watchTargets } from "./watchTargets";
import { FileTree } from "./components/FileTree";
import { FileTab } from "./components/FileTab";
import { AgentsMdPanel } from "./components/AgentsMdPanel";
import type { SessionStats } from "./context";
import { basename as tabBasename } from "./tabs";
// Shared tool-name knowledge with the bridge (precedent: toolLabel.ts ← hv-mcp).
import { isWaitTool } from "../../../pi-runtime/extensions/hv-rules";
import { Banner } from "./components/Banner";
import { NavContext, type NavTarget } from "./components/GoTo";

type KeyState = "loading" | "missing" | "present";
export type SessionStatus = "running" | "crashed" | "waking";

// §23: plan-mode transition tools — never rendered as raw tool cards.
const PLAN_TOOL_NAMES = new Set(["plan_complete", "plan_start", "plan_status_update"]);

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
  // Fresh sessions snapshot for the (stale-closure) ui-request handler — the
  // listener effect runs once, so it can't read the `sessions` state directly.
  const sessionsRef = useRef<SessionMeta[]>([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  // Per-session permission prompt queues (B4): the modal shows the focused
  // session's oldest pending prompt; the rest badge the sidebar + dock.
  const [uiQueue, setUiQueue] = useState<QueuedPrompt[]>([]);
  // Sessions currently in /hv-dangerous mode (bridge-notified, never persisted).
  const [dangerous, setDangerous] = useState<Record<string, boolean>>({});
  // §23: per-session plan mode + current plan-file path (bridge-notified; SURVIVES
  // respawn — the bridge re-emits hv.plan on session_start).
  const [planMode, setPlanMode] = useState<Record<string, { enabled: boolean; planPath?: string }>>({});
  // §23 round 9: the session's active plan, so a plan whose card was compacted
  // out of the transcript stays reachable. Seeded by openSession (survives a
  // renderer reload) and by the session_start hv.plan replay (survives a
  // respawn); kept live by hv:plan-changed.
  const [activePlan, setActivePlan] = useState<Record<string, PlanCardData>>({});
  // §13 round 6: global Plan-mode built-in toggle (Settings → All Tools). Drives
  // whether the composer chip/top-bar affordance render at all — main also
  // bails hv:plan-set/-implement/-discard when this is off (belt + suspenders,
  // main is the enforcement; this is so the chip isn't a dead click).
  const [planBuiltinOn, setPlanBuiltinOn] = useState(true);
  // §14 round 6: per-session skills — what the session LOADED (manifest, from
  // main) and which of them the agent actually reached for (hv.skill notifies).
  const [skillsLoaded, setSkillsLoaded] = useState<Record<string, Array<{ name: string; scope: string }>>>({});
  const [skillsUsed, setSkillsUsed] = useState<Record<string, string[]>>({});
  useEffect(() => { void window.hv.builtinsGet().then((b) => setPlanBuiltinOn(b.plan)); }, []);
  // §23: tool-call ids blocked by plan mode → their cards render "skipped".
  const planBlocked = useRef<Record<string, Set<string>>>({});
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
  const delegationsRef = useRef<Record<string, Record<string, DelegationRun>>>({});
  useEffect(() => { delegationsRef.current = delegations; }, [delegations]);
  const [error, setError] = useState<string | null>(null);
  // B7: onboarding wow-flow overlay. Shown once for a brand-new user's first
  // session (no prior sessions). Dismissing it is permanent — §7 round 8
  // deleted the Help entry, and §22 round 17 confirmed no re-open path.
  const [onboarding, setOnboarding] = useState(false);
  // W1.4: workspace whose settings modal is open (gear on a sidebar workspace row).
  const [wsSettings, setWsSettings] = useState<string | null>(null);
  // W2.2: center tabs (chat + open files), PER-WORKSPACE — switching sessions
  // within a workspace keeps them; another workspace has its own set. The
  // docked file-tree pane is a global toggle (closed by default).
  const [tabsByWs, setTabsByWs] = useState<Record<string, WorkspaceTabs>>({});
  // §26. Terminals live in MAIN; this is only what the view needs to label a
  // tab and decide whether closing it needs a confirm.
  const [terminals, setTerminals] = useState<Record<string, HvTerminalInfo>>({});
  /**
   * §26 part 2: the terminals each SESSION's agent started, and the only thing
   * about them the `terminals` map above does not already carry — the model's
   * intent and when it began. Title and running-state are read from that map,
   * which the push channel keeps live, so an exited terminal drops out of the
   * card stack with no extra bookkeeping.
   */
  const [agentTerms, setAgentTerms] = useState<Record<string, Record<string, { intent: string; startedAt: number }>>>({});
  /**
   * §28: every live browser pane, keyed by id. Main owns the panes and pushes
   * state (url/title/loading/blocked/crashed) — the renderer never derives it,
   * for the same reason the terminal map is main-fed: the pane outlives us.
   */
  const [browsers, setBrowsers] = useState<Record<string, HvBrowserInfo>>({});
  /**
   * §28: page-element comments waiting in a composer, per session. They STACK
   * (the user picks several, then decides when to send) — the composer's
   * existing attachment pattern, applied to a different kind of attachment.
   */
  const [pageRefs, setPageRefs] = useState<Record<string, Array<{ selector: string; label: string; outerHTML: string; comment: string; thumbnail?: string }>>>({});
  /**
   * §28: which SESSION owns each browser pane, learned from the `opened` notify
   * (which main sends for an adopted pane too, not just a created one).
   *
   * It decides where a page comment goes. Without it the comment went to
   * whichever chat was last clicked, which is usually — but not reliably — the
   * agent driving the page. A ⌘B pane has no owner and falls back to that chat.
   */
  const [browserOwners, setBrowserOwners] = useState<Record<string, string>>({});
  /**
   * §26 part 2: ending a session that started terminals asks, with two NAMED
   * outcomes. Silently killing a dev server because a chat closed is hostile;
   * silently leaking one is worse. Held as a promise resolver so the delete
   * flow can simply await the answer.
   */
  const [termConfirm, setTermConfirm] = useState<{
    terms: Array<{ id: string; title: string }>;
    resolve: (d: "stop" | "keep" | null) => void;
  } | null>(null);
  const [termSettings, setTermSettings] = useState<HvTerminalSettings | null>(null);
  /**
   * §27 round 2: voice settings live HERE, not inside useDictation.
   *
   * Same ownership as termSettings and for the same reason: several ChatViews
   * are mounted at once, and a hook-local fetch happens once at mount — so a
   * toggle on the Voice page would never reach a composer that was already
   * open. App owning it makes both toggles apply instantly, with no new
   * broadcast channel to keep in sync.
   */
  const [voiceSettings, setVoiceSettings] = useState<HvVoiceSettings | null>(null);
  // Gate the layout WRITER until the stored layout has been read back, or the
  // first render's empty {} would overwrite it before it ever loaded.
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  /**
   * Which workspace's tabs the center area shows. Its own state rather than a
   * projection of the selected session — see the note on `wsId` below for the
   * blank-center bug that caused.
   */
  /**
   * §26: seeded from localStorage, like the sidebar rail and the settings group
   * above — the active workspace is a pure UI cursor of exactly that class.
   *
   * This is load-bearing for the persisted layout rather than a nicety. Without
   * it a reload restored tabsByWs correctly and then rendered the WELCOME
   * screen, because `wsId` resolves through activeWs and there was nothing to
   * resolve: the tabs were all there, addressed to a workspace nobody was
   * looking at. Found in the GUI, not by a test — no unit could have seen it.
   */
  const [activeWs, setActiveWs] = useState<string | null>(() => localStorage.getItem("hv:active-ws"));
  useEffect(() => {
    if (activeWs) localStorage.setItem("hv:active-ws", activeWs);
  }, [activeWs]);
  /**
   * §7 round 13: ONE drawer, two panels, one at a time — the rail icon selects
   * which, and pressing the lit one closes it. Which panel is open is
   * remembered PER WORKSPACE: a branch bar and a file list are a place you were
   * working, and losing it on every workspace switch is a tax.
   */
  const [drawerByWs, setDrawerByWs] = useState<Record<string, DrawerPanel>>(() => {
    try {
      return JSON.parse(localStorage.getItem("hv:drawer-panel") ?? "{}") as Record<string, DrawerPanel>;
    } catch {
      return {};
    }
  });
  const drawerPanel: DrawerPanel | null = (activeWs && drawerByWs[activeWs]) || null;
  const setDrawerPanel = (panel: DrawerPanel | null): void => {
    if (!activeWs) return;
    setDrawerByWs((m) => {
      const next = { ...m };
      if (panel) next[activeWs] = panel;
      else delete next[activeWs];
      localStorage.setItem("hv:drawer-panel", JSON.stringify(next));
      return next;
    });
  };
  /** The rail's contract: press a panel to show it, press the lit one to close. */
  const toggleDrawer = (panel: DrawerPanel): void => setDrawerPanel(drawerPanel === panel ? null : panel);
  /**
   * Width is per PANEL, not per workspace and not shared: a tree of filenames
   * is comfortable at 256 while the Changes panel has a branch bar, a message
   * box, a file list, stashes and history to fit. Sharing one number is what
   * made Changes feel cramped when it was a tab in the file drawer.
   */
  const [drawerWidths, setDrawerWidths] = useState<Record<DrawerPanel, number>>(() => ({
    files: clampDrawer(Number(localStorage.getItem("hv:drawer-width:files")) || 256),
    changes: clampDrawer(Number(localStorage.getItem("hv:drawer-width:changes")) || 340),
  }));
  const drawerWidth = drawerWidths[drawerPanel ?? "files"];
  const setDrawerWidth = (px: number): void => {
    const panel = drawerPanel ?? "files";
    const w = clampDrawer(px);
    setDrawerWidths((prev) => ({ ...prev, [panel]: w }));
    localStorage.setItem(`hv:drawer-width:${panel}`, String(w));
  };
  // §29: the working tree's state for the ACTIVE workspace — a property of the
  // tree, deliberately not of any session, because several sessions can be
  // acting on the same files.
  const [gitStatus, setGitStatus] = useState<HvGitStatusPayload | null>(null);
  const [gitAvailable, setGitAvailable] = useState(true);
  const gitSummary = useMemo(() => summarise(gitStatus?.status?.files ?? []), [gitStatus]);
  // F6: collapsible sidebar (slim icon rail); persisted across launches.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("hv:sidebar-collapsed") === "1");
  useEffect(() => { localStorage.setItem("hv:sidebar-collapsed", sidebarCollapsed ? "1" : "0"); }, [sidebarCollapsed]);
  // §7 round 18: ⌘K opens the sidebar's session filter. A COUNTER, not a
  // boolean — pressing it twice must re-focus the field, and a boolean already
  // true fires no effect in the sidebar.
  const [searchNonce, setSearchNonce] = useState(0);
  // Round 8: the sidebar's Settings group, open or not — persisted like the rail.
  const [settingsOpen, setSettingsOpen] = useState(() => localStorage.getItem("hv:settings-open") === "1");
  useEffect(() => { localStorage.setItem("hv:settings-open", settingsOpen ? "1" : "0"); }, [settingsOpen]);
  // Round 8: shortcut bindings — defaults until config answers, then whatever
  // the user remapped on the shortcuts page.
  const [bindings, setBindings] = useState<Record<ShortcutId, string>>(() => resolveBindings(null));
  useEffect(() => { void window.hv.getShortcuts().then((m) => setBindings(resolveBindings(m))); }, []);

  // ── §26 Terminals ────────────────────────────────────────────────────────
  // Settings are global, so they load once and every mounted emulator reads
  // the same object.
  useEffect(() => { void window.hv.getTerminalSettings().then(setTermSettings); }, []);
  useEffect(() => { void window.hv.getVoiceSettings().then(setVoiceSettings); }, []);
  // Lifecycle pushes. A terminal that exits stays in the map with running:false
  // — §26 refuses to close a tab out from under someone, so the tab must be
  // able to keep rendering an inert one.
  useEffect(() => {
    const offTitle = window.hv.onTermTitle(({ id, title }) =>
      setTerminals((p) => (p[id] ? { ...p, [id]: { ...p[id]!, title } } : p)),
    );
    const offExit = window.hv.onTermExit(({ id, code }) =>
      setTerminals((p) => (p[id] ? { ...p, [id]: { ...p[id]!, running: false, exitCode: code } } : p)),
    );
    // §28: main pushes a whole BrowserInfo on every change (url, title, load
    // state, blocked host). Whole-state rather than deltas, like the voice
    // status broadcast — the pane is main's, so main's snapshot is the truth.
    const offBrowser = window.hv.onBrowserState((info) =>
      setBrowsers((p) => ({ ...p, [info.id]: info })),
    );
    const offBrowserClosed = window.hv.onBrowserClosed(({ id }) =>
      setBrowsers((p) => {
        if (!p[id]) return p;
        const next = { ...p };
        delete next[id];
        return next;
      }),
    );
    return () => { offTitle(); offExit(); offBrowser(); offBrowserClosed(); };
  }, []);
  // F6: global shortcuts. The handler closure is refreshed each render (reads
  // live wsId/tabs/newSession); a single listener reads it through the ref so we
  // don't re-subscribe every render. ⌘F/⌘S stay owned by chat/editor.
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const on = (e: KeyboardEvent): void => shortcutRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  // WS7: chat controls lifted from the removed ChatView header into the tab strip.
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [selStats, setSelStats] = useState<SessionStats | null>(null);
  // Cost ledger for the selected session — fetched on the same agent_end beat as
  // stats (see the effect below). Total comes from main, never re-summed here.
  const [costOpen, setCostOpen] = useState(false);
  const [selCalls, setSelCalls] = useState<{ calls: HvApiCall[]; total: HvLedgerTotal } | null>(null);
  // AGENTS.md editor — opened from the "+" menu (root) or the file tree (any path).
  const [agentsMd, setAgentsMd] = useState<string | null>(null); // relPath, or null = closed
  // bufferKey(ws, rel) → unsaved edits (feeds the tab-strip dirty dot; the
  // buffers themselves live in the always-mounted FileTab components).
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const seenOnboarding = useRef(true); // assume seen until config says otherwise
  const streaming = useRef<Record<string, boolean>>({});
  // Round 11: sessions whose turn the user aborted. Stop closes the bubble
  // immediately, but deltas still in flight land after that — while this is set
  // they merge into the committed bubble rather than starting a new one. Cleared
  // at agent_end.
  const aborted = useRef<Record<string, boolean>>({});
  /**
   * Round 15: when the in-flight turn started, per session — set on the user's
   * own send, read once at agent_end to stamp the duration onto the turn's last
   * assistant bubble. A ref rather than state: nothing renders from it until
   * the turn ends, so a re-render per turn would be pure waste. Restored
   * sessions get the same number computed main-side (restore.ts), from the
   * session file's own timestamps.
   */
  const turnStart = useRef<Record<string, number>>({});
  /**
   * Round 11: text pushed into a composer from outside it (the editor's "Send to
   * chat"). The nonce is what makes a repeat send of the SAME text still fire —
   * ChatView appends on nonce change. Same shape as the rewind-to-composer path;
   * no store and no event bus, matching how every other prop reaches ChatView.
   */
  const [composerInsert, setComposerInsert] = useState<{ sid: string; text: string; nonce: number } | null>(null);
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
  /** §7 round 16: the live reasoning's render mirror, flushed by the same rAF
   *  as streamText — thinking streams token by token like the answer does. */
  const [thinkingText, setThinkingText] = useState<Record<string, string>>({});
  const streamRef = useRef<Record<string, string>>({});
  // §7 round 16: the thinking buffer, separate from the text one so a thinking
  // block and an answer never merge into one bubble. Committed at
  // thinking_end — the block is collapsed, so nothing repaints per delta.
  const thinkRef = useRef<Record<string, string>>({});
  const rafRef = useRef<number | null>(null);
  // Stable, monotonic id per committed item (see appendItem) so Transcript can
  // key on identity instead of the array index and skip re-parsing.
  const idCounter = useRef(0);
  // Perf: toolCallId → position in transcripts[sid], so tool_execution_update/
  // _end update the card in O(1) instead of mapping the whole array.
  const toolIndex = useRef<Record<string, Map<string, number>>>({});
  /**
   * §12 (2026-08-30): asyncId → toolCallId, per session.
   *
   * Both ids are in hand at tool_execution_end and used to be discarded there.
   * The completion notify arrives minutes later carrying only the runId, so this
   * is the only way back to the transcript card — nothing else ever holds both
   * ids again. Never persisted: a reopened session's card is rebuilt by
   * restore.ts, which has the cost instead.
   */
  const asyncCards = useRef<Record<string, Map<string, string>>>({});
  /** Sessions with an openSession in flight — see hydrateSession. */
  const hydrating = useRef<Set<string>>(new Set());
  // Id of the in-progress "Compacting context…" notice per session, so
  // compaction_end resolves it in place ("Compaction complete") instead of
  // leaving a stale ongoing line + appending a second item.
  const compactionNotice = useRef<Record<string, number>>({});
  // Auto-retry (§ upstream errors): Pi emits message_end(error) on EVERY failed
  // attempt, then auto_retry_start/end around the backoff. We DEFER the hard
  // error card (pendingError) so a retried-and-recovered error shows only a
  // transient "Retrying…" notice; a real error card lands only on the final,
  // non-retried failure. retryNotice tracks the in-place notice id per session.
  const pendingError = useRef<Record<string, { raw: string; provider?: string; model?: string }>>({});
  const retryNotice = useRef<Record<string, number>>({});

  const appendItem = (sid: string, item: TranscriptItem): void =>
    setTranscripts((p) => {
      const items = p[sid] ?? [];
      const withId = { ...item, id: idCounter.current++ };
      if (withId.kind === "tool") {
        (toolIndex.current[sid] ??= new Map()).set(withId.card.toolCallId, items.length);
      }
      return { ...p, [sid]: [...items, withId] };
    });

  /**
   * Round 15 — stamp the finished turn's duration on its LAST assistant bubble.
   *
   * Called at agent_end, after commitStream has flushed the live bubble, so the
   * item it patches already exists. It walks back only to the turn's own user
   * message: a turn that ended on a tool card (the agent edits and says nothing)
   * has no bubble to carry the number, and gets none rather than having it put
   * somewhere it does not belong. Mirrors main's stampTurnDurations, which does
   * the same job for a restored session from the file's timestamps.
   */
  const stampTurnEnd = (sid: string): void => {
    const started = turnStart.current[sid];
    delete turnStart.current[sid];
    if (!started) return;
    const took = Date.now() - started;
    setTranscripts((p) => {
      const items = p[sid];
      if (!items) return p;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "user") return p; // reached this turn's start: no bubble
        if (it.kind !== "assistant") continue;
        const next = items.slice();
        next[i] = { ...it, turnMs: took };
        return { ...p, [sid]: next };
      }
      return p;
    });
  };

  // Upsert the per-session "Retrying…" notice in place (one notice spans all
  // attempts; text updates each attempt). Mirrors the compaction-notice pattern.
  const upsertRetryNotice = (sid: string, text: string, title?: string): void => {
    const existing = retryNotice.current[sid];
    if (existing === undefined) {
      retryNotice.current[sid] = idCounter.current; // id appendItem assigns next
      appendItem(sid, { kind: "notice", text, pending: true, title });
      return;
    }
    setTranscripts((p) => {
      const items = p[sid];
      if (!items) return p;
      const i = items.findIndex((it) => it.id === existing && it.kind === "notice");
      if (i < 0) return p;
      const next = items.slice();
      next[i] = { ...items[i], kind: "notice", text, pending: true, title };
      return { ...p, [sid]: next };
    });
  };
  // Resolve the retry notice: text=null removes it; a string leaves a settled
  // (non-pending) notice. Clears the tracked id either way.
  const resolveRetryNotice = (sid: string, text: string | null): void => {
    const id = retryNotice.current[sid];
    delete retryNotice.current[sid];
    if (id === undefined) return;
    setTranscripts((p) => {
      const items = p[sid];
      if (!items) return p;
      if (text === null) return { ...p, [sid]: items.filter((it) => it.id !== id) };
      const i = items.findIndex((it) => it.id === id && it.kind === "notice");
      if (i < 0) return p;
      const next = items.slice();
      next[i] = { ...items[i], kind: "notice", text, pending: false };
      return { ...p, [sid]: next };
    });
  };

  // §23: append a PlanCard for a plan path once (progress fills in via
  // onPlanChanged); no-op if a card for that path already exists in the session.
  const ensurePlanCard = (sid: string, wsId: string, planPath: string): void =>
    setTranscripts((p) => {
      const items = p[sid] ?? [];
      if (items.some((i) => i.kind === "plan" && i.card.path === planPath)) return p;
      const withId = { kind: "plan" as const, card: { sessionId: sid, workspaceId: wsId, path: planPath, status: "draft", done: 0, total: 0 }, id: idCounter.current++ };
      return { ...p, [sid]: [...items, withId] };
    });

  // §9 round 9: pull the pre-compaction history in for DISPLAY. It never
  // re-enters Pi's context — main reads the session file, sends nothing to the
  // client, and the items render dimmed under the out-of-context divider.
  const loadEarlier = async (sid: string): Promise<void> => {
    const earlier = await window.hv.loadEarlier(sid);
    setTranscripts((p) => {
      const items = p[sid] ?? [];
      if (items[0]?.kind !== "boundary" || items[0].loaded) return p;
      const restored: TranscriptItem[] = earlier.map((m) =>
        m.kind === "tool"
          ? {
              kind: "tool" as const,
              id: idCounter.current++,
              outOfContext: true,
              card: {
                toolCallId: m.toolCallId,
                toolName: m.toolName,
                args: m.args,
                status: m.error ? ("error" as const) : ("done" as const),
                result: m.result,
              },
            }
          // earlierItems never returns a plan card (the pill is that route), so
          // everything else here is a user/assistant text item.
          : { kind: m.kind as "user" | "assistant", text: (m as { text: string }).text, id: idCounter.current++, outOfContext: true },
      );
      const next = [...restored, { ...items[0], loaded: true }, ...items.slice(1)];
      // Prepending shifts EVERY position, so the whole index is rebuilt — a
      // stale one would make a late tool_execution_end patch the wrong card.
      const map = new Map<string, number>();
      next.forEach((it, i) => {
        if (it.kind === "tool") map.set(it.card.toolCallId, i);
      });
      toolIndex.current[sid] = map;
      return { ...p, [sid]: next };
    });
  };

  // §23: patch a PlanCard (status/progress) by path across sessions.
  const updatePlanCardByPath = (planPath: string, patch: Partial<{ status: string; done: number; total: number }>): void =>
    setTranscripts((p) => {
      let changed = false;
      const next: Record<string, TranscriptItem[]> = {};
      for (const [sid, items] of Object.entries(p)) {
        next[sid] = items.map((i) => {
          if (i.kind === "plan" && i.card.path === planPath) { changed = true; return { ...i, card: { ...i.card, ...patch } }; }
          return i;
        });
      }
      return changed ? next : p;
    });

  // Perf: coalesce text deltas to one React update per frame. Deltas accumulate
  // in streamRef; a single rAF mirrors the whole map into streamText.
  const scheduleFlush = (): void => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setStreamText({ ...streamRef.current });
      setThinkingText({ ...thinkRef.current });
    });
  };

  /**
   * §7 round 16 — settle the live reasoning into the transcript, collapsed.
   *
   * Called at the NEXT ACTION rather than at thinking_end: the model often
   * finishes thinking a beat before it starts answering, and collapsing in that
   * gap makes the block vanish while the user is still reading it. So the live
   * block stays up until the turn actually moves on — first answer token, first
   * tool call, or the end of the turn.
   */
  const commitThinking = (sid: string): void => {
    const thought = thinkRef.current[sid];
    delete thinkRef.current[sid];
    setThinkingText((p) => {
      if (!(sid in p)) return p;
      const next = { ...p };
      delete next[sid];
      return next;
    });
    if (thought?.trim()) appendItem(sid, { kind: "thinking", text: thought, ts: Date.now() });
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
    /**
     * §26: restore the tab layout.
     *
     * This is what makes a terminal survive ⌘R, and it is deliberately NOT a
     * terminal-specific path: the layout was React state only, so a reload
     * dropped chats and files too. Restoring only terminals would have made
     * the newest tab type the one that survives, which reads as a bug in the
     * other two.
     *
     * Sessions and live terminals are fetched FIRST because a tab that
     * outlives its subject renders nothing and cannot be closed — pruning
     * needs to know what is still real (layoutPersist.ts).
     */
    void (async () => {
      try {
        const [raw, sessionList, termList, browserList, wsList] = await Promise.all([
          window.hv.getLayout(),
          window.hv.listSessions(),
          window.hv.termList(),
          // §28: normally empty at boot — panes do not survive the app, so their
          // restored tabs must be pruned rather than shown as ghosts.
          window.hv.browserList(),
          // A workspace the user removed keeps its layout entry otherwise, and
          // its file tabs remount against a workspace main no longer knows.
          window.hv.listWorkspaces(),
        ]);
        setTerminals(Object.fromEntries(termList.map((t) => [t.id, t])));
        const layout = restoreLayout(raw, {
          sessions: new Set(sessionList.map((x) => x.id)),
          terminals: new Set(termList.map((t) => t.id)),
          browsers: new Set(browserList.map((b) => b.id)),
          workspaces: new Set(wsList),
        });
        setTabsByWs(layout);
        // Land on a workspace that actually has restored tabs. The remembered
        // one may have been removed, or emptied by pruning, while the app was
        // closed — in which case any restored workspace beats the welcome
        // screen, which is what the user would otherwise get with their tabs
        // sitting in state, invisible.
        const remembered = localStorage.getItem("hv:active-ws");
        const target = remembered && layout[remembered] ? remembered : Object.keys(layout)[0];
        if (target) {
          setActiveWs(target);
          // Re-select the focused pane's chat, so the sidebar highlight, the
          // context bubble and the cost pill point at something real.
          const active = layout[target]!.panes[layout[target]!.focused]?.active;
          const sid = active ? sessionOf(active) : null;
          if (sid) setSelectedId(sid);
        }
      } catch {
        /* a corrupt layout costs the tab arrangement, never the app */
      } finally {
        setLayoutLoaded(true);
      }
    })();
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

    // Async subagent lifecycle → sticky run cards. Cards are keyed by runId
    // (async) and coexist with foreground cards (keyed by toolCallId).
    const handleSubagentEvent = (sid: string, sub: SubagentEvent): void => {
      if (sub.stage === "started" && sub.runId) {
        const run: DelegationRun = {
          id: sub.runId,
          kind: "async",
          agent: sub.agent ?? "subagent",
          // runLabel, not sub.task: from pi-subagents 0.50 the event's own task is
          // redacted, and this caption must never show that. The bridge substitutes
          // the task it remembered from the tool call (hv-subagent-tasks.ts).
          label: runLabel(sub.task),
          startedAt: Date.now(),
          status: "running",
        };
        setDelegations((p) => ({ ...p, [sid]: { ...p[sid], [run.id]: run } }));
      } else if (sub.stage === "control" && sub.runId) {
        setDelegations((p) => {
          const run = p[sid]?.[sub.runId!];
          return run ? { ...p, [sid]: { ...p[sid], [sub.runId!]: { ...run, live: { ...run.live, activityState: sub.activityState } } } } : p;
        });
      } else if (sub.stage === "complete" && sub.runId) {
        const status = sub.status === "success" ? ("done" as const) : sub.status === "interrupted" ? ("interrupted" as const) : ("error" as const);
        setDelegations((p) => {
          const run = p[sid]?.[sub.runId!];
          return run ? { ...p, [sid]: { ...p[sid], [sub.runId!]: { ...run, status } } } : p;
        });
        // §12 (2026-08-30): the TRANSCRIPT card too, not only the sticky one. The
        // sticky card slides away in 2.5s; this one is the permanent record, and
        // it used to freeze at "running in the background" for the life of the
        // session — reported from a real session twenty minutes after the run
        // had finished.
        const cardId = asyncCards.current[sid]?.get(sub.runId!);
        if (cardId) {
          asyncCards.current[sid]?.delete(sub.runId!);
          const outcome = status === "done" ? ("done" as const) : status === "interrupted" ? ("stopped" as const) : ("failed" as const);
          // The run's last polled spend, which the sticky card already holds —
          // read BEFORE that card is torn down below.
          const finalCost = delegationsRef.current[sid]?.[sub.runId!]?.live?.cost;
          const idx = (toolIndex.current[sid] ??= new Map());
          setTranscripts((p) => ({
            ...p,
            [sid]: updateToolCard(p[sid] ?? [], idx, cardId, (card) => ({
              ...card,
              // A dispatched card is already "done" (the CALL succeeded). Only a
              // failed run changes it — the outcome word lives on `delegation`.
              status: outcome === "done" ? card.status : ("error" as const),
              delegation: { outcome, summary: sub.summary },
              cost: card.cost ?? finalCost,
            })),
          }));
        }
        // Hand-off notice: the actual result streams in on the triggered turn.
        // `sub.agent` is absent for a 0.50 workflow run (the bridge drops upstream's
        // generic "workflow"), so this reads "Subagent finished" rather than naming
        // a pipeline the user never asked for. The CARD still shows the real agent.
        appendItem(sid, { kind: "notice", text: `${sub.agent ?? "Subagent"} finished — delivering results…`, pending: false });
        setTimeout(() => {
          setDelegations((p) => {
            if (!p[sid]?.[sub.runId!]) return p;
            const next = { ...p[sid] };
            delete next[sub.runId!];
            return { ...p, [sid]: next };
          });
        }, 2_500);
      } else if (sub.stage === "active") {
        // Respawn resync: replace this session's async cards with the live set.
        const runs = sub.runs ?? [];
        setDelegations((p) => {
          const cur = p[sid] ?? {};
          const fg = Object.fromEntries(Object.entries(cur).filter(([, r]) => r.kind === "fg"));
          const async: Record<string, DelegationRun> = {};
          for (const x of runs) {
            const existing = cur[x.runId];
            async[x.runId] = existing ?? {
              id: x.runId, kind: "async", agent: x.agent ?? "subagent", label: runLabel(x.task), startedAt: Date.now(), status: "running",
            };
          }
          return { ...p, [sid]: { ...fg, ...async } };
        });
      } else if (sub.stage === "interrupt-sent" && sub.runId) {
        setDelegations((p) => {
          const run = p[sid]?.[sub.runId!];
          return run ? { ...p, [sid]: { ...p[sid], [sub.runId!]: { ...run, status: "interrupted" } } } : p;
        });
      }
    };

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
      // §23: plan-mode toggle + plan-ready card + skipped-tool marking.
      const pl = parsePlan(r);
      if (pl !== null && r.sessionId) {
        const sid = r.sessionId;
        setPlanMode((p) => ({ ...p, [sid]: pl }));
        const wsId = sessionsRef.current.find((s) => s.id === sid)?.workspaceId;
        // Only a LIVE plan_complete appends a card — the bottom is the right
        // place for it then. The session_start replay (`restored`) must not:
        // that card belongs at its position in rebuilt history, and if
        // compaction dropped the plan_complete from context it should not
        // reappear at all. Appending it anyway produced a misplaced card frozen
        // at "draft" that claimed an implemented plan was still pending.
        if (pl.planPath && wsId && !pl.restored) ensurePlanCard(sid, wsId, pl.planPath);
        // A LIVE plan_complete is genuinely a fresh draft, so seeding "draft"
        // here is a fact, not a guess. A RESTORED plan's status is unknown from
        // the notify alone — main pushes it via hv:plan-changed (with sessionId)
        // rather than letting the pill invent one.
        if (pl.planPath && wsId && !pl.restored) {
          const path = pl.planPath;
          setActivePlan((p) =>
            p[sid]?.path === path ? p : { ...p, [sid]: { sessionId: sid, workspaceId: wsId, path, status: "draft", done: 0, total: 0 } },
          );
        }
      }
      const pb = parsePlanBlocked(r);
      if (pb && r.sessionId) {
        const sid = r.sessionId;
        (planBlocked.current[sid] ??= new Set()).add(pb.toolCallId);
        const idx = toolIndex.current[sid] ??= new Map();
        setTranscripts((p) => ({ ...p, [sid]: updateToolCard(p[sid] ?? [], idx, pb.toolCallId, (card) => ({ ...card, status: "skipped" as const })) }));
      }
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
        // Async subagents: lifecycle relays drive the sticky run cards (fire-and-
        // forget; never open the modal). The completion also arrives as a
        // triggered assistant turn — this just manages the card + a flow notice.
        const sub = parseSubagentEvent(r);
        if (sub) handleSubagentEvent(sid, sub);
        // §26 part 2: an agent terminal opened or was killed. Fire-and-forget,
        // like the subagent relays — it drives the sticky card, never a modal.
        const termEv = parseTerminalEvent(r);
        if (termEv) {
          if (termEv.stage === "started" && termEv.terminalId) {
            const { terminalId, title } = termEv;
            // The card needs the terminal in the shared map straight away: main
            // pushes title/exit updates for it, but never an initial record.
            setTerminals((p) =>
              p[terminalId]
                ? p
                : {
                    ...p,
                    [terminalId]: {
                      id: terminalId,
                      workspaceId: termEv.workspaceId ?? "",
                      title: title ?? "",
                      running: true,
                      exitCode: null,
                    },
                  },
            );
            setAgentTerms((p) => ({
              ...p,
              [sid]: { ...(p[sid] ?? {}), [terminalId]: { intent: termEv.intent ?? "", startedAt: Date.now() } },
            }));
          } else if (termEv.terminalId) {
            dropAgentTerminal(sid, termEv.terminalId);
          }
        }
        // §28: the agent opened/navigated/acted in its browser. The pane itself
        // is main's; what the renderer does here is make it VISIBLE — a tab
        // placed so it never covers the chat the agent is talking in.
        const browserEv = parseBrowserEvent(r);
        if (browserEv?.browserId) {
          const bid = browserEv.browserId;
          if (browserEv.stage === "opened") {
            setBrowserOwners((p) => ({ ...p, [bid]: sid }));
            const ws = browserEv.workspaceId ?? activeWs;
            if (ws) {
              setTabsByWs((p) => ({ ...p, [ws]: openBrowserTab(p[ws] ?? emptyTabs, bid, chatTab(sid)) }));
              setActiveWs(ws);
              setView("chat");
            }
            void window.hv.browserGet(bid).then((info) => {
              if (info) setBrowsers((p) => ({ ...p, [bid]: info }));
            });
          } else if (browserEv.stage === "closed") {
            setBrowserOwners((p) => {
              const next = { ...p };
              delete next[bid];
              return next;
            });
            setBrowsers((p) => {
              const next = { ...p };
              delete next[bid];
              return next;
            });
            const ws = browserEv.workspaceId ?? activeWs;
            if (ws) {
              setTabsByWs((p) => {
                const t = p[ws] ?? emptyTabs;
                const slot = paneOf(t, browserTab(bid));
                return slot < 0 ? p : { ...p, [ws]: closeTab(t, slot, browserTab(bid)) };
              });
            }
          }
        }
        // §14: raw-read fallback — the model loaded a skill by reading SKILL.md
        // instead of use_skill. Surface a lightweight notice (the use_skill happy
        // path already renders as its own tool card, so only detected reads here).
        if (r.method === "notify") {
          try {
            const p = JSON.parse(r.message ?? "") as {
              kind?: string;
              name?: string;
              detected?: boolean;
              typed?: string;
              expanded?: string;
            };
            // §24: Pi expanded a prompt template. The bubble on screen holds
            // either the typed text (idle send) or the expansion (steered via
            // queue_update) depending on a race the user never chose, so fold
            // the pairing in and let both collapse to the same card.
            if (p?.kind === "hv.prompt-template" && p.typed && p.expanded) {
              const pair = { typed: p.typed, expanded: p.expanded };
              setTranscripts((prev) => {
                const cur = prev[sid] ?? [];
                const next = applyPromptTemplatePair(cur, pair);
                // Identity means nothing matched — skip the re-render.
                return next === cur ? prev : { ...prev, [sid]: next };
              });
            }
            if (p?.kind === "hv.skill" && p.name) {
              // Round 6: track EVERY invocation for the top-bar chip's "used"
              // marks — the use_skill happy path (detected:false) used to be
              // dropped here, so nothing outside its tool card knew it happened.
              setSkillsUsed((prev) => {
                const cur = prev[sid];
                if (cur?.includes(p.name!)) return prev;
                return { ...prev, [sid]: [...(cur ?? []), p.name!] };
              });
              // The transcript notice stays for the raw-read heuristic ONLY: the
              // use_skill path already renders its own tool card.
              if (p.detected) {
                appendItem(sid, { kind: "notice", text: `Loaded skill “${p.name}” by reading it directly` });
              }
            }
          } catch {
            /* not JSON — ignore */
          }
        }
      }
    });

    const offSubStatus = window.hv.onSubagentStatus(({ sessionId, runId, status, cost }) => {
      setDelegations((p) => {
        const run = p[sessionId]?.[runId];
        if (!run) return p;
        const live = {
          currentTool: status.currentTool as string | undefined,
          activityState: status.activityState as string | undefined,
          turnCount: status.turnCount as number | undefined,
          recentTools: status.recentTools as Array<{ tool: string; args?: string }> | undefined,
          // Keep the last figure when a tick arrives without one: a stopped or
          // finishing run must freeze on what it cost, never blank back to
          // nothing after having shown a number.
          cost: cost ?? run.live?.cost,
          // Same keep-the-last rule as cost, for the same reason: this object is
          // REBUILT on every push, so a field omitted here is silently dropped
          // on the next tick rather than merged.
          context: (status.context as { window: number; limit: number } | undefined) ?? run.live?.context,
          // main calls these `steps` (upstream's own word); the card calls them
          // children. Same keep-the-last rule as the two above.
          children: (status.steps as DelegationChild[] | undefined) ?? run.live?.children,
        };
        return { ...p, [sessionId]: { ...p[sessionId], [runId]: { ...run, live } } };
      });
    });

    // §23: live plan-file progress (checklist n/m + status) from the fs watcher.
    const offPlanChanged = window.hv.onPlanChanged(({ sessionId, workspaceId, path, status, done, total }) => {
      updatePlanCardByPath(path, { status, done, total });
      // Keep the active-plan pill live. When main tags the push with a
      // sessionId (the respawn path) this also CREATES the entry — that is how
      // a restored plan reaches the pill with its real status instead of a
      // guessed "draft".
      setActivePlan((p) => {
        let changed = false;
        const next: Record<string, PlanCardData> = {};
        for (const [sid, card] of Object.entries(p)) {
          if (card.path === path) { changed = true; next[sid] = { ...card, status, done, total }; }
          else next[sid] = card;
        }
        if (sessionId && !next[sessionId]) {
          changed = true;
          next[sessionId] = { sessionId, workspaceId, path, status, done, total };
        }
        return changed ? next : p;
      });
    });

    const offPiExit = window.hv.onPiExit(({ sessionId, code, intentional, stderr }) => {
      // Dead Pi: its prompts are unanswerable and dangerous mode never survives a respawn.
      setUiQueue((q) => dropSession(q, sessionId));
      setDangerous((p) => ({ ...p, [sessionId]: false }));
      setBusy((p) => ({ ...p, [sessionId]: false }));
      // Dead Pi won't emit tool_execution_end — drop any dangling FOREGROUND
      // delegation cards. Async (detached) runs survive the process; a resume
      // re-syncs their cards via /hv-subagent-list.
      setDelegations((p) => {
        const cur = p[sessionId];
        if (!cur) return p;
        const kept = Object.fromEntries(Object.entries(cur).filter(([, r]) => r.kind === "async"));
        return { ...p, [sessionId]: kept };
      });
      if (!intentional) {
        setCrashCodes((p) => ({ ...p, [sessionId]: code ?? -1 }));
        // B2: crash lands in the transcript too, with a retriable action.
        // Round 12: and with the child's stderr tail, when there is one. A bare
        // exit code sent people to a terminal to find out what the app already
        // knew — the launcher/Node mismatch that motivated this printed a
        // perfectly clear SyntaxError that never reached the window.
        appendItem(sessionId, {
          kind: "error",
          text: `The session crashed (code ${code ?? -1}).`,
          retriable: true,
          detail: stderr || undefined,
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
      // pi-subagents' wait tool is always intercepted by the bridge in HappyVibe
      // (async results auto-deliver as a new turn), so it never does anything
      // useful — hide its card entirely instead of showing a scary blocked-tool
      // error. Name-matched via the shared set, because upstream renamed it once
      // already (`wait` → `subagent_wait`, no alias) and a literal here silently
      // starts rendering the card again.
      if (isWaitTool((e as { toolName?: string }).toolName)) return;
      // §23: plan-mode tools are internal transitions — the PlanCard/banner
      // represent them, so never render them as raw tool cards.
      if (PLAN_TOOL_NAMES.has((e as { toolName?: string }).toolName ?? "")) return;
      // A `subagent` call that only INSPECTS a run (`{action:"status"}`) is the
      // model polling its own machinery, not work the user asked for. It used to
      // draw a delegation card with no agent and no task — literally "→ asked ?".
      // Hidden for the same reason as the wait tool above; the delegation, its
      // result and any artifact read all still show.
      if (
        isSubagentTool((e as { toolName?: string }).toolName)
        && isSubagentQuery((e as { args?: unknown }).args)
      ) return;
      // §7 round 16: a tool call IS the next action — settle the reasoning that
      // chose it, so the collapsed block sits above the card it produced.
      if (e.type === "tool_execution_start") {
        commitThinking(sid);
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
        // Raised as "fg"; if the delegation turns out async (tool_execution_end
        // carries details.asyncId) this card is dropped and the async card
        // (keyed by runId, raised by the hv.subagent `started` notify) takes over.
        if (isSubagentTool(t.toolName)) {
          const run: DelegationRun = {
            id: t.toolCallId,
            kind: "fg",
            toolCallId: t.toolCallId,
            agent: (t.args as { agent?: string } | undefined)?.agent ?? "subagent",
            label: delegationLabel(t.args),
            startedAt: Date.now(),
            status: "running",
          };
          setDelegations((p) => ({ ...p, [sid]: { ...p[sid], [run.id]: run } }));
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
        // §23: a plan-mode block arrives as an error end — keep it calm ("skipped").
        const blocked = planBlocked.current[sid]?.has(t.toolCallId);
        if (blocked) planBlocked.current[sid]?.delete(t.toolCallId);
        const idx = toolIndex.current[sid] ??= new Map();
        setTranscripts((p) => ({
          ...p,
          [sid]: updateToolCard(p[sid] ?? [], idx, t.toolCallId, (card) => ({
            ...card,
            status: blocked ? ("skipped" as const) : t.isError ? ("error" as const) : ("done" as const),
            result: t.result,
            // The end lacks the transcript — merge the outcome onto the
            // live trace so messages captured during _update survive.
            ...(isSub ? { trace: mergeTrace(card.trace, traceFromEnd(t.result)) } : {}),
          })),
        }));
        if (isSub) {
          // Async dispatch: this tool call returned immediately (details.asyncId).
          // RE-KEY the card from toolCallId to runId rather than dropping it and
          // waiting for the bridge's `started` notify to raise a fresh one.
          //
          // pi-subagents 0.50 made that notify unreliable: every top-level
          // delegation now runs as mode:"workflow" (its legacy single/chain/parallel
          // entry points were removed), and the workflow path emits only
          // `subagent:async-complete` — never `subagent:async-started`. Measured
          // twice with a probe extension: the handler never fires. (0.55 unwrapped
          // single-child launches, so at 0.58 the notify DOES fire again — the
          // re-key still wins because the notify carries no toolCallId and so
          // cannot caption two same-agent runs apart. See d1.md §0.58.) Raising
          // the card from the notify therefore showed the user NOTHING for the whole run,
          // then dropped the result in — the opposite of PRD §12's "watch it run
          // while you keep chatting".
          //
          // Everything the card needs is already here and is NOT redacted: the
          // runId is details.asyncId, and this card already carries the real task
          // and agent from tool_execution_start's original args. So the conversion
          // is strictly more robust than the notify AND survives whichever path
          // upstream takes next. The `started` handler stays as belt-and-braces
          // (it still fires for nested/single runs) and is idempotent against this.
          const detached = asyncResultInfo(t.result);
          if (detached) {
            // §12 (2026-08-30): the ONE moment both ids exist together. The
            // completion notify carries only the runId, so without this the
            // transcript card froze at "running in the background" forever.
            (asyncCards.current[sid] ??= new Map()).set(detached.asyncId, t.toolCallId);
            setDelegations((p) => {
              const fg = p[sid]?.[t.toolCallId];
              if (!fg) return p;
              const next = { ...p[sid] };
              delete next[t.toolCallId];
              // Keep an already-raised async card (its status/live fields), but the
              // TASK and AGENT come from THIS card: `fg` took them from
              // tool_execution_start's own args, which are exact per call. The
              // notify's caption is a best-effort pairing — `subagent:async-started`
              // carries no tool call id, so with two same-agent delegations in one
              // turn it cannot tell them apart. Letting it win is what captioned a
              // Beat Saber run "Minesweeper" (2026-08-29); the store now declines to
              // guess, and this prefers the value that was never a guess.
              const raised = next[detached.asyncId];
              next[detached.asyncId] = raised
                ? { ...raised, label: fg.label || raised.label, agent: fg.agent || raised.agent }
                : { ...fg, id: detached.asyncId, kind: "async", status: "running" };
              return { ...p, [sid]: next };
            });
          } else {
            // Foreground (async:false): mark done/failed — the card shows the
            // outcome briefly, then slides away; remove after the animation.
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
      }
      const ame = (e as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (e.type === "message_update" && ame?.type === "text_delta" && ame.delta) {
        // Round 11: Stop already closed this bubble, but the abort is still in
        // flight (renderer → main → child stdin), so late deltas land here. Merge
        // them into the bubble we just committed instead of opening a second one.
        if (aborted.current[sid]) {
          const delta = ame.delta;
          setTranscripts((p) => ({ ...p, [sid]: mergeIntoLastAssistant(p[sid] ?? [], delta) }));
          return;
        }
        // Perf: accumulate in the ref (O(1)) and repaint one live bubble per
        // frame — no transcript-array copy, no committed-markdown re-parse.
        // The turn has moved on to the answer — settle the reasoning first, so
        // the collapsed block lands ABOVE the bubble it produced.
        if (!streaming.current[sid]) commitThinking(sid);
        streamRef.current[sid] = applyDelta(streamRef.current, sid, ame.delta, streaming.current[sid]);
        streaming.current[sid] = true;
        scheduleFlush();
      }
      // §7 round 16 — the agent's own reasoning, streamed live.
      //
      // Pi already emits these three on the same channel as text_delta
      // (json-event.js forwards the event untouched); the app simply never read
      // them. They accumulate in thinkRef and mirror into thinkingText on the
      // SAME rAF as the answer, so a long think shows its reasoning as it
      // happens instead of a spinner. thinking_end does NOT commit — see
      // commitThinking for why the next action does.
      if (e.type === "message_update" && ame?.type === "thinking_start") {
        thinkRef.current[sid] = "";
        scheduleFlush();
      }
      if (e.type === "message_update" && (ame?.type === "thinking_delta" || ame?.type === "thinking") && ame.delta) {
        thinkRef.current[sid] = (thinkRef.current[sid] ?? "") + ame.delta;
        scheduleFlush();
      }
      // A triggered turn (e.g. an async subagent completion delivering its
      // result) starts without a local send, so mark busy here too — otherwise
      // the composer would send a fresh prompt instead of steering into it.
      if (e.type === "agent_start") {
        setBusy((p) => (p[sid] ? p : { ...p, [sid]: true }));
      }
      if (e.type === "agent_end") {
        // A turn that thought and then said nothing still keeps its reasoning.
        commitThinking(sid);
        commitStream(sid); // finalize the live bubble into the transcript
        stampTurnEnd(sid); // round 15: "· 34s" on that bubble, now that it exists
        delete aborted.current[sid]; // the abort window closes with the turn
        // Flush a deferred provider error that was NOT retried (or exhausted its
        // retries) as the single hard error card for the turn.
        const err = pendingError.current[sid];
        if (err) {
          delete pendingError.current[sid];
          // Raw provider text ("529 status code (no body)") tells the user
          // nothing about whether to wait, fix a key, or fix a setting. Map it,
          // and offer a plain resend for the transient classes — Pi's own retry
          // list omits 529, so this button is the only way out of one.
          const info = describeProviderError(err.raw, { provider: err.provider, model: err.model });
          appendItem(sid, {
            kind: "error",
            text: info.headline,
            hint: info.hint,
            retriable: info.retriable,
            retryLabel: info.retriable ? "Retry" : undefined,
          });
        }
        setBusy((p) => ({ ...p, [sid]: false }));
        setTurns((p) => ({ ...p, [sid]: (p[sid] ?? 0) + 1 }));
      }
      // Auto-retry around a transient provider error (Pi retries with backoff).
      // Show it as a live notice instead of a frozen-looking gap; the deferred
      // hard error card only lands if all retries are exhausted (agent_end).
      if (e.type === "auto_retry_start") {
        const r = e as unknown as { attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string };
        delete pendingError.current[sid]; // this failure is being retried, not final
        commitStream(sid);
        // Round 16: the pill carries a bounded chip; the provider's own words
        // ride the hover title. If the retries exhaust, they land in the error
        // card at agent_end, which is built to carry them.
        upsertRetryNotice(sid, retryNoticeText(r), r.errorMessage);
      }
      if (e.type === "auto_retry_end") {
        const r = e as unknown as { success?: boolean; attempt?: number };
        if (r.success) resolveRetryNotice(sid, `Recovered after ${r.attempt ?? 1} ${((r.attempt ?? 1) === 1) ? "retry" : "retries"}`);
        else resolveRetryNotice(sid, null); // exhausted — the error card (agent_end) tells the story
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
          // A steer delivered mid-turn does NOT restart the clock: the turn
          // the user is waiting on is still the one that began with their
          // first prompt, and resetting here would report it as shorter.
          appendItem(sid, { kind: "user", text, ts: Date.now() });
        }
      }
      // B2: provider errors (model call failed) as distinct transcript items.
      // "aborted" is the user's own Stop — no error item for that. We DEFER the
      // card: Pi fires message_end(error) on every failed attempt, so committing
      // it now would stack a red card per retry. Hold it; agent_end flushes it if
      // the turn ultimately failed, while auto_retry_start clears it on a retry.
      if (e.type === "message_end") {
        const m = (e as {
          message?: { role?: string; stopReason?: string; errorMessage?: string; provider?: string; model?: string };
        }).message;
        if (m?.role === "assistant" && m.stopReason === "error") {
          commitStream(sid); // flush any partial bubble before the (deferred) error
          // Keep the provider and model alongside the text: some providers answer
          // a failure with a word ("ERROR", "terminated") and nothing else, and
          // then the only way to say anything useful is to name what failed.
          pendingError.current[sid] = {
            raw: m.errorMessage || "The model call failed.",
            ...(m.provider ? { provider: m.provider } : {}),
            ...(m.model ? { model: m.model } : {}),
          };
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

    // An extension asked for a prompt HappyVibe has no UI for. Main already
    // denied it so the extension isn't left hanging; say so rather than letting
    // it look like nothing happened.
    const offUiUnhandled = window.hv.onUiUnhandled(({ sessionId }) => {
      appendItem(sessionId, {
        kind: "notice",
        text: "An extension asked something HappyVibe can't display — denied.",
      });
    });

    return () => {
      offSessions();
      offUiRequest();
      offPiExit();
      offPiEvent();
      offPlanChanged();
      offReloading();
      offUiUnhandled();
      offSubStatus();
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
    setActiveWs(wsId); // the layout being filled is this workspace's
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

  const watchedWsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const want = watchTargets(tabsByWs, activePlan);
    const have = watchedWsRef.current;
    for (const w of want) if (!have.has(w)) void window.hv.watchWorkspace(w).catch(() => {});
    for (const w of have) if (!want.has(w)) void window.hv.unwatchWorkspace(w).catch(() => {});
    watchedWsRef.current = want;
  }, [tabsByWs, activePlan]);

  /**
   * §29 1b: the branch under every workspace row. Cheap by construction — one
   * `git status` per workspace at mount, then main's `.git` watch pushes when a
   * branch moves, including one switched in an outside terminal (the file-tree
   * watcher filters `.git`, so nothing else would ever notice).
   */
  const [gitBranches, setGitBranches] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    const load = (ws: string): void => {
      void window.hv.gitStatus(ws).then((p) => {
        if (!alive) return;
        setGitBranches((m) => ({ ...m, [ws]: p.status?.branch.branch ?? null }));
      }).catch(() => {});
    };
    for (const ws of workspaces) load(ws);
    const off = window.hv.onGitChanged(({ workspaceId }) => load(workspaceId));
    return () => { alive = false; off(); };
  }, [workspaces]);

  const gitInfo = useMemo(() => {
    const out: Record<string, { branch: string | null; changes: number | null; tint: "green" | "amber" }> = {};
    for (const ws of workspaces) {
      out[ws] = {
        branch: gitBranches[ws] ?? null,
        changes: ws === activeWs ? gitSummary.files : null,
        tint: ws === activeWs ? badgeTint(gitSummary.changedLines) : "green",
      };
    }
    return out;
  }, [workspaces, gitBranches, activeWs, gitSummary]);

  /**
   * §29: the working tree of the ACTIVE workspace. Refetched when the workspace
   * changes and whenever main pushes hv:git-changed — which it fires from the fs
   * watcher, the narrow `.git` watch and turn end, suppressing the first two
   * while a session here is busy. The renderer therefore never polls.
   *
   * Only the active workspace runs a `git status`; the sidebar's other rows get
   * a branch name only, because a status sweep of every repo at boot is a cost
   * nobody asked for.
   */
  useEffect(() => {
    if (!activeWs) {
      setGitStatus(null);
      return;
    }
    let alive = true;
    const refresh = (): void => {
      void window.hv.gitStatus(activeWs).then((p) => {
        if (!alive) return;
        setGitStatus(p);
        setGitAvailable(p.state.kind !== "no-git");
      }).catch(() => {});
    };
    refresh();
    const off = window.hv.onGitChanged(({ workspaceId }) => {
      if (workspaceId === activeWs) refresh();
    });
    return () => {
      alive = false;
      off();
    };
  }, [activeWs]);

  // WS7: session context stats for the tab-strip bubble + panel, plus the cost
  // ledger for the spend pill. Both fetched once per agent_end (turns bump),
  // debounced; reset search/context/cost on session switch. Settling on
  // agent_end is deliberate: Pi only writes a call's usage once the message
  // lands, so there is no honest intra-turn number to show.
  useEffect(() => {
    setSearchOpen(false);
    setContextOpen(false);
    setCostOpen(false);
    if (!selectedId) { setSelStats(null); setSelCalls(null); return; }
    let live = true;
    const t = setTimeout(() => {
      window.hv.getStats(selectedId).then((s) => live && setSelStats(s as SessionStats | null));
      window.hv.getSessionCalls(selectedId).then((c) => live && setSelCalls(c)).catch(() => {});
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [selectedId, selectedId ? turns[selectedId] : 0]);

  // §14 round 6: the session's LOADED skill set comes from main's per-session
  // manifest (the exact dirs passed to Pi as --skill). Re-fetched when the
  // skills config changes, since that respawns sessions with a new manifest.
  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    const load = (): void => {
      void window.hv.skillsSession(selectedId).then((s) => { if (live) setSkillsLoaded((p) => ({ ...p, [selectedId]: s })); });
    };
    load();
    const off = window.hv.onSkillsChanged(load);
    return () => { live = false; off(); };
  }, [selectedId]);

  /**
   * §12 (2026-08-29): fetch the agent roster per session, for the composer's
   * `@agent` menu and the delegate chip.
   *
   * It used to be requested ONLY by AgentsView on mount, which made both
   * affordances empty until the user had visited the settings page — precisely
   * the user the "delegate from the flow" item exists for. Same shape as the
   * skills effect above; the reply arrives as an hv.agents notify.
   */
  useEffect(() => {
    if (!selectedId) return;
    void window.hv.listAgents(selectedId);
  }, [selectedId]);

  /**
   * §26: persist the layout. Debounced, because a divider drag fires this on
   * every animation frame and config.json is a whole-file rewrite.
   *
   * Gated on layoutLoaded: the first render's `{}` would otherwise land before
   * the stored layout had been read, wiping it on every launch.
   */
  useEffect(() => {
    if (!layoutLoaded) return;
    const id = setTimeout(() => {
      void window.hv.setLayout(tabsByWs as unknown as Record<string, unknown>).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [tabsByWs, layoutLoaded]);

  /**
   * §26 part 2: this session's terminal no longer belongs on its card stack —
   * it was killed, or the human promoted it to a tab. The PTY's own fate is
   * decided elsewhere; this only forgets the card.
   */
  const dropAgentTerminal = (sid: string, terminalId: string): void =>
    setAgentTerms((p) => {
      const forSession = p[sid];
      if (!forSession?.[terminalId]) return p;
      const { [terminalId]: _gone, ...rest } = forSession;
      return { ...p, [sid]: rest };
    });

  /**
   * §26 part 2: the human moves an agent terminal into a tab of its own. The
   * agent NEVER does this — that invariant is the reason the card exists. The
   * PTY is untouched: the tab just attaches a fresh emulator to main's buffer.
   */
  const openAgentTerminalAsTab = (sid: string, ws: string, terminalId: string): void => {
    setTabsByWs((p) => ({ ...p, [ws]: openTerminal(p[ws] ?? emptyTabs, terminalId) }));
    dropAgentTerminal(sid, terminalId);
    setActiveWs(ws);
    setView("chat");
  };

  /**
   * §26 part 2: ask before ending a session that still has terminals running.
   * Returns undefined when there are none, so a session without terminals ends
   * exactly as it did before — no extra click for the common case.
   */
  const askAboutTerminals = async (sid: string): Promise<"stop" | "keep" | null | undefined> => {
    const terms = await window.hv.sessionTerminals(sid).catch(() => []);
    if (!terms.length) return undefined;
    return new Promise((resolve) => setTermConfirm({ terms, resolve }));
  };

  /** §26: open a terminal in the focused pane of `ws`. ⌘T and the `+` menu. */
  const newTerminal = async (ws: string): Promise<void> => {
    try {
      const info = await window.hv.termCreate(ws);
      setTerminals((p) => ({ ...p, [info.id]: info }));
      setTabsByWs((p) => ({ ...p, [ws]: openTerminal(p[ws] ?? emptyTabs, info.id) }));
      setActiveWs(ws);
      setView("chat");
    } catch (err) {
      surface(err);
    }
  };

  /**
   * §28: open a browser in the focused pane of `ws`. ⌘B and the `+` menu.
   *
   * Mirrors newTerminal exactly, with one difference that matters: the pane is
   * created BLANK (browsers.create starts at url: "") so the URL bar takes focus
   * and the human types where they want to go — a human-opened browser has no
   * destination to guess, unlike the agent's, which always opens ON something.
   */
  const newBrowser = async (ws: string): Promise<void> => {
    try {
      const info = await window.hv.browserCreate(ws);
      setBrowsers((p) => ({ ...p, [info.id]: info }));
      // No tab to avoid: this opens where the human asked — the focused pane,
      // which the caller (⌘B or a specific pane's `+`) has just set. The AGENT's
      // call passes the chat tab instead, and only that path does placement.
      setTabsByWs((p) => ({ ...p, [ws]: openBrowserTab(p[ws] ?? emptyTabs, info.id) }));
      setActiveWs(ws);
      setView("chat");
    } catch (err) {
      surface(err);
    }
  };

  /**
   * §26: close a terminal tab, which KILLS its PTY — a terminal tab IS its
   * terminal. That is why this confirms where closing a chat tab does not: a
   * chat tab only stops showing a session that keeps running.
   */
  const closeTerminalTab = async (ws: string, paneIdx: number, tab: TabId): Promise<void> => {
    const id = terminalOf(tab);
    if (!id) return;
    const info = terminals[id];
    // Ask main rather than trusting the cached title: the poll is 500ms and a
    // confirm must not be decided by a stale label.
    if (info?.running && termSettings?.confirmCloseRunning) {
      const running = await window.hv.termForeground(id).catch(() => null);
      if (running && !window.confirm(`${running} is still running. Close anyway?`)) return;
    }
    await window.hv.termClose(id).catch(() => {});
    setTerminals((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    setTabsByWs((p) => ({ ...p, [ws]: closeTab(p[ws] ?? emptyTabs, paneIdx, tab) }));
  };

  /**
   * §28: closing a browser tab DESTROYS its pane — a browser tab IS its browser,
   * exactly like a terminal tab.
   *
   * Round 15: it asks first when the session DRIVING it is mid-turn. Normally
   * there is nothing to confirm — nothing is running, nothing is unsaved, and
   * the page is one navigation away from coming back — but pulling the pane out
   * from under an agent that is reading it fails its turn, and now that ⌘W
   * reaches this tab type the close is one reflex keystroke away. A pane nobody
   * owns (⌘B) still closes silently, which is most of them.
   */
  const closeBrowserTab = (ws: string, paneIdx: number, tab: TabId): void => {
    const id = browserOf(tab);
    if (!id) return;
    const owner = browserOwners[id];
    if (owner && busy[owner]) {
      const title = sessions.find((s) => s.id === owner)?.title ?? "A session";
      if (!window.confirm(`${title} is using this browser right now. Close it anyway?`)) return;
    }
    void window.hv.browserClose(id).catch(() => {});
    setBrowsers((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    setTabsByWs((p) => ({ ...p, [ws]: closeTab(p[ws] ?? emptyTabs, paneIdx, tab) }));
  };

  const closeFileTab = (wsId: string, paneIdx: number, tab: TabId): void => {
    // A chat closes via closeChatTab, a terminal via closeTerminalTab and a
    // browser via closeBrowserTab — each has different semantics (a chat keeps
    // running, a terminal dies, a browser pane is destroyed).
    if (isChatTab(tab) || isTermTab(tab) || isBrowserTab(tab)) return;
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
  /**
   * Round 11: close a chat tab. The SESSION keeps running (hibernation and the
   * sidebar own its lifecycle, §17) — this only stops showing it, which is why
   * there is no confirm and nothing is deleted.
   */
  /**
   * Round 11: get a session to run the skill creator in AND leave the user on its
   * chat. Both halves are the fix: the button was hidden without a session, and
   * on the path where it did fire the interview streamed into a chat nobody was
   * looking at — which is exactly "it does nothing".
   */
  const openSessionForSkillCreator = async (workspaceId?: string): Promise<string | null> => {
    const ws = workspaceId ?? wsId ?? workspaces[0];
    if (!ws) return null;
    // A session already focused in this workspace is the one to use.
    const current = selectedId && sessions.find((x) => x.id === selectedId);
    if (current && current.workspaceId === ws) {
      await selectSession(current.id);
      return current.id;
    }
    try {
      const meta = await window.hv.createSession(ws);
      setStatuses((p) => ({ ...p, [meta.id]: "running" }));
      setTranscripts((p) => ({ ...p, [meta.id]: [] }));
      setSelectedId(meta.id);
      setActiveWs(ws);
      setTabsByWs((p) => ({ ...p, [ws]: openChat(p[ws] ?? emptyTabs, meta.id) }));
      setSessions(await window.hv.listSessions());
      setView("chat");
      return meta.id;
    } catch (err) {
      surface(err);
      return null;
    }
  };

  const closeChatTab = async (ws: string, paneIdx: number, tab: TabId): Promise<void> => {
    const sid = sessionOf(tab);
    // §17 round 12: closing the LAST tab of a session ENDS its process. Until
    // now a chat tab was a pure view, which left the child running with no way
    // to stop it short of deleting the conversation. Counted across panes: the
    // same session open twice must survive one of them closing.
    if (sid && chatTabCount(tabsByWs[ws] ?? emptyTabs, sid) === 1) {
      if (
        busy[sid] &&
        !window.confirm("This session is still working. Close it and stop the agent?")
      ) {
        return;
      }
      // §26's existing confirm — a session with live terminals names them and
      // offers stop/keep. Undefined means it had none, so nothing is asked.
      const terms = await askAboutTerminals(sid);
      if (terms === null) return; // cancelled
      // Round 15: main deletes the session outright when no prompt was ever
      // sent, and says so — refresh the list rather than leaving a row for a
      // session that no longer exists.
      const res = await window.hv.closeSession(sid, terms).catch((e) => {
        surface(e);
        return { deleted: false };
      });
      if (res?.deleted) setSessions(await window.hv.listSessions());
    }
    const next = closeTab(tabsByWs[ws] ?? emptyTabs, paneIdx, tab);
    setTabsByWs((p) => ({ ...p, [ws]: next }));
    if (sid && selectedId === sid) {
      // Follow whatever took its place in that pane when it is a chat, so the
      // sidebar highlight, shortcuts and stats keep pointing at something real.
      // Going straight to null was half of the blank-center bug above.
      const a = next.panes[next.focused]?.active;
      const nextSid = a ? sessionOf(a) : null;
      setSelectedId(nextSid);
    }
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
      // Round 11: a new session is a new tab, in the workspace it belongs to.
      setActiveWs(workspaceId);
      setTabsByWs((p) => ({ ...p, [workspaceId]: openChat(p[workspaceId] ?? emptyTabs, meta.id) }));
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

  /**
   * Load a session's history (and start/resume its Pi process), once.
   *
   * Extracted from selectSession because SELECTING a session and SHOWING one
   * are different events, and only the first used to hydrate. The layout
   * restore and the tab strip both set `selectedId` directly, so after a
   * restart a restored chat tab rendered the empty "Ready when you are." state
   * while its transcript sat on disk and the cost pill happily showed what the
   * conversation had already cost. Hydration now hangs off "is this chat on
   * screen", which every one of those paths routes through.
   *
   * Idempotent twice over: the status guard covers the settled cases, and the
   * ref guard covers the unsettled one — an effect can fire again before
   * setStatuses has committed, and two concurrent openSession calls for one
   * session would race two Pi spawns.
   */
  const hydrateSession = async (id: string): Promise<void> => {
    if (statuses[id] === "running" || statuses[id] === "waking") return;
    if (hydrating.current.has(id)) return;
    hydrating.current.add(id);
    try {
      await hydrateSessionInner(id);
    } finally {
      hydrating.current.delete(id);
    }
  };

  const selectSession = async (id: string): Promise<void> => {
    setSelectedId(id);
    setView("chat");
    // Round 11: opening a session ADDS a tab (or focuses the one it already has)
    // rather than replacing whatever chat was on screen.
    const ws = sessions.find((x) => x.id === id)?.workspaceId;
    if (ws) {
      setActiveWs(ws);
      setTabsByWs((p) => ({ ...p, [ws]: openChat(p[ws] ?? emptyTabs, id) }));
    }
    await hydrateSession(id);
  };

  /**
   * Hydrate whatever chats are ON SCREEN.
   *
   * This is the seam that fixes "restarted the app and my sessions are empty".
   * Three different paths put a chat on screen — the layout restore at boot,
   * clicking a tab in the strip, and switching workspace — and all three set
   * `selectedId` without loading anything; only the sidebar's selectSession
   * ever called openSession. Rather than patch each caller (and miss the
   * fourth), hydration is a consequence of visibility.
   *
   * `visibleChats` and not `allChats` on purpose: the active tab of each pane,
   * so a restored layout costs one Pi process per visible pane instead of one
   * per restored tab. Off-screen tabs hydrate when they are brought forward.
   */
  const visibleKey = activeWs ? visibleChats(tabsByWs[activeWs] ?? emptyTabs).sort().join(",") : "";
  useEffect(() => {
    if (!layoutLoaded || !visibleKey) return;
    for (const sid of visibleKey.split(",")) {
      if (sid) void hydrateSession(sid);
    }
    // hydrateSession is re-created every render and is idempotent; keying on
    // the visible-session list is what makes this fire exactly when the set
    // of on-screen chats changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutLoaded, visibleKey]);

  const hydrateSessionInner = async (id: string): Promise<void> => {
    // Show a loader while the Pi process starts / the session file loads — for
    // ANY not-yet-running open, not only hibernated resumes (round-4 follow-up:
    // a fresh open showed a static empty state with no loader).
    setStatuses((p) => ({ ...p, [id]: "waking" }));
    try {
      const { meta, messages, compaction, plan } = await window.hv.openSession(id);
      setStatuses((p) => ({ ...p, [id]: "running" }));
      // §23: seed the active-plan pill. This is the path that survives a
      // renderer reload — there is no session_start replay then, and main's
      // planState outlives the renderer.
      if (plan) {
        setActivePlan((p) => ({
          ...p,
          [id]: { sessionId: id, workspaceId: meta.workspaceId, path: plan.path, status: plan.status, done: plan.done, total: plan.total },
        }));
      }
      if (messages) {
        // Rebuilt from Pi's session file — only adopt when we hold nothing newer.
        // Reconstructs tool cards too (intent + result persist in the session
        // file); reconstructed cards are "done" and render collapsed by default.
        // Stable ids (like appendItem) keep rewind (#11) + React keys working.
        const items: TranscriptItem[] = toTranscriptItems(
          messages,
          { sessionId: id, workspaceId: meta.workspaceId },
          () => idCounter.current++,
        );
        // §14 round 6: the skills chip's "used" marks came only from live hv.skill
        // notifies, so a REOPENED session reported "0 used" while its own restored
        // transcript listed use_skill cards. The session file is the source of
        // truth — seed from it (raw-read fallbacks stay unmarked; they're a
        // heuristic and card as a plain `read`).
        const restoredUsed = messages.flatMap((m) =>
          m.kind === "tool" && m.toolName === "use_skill"
            ? [(m.args as { name?: string } | undefined)?.name].filter((n): n is string => !!n)
            : [],
        );
        if (restoredUsed.length > 0) {
          setSkillsUsed((p) => ({ ...p, [id]: [...new Set([...(p[id] ?? []), ...restoredUsed])] }));
        }
        const restoredPlanPaths = new Set(messages.flatMap((m) => (m.kind === "plan" ? [m.planPath] : [])));
        setTranscripts((p) => {
          const existing = p[id] ?? [];
          // Adopt the file-rebuilt transcript only when we don't already hold a
          // LIVE conversation. A PlanCard/notice that raced in from the
          // session_start hv.plan notify does NOT count as conversation — else
          // reopening a plan session would keep only the plan card and drop the
          // restored messages.
          const hasConversation = existing.some(
            (it) => it.kind === "user" || it.kind === "assistant" || it.kind === "tool",
          );
          if (hasConversation) return p;
          // Keep any plan cards that raced in but AREN'T already positioned in the
          // rebuilt history (dedupe by path) — avoids a duplicate bottom card.
          const extraPlans = existing.filter((it) => it.kind === "plan" && !restoredPlanPaths.has(it.card.path));
          // §9 round 9: a compacted session's rebuilt history is only the slice
          // Pi still holds — cap it with the boundary bubble so the gap is
          // visible instead of silent. `get_messages` gave us the in-context
          // half; the rest is loadable from the file on demand.
          const head: TranscriptItem[] = compaction
            ? [{ kind: "boundary", compactions: compaction.count, reason: compaction.reason, loaded: false, id: idCounter.current++ }]
            : [];
          const merged = [...head, ...items, ...extraPlans];
          // Rebuild the tool index so any late tool_execution_end still matches.
          const map = new Map<string, number>();
          merged.forEach((it, i) => {
            if (it.kind === "tool") map.set(it.card.toolCallId, i);
          });
          toolIndex.current[id] = map;
          return { ...p, [id]: merged };
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

  /**
   * Round 11: `sid` is a PARAMETER, not `selectedId`. Every chat tab is mounted, so
   * in a split two composers can be visible at once — and typing into one while
   * another is "selected" sent the prompt to the wrong session. A handler shared by
   * N instances must never resolve which session from a global.
   */
  const send = async (
    sid: string,
    msg: string,
    behavior?: "followUp",
    attachments?: ImageAttachment[],
    mentions?: string[],
  ): Promise<void> => {
    // W2.1: attached images ride the RPC `images` param (ImageContent[]).
    const images = attachments?.length ? buildImages(attachments) : undefined;
    // F3: @file mention warnings (skipped binaries, over-cap dirs) surface as notices.
    const noteWarnings = (w: string[]): void => w.forEach((text) => appendItem(sid, { kind: "notice", text }));
    // Round 11: the files open in THIS session's workspace, paths only. Main
    // decides whether to send them (global setting) and whether the set changed.
    const ws = sessions.find((x) => x.id === sid)?.workspaceId;
    const openFiles = ws ? allFiles(tabsByWs[ws] ?? emptyTabs) : undefined;
    // B2: while the agent runs, a bare prompt errors — Enter/send steers
    // (V2.A: the Queue button is gone; the followUp behavior plumbing stays).
    // The message shows as a chip (queue_update) and only joins the
    // transcript when Pi delivers it.
    if (busy[sid]) {
      try {
        const { warnings } = await window.hv.promptSession(sid, msg, behavior ?? "steer", images, mentions, openFiles);
        noteWarnings(warnings);
      } catch (err) {
        surface(err);
      }
      return;
    }
    // Round 15: stamp when it was sent. This is also what starts the turn
    // clock — turnStart below is read at agent_end to fill the duration.
    appendItem(sid, { kind: "user", text: msg, ts: Date.now(), images: attachments?.map(attachmentUrl) });
    turnStart.current[sid] = Date.now();
    streaming.current[sid] = false;
    // A fresh prompt ends any abort window: this turn's text belongs to a new
    // bubble, never merged into the one the user stopped.
    delete aborted.current[sid];
    setBusy((p) => ({ ...p, [sid]: true }));
    try {
      const { warnings } = await window.hv.promptSession(sid, msg, undefined, images, mentions, openFiles);
      noteWarnings(warnings);
    } catch (err) {
      setBusy((p) => ({ ...p, [sid]: false }));
      surface(err);
    }
  };

  // B2: "restart & resend" for a crashed session — restart the agent, then
  // resend the last user message (if any).
  //
  // §16 follow-up: the same button also serves a TRANSIENT PROVIDER ERROR (429,
  // 5xx, 529, network), where the session is perfectly alive. Restarting there
  // would be wrong, not just wasteful: a respawn resets that session's
  // in-memory permission grants and dangerous mode to safe defaults. So the
  // restart is conditional on the session actually being crashed.
  /** Same rule as `send`: the session is a parameter, never `selectedId`. */
  const retryCrash = async (sid: string): Promise<void> => {
    const lastUser = [...(transcripts[sid] ?? [])].reverse().find((it) => it.kind === "user");
    if (statuses[sid] === "crashed") {
      setStatuses((p) => {
        const next = { ...p };
        delete next[sid];
        return next;
      });
      await selectSession(sid);
    }
    if (lastUser && lastUser.kind === "user") await send(sid, lastUser.text);
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
    if (sid && answers) appendItem(sid, { kind: "user", text: answersSummary(answers), ts: Date.now() });
    setUiQueue((q) => q.filter((e) => e.req.id !== uiReq.req.id));
  };

  // #11 rewind: truncate the transcript at (and after) a user message and best-
  // effort drop the matching tail from Pi's context. The composer repopulation is
  // done in ChatView (which owns the input). Chat-only — files are NOT reverted.
  const rewindTo = (it: TranscriptItem, scope: RewindScope): void => {
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
    const toolIds = new Set(tailToolCallIds(items, idx));
    const { truncateChat, restoreFiles } = rewindActions(scope);

    // Files first: the restore reads the CURRENT transcript's tool ids, and it
    // must not depend on whether the chat half ran.
    if (restoreFiles) {
      void window.hv.rewindRestore(sid, [...toolIds]).then((res) => {
        if (!res) {
          appendItem(sid, { kind: "notice", text: "No snapshot for that message — no files were changed." });
          return;
        }
        const parts = [`${res.restored.length} restored`, `${res.deleted.length} removed`];
        if (res.stale.length) parts.push(`${res.stale.length} left alone (changed since)`);
        appendItem(sid, { kind: "notice", text: `Files rewound — ${parts.join(", ")}.` });
      });
    }
    if (!truncateChat) return;

    setTranscripts((p) => ({ ...p, [sid]: (p[sid] ?? []).slice(0, idx) }));
    pendingRewind.current[sid] = { msgCount, toolIds };
    void window.hv.contextSnapshot(sid);
  };

  // §20 round 17 — the one nav callback GoTo rides, via NavContext.
  //
  // MUST stay above the keyState early return: a hook after it is called on
  // some renders and not others, and React counts. It reads keyState directly
  // rather than `needsSetup`, which is declared below the guard.
  //
  // Mirrors ⌘, (openSettings): a settings page renders on activeView alone, but
  // arriving with the sidebar's Settings group collapsed means landing
  // somewhere with no visible sign of where you are. And a workspace
  // destination must be selected BEFORE the view, or it renders the previously
  // selected workspace under the right title.
  const navigate = useCallback((t: NavTarget) => {
    if (keyState !== "present") return;
    if (t.workspace) setWsSettings(t.workspace);
    if (t.view !== "chat") setSettingsOpen(true);
    setView(t.view);
  }, [keyState]);

  if (keyState === "loading") {
    return <div className="h-full flex items-center justify-center text-ink-soft">…</div>;
  }

  const needsSetup = keyState === "missing";
  const activeView: View = needsSetup ? "models" : view;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  // ── W2.2/WS6: current workspace's tab state + dirty flags for the strip ──
  /**
   * The workspace whose layout the center area is showing.
   *
   * Round 11 bugfix: this used to be `selected?.workspaceId`, i.e. a projection
   * of the SELECTED SESSION. Chat tabs became closable in this round, which made
   * "tabs exist but no session is selected" reachable for the first time — and
   * with wsId null every `{wsId && …}` block stopped rendering, so closing a chat
   * tab blanked the whole center area while every tab, file and unsaved buffer
   * was still there, invisible. The layout belongs to a workspace, not to a
   * selection, so it tracks the workspace directly and only falls back to the
   * selected session's (first paint, before anything has been opened).
   */
  const wsId = activeWs ?? selected?.workspaceId ?? null;
  const wsTabs = (wsId ? tabsByWs[wsId] : undefined) ?? emptyTabs;
  // F6: refresh the global-shortcut closure with the current render's state.
  shortcutRef.current = (e: KeyboardEvent): void => {
    // Round 8: dispatch off the registry, so a rebind on the shortcuts page is
    // the only place a key is decided. ⌘S / ⌘F are absent on purpose — the
    // editor and the chat own those, each reading the same binding.
    const b = eventToBinding(e);
    if (!b) return;
    const is = (id: ShortcutId): boolean => bindings[id] === b;
    if (is("toggleSidebar")) { e.preventDefault(); setSidebarCollapsed((c) => !c); return; }
    if (is("toggleFileDrawer")) { e.preventDefault(); toggleDrawer("files"); return; }
    if (is("toggleChangesPanel")) { e.preventDefault(); if (gitAvailable) toggleDrawer("changes"); return; }
    if (is("newSession")) {
      e.preventDefault();
      const ws = wsId ?? workspaces[0];
      if (ws) void newSession(ws);
      return;
    }
    if (is("newTerminal")) {
      e.preventDefault();
      const ws = wsId ?? workspaces[0];
      if (ws) void newTerminal(ws);
      return;
    }
    // §28: ⌘B. Same shape as ⌘T — the workspace falls back to the first one so
    // the key works before anything is focused.
    if (is("newBrowser")) {
      e.preventDefault();
      const ws = wsId ?? workspaces[0];
      if (ws) void newBrowser(ws);
      return;
    }
    if (is("findSession")) {
      e.preventDefault();
      // A shortcut that silently does nothing is a bug: the 48px rail has no
      // filter to focus, so expand it first.
      if (sidebarCollapsed) setSidebarCollapsed(false);
      setSearchNonce((n) => n + 1);
      return;
    }
    if (is("openSettings")) { e.preventDefault(); if (!needsSetup) { setSettingsOpen(true); setView("models"); } return; }
    if (is("openShortcuts")) { e.preventDefault(); if (!needsSetup) { setSettingsOpen(true); setView("shortcuts"); } return; }
    if (is("closeTab")) {
      // Round 15: ⌘W closes the focused pane's active tab, WHATEVER it is —
      // session, terminal or browser. Window close is ⌘⇧W.
      //
      // This reverses round 12's chat exemption, which existed because closing
      // a session's last tab now ends its process and "should not sit under a
      // reflex keystroke". The guard moves rather than disappearing: it is the
      // STATE that decides, not the input device. closeChatTab already asks
      // before killing a working session and already runs §26's stop/keep
      // question for live terminals — so routing ⌘W through it means the
      // keystroke and the tab's own × cannot diverge, which is what the
      // exemption was really protecting against.
      if (!wsId) return;
      const close = (slot: number, tab: TabId): void => {
        if (isChatTab(tab)) void closeChatTab(wsId, slot, tab);
        else if (isTermTab(tab)) void closeTerminalTab(wsId, slot, tab);
        else if (isBrowserTab(tab)) closeBrowserTab(wsId, slot, tab);
        else closeFileTab(wsId, slot, tab);
      };
      const focusedActive = wsTabs.panes[wsTabs.focused]?.active;
      if (focusedActive) {
        e.preventDefault();
        close(wsTabs.focused, focusedActive);
        return;
      }
      // The focused pane is empty — fall back to the first pane that has a tab.
      const i = liveSlots(wsTabs).find((s) => wsTabs.panes[s]?.active);
      if (i != null) { e.preventDefault(); close(i, wsTabs.panes[i]!.active!); }
    }
  };
  // Round 11: every session with an open chat tab in THIS workspace. Each gets a
  // mounted ChatView; only the one placed in a pane is visible.
  const chatSessions = wsId ? allChats(wsTabs) : [];
  // Every session with a chat tab in ANY workspace — the sidebar spans them all.
  const openSessionIds = new Set(Object.values(tabsByWs).flatMap(allChats));
  const dirtyForWs: Record<string, boolean> = {};
  if (wsId) for (const f of allFiles(wsTabs)) dirtyForWs[f] = !!dirtyMap[bufferKey(wsId, f)];
  // Every open file across ALL workspaces stays mounted (hidden) so unsaved
  // buffers survive session/workspace/view switches.
  const openFileEntries = Object.entries(tabsByWs).flatMap(([w, t]) => allFiles(t).map((f) => [w, f] as const));
  /**
   * §26: every terminal with a tab in THIS workspace gets a mounted emulator.
   *
   * Scoped to the active workspace, unlike openFileEntries above: a file tab
   * stays mounted across workspaces to protect an unsaved BUFFER, and a
   * terminal has no such thing — its buffer lives in main's headless mirror,
   * so an off-workspace terminal can be unmounted and repainted on return.
   */
  const terminalIds = wsId ? allTerminals(wsTabs) : [];
  const browserIds = wsId ? allBrowsers(wsTabs) : [];
  // WS6 / round 11: which pane's content cell a tab occupies when it's that
  // pane's active tab. Content is mounted flat and placed via CSS grid-area
  // (NEVER reparented — see the invariant in tabs.ts).
  const AREAS = ["contentA", "contentB", "contentC", "contentD"] as const;
  const areaFor = (tab: TabId): string | null => {
    const p = liveSlots(wsTabs).find((s) => wsTabs.panes[s]!.active === tab);
    return p != null ? AREAS[p] : null;
  };
  /**
   * A content cell draws only its LEFT edge. The horizontal rule is owned by the
   * tab strip directly above it (TabStrip has its own border-b), so adding
   * border-t here doubled that line to 4px.
   */
  const paneDivider = (area?: string | null): string => {
    const slot = ["contentA", "contentB", "contentC", "contentD"].indexOf(area ?? "");
    if (slot < 0) return "";
    return paneEdges(wsTabs, slot).left ? "border-l-2 border-line" : "";
  };
  // v5.1: a persistent `toolbar` area is pinned top-right (strip row only);
  // content spans under it. The file tree is a separate absolute overlay (below),
  // so opening it never shrinks the panes. Content stays mounted-flat (WS6).
  const DRAWER = drawerPanel && !!wsId ? drawerPanel : null;
  const gridStyle = buildGridStyle(wsTabs);

  return (
    <NavContext.Provider value={navigate}>
    <div className="h-full flex">
      <Sidebar
        workspaces={workspaces}
        sessions={sessions}
        statuses={statuses}
        pending={pendingCounts(uiQueue)}
        planning={Object.fromEntries(Object.entries(planMode).map(([sid, p]) => [sid, p.enabled]))}
        selectedId={selectedId}
        openSessionIds={openSessionIds}
        view={activeView}
        onNavigate={(v) => !needsSetup && setView(v)}
        onAddWorkspace={addWorkspace}
        onWorkspaceSettings={(ws) => { setWsSettings(ws); setView("workspace"); }}
        gitInfo={gitInfo}
        onBranchMenu={(ws) => {
          // The branch menu lives in the panel, where switching also gets the
          // three-choice dialog for a dirty tree — one implementation, not two.
          setActiveWs(ws);
          setDrawerPanel("changes");
        }}
        onNewSession={newSession}
        onSelectSession={selectSession}
        onRenameSession={(id, title) => window.hv.renameSession(id, title)}
        onArchiveSession={(id, archived) => window.hv.archiveSession(id, archived)}
        onDeleteSession={async (id) => {
          // §26: the terminals this session started outlive it unless the user
          // says otherwise — asked BEFORE anything is torn down, so cancelling
          // leaves the session exactly as it was.
          const decision = await askAboutTerminals(id);
          if (decision === null) return;
          // V2.C2: deleting the selected session falls back to no-selection.
          if (selectedId === id) setSelectedId(null);
          // Round 11: the tab must follow a DELETION (closing a tab leaves the
          // session alive, but a deleted session has to lose its tab, or the
          // strip keeps one for a session that no longer exists).
          setTabsByWs((p) => {
            const ws = sessions.find((x) => x.id === id)?.workspaceId;
            const t = ws ? p[ws] : undefined;
            if (!ws || !t) return p;
            return { ...p, [ws]: closeSessionTabs(t, id) };
          });
          // §23: drop its plan too — activePlan feeds watchTargets, so a stale
          // entry would keep the workspace watched for a session that is gone.
          setActivePlan((p) => {
            if (!(id in p)) return p;
            const next = { ...p };
            delete next[id];
            return next;
          });
          // "keep" needs no work: an agent terminal already IS an ordinary
          // workspace terminal, so main just releases the claim. Its tab, if
          // the user wants one, is Open-as-tab from the card.
          await window.hv.deleteSession(id, decision ?? undefined); // sessions-changed broadcast refreshes the list
          setAgentTerms((p) => {
            if (!(id in p)) return p;
            const { [id]: _gone, ...rest } = p;
            return rest;
          });
        }}
        settingsOpen={settingsOpen}
        onToggleSettingsOpen={() => setSettingsOpen((o) => !o)}
        searchNonce={searchNonce}
        railCollapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        {error && (
          <Banner tone="attention" onDismiss={() => setError(null)}>
            <span className="flex-1">{error}</span>
          </Banner>
        )}
        {/* B4: permanent dangerous-mode warning with one-click off. */}
        {activeView === "chat" && selectedId && dangerous[selectedId] && (
          <Banner tone="danger">
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
          </Banner>
        )}
        {activeView === "models" && (
          <ModelsView
            firstRun={needsSetup}
            onSaved={() => {
              setKeyState("present");
              setView("chat");
            }}
          />
        )}
        {activeView === "permissions" && <PermissionsView />}
        {activeView === "workspace" && wsSettings && (
          <WorkspaceSettingsView
            workspace={wsSettings}
            onNewSkillSession={async () => {
              const sid = await openSessionForSkillCreator(wsSettings);
              // The creator's prompt is fired by SkillsSection; echo it so the
              // transcript shows what was sent (hv:prompt-session emits none).
              if (sid) appendItem(sid, { kind: "user", text: "/skill:skill-creator", ts: Date.now() });
              return sid;
            }}
            onRemoved={async () => {
              // Round 11: the workspace is gone — refresh the list, drop its tabs,
              // and leave a page that now describes nothing.
              setWorkspaces(await window.hv.listWorkspaces());
              setSessions(await window.hv.listSessions());
              setTabsByWs((p) => { const n = { ...p }; delete n[wsSettings]; return n; });
              setActiveWs((w) => (w === wsSettings ? null : w));
              setWsSettings(null);
              setView("chat");
            }}
          />
        )}
        {activeView === "sysprompt" && <SystemPromptView sessionId={selectedId} />}
        {activeView === "onBehalf" && <OnBehalfView />}
        {activeView === "stats" && <DashboardView workspaces={workspaces} />}
        {activeView === "audit" && <AuditView sessions={sessions} workspaces={workspaces} />}
        {activeView === "changelog" && <ChangelogView />}
        {activeView === "skills" && (
          <SkillsView
            sessionId={selectedId}
            workspaceId={selected?.workspaceId ?? null}
            onNewSkillSession={async () => {
              const sid = await openSessionForSkillCreator();
              if (sid) appendItem(sid, { kind: "user", text: "/skill:skill-creator", ts: Date.now() });
              return sid;
            }}
          />
        )}
        {activeView === "promptTemplates" && (
          <PromptTemplatesView sessionId={selectedId} workspaceId={selected?.workspaceId ?? null} />
        )}
        {activeView === "plugins" && <PluginsView />}
        {activeView === "mcp" && <McpView />}
        {activeView === "shortcuts" && <ShortcutsView bindings={bindings} onChange={setBindings} />}
        {activeView === "terminal" && <TerminalView settings={termSettings} onChange={setTermSettings} />}
        {/* §27: settings are global, so the page needs no props. */}
        {activeView === "voice" && <VoiceView settings={voiceSettings} onChange={setVoiceSettings} />}
        {activeView === "agents" && <AgentsView agents={agents} sessionId={selectedId} />}
        {activeView === "tools" && (
          <AllToolsView
            tools={tools}
            sessionId={selectedId}
            workspaceId={selected?.workspaceId ?? null}
            onPlanBuiltinChange={setPlanBuiltinOn}
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
            {wsId && liveSlots(wsTabs).map((slot) => {
              const pane = wsTabs.panes[slot]!;
              const STRIPS = ["stripA", "stripB", "stripC", "stripD"] as const;
              // A pane can be in column 2 AND row 2 (slot 3 always is), so both
              // edges come from one rule — the old one returned only one and the
              // primary divider stopped halfway down.
              const e = paneEdges(wsTabs, slot);
              const edge = `${e.left ? "border-l-2 border-line" : ""} ${e.top ? "border-t-2 border-line" : ""}`;
              return (
                <div
                  key={slot}
                  style={{ gridArea: STRIPS[slot] }}
                  className={`min-w-0 h-11 ${edge} ${slot === wsTabs.focused ? "bg-paper-deep/30" : ""}`}
                  onMouseDown={() => updateTabs(wsId, (t) => focusPane(t, slot))}
                >
                  <TabStrip
                    pane={pane}
                    paneIndex={slot}
                    sessionTitleFor={(sid) => sessions.find((x) => x.id === sid)?.title ?? "Session"}
                    terminalTitleFor={(tid) => terminals[tid]?.title ?? "Terminal"}
                    browserTitleFor={(bid) => {
                      const info = browsers[bid];
                      if (info?.title) return info.title;
                      try {
                        return info?.url ? new URL(info.url).hostname : "Browser";
                      } catch {
                        return "Browser";
                      }
                    }}
                    terminalExited={(tid) => terminals[tid]?.running === false}
                    dirty={dirtyForWs}
                    busyFor={(sid) => !!busy[sid]}
                    onSelect={(tab) => {
                      updateTabs(wsId, (t) => activateTab(t, slot, tab));
                      // Round 11: focusing a chat tab IS selecting that session —
                      // the sidebar highlight, shortcuts and stats follow it.
                      const sid = sessionOf(tab);
                      if (sid) { setSelectedId(sid); setView("chat"); }
                    }}
                    onClose={(tab) => {
                      // Four tab kinds, four lifecycles: a chat keeps its
                      // session running, a file may hold unsaved edits, a
                      // terminal DIES with its tab (§26) — so it confirms — and
                      // a browser pane is destroyed with no confirm (§28:
                      // nothing is running and nothing is unsaved).
                      if (isChatTab(tab)) void closeChatTab(wsId, slot, tab);
                      else if (isTermTab(tab)) void closeTerminalTab(wsId, slot, tab);
                      else if (isBrowserTab(tab)) closeBrowserTab(wsId, slot, tab);
                      else closeFileTab(wsId, slot, tab);
                    }}
                    onRename={(tab, title) => {
                      // §7 round 12: a chat tab renames the SESSION — the
                      // sidebar row changes with it, because it is the
                      // session's name and not a per-tab alias.
                      const sid = sessionOf(tab);
                      if (sid) {
                        void window.hv
                          .renameSession(sid, title)
                          .then(() => window.hv.listSessions())
                          .then(setSessions)
                          .catch(surface);
                        return;
                      }
                      const tid = terminalOf(tab);
                      if (tid) void window.hv.termRename(tid, title).catch(surface);
                    }}
                    onMoveTab={(tab, to) => updateTabs(wsId, (t) => moveTab(t, tab, to))}
                    onNewSession={() => void newSession(wsId)}
                    newSessionKey={formatBinding(bindings.newSession)}
                    onNewTerminal={() => {
                      // Focus first, so the terminal lands in the pane whose
                      // `+` was clicked rather than in whatever was focused.
                      updateTabs(wsId, (t) => focusPane(t, slot));
                      void newTerminal(wsId);
                    }}
                    newTerminalKey={formatBinding(bindings.newTerminal)}
                    onNewBrowser={() => {
                      updateTabs(wsId, (t) => focusPane(t, slot));
                      void newBrowser(wsId);
                    }}
                    newBrowserKey={formatBinding(bindings.newBrowser)}
                    onOpenFilePanel={() => setDrawerPanel("files")}
                    splitOptions={splitOptions(wsTabs, slot)}
                    onSplit={(dir) => updateTabs(wsId, (t) => splitAt(t, slot, dir))}
                    onClosePane={
                      liveSlots(wsTabs).length > 1
                        ? () => updateTabs(wsId, (t) => closePane(t, slot))
                        : undefined
                    }
                    // §7 round 13: the Files/Changes cluster is layout-wide, so
                    // it renders in exactly ONE strip — the top-right one. In
                    // normal flow, so there is no toolbar track for content to
                    // span under and no overlay for a browser pane to cover.
                    trailing={
                      slot === topRightSlot(wsTabs) ? (
                        <RightRail
                          open={DRAWER}
                          onToggle={toggleDrawer}
                          gitAvailable={gitAvailable}
                          branch={gitStatus?.status?.branch?.branch ?? null}
                          changeCount={gitSummary.files}
                          changeTint={badgeTint(gitSummary.changedLines)}
                          filesKey={formatBinding(bindings.toggleFileDrawer)}
                          changesKey={formatBinding(bindings.toggleChangesPanel)}
                        />
                      ) : undefined
                    }
                  />
                </div>
              );
            })}
            {/* §26: one mounted emulator per open terminal, a FLAT grid child
                exactly like ChatView and FileTab. Nesting it inside a pane
                would remount it on every drag between panes — which for a
                terminal does not merely lose a buffer, it detaches the PTY
                listener and throws the whole thing away. */}
            {termSettings &&
              terminalIds.map((tid) => {
                const area = areaFor(termTab(tid));
                return (
                  <TerminalTab
                    key={tid}
                    terminalId={tid}
                    settings={termSettings}
                    gridArea={area ?? undefined}
                    hidden={area === null}
                    searchKey={bindings.search}
                    dividerClass={paneDivider(area)}
                  />
                );
              })}
            {/* §28: one mounted BrowserTab per open pane, a FLAT grid child like
                every other tab. It renders only the CHROME — main composites the
                real page over the placeholder inside it — so the mount-once rule
                matters for a second reason here: a remount would re-measure from
                zero and flash the page across the window. */}
            {browserIds.map((bid) => {
              const area = areaFor(browserTab(bid));
              return (
                <BrowserTab
                  key={bid}
                  browserId={bid}
                  info={browsers[bid]}
                  gridArea={area ?? undefined}
                  hidden={area === null || activeView !== "chat"}
                  dividerClass={paneDivider(area)}
                  // Where this pane meets another: the view insets itself so the
                  // divider's drag strip is never underneath a composited page.
                  edges={paneNeighbours(wsTabs, paneOf(wsTabs, browserTab(bid)))}
                  // §7 round 13: make ROOM for the drawer instead of vanishing
                  // under it. A WebContentsView cannot be painted over, but it
                  // can be made smaller — and the drawer is a stable rectangle
                  // on the right edge, unlike the transient menus that still
                  // (correctly) hide it.
                  drawerWidth={DRAWER ? drawerWidth : 0}
                  onPicked={(payload) => {
                    // §28: the OWNER of the pane first — the session that opened
                    // or adopted it is the agent actually driving this page — and
                    // the selected chat only as a fallback, which is all a ⌘B pane
                    // can have. Returning false (nowhere to put it) is what stops
                    // the comment being silently dropped: the popup says so and
                    // stays open, holding what was typed.
                    const owner = browserOwners[bid];
                    const target = owner && sessions.some((x) => x.id === owner) ? owner : selectedId;
                    if (!target) return false;
                    setPageRefs((p) => ({ ...p, [target]: [...(p[target] ?? []), payload] }));
                    // A chip filed into a composer nobody can see is the same as
                    // losing it, so bring that chat forward — ALWAYS, not only
                    // when it differs from the selected one. A session can be
                    // selected with no tab open (selecting it in the sidebar
                    // opens one; other routes do not), and then the comment
                    // lands somewhere real but invisible. openChat is
                    // addOrFocus, so this is a no-op when the tab is already up.
                    setSelectedId(target);
                    if (wsId) setTabsByWs((p) => ({ ...p, [wsId]: openChat(p[wsId] ?? emptyTabs, target) }));
                    return true;
                  }}
                />
              );
            })}
            {/* v5.1: persistent top-right toolbar — split + file-panel controls,
                always visible regardless of split state. */}
            {/* Round 11: draggable dividers. Absolutely positioned over the grid
                lines rather than grid children, so they cost no track and cannot
                perturb the areas the mount-once placement depends on. */}
            {wsId && wsTabs.split && (
              <PaneDividers
                tabs={wsTabs}
                onResize={(which, ratio) => updateTabs(wsId, (t) => setSize(t, which, ratio))}
              />
            )}
            {/* An empty pane still needs to say what to do with it. */}
            {wsId && liveSlots(wsTabs).filter((slot) => wsTabs.panes[slot]!.active === null).map((slot) => {
              const CONTENTS = ["contentA", "contentB", "contentC", "contentD"] as const;
              return (
                <div
                  key={`empty-${slot}`}
                  style={{ gridArea: CONTENTS[slot] }}
                  className={`min-h-0 flex items-center justify-center text-sm text-ink-soft ${paneDivider(CONTENTS[slot])}`}
                >
                  Open a file or drag a tab here.
                </div>
              );
            })}
            {/* Round 11 bugfix: with no workspace layout active (fresh launch,
                nothing opened yet) there are no strips and no ChatViews, so the
                centre was a blank void that read as a crash. Round 5 always
                mounted one ChatView and showed this welcome; keep that. */}
            {!wsId && (
              <div
                style={{ gridArea: "contentA" }}
                className={`min-h-0 min-w-0 flex-col ${activeView === "chat" ? "flex" : "hidden"}`}
              >
                <ChatWelcome onOpenFolder={addWorkspace} />
              </div>
            )}
            {/* Round 11: ONE ChatView per open chat tab, all mounted, so two
                sessions can stream at once and either can be watched. Placement
                is by grid-area like every other tab (mount-once invariant). */}
            {chatSessions.map((sid) => {
              const sess = sessions.find((x) => x.id === sid) ?? null;
              const area = areaFor(chatTab(sid));
              return (
              <Fragment key={sid}>
            <div
              style={{ gridArea: area ?? undefined }}
              // Round 11: a click ANYWHERE in the pane focuses it — not just on its
              // tab strip. Two composers can be visible at once, so "the pane I am
              // typing in" has to be the focused one or every global read (stats,
              // cost, the sidebar highlight) describes a different session.
              onMouseDown={() => {
                const slot = paneOf(wsTabs, chatTab(sid));
                if (wsId && slot >= 0) updateTabs(wsId, (t) => focusPane(t, slot));
                if (selectedId !== sid) setSelectedId(sid);
              }}
              className={`min-h-0 min-w-0 flex-col ${paneDivider(area)} ${activeView === "chat" && area ? "flex" : "hidden"}`}
            >
              <ChatView
            // Same expression as the wrapper's flex/hidden above — the recording
            // indicator docks into the pane when it can be seen, and falls back
            // to a body portal when it cannot (a display:none ancestor collapses
            // even a fixed child to 0x0).
            visible={activeView === "chat" && !!area}
            workspace={sess?.workspaceId ?? null}
            sessionId={sid}
            sessionModel={sess?.model ?? null}
            sessionThinking={sess?.thinking ?? null}
            items={transcripts[sid] ?? []}
            streaming={streamText[sid] || undefined}
            thinking={thinkingText[sid] || undefined}
            busy={busy[sid] || false}
            waking={(statuses[sid] === "waking") || false}
            crashed={statuses[sid] === "crashed" ? (crashCodes[sid] ?? -1) : null}
            turns={turns[sid] || 0}
            queue={queues[sid] ?? emptyQueue}
            delegations={Object.values(delegations[sid] ?? {})}
            onStopRun={(runId) => void window.hv.subagentInterrupt(sid, runId)}
            onStopChild={(runId, childId) => void window.hv.subagentStopChild(sid, runId, childId)}
            agents={agents}
            // §26 part 2: title and running-state come from the shared
            // `terminals` map, which the push channel keeps live — so an exited
            // terminal leaves the card stack with no extra bookkeeping.
            terminalRuns={Object.entries(agentTerms[sid] ?? {}).flatMap(([id, meta]) => {
              const info = terminals[id];
              return info ? [{ terminalId: id, title: info.title, running: info.running, intent: meta.intent, startedAt: meta.startedAt }] : [];
            })}
            terminalSettings={termSettings}
            onStopTerminal={(id) => {
              // No confirmation: the human can always kill an agent terminal.
              void window.hv.termClose(id);
              dropAgentTerminal(sid, id);
            }}
            onOpenTerminalAsTab={(id) => {
              const ws = sess?.workspaceId;
              if (ws) openAgentTerminalAsTab(sid, ws, id);
            }}
            contextSnapshot={contextSnapshots[sid] ?? null}
            fallbackWindow={fallbackWindow}
            stats={sid === selectedId ? selStats : undefined}
            searchOpen={searchOpen && sid === selectedId}
            onSearchOpenChange={setSearchOpen}
            searchKey={bindings.search}
            contextOpen={contextOpen && sid === selectedId}
            onContextOpenChange={setContextOpen}
            costCalls={sid === selectedId ? selCalls?.calls : undefined}
            costTotal={sid === selectedId ? selCalls?.total : undefined}
            costOpen={costOpen && sid === selectedId}
            onCostOpenChange={setCostOpen}
            planEnabled={planMode[sid]?.enabled || false}
            sessionSkills={(skillsLoaded[sid] ?? []).map((s) => ({
              ...s,
              used: (skillsUsed[sid] ?? []).includes(s.name),
            }))}
            // Important 1 fix: the chip/exit-✕ only render when the global toggle
            // is on — otherwise clicking them would hit main's hv:plan-set bail
            // (a dead click) instead of simply not existing.
            onTogglePlan={planBuiltinOn ? (on) => {
              // main aborts any live turn before flipping plan mode (hv:plan-set);
              // mirror the Stop path and clear busy now so the composer unlocks
              // even if the aborted turn's agent_end never arrives.
              // planSet aborts a busy session in main (abortIfBusy), so this is an
              // abort window too — late deltas merge rather than split the bubble.
              aborted.current[sid] = true;
              void window.hv.planSet(sid, on).catch(() => {});
              commitStream(sid);
              setBusy((p) => ({ ...p, [sid]: false }));
            } : undefined}
            composerInsert={composerInsert?.sid === sid ? composerInsert : undefined}
            onOpenAgentsMd={() => setAgentsMd("AGENTS.md")}
            onSend={(msg, behavior, images, mentions) => void send(sid, msg, behavior, images, mentions)}
            pageRefs={pageRefs[sid]}
            onDropPageRef={(i) =>
              setPageRefs((p) => ({ ...p, [sid]: (p[sid] ?? []).filter((_, j) => j !== i) }))
            }
            onClearPageRefs={() => setPageRefs((p) => ({ ...p, [sid]: [] }))}
            onRetry={() => void retryCrash(sid)}
            onCompact={() => void window.hv.compactSession(sid)}
            onAbort={() => {
              // Mark BEFORE committing: the abort has a renderer→main→child round
              // trip to make, so deltas arriving in that window must merge into the
              // bubble commitStream is about to close, not open a second one.
              aborted.current[sid] = true;
              void window.hv.abortSession(sid);
              // Stop is an explicit end: clear busy now instead of waiting for an
              // agent_end that an abort may not emit (else the composer stays
              // stuck in steer-only mode). A late agent_end is idempotent here.
              commitStream(sid);
              setBusy((p) => ({ ...p, [sid]: false }));
            }}
            onRestart={async () => {
              setStatuses((p) => {
                const next = { ...p };
                delete next[sid];
                return next;
              });
              await selectSession(sid);
            }}
                onOpenFolder={addWorkspace}
                onOpenFile={openFileFromCard}
                onOpenMcp={() => setView("mcp")}
                onOpenVoice={() => setView("voice")}
                voiceSettings={voiceSettings}
                onRewind={rewindTo}
                onLoadEarlier={() => void loadEarlier(sid)}
                activePlan={activePlan[sid] ?? null}
              />
            </div>
              </Fragment>
              );
            })}
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
                  onSendToChat={
                    // The chat that receives it is the focused one; with no chat
                    // open there is nowhere to send, so the button is not offered.
                    selectedId
                      ? (text) => {
                          setComposerInsert((prev) => ({ sid: selectedId, text, nonce: (prev?.nonce ?? 0) + 1 }));
                          setView("chat");
                        }
                      : undefined
                  }
                  onDirtyChange={(d) => setDirtyFlag(bufferKey(w, f), d)}
                  saveKey={bindings.save}
                  searchKey={bindings.search}
                />
              );
            })}
            {/* v5.1: file tree is a right-side OVERLAY drawer (top below the tab
                bar, h-11) — it overlays the content instead of a grid column, so
                opening it never shrinks the panes. Below the ContextPanel (z-40). */}
            {DRAWER && (
              <div
                // §7 round 13: plain `bg-paper`, NOT the sidebar's pegboard.
                // Tried and reverted: the texture is the app's mark for its own
                // chrome — the sidebar, where you pick a workspace or open
                // settings. This drawer is the workspace's own contents, so it
                // belongs to the centre, and giving it the sidebar's surface
                // said the opposite.
                // §7 round 13: marked so BrowserTab can make ROOM for it
                // instead of hiding under it — see its `drawerWidth` prop.
                data-hv-drawer=""
                className="absolute top-11 right-0 bottom-0 z-30 border-l-2 border-line bg-paper shadow-sticker-lg flex flex-col"
                style={{ width: drawerWidth }}
              >
                {/* §29: the drag strip. Absolutely placed on the drawer's own
                    left edge so it costs no layout and cannot shift the tabs. */}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize the panel"
                  title="Drag to resize"
                  className="absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-10"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const startX = e.clientX;
                    const startW = drawerWidth;
                    const move = (ev: MouseEvent): void =>
                      setDrawerWidth(clampDrawer(startW + (startX - ev.clientX)));
                    const up = (): void => {
                      window.removeEventListener("mousemove", move);
                      window.removeEventListener("mouseup", up);
                    };
                    window.addEventListener("mousemove", move);
                    window.addEventListener("mouseup", up);
                  }}
                />
                {/* §7 round 13: ONE panel at a time. The rail is the switcher,
                    so the drawer carries no tab header of its own — which is
                    what gives Changes the whole width it needs. */}
                <div className="min-h-0 flex-1">
                  {DRAWER === "changes" ? (
                    <ChangesPanel key={wsId} workspace={wsId!} onOpenFile={(rel) => openFileTab(wsId!, rel)} />
                  ) : (
                    <FileTree key={wsId} workspace={wsId!} onOpenFile={(rel) => openFileTab(wsId!, rel)} />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      {uiReq?.kind === "permission" && <PermissionModal req={uiReq.req} info={uiReq.info} onChoice={respondPermission} />}
      {uiReq?.kind === "askUser" && (
        <AskUserModal key={uiReq.req.id} ask={uiReq.ask} onSubmit={respondAskUser} onDismiss={() => respondAskUser(null)} />
      )}
      {/* §26 part 2: two NAMED outcomes, reusing the workspace-removal confirm
          pattern. Never silently kill (hostile — a dev server dies because a
          chat closed), never silently leak. */}
      {termConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8"
          onClick={() => { termConfirm.resolve(null); setTermConfirm(null); }}
        >
          <div
            className="w-full max-w-md rounded-2xl border-2 border-tangerine bg-card p-5 shadow-sticker-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-bold mb-1">
              {termConfirm.terms.length === 1
                ? "1 process started by this session is still running"
                : `${termConfirm.terms.length} processes started by this session are still running`}
            </div>
            <ul className="text-sm text-ink-soft mb-4 list-disc pl-5">
              {termConfirm.terms.map((t) => (
                <li key={t.id} className="font-mono">{t.title || t.id}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { termConfirm.resolve("keep"); setTermConfirm(null); }}
                className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
              >
                Keep them as terminals
              </button>
              <button
                type="button"
                onClick={() => { termConfirm.resolve("stop"); setTermConfirm(null); }}
                className="rounded-xl bg-berry text-paper font-bold text-sm px-4 py-2 border-2 border-berry shadow-sticker cursor-pointer hover:brightness-105"
              >
                Stop them
              </button>
            </div>
          </div>
        </div>
      )}
      {onboarding && <OnboardingOverlay onDismiss={dismissOnboarding} />}
      {/* WS7: AGENTS.md editor — root from the "+" menu, any AGENTS.md from the tree. */}
      {agentsMd && wsId && (
        <AgentsMdPanel
          workspace={wsId}
          relPath={agentsMd}
          sessionId={selectedId}
          // PRD §15 (2026-08-30): the draft is a delegation, so the Agents page
          // owns whether it can run at all. Same inventory that page renders —
          // not a second way to ask.
          agents={agents}
          onClose={() => setAgentsMd(null)}
        />
      )}
    </div>
    </NavContext.Provider>
  );
}


/**
 * Round 11: the draggable pane dividers.
 *
 * Absolutely positioned over the grid lines rather than being grid children, for
 * the same reason the file drawer is an overlay (§21 round 5.1): a divider that
 * occupied a track would change the areas that the mount-once placement depends
 * on, and would shrink the panes it sits between.
 *
 * `main` runs along the primary split; `cross` is the shared second-level one
 * (see the note on WorkspaceTabs.sizes for why it is shared).
 */
function PaneDividers({
  tabs,
  onResize,
}: {
  tabs: WorkspaceTabs;
  onResize: (which: "main" | "cross", ratio: number) => void;
}): React.JSX.Element | null {
  if (!tabs.split) return null;
  const vertical = tabs.split === "v";
  const anyCross = tabs.subSplit[0] || tabs.subSplit[1];

  const drag = (which: "main" | "cross", alongX: boolean) => (e: React.MouseEvent): void => {
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!box) return;
    const onMove = (ev: MouseEvent): void => {
      const r = alongX ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      onResize(which, r);
    };
    const onUp = (): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // §28 round 1: a 10px hit strip centred on the 2px line, tinted on hover so it
  // is findable. 6px was too thin to catch on the first try, and beside a browser
  // pane only the outer half was live at all until the view learned to inset
  // itself away from the divider (BrowserTab DIVIDER_INSET).
  // §28 round 1, revised: the strip you GRAB stays 10px, but it no longer paints
  // itself — a 10px band of colour reads as a fat bar rather than a divider. The
  // tint is a 5px child centred on the line, so the affordance is half as thick
  // while the target is unchanged. Two different jobs, two different widths.
  const hit = "group absolute z-20";
  const tint = "absolute bg-transparent group-hover:bg-tangerine/40 transition-colors";
  const pct = (r: number): string => `${r * 100}%`;
  return (
    <>
      <div
        role="separator"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        title="Drag to resize"
        onMouseDown={drag("main", vertical)}
        className={`${hit} ${vertical ? "top-0 bottom-0 w-2.5 cursor-col-resize -translate-x-1/2" : "left-0 right-0 h-2.5 cursor-row-resize -translate-y-1/2"}`}
        style={vertical ? { left: pct(tabs.sizes.main) } : { top: pct(tabs.sizes.main) }}
      >
        <div className={`${tint} ${vertical ? "inset-y-0 left-1/2 w-[5px] -translate-x-1/2" : "inset-x-0 top-1/2 h-[5px] -translate-y-1/2"}`} />
      </div>
      {anyCross && (
        <div
          role="separator"
          aria-orientation={vertical ? "horizontal" : "vertical"}
          title="Drag to resize"
          onMouseDown={drag("cross", !vertical)}
          className={`${hit} ${vertical ? "left-0 right-0 h-2.5 cursor-row-resize -translate-y-1/2" : "top-0 bottom-0 w-2.5 cursor-col-resize -translate-x-1/2"}`}
          style={vertical ? { top: pct(tabs.sizes.cross) } : { left: pct(tabs.sizes.cross) }}
        >
          <div className={`${tint} ${vertical ? "inset-x-0 top-1/2 h-[5px] -translate-y-1/2" : "inset-y-0 left-1/2 w-[5px] -translate-x-1/2"}`} />
        </div>
      )}
    </>
  );
}

