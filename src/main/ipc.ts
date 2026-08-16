import { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EMPTY_RULES, evaluate, parseRulesFile, type RulesFile } from "../../pi-runtime/extensions/hv-rules";
import { PiClient } from "./pi/PiClient";
import { spawn } from "node:child_process";
import { resolvePiSpawn } from "./pi/spawn";
import { piRuntimeDir } from "./pi/runtimeDir";
import {
  agentDir, builtinAgentsDir, getApiKey, getBuiltinTools, getDefaultModel, getGlobalBypass, getLinkedPromptTemplateDirs, getLinkedSkillDirs, getLongCache, getOnboardingSeen, getOpenFilesContext, setOpenFilesContext,
  customKeyStatus, getWorkspaceBypass, installBuiltinAgents, listCustomEndpoints, providerEnv, providerKeyStatus, removeCustomEndpoint, removeProviderKey,
  saveCustomEndpoint, setLinkedPromptTemplateDirs, setLinkedSkillDirs, writeSubagentConfig,
  resolveBypass, rulesFile, sessionDir, snapshotDir, setApiKey, setBuiltinTools, setDefaultModel, setGlobalBypass, setLongCache, setOnboardingSeen,
  setProviderKey, setWorkspaceBypass, setMcpSecret, removeMcpSecrets, getShortcuts, setShortcuts,
  listMarketplaces, addMarketplace, removeMarketplace, OFFICIAL_MARKETPLACE,
  getTerminalSettings, setTerminalSettings, getLayout, setLayout,
  getVoiceSettings, setVoiceSettings,
  getGitMessageModel, setGitMessageModel,
} from "./config";
import { TerminalManager } from "./terminals";
import {
  voiceStatus, startVoiceDownload, cancelVoiceDownload, removeVoiceModel, onVoiceStatus,
} from "./voice";
import { voiceHost } from "./voice/host";
import { AgentTerminals } from "./agentTerminals";
import { BrowserManager } from "./browsers";
import { AgentBrowsers } from "./agentBrowsers";
import {
  bundledSkillsDir, buildManifest, discoverGlobal, discoverWorkspace, downloadAndExtract, installBundledSkills,
  findLinkedRoot, managedSkillsDir, parseForgeUrl, planSkillRemoval, readSkillDir, removeSkillDir, resolveActiveSkills, scanSkillsDir,
  SkillRegistry, toSkillView,
  type DiscoveredSkill, type SkillProvenance,
} from "./skills";
import {
  bundledPromptTemplatesDir, PromptTemplateRegistry, discoverGlobalPromptTemplates, discoverWorkspacePromptTemplates,
  installBundledPromptTemplates, managedPromptTemplatesDir, planPromptTemplateRemoval, readPromptTemplateFile, removePromptTemplateFile,
  resolveActivePromptTemplates, scanPromptTemplatesDir, toPromptTemplateView, workspacePromptTemplatesDir,
  type PromptTemplateProvenance, type PromptTemplateSource, type DiscoveredPromptTemplate,
} from "./promptTemplates";
import { refuseReservedNames } from "./promptTemplatesImport";
// §25 plugin marketplaces — pure modules (classify/marketplace/scan) plus the
// impure install and the network side.
import { marketplaceRepoArchive, type MarketplaceEntry } from "./plugins/marketplace";
import { CATALOG_GENERATED_AT, PLUGIN_CATALOG } from "./plugins/catalog.generated";
import { scanPluginDir, type PluginScan } from "./plugins/scan";
import { fetchMarketplace, fetchPluginDir } from "./plugins/fetch";
import { normalizePluginMcpServer } from "./plugins/mcpImport";
import {
  findPluginServers, installPluginCommands, installPluginSkills, pluginOrigin,
} from "./plugins/install";
import { allowedAgentDirs, duplicateAgent, readAgentBody, writeAgentEdit } from "./agents";
import {
  authJsonProviders, BYOK_PROVIDERS, BYOK_PROVIDER_IDS, detectOllama, fetchEndpointModels, isByokProvider, OAUTH_PROVIDERS, syncModelsJson,
  type ByokProvider,
} from "./providers";
import { providerKeyFor, validateEndpoint, type CustomEndpoint } from "./modelsJson";
import { ledgerTotal, parseCalls, planProvidersFor, type ApiCall } from "./calls";
import { logOneShot, type OneShotKind } from "./oneShotLog";
import { deleteSessionFile, isSessionEmpty, readSessionFile, SessionIndex, WorkspaceRegistry, sessionsOfWorkspace, type SessionMeta } from "./store";
import { SessionManager, sweepOrphans, type SessionExit } from "./SessionManager";
import { SessionActivity } from "./activity";
import { parseSubagentNotify } from "./subagentEvents";
import { pollSubagentStatus } from "./subagentStatus";
import { EventLog } from "./log";
import { aggregate, type AnalyticsFilter } from "./analytics";
import { generateTitle } from "./titles";
import { promptCommand, type PromptBehavior, type PromptImage } from "./pi/commands";
import { copyClaudeMdToAgentsMd, hasClaudeMd, proposeAgentsMd, readAgentsMd, writeAgentsMd, writeAgentsMdFiles } from "./agentsMd";
import { buildMentionBlocks, buildOpenFilesBlock, openFilesChanged, createDir, createFile, importEntries, listDir, listRecursive, moveEntry, readWorkspaceFile, resolveInWorkspace, statDetails, statMtime, writeWorkspaceFile } from "./files";
import { unwatchAll, unwatchWorkspace, watchWorkspace } from "./watch";
import {
  appendGitignore, branchCommits, defaultBranch, deleteBranch, detectJunk, discardUntracked, fetchRemote, gitAvailable, gitDiff,
  gitHistory, gitShow, gitStatus, initPreview, initRepo, invalidateProbe, listBranches, probeWorkspace,
  publish, remoteUrl, saveVersion, stageFile, stash, switchBranch, sync, undoFile, undoHunk,
} from "./git";
import { unwatchAllGit, unwatchGit, watchGitDir } from "./gitWatch";
import { draftCommitMessage, draftPullRequest } from "./gitMessage";
import { humaniseBranch, parseRemote, pullRequestUrl } from "./gitForge";
import { listPlanProgress, readPlan, setPlanStatus, writePlanFile, PLAN_DIR } from "./plans";
import {
  captureSnapshot, deleteSessionSnapshots, findRestoreTarget, listSnapshots,
  previewRestore, restoreSnapshot, stampSnapshot,
} from "./snapshots";
import { buildPlanPrompt, shouldReconcilePlanOff, type PlanStatus } from "../../pi-runtime/extensions/hv-plan";
import { buildTerminalPrompt } from "../../pi-runtime/extensions/hv-terminal";
import { expandedHash, pairPromptTemplateItems, restoreItems, type RestoreItem } from "./restore";
import { inlineMentionPaths, willExpand } from "./promptTemplateMentions";
import { compactionInfo, compactionReason, contextItems, earlierItems } from "./history";
import { globalAppendFile, readAppend, writeAppend } from "./appendSystem";
import { readMcpFile, writeMcpServer, serverNameInFiles, type McpServerConfig } from "./mcp";
import { sweepLegacyCredentials } from "./mcpAuthStore";
import { createAdapterStore, type AdapterEntry } from "./mcpAdapterStore";
import { mapLimit, probe } from "./mcpClient";
import { resolveMcpConfig } from "./mcpResolve";
import { authenticate, logout } from "./mcpOAuth";
import { statusKey } from "./mcpStatusKey";
import { affectedSessionIds, type ReloadSession } from "./mcpReloadScope";
import { hasNodeRuntime } from "./nodePreflight";
import { isUnhandledBlockingUi, UI_CANCEL_RESPONSE } from "./uiFallback";
import { catalogEntry, buildCatalogInstall } from "./mcpCatalog";

/**
 * One provider's auth status, as the bridge's `/hv-auth-status` reports it
 * (mirrors AuthProviderStatus in src/renderer/src/auth.ts). Main keeps the map so
 * a sign-in result outlives whichever page happened to be mounted.
 */
interface AuthProviderState {
  configured: boolean;
  source?: string;
  label?: string;
}

function truncateTitle(msg: string): string {
  const oneLine = msg.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? oneLine.slice(0, 57) + "…" : oneLine;
}

/** True iff this ui-request is a HappyVibe permission prompt (mirrors renderer parsePermission). */
function isPermissionPrompt(r: { method?: string; title?: string }): boolean {
  if (r.method !== "select") return false;
  try {
    return (JSON.parse(r.title ?? "") as { kind?: string })?.kind === "hv.permission";
  } catch {
    return false;
  }
}

/** hv.audit payload when this ui-request is the bridge's audit notify, else null. */
function parseAuditNotify(r: { method?: string; message?: string }): Record<string, unknown> | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    return p?.kind === "hv.audit" ? p : null;
  } catch {
    return null;
  }
}

/** §14: an hv.skill invocation notify (skill loaded via use_skill or raw read), else null. */
function parseSkillNotify(r: { method?: string; message?: string }): Record<string, unknown> | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    return p?.kind === "hv.skill" ? p : null;
  } catch {
    return null;
  }
}

/** §24: an hv.prompt-template notify (a prompt template expanded), else null. */
/**
 * §24: an hv.prompt-template pairing notify, else null.
 *
 * Returns the WHOLE payload, not just the two fields main reads. Main re-emits
 * this envelope to the renderer with `typed` swapped for the user's original
 * message, and re-serializing from a narrowed object silently dropped `kind` —
 * the discriminator the renderer switches on — so every live card stopped
 * rendering while the restore path (which reads the log, not the notify) kept
 * working and hid it. Pinned by tests/command-notify.test.ts.
 */
export function parsePromptTemplateNotify(
  r: { method?: string; message?: string },
): ({ kind: string; typed: string; expanded: string } & Record<string, unknown>) | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    return p?.kind === "hv.prompt-template" && typeof p.typed === "string" && typeof p.expanded === "string"
      ? (p as { kind: string; typed: string; expanded: string } & Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The envelope main forwards for a pairing: the payload verbatim, with `typed`
 *  replaced by what the user actually wrote. Every other field — `kind` above
 *  all — must survive. */
export function promptTemplateNotifyMessage(
  payload: Record<string, unknown>,
  typed: string,
): string {
  return JSON.stringify({ ...payload, typed });
}

/** Which config source a live respawn is applying — cosmetic, shown in the renderer notice. */
type ReloadReason = "mcp" | "skills" | "promptTemplates";

/** §23: a plan-family notify (hv.plan | hv.plan-status | hv.plan.blocked), else null. */
function parsePlanNotify(r: { method?: string; message?: string }): Record<string, unknown> | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as Record<string, unknown>;
    const k = p?.kind;
    return k === "hv.plan" || k === "hv.plan-status" || k === "hv.plan.blocked" ? p : null;
  } catch {
    return null;
  }
}

/** §26 part 2: the blocking agent-terminal inputs. Main ALWAYS answers one. */
function parseTerminalReq(r: { method?: string; title?: string }):
  | { kind: "run"; command: string; terminalId?: string; intent?: string }
  | { kind: "read"; terminalId: string; lines?: number; waitMs?: number }
  | { kind: "kill"; terminalId: string }
  | null {
  if (r.method !== "input") return null;
  try {
    const p = JSON.parse(r.title ?? "") as Record<string, unknown>;
    if (p.kind === "hv.terminal-run" && typeof p.command === "string") {
      return {
        kind: "run",
        command: p.command,
        terminalId: typeof p.terminalId === "string" ? p.terminalId : undefined,
        intent: typeof p.intent === "string" ? p.intent : undefined,
      };
    }
    if (p.kind === "hv.terminal-read" && typeof p.terminalId === "string") {
      return {
        kind: "read",
        terminalId: p.terminalId,
        lines: typeof p.lines === "number" ? p.lines : undefined,
        waitMs: typeof p.waitMs === "number" ? p.waitMs : undefined,
      };
    }
    if (p.kind === "hv.terminal-kill" && typeof p.terminalId === "string") {
      return { kind: "kill", terminalId: p.terminalId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * §28: how long one browser action may take before main answers anyway.
 * Generous — a real page op is milliseconds — because the point is to make a
 * wedged turn impossible, not to police slow pages.
 */
const BROWSER_OP_TIMEOUT_MS = 30_000;

/**
 * §28: the blocking agent-browser inputs. Main ALWAYS answers one, exactly like
 * hv.terminal-* — a bridge left waiting on ctx.ui.input hangs the turn.
 *
 * The payload rides `title` because these are blocking INPUTS. (A notify carries
 * its payload in `message`; getting that backwards is why a card can silently
 * never appear — §26 records the same trap.)
 */
type BrowserReq =
  | { kind: "open"; url: string; intent?: string }
  | { kind: "navigate"; url: string; intent?: string }
  | { kind: "screenshot"; intent?: string }
  | { kind: "get-text" }
  | { kind: "read-console"; lines?: number }
  | { kind: "read-network"; limit?: number }
  | { kind: "click"; selector: string; intent?: string }
  | { kind: "type"; selector: string; text: string; intent?: string }
  | { kind: "evaluate"; code: string; intent?: string }
  | { kind: "close"; intent?: string };

function parseBrowserReq(r: { method?: string; title?: string }): BrowserReq | null {
  if (r.method !== "input") return null;
  try {
    const p = JSON.parse(r.title ?? "") as Record<string, unknown>;
    const kind = typeof p.kind === "string" ? p.kind : "";
    if (!kind.startsWith("hv.browser-")) return null;
    const str = (k: string): string | undefined => (typeof p[k] === "string" ? (p[k] as string) : undefined);
    const num = (k: string): number | undefined => (typeof p[k] === "number" ? (p[k] as number) : undefined);
    const intent = str("intent");
    switch (kind) {
      case "hv.browser-open":
        return str("url") ? { kind: "open", url: str("url")!, intent } : null;
      case "hv.browser-navigate":
        return str("url") ? { kind: "navigate", url: str("url")!, intent } : null;
      case "hv.browser-screenshot":
        return { kind: "screenshot", intent };
      case "hv.browser-get-text":
        return { kind: "get-text" };
      case "hv.browser-read-console":
        return { kind: "read-console", lines: num("lines") };
      case "hv.browser-read-network":
        return { kind: "read-network", limit: num("limit") };
      case "hv.browser-click":
        return str("selector") ? { kind: "click", selector: str("selector")!, intent } : null;
      case "hv.browser-type":
        return str("selector") !== undefined && str("text") !== undefined
          ? { kind: "type", selector: str("selector")!, text: str("text")!, intent }
          : null;
      case "hv.browser-evaluate":
        return str("code") ? { kind: "evaluate", code: str("code")!, intent } : null;
      case "hv.browser-close":
        return { kind: "close", intent };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** §23: the blocking plan-write input payload (main writes the file, answers with the path), else null. */
function parsePlanWrite(r: { method?: string; title?: string }): { plan: string } | null {
  if (r.method !== "input") return null;
  try {
    const p = JSON.parse(r.title ?? "") as { kind?: string; plan?: unknown };
    return p?.kind === "hv.plan-write" && typeof p.plan === "string" ? { plan: p.plan } : null;
  } catch {
    return null;
  }
}

export function registerIpc(win: BrowserWindow): void {
  // Guard every renderer push: on quit a Pi child can flush a final event after
  // the window/webContents is destroyed — sending then throws "Object has been
  // destroyed". Drop those late sends instead of crashing.
  const send = (channel: string, payload?: unknown): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };
  // §27: whole-state voice snapshots, same broadcast shape as
  // hv:mcp-status-changed. The facade already throttles to ~4 Hz — a 652 MB
  // body fires `data` thousands of times a second.
  onVoiceStatus((s) => send("hv:voice-status-changed", s));
  const userData = app.getPath("userData");
  const index = new SessionIndex(path.join(userData, "session-index.json"));
  // Heal stale absolute piSessionFile paths after a userData move (the
  // hv-scaffold → HappyVibe rename), else resume loads no history.
  index.rebaseSessionFiles(sessionDir());
  const workspaces = new WorkspaceRegistry(path.join(userData, "workspaces.json"));
  const log = new EventLog(path.join(userData, "events.jsonl"));
  const pidFile = path.join(userData, "pi-pids.json");

  // ── §26 Terminals ──────────────────────────────────────────────────────────
  // PTYs are owned by MAIN, so they outlive a renderer reload — which is the
  // whole reason a re-attaching tab can repaint from the headless mirror
  // instead of starting a fresh shell. Data goes straight out on a push
  // channel; the renderer writes it into xterm without it ever touching React
  // state (§7's streaming invariant).
  // §26 part 2: terminal_read's `waitMs` settles for quiet rather than making
  // the agent sleep in bash. One tap on the data callback, no other consumer.
  const termDataTaps = new Map<string, Set<() => void>>();
  const onTerminalData = (id: string, cb: () => void): (() => void) => {
    const set = termDataTaps.get(id) ?? new Set();
    termDataTaps.set(id, set);
    set.add(cb);
    return () => set.delete(cb);
  };
  const terminals = new TerminalManager(
    (id, data) => {
      for (const cb of termDataTaps.get(id) ?? []) cb();
      send("hv:term-data", { id, data });
    },
    (id, code) => send("hv:term-exit", { id, code }),
    (id, title) => send("hv:term-title", { id, title }),
  );
  // §26 part 2: who owns which terminal, the cap, the busy-reuse refusal and the
  // interleave hold. TerminalManager stays session-ignorant.
  const agentTerminals = new AgentTerminals(terminals);
  // A PTY is a child of main, not of a Pi session, so nothing else tears them
  // down. Without this a quit leaks every running shell.
  app.on("before-quit", () => terminals.killAll());

  // ── §28 Embedded browser ───────────────────────────────────────────────────
  // Panes are owned by MAIN for the same reason PTYs are: they outlive a
  // renderer reload and a Pi respawn. Every request the guest makes is logged
  // here — the egress gate lives on the partition (browsers.ts), not on the
  // tool call, because JS inside the page can navigate without any tool.
  const browsers = new BrowserManager(
    win,
    (info) => send("hv:browser-state", info),
    (id, req) => {
      // Deliberately NOT one EventLog entry per subresource: a single page load
      // is dozens, and drowning the audit trail is how it stops being read. The
      // ring buffer holds them all for browser_read_network; the LOG records
      // main-frame navigations, which is what a human audits.
      if (req.resourceType === "mainFrame") {
        void log.append({ type: "browser.nav", data: { browserId: id, url: req.url, method: req.method } });
      }
    },
  );
  const agentBrowsers = new AgentBrowsers(browsers);
  app.on("before-quit", () => browsers.destroyAll());

  /**
   * §26: resolve when the terminal has produced no bytes for ~400ms, or when
   * the cap expires. Without it the agent's only way to wait is bash("sleep 3"),
   * a second gated tool call per poll, forever.
   */
  const settleQuiet = (terminalId: string, capMs: number): Promise<void> => {
    const QUIET_MS = 400;
    return new Promise((resolve) => {
      let last = Date.now();
      const started = last;
      const off = onTerminalData(terminalId, () => {
        last = Date.now();
      });
      const tick = setInterval(() => {
        if (Date.now() - last >= QUIET_MS || Date.now() - started >= capMs) {
          clearInterval(tick);
          off();
          resolve();
        }
      }, 100);
      tick.unref?.();
    });
  };

  // ── §14 Skills ─────────────────────────────────────────────────────────────
  const skillRegistry = new SkillRegistry(path.join(userData, "skills-approvals.jsonl"));
  // Pre-approve bundled starter skills (off by default) — idempotent.
  try {
    installBundledSkills(bundledSkillsDir(piRuntimeDir()), skillRegistry, new Date().toISOString());
  } catch (e) {
    console.warn("[hv] bundled skills install failed:", e);
  }
  const skillsManifestDir = path.join(userData, "skills-manifests");
  const globalScanDirs = () => ({
    managedDir: managedSkillsDir(agentDir()),
    bundledDir: bundledSkillsDir(piRuntimeDir()),
    linkedDirs: getLinkedSkillDirs(),
  });
  /** Global-scope skills (bundled + managed + linked), current on-disk snapshot. */
  const discoverGlobalSkills = (): DiscoveredSkill[] => discoverGlobal(globalScanDirs());
  /** The (skill, scope) entries a session in this workspace should spawn with. */
  const activeSkillEntries = (workspace: string): Array<{ skill: DiscoveredSkill; scope: "global" | "workspace" }> => {
    const activation = workspaces.getSkillsActive(workspace);
    const global = discoverGlobalSkills();
    const ws = discoverWorkspace(workspace);
    const activeGlobal = new Set(resolveActiveSkills(global, skillRegistry, activation));
    const activeWs = new Set(resolveActiveSkills(ws, skillRegistry, activation));
    return [
      ...global.filter((s) => activeGlobal.has(s.id)).map((skill) => ({ skill, scope: "global" as const })),
      ...ws.filter((s) => activeWs.has(s.id)).map((skill) => ({ skill, scope: "workspace" as const })),
    ];
  };
  /** Write this session's loaded-skills manifest → HV_SKILLS_FILE. Returns the path. */
  const writeSkillsManifest = (sessionId: string, entries: ReturnType<typeof activeSkillEntries>): string => {
    fs.mkdirSync(skillsManifestDir, { recursive: true });
    const file = path.join(skillsManifestDir, `${sessionId}.json`);
    fs.writeFileSync(file, JSON.stringify(buildManifest(entries)));
    // The renderer's session chip + /skill: menu read THIS file. skillsChanged()
    // fires when config changes, which is BEFORE the debounced respawn rewrites
    // the manifest — so notify again here, once the new set is actually on disk,
    // or the chip shows the pre-change set until the user switches sessions.
    send("hv:skills-changed");
    return file;
  };
  const skillsChanged = (): void => send("hv:skills-changed");

  // ── §24 Commands (prompt templates) ────────────────────────────────────────
  // The §14 shape, one axis simpler: a command is ONE .md file, so the approval
  // key is a file path and the gate is `--no-prompt-templates` + one
  // `--prompt-template <file>` per approved command. There is NO manifest —
  // Pi expands templates itself, so the bridge is handed nothing about commands.
  const promptTemplateRegistry = new PromptTemplateRegistry(path.join(userData, "prompt-templates-approvals.jsonl"));
  try {
    installBundledPromptTemplates(bundledPromptTemplatesDir(piRuntimeDir()), promptTemplateRegistry, new Date().toISOString());
  } catch (e) {
    console.warn("[hv] bundled prompts install failed:", e);
  }
  const globalPromptTemplateDirs = () => ({
    managedDir: managedPromptTemplatesDir(agentDir()),
    bundledDir: bundledPromptTemplatesDir(piRuntimeDir()),
    linkedDirs: getLinkedPromptTemplateDirs(),
  });
  const globalPromptTemplates = (): DiscoveredPromptTemplate[] => discoverGlobalPromptTemplates(globalPromptTemplateDirs());
  /** The command FILES a session in this workspace should spawn with (--prompt-template args). */
  const activePromptTemplateEntries = (workspace: string): string[] => {
    const activation = workspaces.getPromptTemplatesActive(workspace);
    return [
      ...resolveActivePromptTemplates(globalPromptTemplates(), promptTemplateRegistry, activation),
      ...resolveActivePromptTemplates(discoverWorkspacePromptTemplates(workspace), promptTemplateRegistry, activation),
    ];
  };
  const promptTemplatesChanged = (): void => send("hv:prompt-templates-changed");
  /**
   * §24: main's OUTGOING message → what the user actually typed. Only populated
   * when the two differ, i.e. when a command's @mentions were rewritten to paths
   * (commandMentions.ts). The bridge can only ever report the outgoing form, so
   * without this the card would be titled `/explain src/audio/Sfx.ts` while the
   * user typed `/explain @Sfx.ts`. Consumed once, when the pairing notify lands.
   * ponytail: cleared wholesale past a generous cap — a stale miss costs a card
   * title, never a message.
   */
  const typedByOutgoing = new Map<string, string>();
  /**
   * Round 11: the open-file set last sent to each session, so the block rides a
   * prompt only when it CHANGED. Without this every turn carries its own
   * snapshot and the model sees a history of stale lists. Cleared when the
   * session ends (an id is never reused).
   */
  const lastOpenFiles = new Map<string, string[]>();
  /**
   * §26 part 2: the same idea for the terminals a session started. The RENDERED
   * block is stored rather than the list, because it is sorted and therefore
   * byte-stable — so the change check is a string compare and needs no
   * openFilesChanged twin.
   */
  const lastOpenTerminals = new Map<string, string>();
  /** §28: the same trick for the one-line open-browser block. */
  const lastOpenBrowser = new Map<string, string>();
  /**
   * §24: the typed form of every command invocation logged for a session, keyed
   * by sha256(expanded). Restore hashes each user message against this map, so a
   * reloaded transcript shows the card instead of the expansion (restore.ts).
   */
  const promptTemplatePairs = async (sessionId: string): Promise<Map<string, string>> =>
    new Map(
      (await log.read({ type: "prompt-template.invoked", sessionId }))
        .map((ev) => [String(ev.data?.expandedHash ?? ""), String(ev.data?.typed ?? "")] as const)
        .filter(([hash, typed]) => hash && typed),
    );

  // Kill pi processes a previous app run left behind (crash / force-quit).
  const swept = sweepOrphans(pidFile);
  if (swept.length) console.warn("[hv] swept orphan pi processes:", swept);

  // B6: install/refresh the bundled built-in agents into the app-owned agent
  // dir (idempotent, never clobbers user edits). pi-subagents discovers them.
  try {
    installBuiltinAgents(path.join(piRuntimeDir(), "agents"));
  } catch (e) {
    console.warn("[hv] built-in agent install failed:", e);
  }

  // Async-by-default subagents (PRD §12) — pi-subagents reads this at spawn.
  try {
    writeSubagentConfig();
  } catch (e) {
    console.warn("[hv] subagent config write failed:", e);
  }


  // W1.3: main-side activity knowledge (busy / pending prompt / subagent) —
  // hibernation must never touch a genuinely active session.
  const activity = new SessionActivity();

  /**
   * §16 (2026-07-30): every provider a spawn could legitimately use. Sent to the
   * renderer via hv:get-providers so BOTH sides filter with the SAME set — an
   * auth-filtered list on one side and this one on the other made the chip claim
   * a model that the spawn did not use.
   */
  const knownProviders = (): string[] => [
    ...BYOK_PROVIDER_IDS,
    ...OAUTH_PROVIDERS.map((p) => p.id),
    "ollama",
    ...listCustomEndpoints().map((e) => e.providerKey),
  ];

  /**
   * The model a spawn should use: session → workspace → global, skipping any
   * tier whose provider no longer exists (a deleted custom endpoint). Mirrors
   * dropUnknownProvider in renderer composer.ts — change both or neither.
   * Used by EVERY spawn path (chat sessions, title generation, AGENTS.md
   * proposal) so the resolution lives in exactly one place on this side.
   */
  const resolveSpawnModel = (
    workspace?: string,
    sessionId?: string,
  ): { provider: string; modelId: string } | null => {
    const known = knownProviders();
    const live = (m: { provider: string; modelId: string } | null | undefined) =>
      m && known.includes(m.provider) ? m : null;
    return (
      live(sessionId ? index.get(sessionId)?.model : null) ??
      live(workspace ? workspaces.getModel(workspace) : null) ??
      live(getDefaultModel())
    );
  };

  /** Everything a Pi spawn needs from provider config (B3) + rules delivery (B4).
   *  Model resolution (W2.1, full PRD hierarchy): session override → workspace
   *  override → global default. Mirrors resolveModel in renderer composer.ts. */
  const spawnOpts = (workspace?: string, resumeFile?: string, sessionId?: string) => {
    // §14: resolve the approved ∩ enabled ∩ active-for-workspace skill set and
    // write the per-session manifest the bridge reads (HV_SKILLS_FILE). Only for
    // real chat sessions — the utility client ($HOME, no workspace/id) loads none.
    const entries = workspace && sessionId ? activeSkillEntries(workspace) : [];
    return {
      model: resolveSpawnModel(workspace, sessionId),
      agentDir: agentDir(),
      providerEnv: providerEnv(),
      resumeFile,
      rulesFile: rulesFile(),
      // #14: persistent bypass resolved workspace ?? global ?? off; re-applied on
      // every (re)spawn so it survives respawns (unlike session dangerous mode).
      bypass: resolveBypass(workspace ?? null),
      // §13 round 6: global on/off for built-in custom tools, re-applied on
      // every (re)spawn — mirrors bypass, but global-only (no workspace tier).
      builtinTools: getBuiltinTools(),
      // Prompt-cache retention: global, spawn-time (PI_CACHE_RETENTION).
      longCache: getLongCache(),
      skills: entries.map((e) => e.skill.id),
      skillsFile: sessionId ? writeSkillsManifest(sessionId, entries) : undefined,
      // §24: one --prompt-template per approved ∩ enabled ∩ active command. No
      // manifest counterpart — the bridge reads nothing about commands.
      promptTemplates: workspace && sessionId ? activePromptTemplateEntries(workspace) : [],
    };
  };

  /**
   * §28: can THIS session's model read an image?
   *
   * Pi's registry is the only thing that knows (`input` includes "image"), and
   * it answers over the utility client, so the list is fetched once and cached.
   * Deliberately resolved here rather than mirrored into a second capability
   * table: `resolveSpawnModel` is already the one place that knows which model a
   * session runs, and a second list is a second thing to be wrong.
   * Unknown model, or no list yet ⇒ FALSE — the honest default is text, exactly
   * as the composer's attach button defaults to disabled (composer.ts
   * supportsVision, same rule).
   */
  let visionModels: Array<{ provider: string; id: string; input?: string[] }> | null = null;
  const sessionCanSeeImages = async (workspace?: string, sessionId?: string): Promise<boolean> => {
    try {
      const ref = resolveSpawnModel(workspace, sessionId);
      if (!ref) return false;
      if (!visionModels) {
        const c = await ensureUtility();
        const res = await c.send({ type: "get_available_models" });
        visionModels = (res.data as { models?: Array<{ provider: string; id: string; input?: string[] }> })?.models ?? [];
      }
      const m = visionModels.find((x) => x.provider === ref.provider && x.id === ref.modelId);
      return m?.input?.includes("image") ?? false;
    } catch {
      return false;
    }
  };

  const manager = new SessionManager({
    pidFile,
    spawn: (workspace, resumeFile, sessionId) =>
      new PiClient(resolvePiSpawn(workspace, sessionDir(), piRuntimeDir(), spawnOpts(workspace, resumeFile, sessionId))),
    // W1.3: called at the cap — hibernate the oldest idle session (stats
    // captured best-effort like close-session, index marked, renderer told),
    // or return null so the manager refuses honestly.
    hibernate: async (liveIds) => {
      const victim = activity.oldestIdle(liveIds);
      if (!victim) return null;
      const client = manager.get(victim) as PiClient | null;
      let stats: unknown = null;
      if (client) {
        try {
          stats = (await client.send({ type: "get_session_stats" })).data ?? null;
        } catch {
          /* unresponsive — hibernate without stats */
        }
      }
      const meta = index.get(victim);
      void log.append({
        type: "session.hibernate",
        sessionId: victim,
        workspaceId: meta?.workspaceId,
        data: { stats: stats as Record<string, unknown> | null },
      });
      index.update(victim, { hibernated: true });
      sessionsChanged();
      return victim;
    },
  });

  // Which client owns a pending extension_ui_request id (permission modal, auth flows).
  const UTILITY = "__utility__";
  const uiOwners = new Map<string, string>();
  const clientFor = (owner: string | undefined): PiClient | null =>
    owner === UTILITY ? utility : owner ? (manager.get(owner) as PiClient | null) : null;

  // ── utility client (B3) ──────────────────────────────────────────
  // Auth/model bridge commands ride the RPC prompt channel (s0.2), so they
  // need a live Pi even before any workspace session exists. A $HOME session
  // outside the SessionManager (and outside the index) serves those ops.
  let utility: PiClient | null = null;
  let utilityStarting: Promise<PiClient> | null = null;

  /**
   * Round 11: last-known provider auth status, held in main so a successful
   * sign-in survives whatever the user is looking at. The result arrives as ONE
   * fire-and-forget `hv.auth` notify; before this it was only ever read by a
   * mounted ModelsView, so navigating away mid-browser-round-trip lost it.
   * Mirrors the MCP status map's shape (get + push).
   */
  let authState: Record<string, AuthProviderState> = {};
  /** Ask the bridge to re-report status; the answer lands as an hv.auth notify. */
  const requestAuthStatus = async (): Promise<void> => {
    const c = await ensureUtility();
    void c.send({ type: "prompt", message: "/hv-auth-status" }).catch(() => {});
  };

  const startUtility = async (): Promise<PiClient> => {
    utility?.stop();
    utility = null;
    // Sync Ollama models into the app-owned agent dir so local models are
    // selectable with zero config.
    await syncModelsJson(agentDir(), listCustomEndpoints()).catch(() => {});
    const c = new PiClient(resolvePiSpawn(os.homedir(), sessionDir(), piRuntimeDir(), spawnOpts()));
    c.on("ui-request", (r: { id: string; method?: string; title?: string; message?: string }) => {
      // Same hang as the session path (see uiFallback.ts), and this client has
      // no method filtering at all — a foreign blocking request would wedge the
      // auth/model bridge. No notice: there is no session to attach one to.
      if (isUnhandledBlockingUi(r)) {
        c.respondUi(r.id, UI_CANCEL_RESPONSE);
        void log.append({ type: "ui.unhandled", data: { method: r.method, title: r.title?.slice(0, 200), utility: true } });
        return;
      }
      uiOwners.set(r.id, UTILITY);
      send("hv:ui-request", { ...r, sessionId: UTILITY });
      // Auth landed/left → the model list changed (OAuth results only flow as
      // hv.auth ui-requests, so this is where main learns about them).
      try {
        const p = JSON.parse(r.message ?? "") as {
          kind?: string;
          stage?: string;
          providers?: Record<string, AuthProviderState>;
        };
        if (p?.kind !== "hv.auth") return;
        // Round 11: hold the status HERE. It used to live only in a mounted
        // ModelsView, so navigating away during the browser round-trip dropped
        // the one fire-and-forget success notify — permanently, since nothing
        // persisted it and only that page listened.
        if (p.stage === "status" && p.providers) {
          authState = p.providers;
          send("hv:auth-state-changed", authState);
          return;
        }
        if (p.stage === "success" || p.stage === "logged_out") {
          providersChanged();
          // Pi's AuthStorage reads its file ONCE at process start, so the utility
          // must respawn or it keeps serving the pre-login credential set — the
          // api-key path already does this (hv:set-provider-key). Then re-ask for
          // status so the stored state (and every renderer) catches up.
          void (async () => {
            await restartUtility();
            await requestAuthStatus();
          })().catch(() => {});
        }
      } catch {
        /* not JSON — not an hv.auth notify */
      }
    });
    c.on("exit", () => {
      if (utility === c) utility = null; // crashed — next auth/model op respawns it
    });
    await c.start();
    utility = c;
    return c;
  };
  const ensureUtility = async (): Promise<PiClient> => {
    if (utility) return utility;
    // Guard against concurrent first calls (settings fires status+models together).
    utilityStarting ??= startUtility().finally(() => { utilityStarting = null; });
    return utilityStarting;
  };
  /** Respawn so key changes (they ride spawn env) take effect for auth/model ops. */
  const restartUtility = async (): Promise<void> => {
    if (utility) await startUtility();
  };

  // First user message per session, kept until the model title lands.
  const firstPrompt = new Map<string, string>();

  const sessionsChanged = (): void => send("hv:sessions-changed", index.list());

  // V2.A: single "model config changed" broadcast — fired on BYOK key add/
  // remove, OAuth login/logout (main sees every utility hv.auth notify), and
  // default/workspace-model edits. The chat bar refetches its model list and
  // resolution tiers on it, so the chip and menu are never stale.
  const providersChanged = (): void => send("hv:providers-changed");

  // ── MCP status model ─────────────────────────────────────────────────────
  type McpState = "connected" | "needs-auth" | "failed" | "checking";
  interface McpServerStatus {
    name: string;
    scope: "global" | "workspace";
    workspaceId: string | null;
    state: McpState;
    toolCount: number;
    tools?: { name: string; description?: string }[];
    error?: string;
    lastChecked: number;
  }
  const mcpStatusMap = new Map<string, McpServerStatus>();
  /**
   * MCP credentials live in the OS keychain from pi-mcp-adapter 2.17.0, reached
   * through a one-shot sidecar running the adapter's own code. One instance for
   * the process; each call is its own spawn.
   */
  const adapterStore = createAdapterStore({ agentDir: agentDir(), runtimeDir: piRuntimeDir() });
  const mcpStatusChanged = (): void =>
    send("hv:mcp-status-changed", Array.from(mcpStatusMap.values()));

  const checkServer = async (
    scope: "global" | "workspace",
    workspaceId: string | null,
    name: string,
    /** Pre-read by the sweep so N servers cost ONE sidecar spawn, not N. */
    authEntry?: AdapterEntry,
  ): Promise<void> => {
    const file =
      scope === "global"
        ? path.join(agentDir(), "mcp.json")
        : (() => {
            const ws = path.resolve(workspaceId ?? "");
            if (!workspaces.list().some((w) => path.resolve(w) === ws)) {
              throw new Error("Unknown workspace");
            }
            return path.join(ws, ".mcp.json");
          })();
    const cfg = readMcpFile(file).mcpServers[name];
    if (!cfg) {
      mcpStatusMap.delete(statusKey(scope, workspaceId, name));
      mcpStatusChanged();
      return;
    }
    mcpStatusMap.set(statusKey(scope, workspaceId, name), {
      name, scope, workspaceId, state: "checking", toolCount: 0, lastChecked: Date.now(),
    });
    mcpStatusChanged();
    // §13 round 8: a catalog server's key lives encrypted in config and the file
    // holds only a ${HV_MCP_…} placeholder. The Pi runtime interpolates it at
    // spawn; this process does not, so resolve before probing or every
    // key-based server reports needs-auth with a literal placeholder as its key.
    const result = await probe(name, resolveMcpConfig(cfg, providerEnv()), agentDir(), {
      store: adapterStore,
      authEntry,
    });
    mcpStatusMap.set(statusKey(scope, workspaceId, name), {
      name, scope, workspaceId,
      state: result.state,
      toolCount: result.tools?.length ?? 0,
      tools: result.tools,
      error: result.error,
      lastChecked: Date.now(),
    });
    mcpStatusChanged();
  };

  // Startup connectivity sweep — fire-and-forget, never blocks boot.
  // ponytail: stdio probes briefly spawn each server process; upgrade = persistent handles if startup time bites
  //
  // §13 round 12: CAPPED. This used to fire every configured server at once, so
  // N TLS handshakes, N silent token refreshes and N `npx` cold starts raced
  // each other at the busiest moment the app has — which is most of why servers
  // reported `failed` at boot and connected instantly on a click. The sweep is a
  // badge, not a race; four at a time is plenty.
  const SWEEP_CONCURRENCY = 4;

  /** Config across both tiers, read fresh — the sweep runs at two different times now. */
  const mcpTiers = (): {
    globalFile: Record<string, McpServerConfig>;
    wsFiles: (readonly [string, Record<string, McpServerConfig>])[];
  } => ({
    globalFile: readMcpFile(path.join(agentDir(), "mcp.json")).mcpServers,
    wsFiles: workspaces
      .list()
      .map((ws) => [ws, readMcpFile(path.join(ws, ".mcp.json")).mcpServers] as const),
  });

  /**
   * Boot sweep — STDIO SERVERS ONLY, and that restriction is the point.
   *
   * A remote server's badge needs its OAuth credential, and from pi-mcp-adapter
   * 2.17.0 that lives in the OS keychain. Reading it raises a macOS "wants to
   * use your confidential information" dialog for any binary not on the item's
   * ACL — and measured on a dev build, EVERY access prompts, even from the
   * binary that created the item, because an ad-hoc signature gives macOS no
   * stable identity to record ("Always Allow" cannot stick). Doing that at
   * launch means the app opens with a password dialog in front of it.
   *
   * So remote servers are swept when the user opens the MCP page instead
   * (hv:mcp-sweep-remote): the prompt then answers a question they just asked,
   * once per run, on the surface that is about MCP servers. Stdio servers need
   * no credential and keep their boot badge.
   */
  void (async () => {
    const { globalFile, wsFiles } = mcpTiers();
    const checks: Array<() => Promise<void>> = [
      ...Object.entries(globalFile).filter(([, c]) => !c.url).map(([n]) => () => checkServer("global", null, n)),
      ...wsFiles.flatMap(([ws, servers]) =>
        Object.entries(servers).filter(([, c]) => !c.url).map(([n]) => () => checkServer("workspace", ws, n)),
      ),
    ];
    if (!checks.length) return;
    await mapLimit(checks, SWEEP_CONCURRENCY, (run) => run());
    const byState: Record<string, number> = {};
    for (const st of mcpStatusMap.values()) byState[st.state] = (byState[st.state] ?? 0) + 1;
    void log.append({ type: "mcp.startup_check", data: { total: checks.length, byState, tier: "stdio" } });
  })().catch((e) => console.warn("[hv] mcp startup sweep failed:", e));

  /**
   * Remote sweep — one credential read for every remote server, then their
   * probes. Latched: at most once per app run unless forced, because each run
   * can cost the user a keychain prompt.
   */
  let remoteSweepDone = false;
  const sweepRemote = async (force = false): Promise<void> => {
    if (remoteSweepDone && !force) return;
    remoteSweepDone = true;
    const { globalFile, wsFiles } = mcpTiers();

    /**
     * ONE sidecar spawn for the whole sweep. Credentials are keyed by server
     * NAME only (the adapter hashes the name, not the tier), so a global and a
     * workspace server sharing a name share a credential — deduplicating by
     * name here is correct, not a shortcut.
     */
    const httpByName = new Map<string, { name: string; url: string }>();
    for (const [n, cfg] of Object.entries(globalFile)) if (cfg.url) httpByName.set(n, { name: n, url: cfg.url });
    for (const [, servers] of wsFiles) {
      for (const [n, cfg] of Object.entries(servers)) if (cfg.url) httpByName.set(n, { name: n, url: cfg.url });
    }
    const wanted = [...httpByName.values()];
    if (!wanted.length) return;

    let prefetched: Record<string, AdapterEntry> = {};
    try {
      prefetched = await adapterStore.read(wanted);

      // One-time: hand the adapter anything main wrote before it stopped owning
      // this store, then delete the orphans nobody will ever migrate. It reuses
      // the read above rather than taking its own — every extra sidecar call is
      // another keychain dialog for the user.
      try {
        const swept = await sweepLegacyCredentials(agentDir(), wanted, adapterStore, prefetched);
        if (swept.adopted || swept.discarded || swept.deleted) {
          void log.append({ type: "mcp.legacy_sweep", data: swept });
          if (swept.adopted) prefetched = await adapterStore.read(wanted);
        }
      } catch (e) {
        console.warn("[hv] mcp legacy credential sweep failed:", e);
      }
    } catch (e) {
      // Do NOT leave this empty and let each probe read its own. Each read can
      // raise its own dialog, so N fallbacks means N stacked ones — observed,
      // four at once, from exactly this path. If the one batched read could not
      // answer, nothing else will: mark every server unavailable so each reports
      // `failed` WITH the reason, and the user is asked at most once.
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[hv] mcp credential prefetch failed:", message);
      prefetched = Object.fromEntries(
        wanted.map((s) => [s.name, { status: "unavailable", message } as AdapterEntry]),
      );
    }

    const checks: Array<() => Promise<void>> = [
      ...Object.entries(globalFile).filter(([, c]) => c.url).map(([n]) => () => checkServer("global", null, n, prefetched[n])),
      ...wsFiles.flatMap(([ws, servers]) =>
        Object.entries(servers).filter(([, c]) => c.url).map(([n]) => () => checkServer("workspace", ws, n, prefetched[n])),
      ),
    ];
    await mapLimit(checks, SWEEP_CONCURRENCY, (run) => run());
    const byState: Record<string, number> = {};
    for (const st of mcpStatusMap.values()) byState[st.state] = (byState[st.state] ?? 0) + 1;
    void log.append({ type: "mcp.startup_check", data: { total: checks.length, byState, tier: "remote" } });
  };

  // Called by the MCP page on mount. `force` is the Reconnect-all affordance.
  ipcMain.handle("hv:mcp-sweep-remote", async (_e, force?: boolean) => {
    await sweepRemote(force === true).catch((e) => console.warn("[hv] mcp remote sweep failed:", e));
    return Array.from(mcpStatusMap.values());
  });

  const maybeTitle = (sessionId: string): void => {
    const meta = index.get(sessionId);
    const msg = firstPrompt.get(sessionId);
    if (!meta || meta.titleSource !== "fallback" || !msg) return;
    firstPrompt.delete(sessionId);
    // Fire-and-forget — never blocks the chat; fallback title stays on failure.
    void generateTitle(piRuntimeDir(), meta.workspaceId, msg, {
      // §16: same guarded resolution as a chat spawn — a removed endpoint's
      // ref must not be handed to a one-shot Pi call either.
      model: resolveSpawnModel(),
      // BYOK keys via env; OAuth creds live in auth.json under the agent dir.
      env: { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
      onDone: oneShot("title", meta.workspaceId, sessionId),
    }).then((title) => {
      const cur = index.get(sessionId);
      if (title && cur && cur.titleSource === "fallback") {
        index.update(sessionId, { title, titleSource: "model" });
        sessionsChanged();
      }
    });
  };

  const captureSessionFile = async (sessionId: string, client: PiClient): Promise<void> => {
    try {
      const state = (await client.send({ type: "get_state" })).data as { sessionFile?: string } | undefined;
      if (state?.sessionFile) index.update(sessionId, { piSessionFile: state.sessionFile });
    } catch {
      /* crashed before answering — piSessionFile stays unset */
    }
  };

  const attach = (sessionId: string, client: PiClient): void => {
    const meta = index.get(sessionId);
    client.on("event", (e: Record<string, unknown>) => {
      activity.event(sessionId, e); // W1.3: busy/subagent state + last-activity
      // §9 rewind: stamp the pending "pre" snapshot with the turn's FIRST
      // toolCallId (the only id durable across a reload), and record what the
      // agent left behind at agent_end — that record is the stale-check's
      // reference. Best-effort: snapshotting must never disturb the stream.
      const snapWsId = index.get(sessionId)?.workspaceId;
      if (snapWsId) {
        try {
          if (e.type === "tool_execution_start" && typeof e.toolCallId === "string") {
            stampSnapshot(snapshotDir(), sessionId, e.toolCallId);
          } else if (e.type === "agent_end") {
            captureSnapshot(
              snapshotDir(), sessionId, workspaces.list(), snapWsId,
              "post", new Date().toISOString(),
            );
          }
        } catch {
          /* never disturb the event stream */
        }
      }
      send("hv:pi-event", { ...e, sessionId });
      // The compaction session-file entry carries no reason — only this event
      // does. Log it so a restored boundary bubble can say WHY the history is
      // gone: Pi's auto-compaction is ON by default (settings default
      // `compaction.enabled ?? true`, and we never call set_auto_compaction), so
      // "you didn't ask for this one" is the honest label. `firstKeptEntryId` is
      // the join key back to the file entry (history.ts compactionReason). Also
      // closes the §11 promise that the audit log records context compactions.
      if (e.type === "compaction_end") {
        const c = e as { reason?: string; result?: { firstKeptEntryId?: string; tokensBefore?: number } };
        void log.append({
          type: "context.compact",
          sessionId,
          workspaceId: meta?.workspaceId,
          data: {
            reason: c.reason ?? "unknown",
            firstKeptEntryId: c.result?.firstKeptEntryId ?? null,
            tokensBefore: c.result?.tokensBefore ?? null,
          },
        });
      }
      if (e.type === "agent_end") {
        maybeTitle(sessionId);
        if (meta && !index.get(sessionId)?.piSessionFile) void captureSessionFile(sessionId, client);
        drainPendingReload(sessionId); // apply a deferred MCP reload now the turn is done
        // §29: the third refresh seam, and the one that pays for suppressing the
        // other two. Forced: the session is still marked busy at this instant,
        // so a gated push would drop exactly the refresh the user is waiting for.
        if (meta) pushGitChanged(meta.workspaceId, { force: true });
      }
    });
    client.on("ui-request", (r: { id: string; method?: string; title?: string; message?: string }) => {
      // B4 audit channel: hv.audit notifies are fire-and-forget (never respond)
      // and land in the EventLog, not the renderer.
      const audit = parseAuditNotify(r);
      if (audit) {
        void log.append({ type: "permission.decision", sessionId, workspaceId: meta?.workspaceId, data: audit });
        return;
      }
      // §14: skill invocation — audit it and forward to the renderer (invocation
      // card). Raw-read fallbacks are flagged heuristic (detected:true).
      const skill = parseSkillNotify(r);
      if (skill) {
        void log.append({ type: "skill.invoked", sessionId, workspaceId: meta?.workspaceId, data: skill });
        send("hv:ui-request", { ...r, sessionId });
        return;
      }
      // §24: a prompt template expanded. Log {typed, sha256(expanded)} — the
      // expansion itself is already in the session file, and the hash is what
      // re-pairs the card after a reload (restore.ts pairPromptTemplateItems). Forward
      // the envelope too, so the live transcript can draw the card now.
      const command = parsePromptTemplateNotify(r);
      if (command) {
        // §24: the bridge reports MAIN's outgoing text, which is not what the
        // user typed — @mentions have been rewritten to paths by then. Recover
        // the original so the card is titled with the keystrokes, live and after
        // a reload alike (they must not disagree; that is the whole point).
        const typed = typedByOutgoing.get(command.typed) ?? command.typed;
        typedByOutgoing.delete(command.typed);
        void log.append({
          type: "prompt-template.invoked",
          sessionId,
          workspaceId: meta?.workspaceId,
          data: { sessionId, typed, expandedHash: expandedHash(command.expanded) },
        });
        send("hv:ui-request", { ...r, message: promptTemplateNotifyMessage(command, typed), sessionId });
        return;
      }
      // Async subagents: lifecycle relays drive activity gating (a live async run
      // keeps the session non-idle so a respawn can't kill it), status polling,
      // and the audit log. The envelope still forwards to the renderer below.
      const sub = parseSubagentNotify(r);
      if (sub) {
        if (sub.stage === "started" && sub.runId) {
          activity.asyncStarted(sessionId, sub.runId);
          startSubagentPoll(sessionId, sub.runId, sub.asyncDir);
          void log.append({ type: "subagent.async_started", sessionId, workspaceId: meta?.workspaceId, data: { runId: sub.runId, agent: sub.agent } });
        } else if (sub.stage === "complete" && sub.runId) {
          activity.asyncEnded(sessionId, sub.runId);
          stopSubagentPoll(sub.runId);
          drainPendingReload(sessionId); // a deferred reload can now proceed
          void log.append({ type: "subagent.async_complete", sessionId, workspaceId: meta?.workspaceId, data: { runId: sub.runId, status: sub.status } });
        } else if (sub.stage === "active") {
          const runs = sub.runs ?? [];
          activity.asyncSet(sessionId, runs.map((x) => x.runId));
          reconcileSubagentPolls(sessionId, runs);
        } else if (sub.stage === "interrupt-sent" && sub.runId) {
          void log.append({ type: "subagent.interrupt", sessionId, workspaceId: meta?.workspaceId, data: { runId: sub.runId } });
        }
        send("hv:ui-request", { ...r, sessionId });
        return;
      }
      // §26 part 2: the blocking terminal inputs. Main ALWAYS respondUi — a
      // failure is a JSON {ok:false,reason}, never a dropped response, or the
      // bridge waits on ctx.ui.input forever and the turn hangs.
      const term = parseTerminalReq(r as { method?: string; title?: string });
      if (term) {
        void (async () => {
          const rid = r.id;
          const reply = (v: unknown): void => client.respondUi(rid, { value: JSON.stringify(v) });
          // The card is a transcript item, so it rides the same ui-request
          // channel the delegation card does. A notify carries its payload in
          // `message` (a blocking input uses `title`) — the renderer's parsers
          // all read `message`, so this must too.
          const notify = (payload: Record<string, unknown>): void =>
            send("hv:ui-request", {
              id: `hv-term-${Date.now()}`,
              method: "notify",
              message: JSON.stringify({ kind: "hv.terminal", ...payload }),
              sessionId,
            });
          try {
            const wsId = meta?.workspaceId;
            if (!wsId) throw new Error("No workspace for this session");
            if (term.kind === "run") {
              const res = await agentTerminals.run(
                sessionId, wsId, wsId, getTerminalSettings(), term.command, term.terminalId,
              );
              if (res.ok) {
                // §26: every terminal_run is audited WITH its command — the one
                // thing `npm run dev &> /tmp/log &` gives you nothing of.
                void log.append({
                  type: "terminal.run",
                  sessionId,
                  workspaceId: wsId,
                  data: { terminalId: res.terminalId, command: term.command },
                });
                notify({
                  stage: "started",
                  terminalId: res.terminalId,
                  title: res.title,
                  command: term.command,
                  intent: term.intent,
                  workspaceId: wsId,
                });
              }
              reply(res);
            } else if (term.kind === "read") {
              if (term.waitMs && term.waitMs > 0) {
                await settleQuiet(term.terminalId, Math.min(term.waitMs, 15_000));
              }
              reply(agentTerminals.read(sessionId, term.terminalId, term.lines));
            } else {
              const res = agentTerminals.kill(sessionId, term.terminalId);
              if (res.ok) {
                void log.append({
                  type: "terminal.kill",
                  sessionId,
                  workspaceId: wsId,
                  data: { terminalId: term.terminalId },
                });
                notify({ stage: "killed", terminalId: term.terminalId });
              }
              reply(res);
            }
          } catch (e) {
            reply({ ok: false, reason: e instanceof Error ? e.message : String(e) });
          }
        })();
        return;
      }
      // §28: the blocking browser inputs. Same contract as the terminal block
      // above — main ALWAYS respondUi, an error is a JSON {ok:false,reason},
      // never a dropped response.
      const br = parseBrowserReq(r as { method?: string; title?: string });
      if (br) {
        void (async () => {
          const rid = r.id;
          // §28: main ALWAYS answers, and "always" has to survive an operation
          // that never settles — not just one that throws.
          //
          // Measured, from a wedged session: `executeJavaScript` on a pane that
          // is DESTROYED mid-call never resolves and never rejects, so the reply
          // was never sent, the bridge sat on ctx.ui.input forever, the tool card
          // stayed RUNNING, and every later prompt queued behind a turn that
          // could not end. A try/catch cannot see that; only a deadline can.
          //
          // `answered` makes the reply idempotent so the deadline and the real
          // result can race harmlessly.
          let answered = false;
          const reply = (v: unknown): void => {
            if (answered) return;
            answered = true;
            client.respondUi(rid, { value: JSON.stringify(v) });
          };
          const deadline = setTimeout(() => {
            reply({
              ok: false,
              reason:
                "That browser action never finished — the page or the browser pane probably went away. " +
                "Open it again with browser_open before retrying.",
            });
          }, BROWSER_OP_TIMEOUT_MS);
          const notify = (payload: Record<string, unknown>): void =>
            send("hv:ui-request", {
              id: `hv-browser-${Date.now()}`,
              method: "notify",
              // A notify's payload rides `message` (a blocking input uses
              // `title`). Every renderer parser reads `message`, so this must.
              message: JSON.stringify({ kind: "hv.browser", ...payload }),
              sessionId,
            });
          try {
            const wsId = meta?.workspaceId;
            if (!wsId) throw new Error("No workspace for this session");
            if (br.kind === "open") {
              const res = agentBrowsers.open(sessionId, wsId, br.url);
              if (res.ok) {
                void log.append({
                  type: "browser.open",
                  sessionId,
                  workspaceId: wsId,
                  data: { browserId: res.browserId, url: br.url, reused: res.reused },
                });
                notify({ stage: "opened", browserId: res.browserId, url: br.url, intent: br.intent, workspaceId: wsId });
                reply({ ok: true, browserId: res.browserId, text: `The browser is open at ${br.url}. Use browser_get_text to read it.` });
              } else {
                reply(res);
              }
              return;
            }
            // Everything else acts on the pane this session already owns.
            const owned = agentBrowsers.require(sessionId);
            if (!owned.ok) return reply(owned);
            const bid = owned.browserId;
            switch (br.kind) {
              case "navigate": {
                browsers.navigate(bid, br.url, "agent");
                void log.append({ type: "browser.nav", sessionId, workspaceId: wsId, data: { browserId: bid, url: br.url, origin: "agent" } });
                notify({ stage: "navigated", browserId: bid, url: br.url, intent: br.intent, workspaceId: wsId });
                reply({ ok: true, text: `Navigating to ${br.url}. Read it with browser_get_text once it settles.` });
                return;
              }
              case "screenshot": {
                const png = await browsers.screenshot(bid);
                if (!png) return reply({ ok: false, reason: "The page could not be captured." });
                const b64 = png.toString("base64");
                // Deliberately NO image on this notify. §28's "the user always
                // sees it" means IN THE PANE — the live page is on screen right
                // beside the transcript — so shipping a multi-megabyte data URL
                // to a renderer that has the real thing already would be pure
                // waste. The card's label carries the action.
                notify({ stage: "screenshot", browserId: bid, intent: br.intent });
                // §28: the IMAGE reaches the model only when the model can read
                // one. The user always sees it either way (the notify above) —
                // which is why a non-vision session still gets a useful result
                // instead of a refusal.
                const canSee = await sessionCanSeeImages(wsId, sessionId);
                reply(
                  canSee
                    ? { ok: true, imageBase64: b64, text: "Screenshot captured and shown to the user." }
                    : { ok: true, text: "Screenshot captured and shown to the user. This session's model cannot read images — call browser_get_text to find out what is on the page." },
                );
                return;
              }
              case "get-text": {
                const text = await browsers.getText(bid);
                reply(text === null ? { ok: false, reason: "That browser is gone." } : { ok: true, text, untrusted: true });
                return;
              }
              case "read-console": {
                const text = browsers.readConsole(bid, br.lines);
                reply(text === null ? { ok: false, reason: "That browser is gone." } : { ok: true, text, untrusted: true });
                return;
              }
              case "read-network": {
                const text = browsers.readNetwork(bid, br.limit);
                reply(text === null ? { ok: false, reason: "That browser is gone." } : { ok: true, text, untrusted: true });
                return;
              }
              case "click": {
                const text = await browsers.click(bid, br.selector);
                notify({ stage: "acted", browserId: bid, action: "click", detail: br.selector, intent: br.intent });
                reply(text === null ? { ok: false, reason: "That browser is gone." } : { ok: true, text, untrusted: true });
                return;
              }
              case "type": {
                const text = await browsers.type(bid, br.selector, br.text);
                notify({ stage: "acted", browserId: bid, action: "type", detail: br.selector, intent: br.intent });
                reply(text === null ? { ok: false, reason: "That browser is gone." } : { ok: true, text, untrusted: true });
                return;
              }
              case "evaluate": {
                const text = await browsers.evaluate(bid, br.code);
                void log.append({ type: "browser.evaluate", sessionId, workspaceId: wsId, data: { browserId: bid, code: br.code.slice(0, 500) } });
                notify({ stage: "acted", browserId: bid, action: "evaluate", detail: br.code.slice(0, 200), intent: br.intent });
                reply(text === null ? { ok: false, reason: "That browser is gone." } : { ok: true, text, untrusted: true });
                return;
              }
              case "close": {
                browsers.destroy(bid);
                agentBrowsers.forgetBrowser(bid);
                send("hv:browser-closed", { id: bid });
                notify({ stage: "closed", browserId: bid });
                reply({ ok: true, text: "The browser pane is closed." });
                return;
              }
            }
          } catch (e) {
            reply({ ok: false, reason: e instanceof Error ? e.message : String(e) });
          } finally {
            // Reached on every path that returns; a body that hangs forever never
            // gets here, which is exactly when the deadline above must fire.
            clearTimeout(deadline);
          }
        })();
        return;
      }
      // §23 Plan Mode. plan-write is a BLOCKING input: main writes the workspace
      // file and answers with its path (never forwards to the renderer, never
      // leaves the bridge hanging — an error still resolves with a message).
      const planWrite = parsePlanWrite(r as { method?: string; title?: string });
      if (planWrite) {
        void (async () => {
          const rid = r.id;
          const wsId = meta?.workspaceId;
          try {
            if (!wsId) throw new Error("No workspace for this session");
            const now = new Date().toISOString();
            const relPath = await writePlanFile(workspaces.list(), wsId, planWrite.plan, now, planState.get(sessionId)?.planPath);
            planState.set(sessionId, { enabled: true, planPath: relPath });
            void log.append({ type: "plan.ready", sessionId, workspaceId: wsId, data: { path: relPath } });
            client.respondUi(rid, { value: relPath });
          } catch (e) {
            client.respondUi(rid, { value: `ERROR: ${e instanceof Error ? e.message : String(e)}` });
          }
        })();
        return;
      }
      // Plan-family notifies (mode toggle, terminal status, blocked tool) —
      // fire-and-forget: audit, update main-side plan state, forward to renderer.
      const planN = parsePlanNotify(r);
      if (planN) {
        const wsId = meta?.workspaceId;
        if (planN.kind === "hv.plan" && typeof planN.enabled === "boolean") {
          // Self-heal a wedged respawn: plan mode only makes sense while the plan
          // file is still a draft. A `restored` (session_start) notify that comes
          // back enabled:true over a non-draft or missing plan file is the
          // mid-turn-toggle wedge surviving a respawn — force it off so the
          // session isn't stuck read-only. Only on restore: a live toggle to "on"
          // (e.g. re-planning after implementing) must be honored, not reverted.
          if (planN.restored === true && planN.enabled && wsId && typeof planN.planPath === "string") {
            const parsed = readPlan(workspaces.list(), wsId, planN.planPath);
            if (shouldReconcilePlanOff(true, true, parsed?.status ?? null)) {
              planCmd(sessionId, "/hv-plan off"); // emits a corrected hv.plan notify
              planState.set(sessionId, { enabled: false, planPath: planN.planPath });
              void log.append({ type: "plan.exit", sessionId, workspaceId: wsId, data: { reconciled: true, status: parsed?.status ?? "missing" } });
              return;
            }
          }
          const prev = planState.get(sessionId);
          planState.set(sessionId, { enabled: planN.enabled, planPath: (typeof planN.planPath === "string" ? planN.planPath : undefined) ?? prev?.planPath });
          if (prev?.enabled !== planN.enabled) {
            void log.append({ type: planN.enabled ? "plan.enter" : "plan.exit", sessionId, workspaceId: wsId, data: {} });
          }
          // Round 9: the notify carries only the PATH, so the active-plan pill
          // would have to guess the status — and guessing "draft" is exactly the
          // bug 833a966 removed (an implemented plan reported as still pending).
          // Push the file's real status instead. `sessionId` is set here (and
          // only here) so the renderer can attach the plan to a session it does
          // not otherwise know about on a respawn.
          const restoredPath = planState.get(sessionId)?.planPath;
          if (restoredPath && wsId) {
            const parsed = readPlan(workspaces.list(), wsId, restoredPath);
            if (parsed) {
              send("hv:plan-changed", {
                sessionId, workspaceId: wsId, path: restoredPath,
                status: parsed.status, done: parsed.done, total: parsed.total,
              });
            }
          }
        } else if (planN.kind === "hv.plan-status" && wsId) {
          const relPath = planState.get(sessionId)?.planPath;
          const status = planN.status;
          if (relPath && (status === "implemented" || status === "cancelled")) {
            void setPlanStatus(workspaces.list(), wsId, relPath, status, new Date().toISOString())
              .then((parsed) => {
                void log.append({ type: "plan.status", sessionId, workspaceId: wsId, data: { path: relPath, status, who: "model", note: planN.note ?? "" } });
                send("hv:plan-changed", { workspaceId: wsId, path: relPath, status: parsed.status, done: parsed.done, total: parsed.total });
              })
              .catch(() => {});
          }
        } else if (planN.kind === "hv.plan.blocked") {
          void log.append({ type: "plan.blocked", sessionId, workspaceId: wsId, data: { toolName: planN.toolName } });
        }
        send("hv:ui-request", { ...r, sessionId });
        return;
      }
      // Nothing above recognised it. If it BLOCKS the extension and carries no
      // hv.* envelope, no HappyVibe surface will ever render it — answer it
      // here or the extension's await never settles and the turn/session
      // freezes silently (see uiFallback.ts). Do NOT register an owner or
      // forward: the renderer would queue a prompt nobody can answer.
      if (isUnhandledBlockingUi(r)) {
        client.respondUi(r.id, UI_CANCEL_RESPONSE);
        void log.append({
          type: "ui.unhandled",
          sessionId,
          workspaceId: meta?.workspaceId,
          data: { method: r.method, title: r.title?.slice(0, 200) },
        });
        send("hv:ui-unhandled", { sessionId, method: r.method });
        return;
      }
      uiOwners.set(r.id, sessionId);
      // W1.3: an unanswered permission prompt protects the session from hibernation.
      if (isPermissionPrompt(r)) activity.promptOpened(sessionId);
      send("hv:ui-request", { ...r, sessionId });
    });
  };

  // Sessions deferred for an MCP reload (declared here so session-exit can clear them).
  const pendingMcpReload = new Set<string>();

  // §23: per-session plan mode + current plan-file path (fed by hv.plan notifies).
  const planState = new Map<string, { enabled: boolean; planPath?: string }>();

  // ── Async subagent status pollers (one per live detached run, by runId) ────
  const subagentPollers = new Map<string, { sessionId: string; stop: () => void }>();
  const startSubagentPoll = (sessionId: string, runId: string, asyncDir?: string): void => {
    if (!asyncDir || subagentPollers.has(runId)) return;
    const stop = pollSubagentStatus(asyncDir, (status) => send("hv:subagent-status", { sessionId, runId, status }));
    subagentPollers.set(runId, { sessionId, stop });
  };
  const stopSubagentPoll = (runId: string): void => {
    subagentPollers.get(runId)?.stop();
    subagentPollers.delete(runId);
  };
  // Resync after a respawn: start pollers for this session's runs we aren't
  // watching, stop this session's runs that are gone (leave other sessions' be).
  const reconcileSubagentPolls = (sessionId: string, runs: Array<{ runId: string; asyncDir: string }>): void => {
    const live = new Set(runs.map((r) => r.runId));
    for (const [runId, p] of subagentPollers) if (p.sessionId === sessionId && !live.has(runId)) stopSubagentPoll(runId);
    for (const r of runs) startSubagentPoll(sessionId, r.runId, r.asyncDir);
  };

  manager.on("session-exit", ({ sessionId, code, intentional, stderr }: SessionExit) => {
    activity.remove(sessionId);
    pendingMcpReload.delete(sessionId); // don't reload a session that's gone
    // Stop this session's status pollers. The detached runners survive (they're
    // unref'd); a resume re-adopts + re-polls via /hv-subagent-list.
    for (const [runId, p] of subagentPollers) if (p.sessionId === sessionId) stopSubagentPoll(runId);
    const meta = index.get(sessionId);
    if (!intentional) {
      // The stderr tail is recorded too: a crash entry without its cause is the
      // exact gap this exists to close, and a crash is often not reproducible.
      // No more sensitive than the commands and MCP arguments already logged,
      // and the EventLog is local-only.
      void log.append({
        type: "session.crash",
        sessionId,
        workspaceId: meta?.workspaceId,
        data: { code, ...(stderr ? { stderr } : {}) },
      });
    }
    send("hv:pi-exit", { sessionId, code, intentional, stderr });
  });

  const startClient = async (meta: SessionMeta, resume: boolean): Promise<PiClient> => {
    // The workspace dir is the pi child's cwd. If the app can't stat it, the
    // child can't getcwd() and dies with a cryptic `EPERM: uv_cwd`. Two distinct
    // causes, two honest messages: EPERM/EACCES = macOS TCC denying the app
    // access to a protected folder (Documents/Desktop/Downloads — grant it in
    // System Settings → Privacy & Security → Files & Folders); anything else =
    // the folder is genuinely gone (deleted repo / cleaned-up worktree).
    try {
      if (!fs.statSync(meta.workspaceId).isDirectory()) throw new Error("not a directory");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      throw new Error(
        code === "EPERM" || code === "EACCES"
          ? `macOS denied access to ${meta.workspaceId} — grant HappyVibe/Electron access to this folder in System Settings → Privacy & Security → Files & Folders`
          : `Workspace folder no longer exists: ${meta.workspaceId}`,
      );
    }
    await syncModelsJson(agentDir(), listCustomEndpoints()).catch(() => {});
    const client = (await manager.start(
      meta.id,
      meta.workspaceId,
      resume ? meta.piSessionFile : undefined
    )) as PiClient;
    attach(meta.id, client);
    // W1.3: waking a hibernated session — restore is otherwise the plain resume path.
    if (index.get(meta.id)?.hibernated) {
      index.update(meta.id, { hibernated: false });
      sessionsChanged();
    }
    void log.append({ type: "session.start", sessionId: meta.id, workspaceId: meta.workspaceId, data: { resume } });
    if (!resume) void captureSessionFile(meta.id, client);
    // A resume keeps the same Pi session file → same session id, so detached
    // async runs are still deliverable. restoreActiveJobs re-adopts them but does
    // NOT re-emit started, so resync our run cards + activity counter from disk.
    if (resume) void client.send({ type: "prompt", message: "/hv-subagent-list" }).catch(() => {});
    return client;
  };

  // ── MCP live-reload ──────────────────────────────────────────────────────
  // Pi/the adapter read MCP config only at spawn (no live tool-reload API), so
  // "apply changes live" = respawn the affected sessions resumed (conversation
  // preserved via the session file). Idle sessions reload now; busy ones defer
  // to their next idle. A respawn resets that session's in-memory permission
  // grants + dangerous mode to safe defaults — surfaced via hv:session-reloading.
  // (pendingMcpReload is declared earlier so the session-exit handler can clear it.)
  const reloadingMcp = new Set<string>();

  // Reason for each pending/in-flight reload (mcp | skills | commands) —
  // cosmetic (renderer notice text); coalesced last-writer-wins per session.
  const reloadReasons = new Map<string, ReloadReason>();
  const reloadSession = async (sessionId: string): Promise<void> => {
    if (reloadingMcp.has(sessionId) || !manager.get(sessionId)) return;
    reloadingMcp.add(sessionId);
    const reason = reloadReasons.get(sessionId) ?? "mcp";
    try {
      // Capture the session file first so the conversation survives the respawn.
      if (!index.get(sessionId)?.piSessionFile) {
        const c = manager.get(sessionId) as PiClient | null;
        if (c) await captureSessionFile(sessionId, c);
      }
      const meta = index.get(sessionId);
      if (!meta) return;
      send("hv:session-reloading", { sessionId, reason });
      const exited = new Promise<void>((resolve) => {
        const onExit = (e: SessionExit): void => {
          if (e.sessionId !== sessionId) return;
          manager.off("session-exit", onExit);
          resolve();
        };
        manager.on("session-exit", onExit);
      });
      manager.stop(sessionId); // intentional — renderer clears crash status
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([exited, new Promise<void>((r) => { timer = setTimeout(r, 5_000); })]);
      clearTimeout(timer);
      // If the process didn't exit within the grace window its record still
      // exists — startClient would return the dying client (the manager never
      // double-spawns the same id), losing the session. Abort: leave the old
      // process running; the change applies on its next natural restart.
      if (manager.get(sessionId)) {
        void log.append({ type: "session.mcp_reload_failed", sessionId, data: { error: "stop timed out; left running" } });
        return;
      }
      const client = await startClient(meta, !!meta.piSessionFile);
      void client.send({ type: "prompt", message: "/hv-tools" }).catch(() => {}); // refresh renderer tool list
    } catch (err) {
      void log.append({ type: "session.mcp_reload_failed", sessionId, data: { error: String(err) } });
    } finally {
      reloadingMcp.delete(sessionId);
      reloadReasons.delete(sessionId);
    }
  };

  // Reload a deferred session once it goes idle (called from event/prompt-close paths).
  const drainPendingReload = (sessionId: string): void => {
    if (pendingMcpReload.has(sessionId) && activity.isIdle(sessionId)) {
      pendingMcpReload.delete(sessionId);
      void reloadSession(sessionId);
    }
  };

  let mcpReloadTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingScopes: Array<{ scope: "global" | "workspace"; workspaceId: string | null; reason: ReloadReason }> = [];
  const runMcpReloadPass = async (): Promise<void> => {
    const scopes = pendingScopes.splice(0);
    const live: ReloadSession[] = manager
      .activeIds()
      .map((id) => { const m = index.get(id); return m ? { id, workspaceId: m.workspaceId } : null; })
      .filter((s): s is ReloadSession => s !== null);
    const affected = new Set<string>();
    for (const { scope, workspaceId, reason } of scopes)
      for (const id of affectedSessionIds(scope, workspaceId, live)) { affected.add(id); reloadReasons.set(id, reason); }
    for (const id of affected) {
      if (activity.isIdle(id)) await reloadSession(id); // sequential — avoid a spawn burst
      else pendingMcpReload.add(id);
    }
  };
  // Debounced so add-then-authenticate (or approve-then-toggle) coalesces into a
  // single reload pass. §14 skills and §24 commands reuse the exact same
  // machinery (one mechanism, three config sources) — only the label differs.
  const scheduleRuntimeReload = (reason: ReloadReason, scope: "global" | "workspace", workspaceId: string | null): void => {
    pendingScopes.push({ scope, workspaceId, reason });
    clearTimeout(mcpReloadTimer);
    mcpReloadTimer = setTimeout(() => { void runMcpReloadPass(); }, 500);
  };
  const scheduleMcpReload = (scope: "global" | "workspace", workspaceId: string | null): void =>
    scheduleRuntimeReload("mcp", scope, workspaceId);
  const scheduleSkillReload = (scope: "global" | "workspace", workspaceId: string | null): void =>
    scheduleRuntimeReload("skills", scope, workspaceId);
  // §24: same machinery again — approving/toggling/importing a command changes
  // the --prompt-template set, which Pi only reads at spawn.
  const schedulePromptTemplateReload = (scope: "global" | "workspace", workspaceId: string | null): void =>
    scheduleRuntimeReload("promptTemplates", scope, workspaceId);

  app.on("will-quit", () => {
    clearTimeout(mcpReloadTimer); // don't spawn during teardown
    manager.stopAll();
    utility?.stop();
    unwatchAll(); // WS8: close fs watchers
    unwatchAllGit(); // §29: and the narrow .git ones
  });

  // ── config / folder picking ──────────────────────────────────────
  ipcMain.handle("hv:get-api-key", () => getApiKey());
  ipcMain.handle("hv:set-api-key", (_e, key: string) => setApiKey(key));
  ipcMain.handle("hv:pick-folder", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });

  // ── workspaces ───────────────────────────────────────────────────
  ipcMain.handle("hv:list-workspaces", () => workspaces.list());
  ipcMain.handle("hv:add-workspace", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    workspaces.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  /**
   * Round 11: removal is a confirmed choice between two outcomes, and neither
   * leaves orphans behind (the old one-liner dropped the registry entry and left
   * every session pointing at a workspace that no longer existed).
   *
   *   forget — archive its sessions; re-adding the folder brings them back, and
   *            nothing on disk is touched.
   *   delete — permanently remove them, session files and snapshots included.
   *
   * Both reuse the paths the session UI already calls (`hv:archive-session` /
   * `hv:delete-session`) rather than adding a second delete implementation.
   */
  ipcMain.handle("hv:remove-workspace", async (_e, ws: string, mode: "forget" | "delete" = "forget") => {
    const affected = sessionsOfWorkspace(index.list(), ws);
    for (const s of affected) {
      if (mode === "delete") {
        if (manager.get(s.id)) await endSession(s.id);
        index.remove(s.id);
        deleteSessionFile(sessionDir(), s.piSessionFile);
        deleteSessionSnapshots(snapshotDir(), s.id);
        void log.append({ type: "session.delete", sessionId: s.id, workspaceId: s.workspaceId });
      } else if (!s.archived) {
        index.update(s.id, { archived: true });
      }
    }
    // §26: a terminal belongs to the workspace, not to a session, so nothing
    // above touches it. Both outcomes kill them — "forget" stops showing the
    // workspace, and a shell you can no longer see or close is a leak.
    terminals.killWorkspace(ws);
    workspaces.remove(ws);
    sessionsChanged();
    return { sessions: affected.length };
  });
  /** Count for the confirm dialog — asked BEFORE anything is written. */
  ipcMain.handle("hv:workspace-session-count", (_e, ws: string) => sessionsOfWorkspace(index.list(), ws).length);

  // ── sessions ─────────────────────────────────────────────────────
  ipcMain.handle("hv:list-sessions", () => index.list());

  ipcMain.handle("hv:create-session", async (_e, workspaceId: string): Promise<SessionMeta> => {
    const meta = index.create(workspaceId);
    try {
      await startClient(meta, false);
    } catch (err) {
      index.remove(meta.id); // never spawned — don't leave a ghost entry
      throw err;
    }
    sessionsChanged();
    return meta;
  });

  ipcMain.handle(
    "hv:open-session",
    async (_e, sessionId: string): Promise<{
      meta: SessionMeta;
      messages: RestoreItem[] | null;
      compaction: { count: number; reason: string | null } | null;
      plan: { path: string; status: string; done: number; total: number } | null;
    }> => {
      const meta = index.get(sessionId);
      if (!meta) throw new Error("Unknown session");

      // §9 round 9: the boundary the rebuilt transcript must stop at. DERIVED,
      // never persisted — Pi's `compaction` entry IS the record, and its own
      // rule is [latest compaction] + entries from firstKeptEntryId onward. A
      // line scan, not a full parse: this runs on every open, while the earlier
      // region is parsed only when the user asks for it.
      const compactionFor = async (): Promise<{ count: number; reason: string | null } | null> => {
        const info = compactionInfo(readSessionFile(sessionDir(), meta.piSessionFile));
        if (!info) return null;
        const rows = await log.read({ type: "context.compact", sessionId });
        return { count: info.count, reason: compactionReason(rows, info.firstKeptEntryId) };
      };

      // §23: the session's active plan. Returned here because a renderer reload
      // gets no session_start replay — main's planState outlives the renderer,
      // so the active-plan pill survives ⌘R.
      const planFor = (): { path: string; status: string; done: number; total: number } | null => {
        const p = planState.get(sessionId)?.planPath;
        if (!p) return null;
        const parsed = readPlan(workspaces.list(), meta.workspaceId, p);
        return parsed ? { path: p, status: parsed.status, done: parsed.done, total: parsed.total } : null;
      };

      const typedByHash = await promptTemplatePairs(sessionId); // §24: card pairing (see restore.ts)

      // Rebuild the transcript from Pi's session FILE, not `get_messages`.
      // That RPC is the first thing a freshly spawned child has to answer, so it
      // absorbs the whole boot — 1.35–2.86 s, 90%+ of every restore — while the
      // file is already on disk and needs no child at all. Same source as the
      // cost ledger (§19) and the earlier region (§9). See history.ts.
      const loadMessages = (): RestoreItem[] => {
        const items = contextItems(readSessionFile(sessionDir(), meta.piSessionFile));
        // §23: fill each restored plan card with the plan file's real status +
        // checklist progress, so a reopened card shows "implementing" (etc.)
        // and the right CTA — not a stale "draft".
        for (const it of items) {
          if (it.kind !== "plan") continue;
          const parsed = readPlan(workspaces.list(), meta.workspaceId, it.planPath);
          if (parsed) { it.status = parsed.status; it.done = parsed.done; it.total = parsed.total; }
        }
        return pairPromptTemplateItems(items, typedByHash);
      };

      /** Fallback for a live session with no session file yet (see below). */
      const loadFromClient = async (c: PiClient): Promise<RestoreItem[]> => {
        try {
          const res = await c.send({ type: "get_messages" });
          return pairPromptTemplateItems(
            restoreItems((res.data as { messages?: Parameters<typeof restoreItems>[0] })?.messages ?? []),
            typedByHash,
          );
        } catch {
          return []; // history unreadable — start visually fresh
        }
      };

      // Already active: serve history from the LIVE client instead of assuming
      // the renderer still holds it. That assumption breaks on a renderer reload
      // (⌘R / Vite full-reload), which wipes renderer state while this process
      // keeps running — the session then rendered as an empty "Ready when you
      // are." even though nothing was lost. Safe for a normal tab switch too:
      // the renderer adopts a rebuilt transcript ONLY when it holds no
      // conversation of its own (App.tsx `hasConversation`). No respawn here, so
      // session grants and dangerous mode are untouched.
      // A young session whose file we have not captured yet has nothing to read,
      // so it keeps the RPC — the client is already warm there, so the boot cost
      // this change removes does not apply.
      // (cast: the manager stores PiClients behind the narrower ManagedClient
      // handle — same pattern as every other send site in this file.)
      const active = manager.get(sessionId) as PiClient | null;
      if (active) {
        const messages = meta.piSessionFile ? loadMessages() : await loadFromClient(active);
        return { meta, messages, compaction: await compactionFor(), plan: planFor() };
      }

      // Read BEFORE the spawn: the transcript no longer depends on the child, so
      // nothing here waits on it.
      const messages = meta.piSessionFile ? loadMessages() : null;
      await startClient(meta, !!meta.piSessionFile);
      sessionsChanged();
      return { meta, messages, compaction: await compactionFor(), plan: planFor() };
    }
  );

  // §9 round 9: the pre-compaction transcript, DISPLAY ONLY. Reads the session
  // file (which keeps everything) rather than any RPC (which returns live
  // context only). No client call at all, so no respawn, no session-grant reset
  // — this works on a hibernated session too. Loading these does NOT put them
  // back in the model's context; the renderer marks them as outside it.
  ipcMain.handle("hv:load-earlier", async (_e, sessionId: string): Promise<RestoreItem[]> => {
    const meta = index.get(sessionId);
    if (!meta) throw new Error("Unknown session");
    // §24: pair command cards here too — the earlier region is still transcript,
    // and a half-paired transcript is exactly the disagreement §24 exists to fix.
    return pairPromptTemplateItems(earlierItems(readSessionFile(sessionDir(), meta.piSessionFile)), await promptTemplatePairs(sessionId));
  });

  // Shared by close and delete: capture stats best-effort, log session.end,
  // stop the process.
  //
  // §26 part 2: a session that started terminals must not silently kill them
  // (hostile — a dev server dies because a chat closed) and must not silently
  // leak them either. The renderer asks first, with two named outcomes, and
  // passes the answer here. `keep` needs no work in main: an agent terminal
  // already IS an ordinary workspace terminal — releasing the claim is the
  // whole promotion. Absent decision = keep, the safe direction.
  const endSession = async (sessionId: string, terminals_?: "stop" | "keep"): Promise<void> => {
    const owned = agentTerminals.releaseSession(sessionId);
    if (terminals_ === "stop") for (const id of owned) terminals.kill(id);
    // §28: the browser pane is NOT killed with the session, and there is no
    // "stop them?" question for it either — a page is not a running process, and
    // the tab the user is looking at should not vanish because a chat ended. The
    // claim is released; the pane becomes an ordinary browser tab.
    agentBrowsers.releaseSession(sessionId);
    const client = manager.get(sessionId) as PiClient | null;
    const meta = index.get(sessionId);
    let stats: unknown = null;
    if (client) {
      try {
        stats = (await client.send({ type: "get_session_stats" })).data ?? null;
      } catch {
        /* dying process — end without stats */
      }
    }
    void log.append({
      type: "session.end",
      sessionId,
      workspaceId: meta?.workspaceId,
      data: { stats: stats as Record<string, unknown> | null },
    });
    manager.stop(sessionId);
  };

  /**
   * Round 15 — an empty session leaves nothing behind.
   *
   * A session whose last tab closes without a single prompt ever sent is
   * deleted outright, with no confirm: there is nothing to confirm losing, and
   * the sidebar filling with "New session" rows is the whole complaint. Shares
   * the delete path below rather than reimplementing it, so snapshots, the
   * session file and the last-open-* maps go with it.
   *
   * Returns whether it deleted, so the renderer knows not to keep the row.
   */
  /**
   * Round 15 — one place the four one-shot callers report to.
   *
   * Each returns its own resolved model and byte counts; this binds them to the
   * EventLog with the right kind and workspace. Tokens only, never dollars —
   * see oneShotLog.ts for why that is a rule and not an omission.
   */
  const oneShot =
    (kind: OneShotKind, workspaceId?: string, sessionId?: string) =>
    (o: { model: { provider: string; modelId: string }; promptChars: number; outputChars: number; ok: boolean }): void => {
      logOneShot(log, { kind, workspaceId, sessionId, ...o });
    };

  const purgeIfEmpty = (sessionId: string): boolean => {
    const meta = index.get(sessionId);
    if (!meta || !isSessionEmpty(meta, sessionDir())) return false;
    index.remove(sessionId);
    deleteSessionFile(sessionDir(), meta.piSessionFile);
    deleteSessionSnapshots(snapshotDir(), sessionId);
    lastOpenFiles.delete(sessionId);
    lastOpenTerminals.delete(sessionId);
    lastOpenBrowser.delete(sessionId);
    void log.append({ type: "session.delete", sessionId, workspaceId: meta.workspaceId, data: { reason: "empty" } });
    sessionsChanged();
    return true;
  };

  ipcMain.handle("hv:close-session", async (_e, sessionId: string, terminals_?: "stop" | "keep") => {
    await endSession(sessionId, terminals_);
    return { deleted: purgeIfEmpty(sessionId) };
  });

  /**
   * Round 15: …and on quit. Deliberately NOT on a workspace switch — two
   * projects get worked in parallel and the user comes back to them, so a
   * switch must never be a delete. This sweeps EVERY workspace's metas rather
   * than the live children only: an empty session whose process was never
   * started (or was hibernated away) is exactly the row being cleaned up.
   */
  app.on("will-quit", () => {
    for (const s of index.list()) purgeIfEmpty(s.id);
  });

  // §26 part 2: what the close/delete confirm has to name. Empty ⇒ no confirm,
  // so a session with no terminals closes exactly as it did before.
  ipcMain.handle("hv:session-terminals", (_e, sessionId: string) =>
    agentTerminals
      .ownedBy(sessionId)
      .map((id) => terminals.get(id))
      .filter((i): i is NonNullable<typeof i> => !!i && i.running)
      .map((i) => ({ id: i.id, title: i.title })),
  );

  // V2.C2: permanent delete — confirm happens renderer-side. Stop first if
  // live (same stats/session.end capture as close), drop the index entry,
  // delete the Pi session file (sessionDir-confined; missing file fine).
  ipcMain.handle("hv:delete-session", async (_e, sessionId: string, terminals_?: "stop" | "keep") => {
    const meta = index.get(sessionId);
    if (!meta) return;
    if (manager.get(sessionId)) await endSession(sessionId, terminals_);
    index.remove(sessionId);
    deleteSessionFile(sessionDir(), meta.piSessionFile);
    deleteSessionSnapshots(snapshotDir(), sessionId); // §9: snapshots die with the session
    lastOpenFiles.delete(sessionId); // round 11: no stale set for a dead session
    lastOpenTerminals.delete(sessionId); // §26: same, for the terminals block
    lastOpenBrowser.delete(sessionId); // §28: …and for the browser block
    void log.append({ type: "session.delete", sessionId, workspaceId: meta.workspaceId });
    sessionsChanged();
  });

  ipcMain.handle("hv:rename-session", (_e, sessionId: string, title: string) => {
    index.update(sessionId, { title: title.trim() || "Untitled", titleSource: "user" });
    sessionsChanged();
  });

  ipcMain.handle("hv:archive-session", async (_e, sessionId: string, archived: boolean) => {
    // §17 round 12: archiving used to flip a flag and leave the child running —
    // a defect rather than a design, and half of why "how do I stop a session?"
    // had no answer. endSession also captures the final stats the §19 ledger
    // reads, so an archived session's spend is recorded rather than lost.
    if (archived && manager.get(sessionId)) await endSession(sessionId);
    index.update(sessionId, { archived });
    sessionsChanged();
  });

  // behavior (B2, additive): renderer passes "steer" | "followUp" while the
  // agent is busy — Pi errors on a bare prompt mid-stream without it.
  // images (W2.1, additive): RPC ImageContent[] built renderer-side (composer.ts).
  // mentions (F3, additive): workspace-relative paths of @file references. Main
  // assembles the hidden <file> context blocks (files.ts) and appends them to
  // the message the model sees; the raw msg is still used for the title/echo.
  ipcMain.handle(
    "hv:prompt-session",
    async (
      _e,
      sessionId: string,
      msg: string,
      behavior?: PromptBehavior,
      images?: PromptImage[],
      mentions?: string[],
      openFiles?: string[],
    ) => {
    if (behavior !== undefined && behavior !== "steer" && behavior !== "followUp") {
      throw new Error("Invalid prompt behavior");
    }
    if (images !== undefined) {
      const ok = Array.isArray(images) &&
        images.every((i) => i?.type === "image" && typeof i.data === "string" && typeof i.mimeType === "string");
      if (!ok) throw new Error("Invalid images payload");
    }
    if (mentions !== undefined && !(Array.isArray(mentions) && mentions.every((m) => typeof m === "string"))) {
      throw new Error("Invalid mentions payload");
    }
    if (openFiles !== undefined && !(Array.isArray(openFiles) && openFiles.every((m) => typeof m === "string"))) {
      throw new Error("Invalid openFiles payload");
    }
    let client = manager.get(sessionId) as PiClient | null;
    const meta = index.get(sessionId);
    if (!client) {
      // W1.3: prompting a hibernated (or otherwise stopped) session wakes it
      // transparently — the user is never blocked by our internal cap.
      if (!meta) throw new Error("Unknown session");
      client = await startClient(meta, !!meta.piSessionFile);
    }
    activity.prompted(sessionId);
    if (meta?.titleSource === "fallback" && !firstPrompt.has(sessionId) && meta.title === "New session") {
      firstPrompt.set(sessionId, msg);
      index.update(sessionId, { title: truncateTitle(msg) }); // fallback until generation lands
      sessionsChanged();
    }
    let outgoing = msg;
    let warnings: string[] = [];
    if (mentions && mentions.length && meta?.workspaceId) {
      // §24 × F3: a message Pi will expand as a prompt template must NOT carry
      // the inline <file> blocks. The template's `${ARGUMENTS}` captures
      // everything after the command name, so the blocks would be substituted
      // into the middle of the prompt — inlined, markdown-mangled, and then read
      // AGAIN because the template says to read the path. Rewrite each mention
      // to its workspace-relative path instead and let the command do its job.
      // Skills are deliberately excluded (they APPEND args, so blocks already
      // land correctly) — see commandMentions.ts.
      if (willExpand(msg, activePromptTemplateEntries(meta.workspaceId))) {
        outgoing = inlineMentionPaths(msg, mentions);
        if (outgoing !== msg) {
          if (typedByOutgoing.size > 64) typedByOutgoing.clear();
          typedByOutgoing.set(outgoing, msg);
        }
      } else {
        const { blocks, warnings: w } = buildMentionBlocks(workspaces.list(), meta.workspaceId, mentions);
        if (blocks) outgoing = `${msg}\n\n${blocks}`;
        warnings = w;
      }
    }
    // Round 11: which files the user has open, PATHS ONLY, appended after any
    // mention blocks. Sent only when the set CHANGED since this session's last
    // prompt — otherwise every turn would carry its own snapshot and turn 1's
    // stale list would sit in context beside turn 5's. The newest block is
    // therefore always the current one.
    //
    // §26 part 2: the terminals THIS session started ride the same seam under
    // the same toggle — one setting, one answer, disclosed in its description.
    // It is what lets an agent still find a dev server it opened three
    // compactions ago; with the toggle off it will lose track of one.
    if (getOpenFilesContext()) {
      if (openFiles && openFilesChanged(lastOpenFiles.get(sessionId), openFiles)) {
        const block = buildOpenFilesBlock(openFiles);
        if (block) outgoing = `${outgoing}\n\n${block}`;
        lastOpenFiles.set(sessionId, [...openFiles]);
      }
      // The block is sorted, so an unchanged set renders byte-identically and
      // the change check is a plain string compare (openFilesChanged's trick).
      const terms = agentTerminals.buildOpenTerminalsBlock(sessionId);
      if (terms && terms !== lastOpenTerminals.get(sessionId)) {
        outgoing = `${outgoing}\n\n${terms}`;
        lastOpenTerminals.set(sessionId, terms);
      }
      // §28: the same seam, one line, for the browser pane this session owns —
      // the URL and its state, never page content. Content is what get_text is
      // for, on request; injecting it every turn would be a page-sized tax.
      const browserBlock = agentBrowsers.buildOpenBrowserBlock(sessionId);
      if (browserBlock && browserBlock !== lastOpenBrowser.get(sessionId)) {
        outgoing = `${outgoing}\n\n${browserBlock}`;
        lastOpenBrowser.set(sessionId, browserBlock);
      }
    }
    // §9 rewind: the snapshot a rewind to THIS message restores to. A capture
    // failure must never block the prompt.
    //
    // Steers get NO snapshot, and NOT as an oversight to fix later: a steer
    // means the agent is mid-turn BY DEFINITION, so captureSnapshot would copy
    // files while a write tool is running, record torn content, and a later
    // restore would write that torn content back. Non-steer prompts are safe
    // precisely because the agent is idle. Do not lift this guard without
    // coordinating the capture against in-flight tool calls.
    //
    // Consequence for a rewind anchored at a steer: stamps are the turn's FIRST
    // toolCallId, so if that call ran BEFORE the steer arrived, its `pre` is not
    // in the rewind tail and findRestoreTarget lands on a LATER turn's snapshot
    // (restores LESS than asked) or on nothing at all. The confirm dialog
    // reports the "nothing" case and disables Rewind when that is the whole
    // outcome (ChatView rewind confirm).
    if (behavior !== "steer" && meta?.workspaceId) {
      try {
        captureSnapshot(
          snapshotDir(), sessionId, workspaces.list(), meta.workspaceId,
          "pre", new Date().toISOString(),
        );
      } catch (e) {
        void log.append({
          type: "rewind.capture_failed", sessionId, workspaceId: meta.workspaceId,
          data: { error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
    await client.send(promptCommand(outgoing, behavior, images));
    return { warnings };
  });

  ipcMain.handle("hv:abort-session", async (_e, sessionId: string) => {
    await (manager.get(sessionId) as PiClient | null)?.send({ type: "abort" });
  });

  // Per-call cost ledger. Read from Pi's own session file rather than
  // get_messages: that RPC returns the LIVE context, so a compaction would drop
  // calls the user was already billed for. The file is what get_session_stats
  // sums, so the pill and the drill-in can never disagree. See calls.ts.
  // Returns the total alongside the calls so the sum is computed ONCE, by the
  // unit-tested ledgerTotal — a renderer-side re-sum would be mirrored logic
  // free to drift from the list it labels.
  ipcMain.handle("hv:get-session-calls", (_e, sessionId: string) => {
    const meta = index.get(sessionId);
    // Which providers are flat-subscription rather than per-token. Resolved here
    // because it depends on key configuration (no anthropic key ⇒ the Claude
    // subscription is what paid), which calls.ts stays pure of.
    const plans = planProvidersFor(providerKeyStatus());
    const calls = meta ? parseCalls(readSessionFile(sessionDir(), meta.piSessionFile), plans) : [];
    return { calls, total: ledgerTotal(calls) };
  });

  // §9 rewind file rollback. HUMAN-ONLY by construction: these are IPC handlers
  // with no tool, no bridge command and no model-reachable path — the same
  // invariant as the plan-mode power transitions.
  const rewindTarget = (sessionId: string, toolCallIds: string[]) => {
    const meta = index.get(sessionId);
    if (!meta?.workspaceId) return null;
    const target = findRestoreTarget(snapshotDir(), sessionId, toolCallIds);
    return target ? { workspaceId: meta.workspaceId, target } : null;
  };

  ipcMain.handle("hv:rewind-preview", (_e, sessionId: string, toolCallIds: string[]) => {
    const hit = rewindTarget(sessionId, toolCallIds);
    if (!hit) return null;
    return previewRestore(
      snapshotDir(), sessionId, workspaces.list(), hit.workspaceId, hit.target,
    );
  });

  ipcMain.handle("hv:rewind-restore", (_e, sessionId: string, toolCallIds: string[]) => {
    const hit = rewindTarget(sessionId, toolCallIds);
    if (!hit) return null;
    const result = restoreSnapshot(
      snapshotDir(), sessionId, workspaces.list(), hit.workspaceId,
      hit.target, new Date().toISOString(),
    );
    void log.append({
      type: "rewind.restore",
      sessionId,
      workspaceId: hit.workspaceId,
      data: {
        who: "human",
        seq: hit.target.seq,
        restored: result.restored.length,
        deleted: result.deleted.length,
        stale: result.stale,
        notCaptured: result.notCaptured,
      },
    });
    return result;
  });

  // getStats(sessionId?) — the optional sessionId is the additive B1 extension.
  ipcMain.handle("hv:get-stats", async (_e, sessionId?: string) => {
    const client = sessionId ? (manager.get(sessionId) as PiClient | null) : null;
    if (!client) return null;
    try {
      return (await client.send({ type: "get_session_stats" })).data ?? null;
    } catch {
      return null;
    }
  });

  // ── B5: context visibility ─────────────────────────────────────────
  // All three ride the RPC prompt channel as fire-and-forget /hv-context*
  // bridge commands; the hv.context notify streams back through hv:ui-request
  // (B4 hv.dangerous pattern). The renderer parses it — never opens the modal.
  const contextCmd = (sessionId: string, message: string): void => {
    void (manager.get(sessionId) as PiClient | null)?.send({ type: "prompt", message }).catch(() => {});
  };
  ipcMain.handle("hv:context-snapshot", (_e, sessionId: string) => contextCmd(sessionId, "/hv-context"));
  ipcMain.handle("hv:context-remove", (_e, sessionId: string, keys: string[]) =>
    contextCmd(sessionId, `/hv-context-remove ${keys.join(",")}`));
  ipcMain.handle("hv:context-restore", (_e, sessionId: string, keys: string[]) =>
    contextCmd(sessionId, `/hv-context-restore ${keys.join(",")}`));
  ipcMain.handle("hv:compact-session", (_e, sessionId: string) => {
    const client = manager.get(sessionId) as PiClient | null;
    if (!client) throw new Error("Session is not active");
    // Fire the compact RPC; compaction_start/end stream back as pi-events.
    void client.send({ type: "compact" }).catch(() => {});
  });

  // ── §23 Plan Mode: renderer-driven transitions ────────────────────────────
  // All power-granting transitions (implement, exit, reopen) live here — the
  // model can never invoke them (there is no plan_off tool), per the invariant.
  const planCmd = (sessionId: string, message: string): void => {
    void (manager.get(sessionId) as PiClient | null)?.send({ type: "prompt", message }).catch(() => {});
  };
  // Aborts a mid-turn session before flipping plan mode off, so no half-planning
  // turn survives with restored tools (the "must be idle" rule, like rewind).
  const abortIfBusy = async (sessionId: string): Promise<void> => {
    if (!activity.isIdle(sessionId)) {
      await (manager.get(sessionId) as PiClient | null)?.send({ type: "abort" }).catch(() => {});
    }
  };

  // Enter/leave plan mode (composer toggle). Abort a running turn in BOTH
  // directions first: flipping plan mode must never stack `/hv-plan on|off`
  // behind (or race) a live turn. Enabling mid-turn used to skip the abort, so
  // clicking Plan while implementing left the on/off commands queued behind the
  // turn — they interleaved with the abort and wedged the session busy.
  // Root-cause gate: /hv-plan is registered in the bridge only when the global
  // Plan-mode toggle is on (happyvibe-bridge.ts). Sending it while the toggle
  // is off falls through Pi's unregistered-command path as a literal user
  // message to the model — so every caller here (set/implement/discard) must
  // bail before calling planCmd, not just the renderer chip that happens to be
  // the one the reviewer clicked.
  const requirePlanEnabled = (): void => {
    if (!getBuiltinTools().plan) throw new Error("Plan mode is disabled");
  };
  ipcMain.handle("hv:plan-set", async (_e, sessionId: string, enabled: boolean) => {
    requirePlanEnabled();
    if (!index.get(sessionId)) throw new Error("Unknown session");
    await abortIfBusy(sessionId);
    planCmd(sessionId, `/hv-plan ${enabled ? "on" : "off"}`);
  });

  // Implement: exit plan mode, restore tools, hand the plan file to a normal
  // turn. Optional per-implementation model override (the reasonable-model nudge).
  ipcMain.handle(
    "hv:plan-implement",
    async (_e, sessionId: string, relPath: string, model?: { provider: string; modelId: string } | null) => {
      requirePlanEnabled();
      const meta = index.get(sessionId);
      if (!meta?.workspaceId) throw new Error("Unknown session");
      const wsId = meta.workspaceId;
      // §23 round 7: the baseline "Revert implementation" restores to. Labelled,
      // so the per-session cap never evicts it. Best-effort — a snapshot failure
      // must never block Implement.
      try {
        captureSnapshot(
          snapshotDir(), sessionId, workspaces.list(), wsId,
          "pre", new Date().toISOString(), "implement",
        );
      } catch { /* never block the handoff */ }
      const client = manager.get(sessionId) as PiClient | null;
      if (model && typeof model.provider === "string" && typeof model.modelId === "string") {
        index.update(sessionId, { model });
        sessionsChanged();
        await client?.send({ type: "set_model", provider: model.provider, modelId: model.modelId }).catch(() => {});
      }
      let parsed: Awaited<ReturnType<typeof setPlanStatus>> | null = null;
      try {
        parsed = await setPlanStatus(workspaces.list(), wsId, relPath, "implementing", new Date().toISOString());
      } catch { /* file may have been removed; proceed to hand off anyway */ }
      planCmd(sessionId, "/hv-plan off");
      const busy = !activity.isIdle(sessionId);
      const msg =
        `Plan mode is off, full tools restored. Execute the approved plan in ${relPath}. ` +
        `Keep the plan file in sync with your progress AS YOU GO: the moment you finish a task, ` +
        `use the edit tool on ${relPath} to change that task's "- [ ]" to "- [x]" (do this immediately ` +
        `after each task, not all at the end). Keep the implementation scoped to the plan, and if reality ` +
        `differs materially, edit the plan to match. When every task is done and the plan's Verification ` +
        `section passes, call plan_status_update with status "implemented".`;
      await client?.send(promptCommand(msg, busy ? "followUp" : undefined)).catch(() => {});
      activity.prompted(sessionId);
      void log.append({ type: "plan.implement", sessionId, workspaceId: wsId, data: { path: relPath } });
      if (parsed) send("hv:plan-changed", { workspaceId: wsId, path: relPath, status: parsed.status, done: parsed.done, total: parsed.total });
    }
  );

  // Discard: leave plan mode; the plan file stays on disk (the user's artifact).
  ipcMain.handle("hv:plan-discard", async (_e, sessionId: string) => {
    requirePlanEnabled();
    const meta = index.get(sessionId);
    if (!meta) throw new Error("Unknown session");
    await abortIfBusy(sessionId);
    planCmd(sessionId, "/hv-plan off");
    void log.append({ type: "plan.exit", sessionId, workspaceId: meta.workspaceId, data: { discard: true } });
  });

  // Human status override (mark implemented / cancelled / reopen→implementing).
  ipcMain.handle("hv:plan-status", async (_e, sessionId: string, relPath: string, status: PlanStatus) => {
    const meta = index.get(sessionId);
    if (!meta?.workspaceId) throw new Error("Unknown session");
    const parsed = await setPlanStatus(workspaces.list(), meta.workspaceId, relPath, status, new Date().toISOString());
    void log.append({ type: "plan.status", sessionId, workspaceId: meta.workspaceId, data: { path: relPath, status, who: "human" } });
    send("hv:plan-changed", { workspaceId: meta.workspaceId, path: relPath, status: parsed.status, done: parsed.done, total: parsed.total });
  });

  // §23 round 7: roll the workspace back to the Implement baseline. Human-only,
  // like every other power transition in this block. Files changed since the
  // agent touched them are left alone by the same stale-check rewind uses.
  ipcMain.handle("hv:plan-revert", (_e, sessionId: string) => {
    const meta = index.get(sessionId);
    if (!meta?.workspaceId) return null;
    const target = listSnapshots(snapshotDir(), sessionId)
      .filter((r) => r.label === "implement")
      .pop();
    if (!target) return null;
    const result = restoreSnapshot(
      snapshotDir(), sessionId, workspaces.list(), meta.workspaceId,
      target, new Date().toISOString(),
    );
    void log.append({
      type: "plan.revert", sessionId, workspaceId: meta.workspaceId,
      data: {
        who: "human", restored: result.restored.length,
        deleted: result.deleted.length, stale: result.stale,
      },
    });
    return result;
  });

  // Payload field must match docs/validation/d1.md — select permission response uses { value: <choice string> }
  ipcMain.on("hv:respond-permission", (_e, id: string, choice: string) => {
    const owner = uiOwners.get(id);
    uiOwners.delete(id);
    if (owner && owner !== UTILITY) {
      activity.promptClosed(owner);
      drainPendingReload(owner); // prompt closed → session may be idle now
    }
    clientFor(owner)?.respondUi(id, { value: choice });
  });

  // ── B3: providers & onboarding ────────────────────────────────────
  // input/select responses use { value }; null → { cancelled: true } (rpc-mode.js).
  ipcMain.on("hv:respond-input", (_e, id: string, value: string | null) => {
    const owner = uiOwners.get(id);
    uiOwners.delete(id);
    clientFor(owner)?.respondUi(id, value === null ? { cancelled: true } : { value });
  });

  ipcMain.handle("hv:get-providers", () => {
    const status = providerKeyStatus();
    return {
      byok: (Object.keys(BYOK_PROVIDERS) as ByokProvider[]).map((id) => ({
        id, label: BYOK_PROVIDERS[id].label, source: status[id],
      })),
      defaultModel: getDefaultModel(),
      // §16: the set BOTH sides filter model refs with (see resolveSpawnModel).
      knownProviders: knownProviders(),
    };
  });
  ipcMain.handle("hv:set-provider-key", async (_e, provider: string, key: string) => {
    if (!isByokProvider(provider)) throw new Error(`Not a curated provider: ${provider}`);
    setProviderKey(provider, key);
    // Keys ride spawn env: the utility client respawns now; running chat
    // sessions keep their env until their next spawn (never yanked mid-turn).
    await restartUtility();
    providersChanged();
  });
  ipcMain.handle("hv:remove-provider-key", async (_e, provider: string) => {
    if (!isByokProvider(provider)) throw new Error(`Not a curated provider: ${provider}`);
    removeProviderKey(provider);
    await restartUtility();
    providersChanged();
  });

  // OAuth over RPC: fire-and-forget /hv-* bridge commands. The prompt promise
  // only resolves when the whole login flow ends, so never await it here —
  // progress/results stream back as hv.auth ui-requests.
  ipcMain.handle("hv:auth-login", async (_e, provider: string) => {
    const c = await ensureUtility();
    void c.send({ type: "prompt", message: `/hv-login ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-login-cancel", (_e, provider: string) => {
    void utility?.send({ type: "prompt", message: `/hv-login-cancel ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-logout", async (_e, provider: string) => {
    const c = await ensureUtility();
    void c.send({ type: "prompt", message: `/hv-logout ${provider}` }).catch(() => {});
  });
  ipcMain.handle("hv:auth-status", async () => {
    await requestAuthStatus();
  });
  // Round 11: the state main already holds, so a page mounting after a sign-in
  // renders it immediately instead of waiting for a notify that already fired.
  ipcMain.handle("hv:auth-state", () => authState);

  ipcMain.handle("hv:detect-ollama", () => detectOllama());

  // §16 (2026-07-30): user-defined OpenAI-compatible endpoints. Secrets never
  // reach models.json — the file references $HV_CUSTOM_<ID>_KEY and the value
  // rides the spawn env (config.ts providerEnv).
  ipcMain.handle("hv:get-custom-endpoints", () => ({
    endpoints: listCustomEndpoints(),
    keyStatus: customKeyStatus(),
  }));

  // The renderer sends a DRAFT; main owns providerKey and auth so a renderer bug
  // cannot produce a hijacking key or an unusable env reference.
  ipcMain.handle(
    "hv:save-custom-endpoint",
    async (_e, draft: { id: string; label: string; baseUrl: string; preset: CustomEndpoint["preset"]; models: CustomEndpoint["models"] }, key?: string) => {
      const endpoint: CustomEndpoint = {
        id: draft.id,
        providerKey: providerKeyFor(draft.id),
        label: draft.label,
        // Trailing slash would make Pi request …/v1//chat/completions even
        // though the /models probe (which strips it) verified fine.
        baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
        preset: draft.preset,
        // No key → a placeholder, NOT an env reference. Pi hides every model of
        // a provider whose apiKey env var is unresolvable, so "leave blank if
        // the server needs none" (vLLM/LM Studio/llama.cpp) would otherwise
        // save successfully and then expose nothing.
        auth: key ? { kind: "env" } : { kind: "placeholder", value: "none" },
        models: draft.models,
      };
      const problem = validateEndpoint(endpoint, listCustomEndpoints().map((x) => x.id));
      if (problem) throw new Error(problem);
      saveCustomEndpoint(endpoint, key);
      // NOT swallowed, and rolled back: config.json is already written, so a
      // models.json failure (EACCES/ENOSPC) would otherwise leave Settings
      // showing an endpoint — with its key injected on every spawn — that Pi
      // has no provider entry for.
      try {
        await syncModelsJson(agentDir(), listCustomEndpoints());
      } catch (err) {
        removeCustomEndpoint(endpoint.id);
        throw err;
      }
      await restartUtility();
      providersChanged();
    },
  );

  ipcMain.handle("hv:remove-custom-endpoint", async (_e, id: string) => {
    removeCustomEndpoint(id);
    await syncModelsJson(agentDir(), listCustomEndpoints());
    // Sessions pinned to its models are NOT respawned (that would be a lie —
    // hv:session-reloading means grants reset). providersChanged refetches the
    // model list; dropUnknownProvider then shows the tier it fell back to.
    await restartUtility();
    providersChanged();
  });

  ipcMain.handle("hv:fetch-endpoint-models", (_e, baseUrl: string, key?: string) => {
    // Same scheme check as the save path — the asymmetry was free to fix.
    if (!/^https?:\/\//.test(baseUrl)) {
      return { ok: false, models: [], error: "Base URL must start with http:// or https://" };
    }
    return fetchEndpointModels(baseUrl, key);
  });

  // ── B4: permission rules, audit, badge ─────────────────────────────
  const readRules = (): RulesFile => {
    try {
      return parseRulesFile(fs.readFileSync(rulesFile(), "utf8"));
    } catch {
      return EMPTY_RULES; // missing or corrupt → empty (bridge behaves the same)
    }
  };

  // Sanitize through the same parser the bridge uses (malformed rules never hit
  // disk), persist, then broadcast reload to every live Pi (fire-and-forget
  // slash command, B3 pattern).
  const writeRulesAndReload = (rules: RulesFile): RulesFile => {
    const clean = parseRulesFile(JSON.stringify(rules));
    fs.writeFileSync(rulesFile(), JSON.stringify(clean, null, 2));
    for (const id of manager.activeIds()) {
      void (manager.get(id) as PiClient | null)?.send({ type: "prompt", message: "/hv-rules-reload" }).catch(() => {});
    }
    void utility?.send({ type: "prompt", message: "/hv-rules-reload" }).catch(() => {});
    return clean;
  };

  ipcMain.handle("hv:get-rules", () => readRules());

  ipcMain.handle("hv:set-rules", (_e, rules: RulesFile) => writeRulesAndReload(rules));

  // Round 3 #13: one-click persistent grant from the permission prompt.
  // "Allow for Workspace" (workspace set) / "Always allow" (workspace null)
  // append a tool-layer allow rule at the matching scope. ponytail: tool-layer
  // granularity for V1; add command-pattern grants later if asked.
  ipcMain.handle("hv:add-permission-rule", (_e, workspace: string | null, tool: string) => {
    const rules = readRules();
    const list = workspace ? (rules.workspaces[workspace] ??= []) : rules.global;
    if (!list.some((r) => r.layer === "tool" && r.pattern === tool && r.action === "allow")) {
      list.push({ layer: "tool", pattern: tool, action: "allow" });
    }
    return writeRulesAndReload(rules);
  });

  // Settings "test a call" preview — the SAME pure engine the bridge runs.
  ipcMain.handle("hv:eval-rules", (_e, workspaceId: string, tool: string, input: Record<string, unknown>) =>
    evaluate(readRules(), { tool, input, workspace: workspaceId }));

  // ── §28 Embedded browser: the renderer's half ──────────────────────────────
  // Bounds and visibility are the whole cost of choosing WebContentsView: the
  // view composites OVER the DOM, so the renderer measures its placeholder and
  // main moves the view. `hv:browser-visible false` is also what makes the
  // permission modal win — BrowserTab hides the view whenever an overlay is up.
  ipcMain.handle("hv:browser-create", (_e, workspaceId: string) => browsers.create(workspaceId));
  ipcMain.handle("hv:browser-bounds", (_e, id: string, b: { x: number; y: number; width: number; height: number }) => {
    // Round to whole device pixels: a fractional bound leaves a hairline of the
    // renderer showing through at the seam.
    browsers.setBounds(id, {
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)),
    });
  });
  ipcMain.handle("hv:browser-visible", (_e, id: string, visible: boolean) => browsers.setVisible(id, visible));
  // origin "user": typing a URL IS consent (§28) — no prompt, still logged.
  //
  // The SCHEME is resolved in the renderer now (browserError.resolveTypedUrl):
  // a bare `localhost:3000` gets http, the public web gets https, and a scheme
  // we do not open is NAMED rather than prefixed into nonsense. Main keeps the
  // hard refusal, which is a guard and not a guess.
  ipcMain.handle("hv:browser-navigate", (_e, id: string, url: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    browsers.navigate(id, url, "user");
    void log.append({ type: "browser.nav", data: { browserId: id, url, origin: "user" } });
  });
  ipcMain.handle("hv:browser-allow-blocked", (_e, id: string) => {
    const info = browsers.get(id);
    void log.append({ type: "browser.allow", data: { browserId: id, host: info?.blockedHost } });
    browsers.allowBlocked(id);
  });
  ipcMain.handle("hv:browser-back", (_e, id: string) => browsers.goBack(id));
  ipcMain.handle("hv:browser-forward", (_e, id: string) => browsers.goForward(id));
  ipcMain.handle("hv:browser-reload", (_e, id: string) => browsers.reload(id));
  ipcMain.handle("hv:browser-close", (_e, id: string) => {
    browsers.destroy(id);
    agentBrowsers.forgetBrowser(id);
  });
  // §28 picker: blocking by design — it resolves when the user clicks or cancels.
  ipcMain.handle("hv:browser-pick", (_e, id: string) => browsers.pick(id));
  ipcMain.handle("hv:browser-pick-cancel", (_e, id: string) => browsers.cancelPick(id));
  ipcMain.handle("hv:browser-list", (_e, workspaceId?: string) => browsers.list(workspaceId));
  ipcMain.handle("hv:browser-get", (_e, id: string) => browsers.get(id));
  // §28: what makes the persistent partition reversible (All Tools → Browser).
  ipcMain.handle("hv:browser-clear-data", () => browsers.clearData());

  // Round 3 #14: persistent "bypass all permissions". Resolved bypass is applied
  // live to affected sessions via /hv-dangerous (idempotent) and re-applied on
  // every respawn through HV_BYPASS (spawnOpts). Changing a persistent setting
  // overrides any manual /hv-dangerous toggle on the affected sessions.
  const applyBypassLive = (id: string): void => {
    const ws = index.get(id)?.workspaceId ?? null;
    const on = resolveBypass(ws);
    void (manager.get(id) as PiClient | null)?.send({ type: "prompt", message: `/hv-dangerous ${on ? "on" : "off"}` }).catch(() => {});
  };
  ipcMain.handle("hv:get-global-bypass", () => getGlobalBypass());
  ipcMain.handle("hv:set-global-bypass", (_e, on: boolean) => {
    setGlobalBypass(on);
    // Only sessions that inherit the global default (no explicit workspace override).
    for (const id of manager.activeIds()) {
      const ws = index.get(id)?.workspaceId ?? null;
      if (!ws || getWorkspaceBypass(ws) === null) applyBypassLive(id);
    }
  });
  ipcMain.handle("hv:get-workspace-bypass", (_e, workspace: string) => getWorkspaceBypass(workspace));
  ipcMain.handle("hv:set-workspace-bypass", (_e, workspace: string, on: boolean | null) => {
    setWorkspaceBypass(workspace, on);
    for (const id of manager.activeIds()) {
      if ((index.get(id)?.workspaceId ?? null) === workspace) applyBypassLive(id);
    }
  });

  // §13 round 6: global on/off for built-in custom tools (plan mode, ask_user).
  // Takes effect at next spawn only — reuse the existing debounced, idle-only,
  // resume-preserving reload path (same mechanism as MCP/skills config changes).
  ipcMain.handle("hv:builtins-get", () => getBuiltinTools());
  ipcMain.handle("hv:builtins-set", (_e, t: { plan?: boolean; askUser?: boolean; planAppend?: string; terminal?: boolean; intent?: boolean; browser?: boolean }) => {
    setBuiltinTools(t);
    scheduleRuntimeReload("skills", "global", null);
  });
  // Extended prompt-cache retention. Deliberately NO live reload: the only gain
  // is a longer cache TTL on later turns, which is not worth respawning live
  // sessions for (a respawn resets their grants + dangerous mode). Next spawn.
  ipcMain.handle("hv:get-long-cache", () => getLongCache());
  ipcMain.handle("hv:set-long-cache", (_e, on: boolean) => setLongCache(!!on));
  // Round 11: open-files context. Global and ON by default (§9).
  ipcMain.handle("hv:get-open-files-context", () => getOpenFilesContext());
  ipcMain.handle("hv:set-open-files-context", (_e, on: boolean) => setOpenFilesContext(!!on));

  // Round 8: keyboard-shortcut overrides. Stored whole; the renderer merges
  // them with the defaults (shortcuts.ts), so main stays ignorant of the action list.
  ipcMain.handle("hv:get-shortcuts", () => getShortcuts());
  ipcMain.handle("hv:set-shortcuts", (_e, map: Record<string, string>) => setShortcuts(map ?? {}));

  // ── §26 Terminals ──────────────────────────────────────────────────────────
  // No permission gate anywhere in this block, deliberately: permissions gate
  // the AGENT, not the human (§26). Part 2 is where the gate comes back.
  ipcMain.handle("hv:term-create", (_e, ws: string, cols?: number, rows?: number) => {
    // cwd comes from the REGISTRY, never from the renderer's string — the same
    // posture every other fs entry point in this file takes.
    const known = workspaces.list().find((p) => p.replace(/\/+$/, "") === String(ws).replace(/\/+$/, ""));
    if (!known) throw new Error("Unknown workspace");
    const settings = getTerminalSettings();
    const info = terminals.create(known, known, settings, cols ?? 80, rows ?? 24);
    // ONE entry, on open. Not per command and not per keystroke: the audit
    // trail should not be silent about the existence of a shell, and should
    // not pretend to be a keylogger either (§26).
    void log.append({
      type: "terminal.open",
      workspaceId: known,
      data: { terminalId: info.id, shell: settings.shellPath ?? process.env.SHELL ?? "/bin/zsh" },
    });
    return info;
  });
  ipcMain.handle("hv:term-input", (_e, id: string, data: string) => {
    const d = String(data);
    // §26 part 2: main is the only place that sees BOTH writers, which is what
    // makes the interleave hold possible at all — an agent-terminal card and a
    // workspace tab route their keystrokes through this one handler. Still
    // ungated: permissions gate the agent, not the human.
    agentTerminals.noteUserInput(id, d);
    terminals.write(id, d);
  });
  ipcMain.handle("hv:term-resize", (_e, id: string, cols: number, rows: number) =>
    terminals.resize(id, cols, rows),
  );
  ipcMain.handle("hv:term-close", (_e, id: string) => terminals.kill(id));
  // §7 round 12: a user title beats the foreground poll; "" restores it.
  ipcMain.handle("hv:term-rename", (_e, id: string, title: string) => terminals.rename(id, title));
  ipcMain.handle("hv:term-list", (_e, ws?: string) => terminals.list(ws));
  ipcMain.handle("hv:term-snapshot", (_e, id: string) => terminals.snapshot(id));
  // §26 part 2: the RENDERED grid as plain text — the agent-terminal card's
  // collapsed tail. It exists because the first version accumulated raw PTY
  // bytes in the renderer and stripped CSI escapes with a regex, which left
  // control characters behind: zsh's line editor writes `s`, a backspace, then
  // rewrites, so `sleep 600` was displayed as `ssleep 600`. That is precisely
  // the failure §26 built the headless mirror to avoid — one buffer, more
  // readers, never a second parser.
  ipcMain.handle("hv:term-text", (_e, id: string, lines?: number) =>
    terminals.readText(id, Math.min(Math.max(1, Math.floor(lines ?? 3)), 200)),
  );
  ipcMain.handle("hv:term-foreground", (_e, id: string) => terminals.foreground(id));
  ipcMain.handle("hv:get-terminal-settings", () => getTerminalSettings());
  ipcMain.handle("hv:set-terminal-settings", (_e, s: Record<string, unknown>) =>
    setTerminalSettings(s ?? {}),
  );

  // §27: voice input. The model download and the inference child both live in
  // main — the renderer's CSP is `default-src 'self'` with no `connect-src`,
  // so downloading here sidesteps it rather than weakening it.
  ipcMain.handle("hv:voice-status", () => voiceStatus());
  ipcMain.handle("hv:voice-download", () => {
    // Deliberately not awaited: §3.2's download must not block the app — the
    // user keeps typing, and the mic activates when it finishes.
    void startVoiceDownload();
    return voiceStatus();
  });
  ipcMain.handle("hv:voice-cancel-download", () => {
    cancelVoiceDownload();
    return voiceStatus();
  });
  ipcMain.handle("hv:voice-remove-model", () => {
    removeVoiceModel();
    return voiceStatus();
  });
  ipcMain.handle("hv:get-voice-settings", () => getVoiceSettings());
  ipcMain.handle("hv:set-voice-settings", (_e, s: Record<string, unknown>) =>
    setVoiceSettings(s ?? {}),
  );
  /**
   * §8.3. The renderer must NEVER call getUserMedia without asking this first.
   * Chromium on macOS resolves getUserMedia with a live track that produces
   * nothing but zeros when TCC has not granted access — for dictation that is
   * the worst failure available: not an error the user can act on, but a
   * silent empty transcript.
   */
  ipcMain.handle("hv:voice-mic-status", () =>
    process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("microphone") : "granted",
  );
  ipcMain.handle("hv:voice-ask-mic", async () => {
    if (process.platform !== "darwin") return true;
    if (systemPreferences.getMediaAccessStatus("microphone") !== "not-determined") {
      return systemPreferences.getMediaAccessStatus("microphone") === "granted";
    }
    return systemPreferences.askForMediaAccess("microphone");
  });
  ipcMain.handle("hv:voice-open-mic-settings", () => {
    if (process.platform !== "darwin") return;
    // The pane identifier changed with System Settings (macOS 13+), and the old
    // one FAILS SOFTLY: `com.apple.preference.security` still launches Settings
    // but the ?Privacy_Microphone anchor is dropped, so you land on the Privacy
    // & Security overview — a page with no app list on it at all. The user reads
    // that as "the app is not in the list" and there is nothing to grant.
    // The ExtensionKit id is the one that actually scrolls to Microphone:
    //   /System/Library/ExtensionKit/Extensions/SecurityPrivacyExtension.appex
    const modern = Number(process.getSystemVersion().split(".")[0]) >= 13;
    void shell.openExternal(
      modern
        ? "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone"
        : "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
  });
  ipcMain.handle("hv:voice-transcribe", async (_e, pcm: Int16Array) => {
    // The transcript is returned and nothing else: §11 forbids it reaching the
    // EventLog, the audit log or any analytics surface. A dictated prompt is
    // recorded exactly as a typed one is, and there is no separate voice trail.
    const samples = pcm instanceof Int16Array ? pcm : new Int16Array(pcm ?? []);
    if (samples.length === 0) return "";
    return voiceHost.transcribe(samples);
  });

  // §26: the tab layout, stored opaquely — the renderer validates and prunes
  // it on restore (layoutPersist.ts), so main never learns what a tab is.
  ipcMain.handle("hv:get-layout", () => getLayout());
  ipcMain.handle("hv:set-layout", (_e, l: Record<string, unknown>) => setLayout(l ?? {}));

  // Read-only display of a built-in tool's prompt body (§13 round 6) — the UI
  // shows this verbatim and offers only an append, never an override.
  ipcMain.handle("hv:builtin-prompt", (_e, name: string) => {
    if (name === "plan") return { text: buildPlanPrompt() };
    // §26: the Terminal group's resting cost is the steer line PLUS three tool
    // schemas, so showing only the steer line would understate what turning it
    // off saves. Descriptions come from the bridge's own registrations.
    if (name === "terminal") return { text: buildTerminalPrompt() };
    return { text: "" };
  });

  /**
   * Round 15: the audit page reads BOTH kinds of row — permission decisions and
   * the app's own one-shot model calls (§19: titles, the AGENTS.md draft, the
   * commit message, the PR draft). They belong on the same page because the
   * question the user asked is one question: "what has run, and did I see it?"
   * Sorted by timestamp so the two interleave honestly rather than appearing as
   * two lists that happen to share a screen.
   */
  ipcMain.handle("hv:read-audit", async (_e, filter?: { sessionId?: string; workspaceId?: string }) => {
    const [decisions, oneShots] = await Promise.all([
      log.read({ type: "permission.decision", ...filter }),
      log.read({ type: "assistant.oneshot", ...filter }),
    ]);
    return [...decisions, ...oneShots].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  });

  // ── B7: local analytics (read + aggregate in main, never leaves the machine) ──
  ipcMain.handle("hv:get-analytics", async (_e, filter?: AnalyticsFilter) => {
    // Round 11: money comes from the ledger, not from `stats.cost`, so Stats and
    // the per-session cost pill are the same arithmetic with the same policy —
    // plan spend excluded, unknown prices flagged. Resolved once per call
    // because planProvidersFor depends on which keys are configured.
    const plans = planProvidersFor(providerKeyStatus());
    const readCalls = (sessionId: string): ApiCall[] | null => {
      const meta = index.get(sessionId);
      if (!meta) return null; // no meta ⇒ we cannot price it ⇒ unknown, not $0
      const text = readSessionFile(sessionDir(), meta.piSessionFile);
      if (text == null) return null;
      return parseCalls(text, plans);
    };
    return aggregate(await log.read(), filter ?? {}, readCalls);
  });

  // B7 onboarding: "seen the wow-flow" flag lives in config (userData), shown
  // once, re-openable from the Help affordance.
  ipcMain.handle("hv:get-onboarding-seen", () => getOnboardingSeen());
  ipcMain.handle("hv:set-onboarding-seen", (_e, seen: boolean) => setOnboardingSeen(!!seen));

  // macOS dock badge = total pending permission prompts (renderer-computed).
  ipcMain.on("hv:set-badge-count", (_e, n: number) => {
    try {
      app.setBadgeCount(Number.isInteger(n) && n > 0 ? n : 0);
    } catch {
      /* not supported on this platform */
    }
  });

  // Live model list from Pi's registry (only models with configured auth).
  ipcMain.handle("hv:list-models", async () => {
    const c = await ensureUtility();
    const res = await c.send({ type: "get_available_models" });
    const models = ((res.data as { models?: { provider: string; id: string; name?: string; contextWindow?: number; input?: string[] }[] })?.models ?? []);
    // contextWindow feeds B5's estimated-gauge fallback (when Pi didn't measure).
    // input (W2.1) gates the image-attach button: only vision models accept images.
    return models.map((m) => ({ provider: m.provider, id: m.id, name: m.name ?? m.id, contextWindow: m.contextWindow, input: m.input }));
  });
  ipcMain.handle("hv:set-default-model", async (_e, provider: string, modelId: string) => {
    setDefaultModel({ provider, modelId });
    // Apply live to the utility client; chat sessions pick the new default up
    // at their next spawn (changing a running conversation's model mid-turn
    // would be surprising).
    await utility?.send({ type: "set_model", provider, modelId }).catch(() => {});
    providersChanged();
  });

  // First-run gate: any BYOK key, any auth.json credential, or local Ollama.
  ipcMain.handle("hv:has-any-provider", async () => {
    const status = providerKeyStatus();
    if (Object.values(status).some(Boolean)) return true;
    if (authJsonProviders(agentDir()).length > 0) return true;
    return (await detectOllama()).running;
  });

  // Explicit renderer request only; auth URLs from Pi's OAuth flows.
  ipcMain.handle("hv:open-external", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
    return Promise.resolve();
  });

  // ── AGENTS.md (B2, additive) — fs confined to <workspace>/AGENTS.md ──
  ipcMain.handle("hv:read-agents-md", (_e, workspaceId: string) =>
    readAgentsMd(workspaces.list(), workspaceId));
  ipcMain.handle("hv:write-agents-md", (_e, workspaceId: string, content: string) =>
    writeAgentsMd(workspaces.list(), workspaceId, String(content)));
  // WS5: write the agents-md-maker structured draft (root + nested) — the app
  // does the confined write + audit; the sub-agent stays read-only.
  ipcMain.handle("hv:write-agents-md-files", (_e, workspaceId: string, files: Record<string, string>) => {
    const written = writeAgentsMdFiles(workspaces.list(), workspaceId, files);
    void log.append({ type: "agents_md.written", workspaceId, data: { files: written } });
    return written;
  });
  ipcMain.handle("hv:propose-agents-md", (_e, workspaceId: string) =>
    proposeAgentsMd(piRuntimeDir(), workspaces.list(), workspaceId, {
      // §16: same guarded resolution as a chat spawn — a removed endpoint's
      // ref must not be handed to a one-shot Pi call either.
      model: resolveSpawnModel(),
      env: { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
      onDone: oneShot("agents-md", workspaceId),
    }));
  // W2.3 missing-file flow: CLAUDE.md → AGENTS.md copy (same confinement).
  ipcMain.handle("hv:has-claude-md", (_e, workspaceId: string) =>
    hasClaudeMd(workspaces.list(), workspaceId));
  ipcMain.handle("hv:copy-claude-md", (_e, workspaceId: string) =>
    copyClaudeMdToAgentsMd(workspaces.list(), workspaceId));

  // ── B6: agents & tools ─────────────────────────────────────────────────
  // hv.agents / hv.tools ride the fire-and-forget /hv-* command channel (like
  // B5 context); results stream back as notifies parsed by the renderer.
  // Prefer the focused session's live Pi, else the utility client, so the
  // panels work even with no chat session open.
  const anyClient = async (sessionId?: string): Promise<PiClient> => {
    const c = sessionId ? (manager.get(sessionId) as PiClient | null) : null;
    return c ?? ensureUtility();
  };
  const agentDirs = (): string[] => allowedAgentDirs(builtinAgentsDir(), workspaces.list());

  ipcMain.handle("hv:list-agents", async (_e, sessionId?: string) => {
    void (await anyClient(sessionId)).send({ type: "prompt", message: "/hv-agents" }).catch(() => {});
  });
  ipcMain.handle("hv:list-tools", async (_e, sessionId?: string) => {
    void (await anyClient(sessionId)).send({ type: "prompt", message: "/hv-tools" }).catch(() => {});
  });
  // Interrupt a running async subagent (stop button). Fire-and-forget prompt to
  // that session's client; the bridge drives pi-subagents' RPC and notifies back.
  ipcMain.handle("hv:subagent-interrupt", (_e, sessionId: string, runId: string) => {
    void (manager.get(sessionId) as PiClient | null)?.send({ type: "prompt", message: `/hv-subagent-interrupt ${runId}` }).catch(() => {});
  });

  // Agent file edit/duplicate — path-confined to allowed agent dirs (agents.ts).
  ipcMain.handle("hv:read-agent", (_e, filePath: string) => readAgentBody(agentDirs(), filePath));
  ipcMain.handle("hv:write-agent", (_e, filePath: string, edit: { body?: string; model?: string | null }) => {
    writeAgentEdit(agentDirs(), filePath, edit);
    // Agents are read at delegation time by the pi-subagents child spawn, so
    // edits apply to the next delegation — no live broadcast needed.
  });
  ipcMain.handle("hv:duplicate-agent", (_e, filePath: string) => duplicateAgent(agentDirs(), filePath));

  // ── W1.4: system prompt + workspace settings ───────────────────────────
  // /hv-sysprompt rides the fire-and-forget command channel (B5 pattern); the
  // hv.sysprompt notify streams back through hv:ui-request. Prefer the focused
  // session's Pi (it has a captured prompt after a turn), else the utility
  // client (never runs a turn → text null → renderer shows the friendly note).
  ipcMain.handle("hv:sysprompt-snapshot", async (_e, sessionId?: string) => {
    void (await anyClient(sessionId)).send({ type: "prompt", message: "/hv-sysprompt" }).catch(() => {});
  });

  // APPEND_SYSTEM.md additions layer — read at session load, so edits apply to
  // new/restarted sessions. Workspace file REPLACES the global one (appendSystem.ts).
  ipcMain.handle("hv:get-global-append", () => readAppend(globalAppendFile(agentDir())));
  ipcMain.handle("hv:set-global-append", (_e, content: string) =>
    writeAppend(globalAppendFile(agentDir()), String(content)));

  // ── W2.1: per-session model override + image attach ─────────────────────
  // Persists on SessionMeta (survives hibernation/resume — spawn resolution
  // picks it up) AND applies live via RPC set_model when the session has a
  // running Pi. Returns { live } so the renderer can show an honest
  // "applies on restart" hint when the live switch didn't happen.
  ipcMain.handle(
    "hv:set-session-model",
    async (_e, sessionId: string, m: { provider: string; modelId: string } | null): Promise<{ live: boolean }> => {
      if (!index.get(sessionId)) throw new Error("Unknown session");
      const model = m && typeof m.provider === "string" && typeof m.modelId === "string"
        ? { provider: m.provider, modelId: m.modelId }
        : undefined;
      index.update(sessionId, { model }); // undefined clears (dropped by JSON.stringify)
      sessionsChanged();
      const client = manager.get(sessionId) as PiClient | null;
      if (!client || !model) return { live: false };
      try {
        const res = await client.send({ type: "set_model", provider: model.provider, modelId: model.modelId });
        return { live: res.success !== false };
      } catch {
        return { live: false }; // persisted — applies on next spawn
      }
    }
  );

  // Image picker for the "+" attach menu — main-side dialog, images only.
  // Returns base64 + mimeType matching the RPC ImageContent shape (no data: prefix).
  const IMAGE_MIME: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
  };
  ipcMain.handle("hv:pick-image", async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    const file = r.canceled ? null : r.filePaths[0];
    if (!file) return null;
    const mimeType = IMAGE_MIME[path.extname(file).toLowerCase()];
    if (!mimeType) return null; // filter should prevent this — stay honest if bypassed
    return { data: fs.readFileSync(file).toString("base64"), mimeType, name: path.basename(file) };
  });

  // ── W2.2: workspace file tree + editor (additive; files.ts confinement) ──
  ipcMain.handle("hv:fs-list", (_e, workspaceId: string, relDir: string) =>
    listDir(workspaces.list(), workspaceId, relDir));
  // F3: recursive listing for @-mention autocomplete (visible entries, capped).
  ipcMain.handle("hv:fs-list-recursive", (_e, workspaceId: string) =>
    listRecursive(workspaces.list(), workspaceId));
  ipcMain.handle("hv:fs-read", (_e, workspaceId: string, relPath: string) =>
    readWorkspaceFile(workspaces.list(), workspaceId, relPath));
  ipcMain.handle("hv:fs-write", (_e, workspaceId: string, relPath: string, content: string) =>
    writeWorkspaceFile(workspaces.list(), workspaceId, relPath, content));
  ipcMain.handle("hv:fs-mtime", (_e, workspaceId: string, relPath: string) =>
    statMtime(workspaces.list(), workspaceId, relPath));
  // Reveal in Finder from clickable card paths — workspace-confined.
  ipcMain.handle("hv:reveal-path", (_e, workspaceId: string, relPath: string) => {
    shell.showItemInFolder(resolveInWorkspace(workspaces.list(), workspaceId, relPath));
  });
  // Round 4 #7: file-tree Details popup — kind/size/mtime, workspace-confined.
  ipcMain.handle("hv:fs-stat", (_e, workspaceId: string, relPath: string) =>
    statDetails(workspaces.list(), workspaceId, relPath));
  // Round 4 #7: file-tree Delete — move to the OS Trash (recoverable, never a
  // hard delete), workspace-confined like every other fs op.
  ipcMain.handle("hv:fs-trash", (_e, workspaceId: string, relPath: string) =>
    shell.trashItem(resolveInWorkspace(workspaces.list(), workspaceId, relPath)));

  // WS8: file-tree mutations (confined; refuse to clobber).
  ipcMain.handle("hv:fs-create-file", (_e, workspaceId: string, relPath: string) =>
    createFile(workspaces.list(), workspaceId, relPath));
  ipcMain.handle("hv:fs-create-dir", (_e, workspaceId: string, relPath: string) =>
    createDir(workspaces.list(), workspaceId, relPath));
  ipcMain.handle("hv:fs-move", (_e, workspaceId: string, srcRel: string, destDirRel: string) =>
    moveEntry(workspaces.list(), workspaceId, srcRel, destDirRel));
  ipcMain.handle("hv:fs-import", (_e, workspaceId: string, destDirRel: string, srcAbsPaths: string[]) =>
    importEntries(workspaces.list(), workspaceId, destDirRel, srcAbsPaths));
  // §23: re-parse every plan file in a workspace and push its n/m + status.
  const pushPlanProgress = (workspaceId: string): void => {
    for (const p of listPlanProgress(workspaces.list(), workspaceId)) {
      send("hv:plan-changed", { workspaceId, ...p });
    }
  };
  // WS8: native fs watching — auto-refresh the tree (replaces the refresh button).
  ipcMain.handle("hv:watch-workspace", (_e, workspaceId: string) => {
    resolveInWorkspace(workspaces.list(), workspaceId, ""); // confinement gate
    // §23: plan progress only moves on a watcher event, so anything ticked while
    // nobody was watching is invisible until the NEXT write. Sync once up front.
    pushPlanProgress(workspaceId);
    watchWorkspace(workspaceId, (relDirs) => {
      send("hv:fs-changed", { workspaceId, relDirs });
      // §29: a file changed on disk means the working tree moved. Suppressed
      // while a session here is busy (pushGitChanged's own gate) — the turn-end
      // refresh below catches the whole turn at once.
      pushGitChanged(workspaceId);
      // §14: a change under .agents/skills may flip an approved workspace skill
      // back to needs-review (hash mismatch) — tell the renderer to re-fetch, and
      // auto-approve skills the agent just authored via skill-creator.
      if (relDirs.some((d) => d.startsWith(".agents/skills") || d === ".agents" || d === "")) {
        skillsChanged();
        autoApproveCreatedSkills(workspaceId);
      }
      // §24: same for the workspace prompt root — an edit flips an approved
      // template back to needs-review, a git pull can add a new one.
      if (relDirs.some((d) => d.startsWith(".agents/prompts") || d === ".agents" || d === "")) {
        promptTemplatesChanged();
      }
      // §23: when a plan dir changed, re-parse plan files and push live progress.
      if (relDirs.some((d) => d === PLAN_DIR || d === ".agents" || d === "")) {
        pushPlanProgress(workspaceId);
      }
    });
  });
  ipcMain.handle("hv:unwatch-workspace", (_e, workspaceId: string) => {
    unwatchWorkspace(workspaceId);
    unwatchGit(workspaceId);
  });

  // ── §29 Git integration ──────────────────────────────────────────────────
  //
  // Three refresh seams feed one push. Two of them (the fs watcher and the
  // narrow .git watch) are SUPPRESSED while any session in the workspace is
  // busy: an agent mid-refactor would otherwise trigger a status run per
  // debounce tick. The third — turn end — catches everything at once.
  const gitBusySessions = (workspaceId: string): string[] =>
    affectedSessionIds("workspace", workspaceId, index.list().map((s) => ({ id: s.id, workspaceId: s.workspaceId })))
      .filter((id) => manager.get(id) !== null && !activity.isIdle(id));

  const pushGitChanged = (workspaceId: string, opts: { force?: boolean } = {}): void => {
    if (!opts.force && gitBusySessions(workspaceId).length > 0) return;
    send("hv:git-changed", { workspaceId });
  };

  /**
   * The idle gate, in ONE place. Every verb that mutates the WORKING TREE is
   * blocked while a session in this workspace is busy — sessions share one tree,
   * so a stash rips the agent's own edits out from under it exactly the way a
   * branch switch does. Commit, push and fetch are deliberately NOT gated: they
   * change history or the remote picture, never the files under the agent.
   */
  const gitGate = (workspaceId: string): { busy: string[] } | null => {
    const busy = gitBusySessions(workspaceId);
    if (!busy.length) return null;
    return { busy: busy.map((id) => index.get(id)?.title ?? id) };
  };

  const auditGit = (workspaceId: string, action: string, detail: Record<string, unknown>): void => {
    // Human-only by construction — there is no git tool the model can call, so
    // `who` is not a variable here (§29, mirroring §23 and §9).
    void log.append({ type: "git.action", workspaceId, data: { action, ...detail, who: "human" } });
  };

  /**
   * The probe is cached per workspace, which is right for a repo — its root does
   * not move — but wrong for a NEGATIVE answer: someone running `git init` in
   * their own terminal would leave the panel saying "isn't tracking versions
   * yet" forever. So a non-repo answer is re-asked each time (one rev-parse),
   * while a known repo stays cached.
   */
  const freshProbe = async (workspaceId: string): Promise<Awaited<ReturnType<typeof probeWorkspace>>> => {
    const cached = await probeWorkspace(workspaceId);
    if (cached.kind === "repo") return cached;
    invalidateProbe(workspaceId);
    return probeWorkspace(workspaceId);
  };

  ipcMain.handle("hv:git-state", async (_e, workspaceId: string) => ({
    ...(await freshProbe(workspaceId)),
    available: await gitAvailable(),
  }));

  ipcMain.handle("hv:git-status", async (_e, workspaceId: string) => {
    await freshProbe(workspaceId);
    const payload = await gitStatus(workspaceId);
    // Start the narrow .git watch lazily, when someone first asks about this
    // workspace's git: the sidebar wants a fresh branch name for every
    // workspace, and the file-tree watcher filters .git so nothing else sees it.
    if (payload.state.kind === "repo") watchGitDir(workspaceId, () => pushGitChanged(workspaceId));
    return payload;
  });

  ipcMain.handle("hv:git-diff", (_e, workspaceId: string, baseline: "head" | "base", opts?: { staged?: boolean; path?: string }) =>
    gitDiff(workspaceId, baseline, opts ?? {}));
  ipcMain.handle("hv:git-history", (_e, workspaceId: string, limit: number) => gitHistory(workspaceId, limit));
  ipcMain.handle("hv:git-show", (_e, workspaceId: string, sha: string) => gitShow(workspaceId, sha));
  ipcMain.handle("hv:git-branches", (_e, workspaceId: string) => listBranches(workspaceId));
  // Round 14: this outlived the baseline dropdown it was written for. It now
  // answers "which branch must NOT offer a delete control".
  ipcMain.handle("hv:git-default-branch", (_e, workspaceId: string) => defaultBranch(workspaceId));

  ipcMain.handle("hv:git-commit", async (_e, workspaceId: string, message: string, opts: { stagedOnly: boolean; amend: boolean }) => {
    // Not gated: a commit records what is already on disk.
    const r = await saveVersion(workspaceId, message, opts);
    if (r.ok) {
      auditGit(workspaceId, opts.amend ? "amend" : "commit", { sha: r.sha, message });
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-stage", async (_e, workspaceId: string, relPath: string, stage: boolean) => {
    const r = await stageFile(workspaceId, relPath, stage);
    if (r.ok) pushGitChanged(workspaceId, { force: true });
    return r;
  });

  ipcMain.handle("hv:git-switch", async (_e, workspaceId: string, branch: string, opts: { create: boolean; mode: "take" | "stash" }) => {
    const gate = gitGate(workspaceId);
    if (gate) return { ok: false, ...gate };
    const r = await switchBranch(workspaceId, branch, opts);
    if (r.ok) {
      auditGit(workspaceId, "switch", { branch, create: opts.create, mode: opts.mode });
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-delete-branch", async (_e, workspaceId: string, branch: string, force?: boolean) => {
    // Not gated: deleting a ref never touches the working tree, so it sits with
    // commit/push/fetch rather than with switch/stash/undo (§29's gate rule).
    const r = await deleteBranch(workspaceId, branch, force === true);
    if (r.ok) {
      auditGit(workspaceId, "delete-branch", { branch, force: force === true });
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-fetch", (_e, workspaceId: string) => fetchRemote(workspaceId));

  ipcMain.handle("hv:git-sync", async (_e, workspaceId: string) => {
    // A pull DOES touch the working tree, so sync is gated even though its
    // fetch and push halves are harmless.
    const gate = gitGate(workspaceId);
    if (gate) return { ok: false, ...gate };
    const r = await sync(workspaceId);
    if (r.ok) {
      auditGit(workspaceId, "sync", {});
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-publish", async (_e, workspaceId: string) => {
    const r = await publish(workspaceId);
    if (r.ok) {
      auditGit(workspaceId, "publish", {});
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-stash", async (_e, workspaceId: string, action: "save" | "pop" | "drop", stashIndex?: number) => {
    const gate = gitGate(workspaceId);
    if (gate) return { ok: false, ...gate };
    const r = await stash(workspaceId, action, stashIndex ?? 0);
    if (r.ok) {
      auditGit(workspaceId, `stash-${action}`, { index: stashIndex ?? 0 });
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-undo-hunk", async (_e, workspaceId: string, patch: string, meta: { path: string }) => {
    const gate = gitGate(workspaceId);
    if (gate) return { ok: false, stale: false, error: "", ...gate };
    const r = await undoHunk(workspaceId, patch);
    if (r.ok) {
      auditGit(workspaceId, "undo-hunk", { path: meta?.path, hunks: 1 });
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-undo-file", async (_e, workspaceId: string, relPath: string) => {
    const gate = gitGate(workspaceId);
    if (gate) return { ok: false, ...gate };
    const r = await undoFile(workspaceId, relPath);
    if (r.ok) {
      auditGit(workspaceId, "undo-file", { path: relPath });
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-discard-untracked", async (_e, workspaceId: string, relPath: string) => {
    const gate = gitGate(workspaceId);
    if (gate) return { ok: false, ...gate };
    const r = await discardUntracked(workspaceId, relPath);
    if (r.ok) {
      auditGit(workspaceId, "discard-untracked", { path: relPath });
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-init-preview", (_e, workspaceId: string) => initPreview(workspaceId));

  ipcMain.handle("hv:git-init", async (_e, workspaceId: string, gitignore: string) => {
    const gate = gitGate(workspaceId);
    if (gate) return { ok: false, ...gate };
    const r = await initRepo(workspaceId, gitignore);
    if (r.ok) {
      auditGit(workspaceId, "init", {});
      pushGitChanged(workspaceId, { force: true });
    }
    return r;
  });

  ipcMain.handle("hv:git-detect-junk", async (_e, workspaceId: string) => {
    const payload = await gitStatus(workspaceId);
    return detectJunk(payload.status?.files ?? []);
  });

  ipcMain.handle("hv:git-add-gitignore", async (_e, workspaceId: string, lines: string[]) => {
    await appendGitignore(workspaceId, lines);
    pushGitChanged(workspaceId, { force: true });
    return { ok: true };
  });

  // §2b — the drafted commit message. Never the live session: this is a one-shot
  // print-mode call, so nothing reaches a transcript or a context window.
  ipcMain.handle("hv:git-draft-message", async (_e, workspaceId: string, stagedOnly: boolean) => {
    const model = getGitMessageModel() ?? resolveSpawnModel(workspaceId);
    if (!model) return null;
    const [files, diffs, log20] = await Promise.all([
      gitStatus(workspaceId),
      gitDiff(workspaceId, "head", { staged: stagedOnly }),
      gitHistory(workspaceId, 20),
    ]);
    const diffText = diffs
      .map((f) => `${f.fileHeader}\n${f.hunks.map((h) => h.raw).join("")}`)
      .join("\n");
    if (!diffText.trim()) return null;
    return draftCommitMessage(
      piRuntimeDir(),
      workspaceId,
      {
        diff: diffText,
        files: (files.status?.files ?? []).filter((f) => (stagedOnly ? f.staged : true)),
        recentSubjects: log20.map((l) => l.subject),
      },
      model,
      { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
      undefined,
      oneShot("commit-message", workspaceId),
    );
  });

  /**
   * §5a — the ONLY thing we do about a missing git: ask the OS for it. Running
   * `git --version` WITHOUT suppressing its output is what triggers macOS's
   * Command Line Tools installer, because /usr/bin/git is a shim that prompts.
   * We never download or bundle a git: §3 says git is a feature, not a runtime
   * dependency, and installing developer tooling behind the user's back would
   * be the opposite of that promise.
   */
  ipcMain.handle("hv:git-install-prompt", () => {
    if (process.platform === "darwin") {
      spawn("git", ["--version"], { detached: true, stdio: "ignore" }).unref();
      return { ok: true };
    }
    void shell.openExternal("https://git-scm.com/downloads");
    return { ok: true };
  });

  /**
   * §29 §7 — the prefilled pull-request URL, or null.
   *
   * Assembled in MAIN so the renderer only has a link to open. Null means "no
   * button": not a repo, no `origin`, a forge we do not recognise, sitting on
   * the default branch, or nothing pushed yet — all states where a PR link
   * would 404 or propose nothing.
   *
   * HappyVibe creates nothing and stores no credential; the user presses Create
   * on the forge, already signed in there. (Which is why this cannot use the
   * §28 embedded pane: it has its own cookie jar.)
   */
  ipcMain.handle("hv:git-pr-url", async (_e, workspaceId: string, draft = false) => {
    const payload = await gitStatus(workspaceId);
    if (payload.state.kind !== "repo") return null;
    const branch = payload.status?.branch;
    if (!branch?.branch || !branch.upstream) return null;

    const origin = await remoteUrl(workspaceId);
    const remote = origin ? parseRemote(origin) : null;
    if (!remote) return null;

    const baseRef = await defaultBranch(workspaceId);
    // "origin/main" names the same branch as "main" for a compare link.
    const base = (baseRef ?? "main").replace(/^origin\//, "");
    if (base === branch.branch) return null; // a PR from main into main proposes nothing

    const commits = await branchCommits(workspaceId, base);

    // `draft: false` is the ELIGIBILITY call — the renderer asks it on every
    // status change to decide whether the button exists, so it must never run
    // the model or read a diff. `draft: true` is the click.
    let drafted: { title: string; body: string } | null = null;
    if (draft) {
      const model = getGitMessageModel() ?? resolveSpawnModel(workspaceId);
      if (model) {
        const diffs = await gitDiff(workspaceId, "base");
        const diffText = diffs.map((f) => `${f.fileHeader}\n${f.hunks.map((h) => h.raw).join("")}`).join("\n");
        drafted = await draftPullRequest(
          piRuntimeDir(),
          workspaceId,
          { commits, diff: diffText, branch: branch.branch, base },
          model,
          { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
          undefined,
          oneShot("pr-draft", workspaceId),
        );
      }
    }
    // The fallback is what the user would have typed anyway, so a missing
    // provider costs nicer prose and nothing else.
    const title = drafted?.title || (commits.length === 1 ? commits[0] : humaniseBranch(branch.branch));
    const body = drafted?.body || commits.map((c) => `- ${c}`).join("\n");

    const url = pullRequestUrl({ host: remote.host, path: remote.path, base, head: branch.branch, title, body });
    return url ? { url, drafted: !!drafted } : null;
  });

  ipcMain.handle("hv:git-message-model", () => getGitMessageModel());
  ipcMain.handle("hv:set-git-message-model", (_e, m: { provider: string; modelId: string } | null) => {
    setGitMessageModel(m && typeof m.provider === "string" && typeof m.modelId === "string" ? m : null);
    return getGitMessageModel();
  });

  // Per-workspace model override (spawn resolution: workspace → global default).
  // Applies to sessions spawned/restarted after the change.
  ipcMain.handle("hv:get-workspace-model", (_e, workspaceId: string) => workspaces.getModel(workspaceId));
  ipcMain.handle("hv:set-workspace-model", (_e, workspaceId: string, m: { provider: string; modelId: string } | null) => {
    workspaces.setModel(workspaceId, m && typeof m.provider === "string" && typeof m.modelId === "string"
      ? { provider: m.provider, modelId: m.modelId }
      : null);
    providersChanged(); // open chat bars refetch → the chip's tier updates live
  });

  // ── MCP server config (adapter reads agentDir()/mcp.json + <ws>/.mcp.json;
  //    changes apply to NEW sessions — the adapter loads config at startup) ──
  const globalMcpFile = () => path.join(agentDir(), "mcp.json");
  // Workspace tier: fixed filename at the workspace root. Guard: only paths
  // registered in the WorkspaceRegistry are writable — uses path.resolve
  // matching (the same trust boundary every fs writer here uses).
  const workspaceMcpFile = (workspaceId: string): string => {
    const ws = path.resolve(workspaceId);
    if (!workspaces.list().some((w) => path.resolve(w) === ws)) {
      throw new Error("Unknown workspace");
    }
    return path.join(ws, ".mcp.json");
  };

  ipcMain.handle("hv:mcp-get", (_e, workspaceId?: string) => ({
    global: readMcpFile(globalMcpFile()),
    workspace: workspaceId ? readMcpFile(workspaceMcpFile(workspaceId)) : null,
  }));

  ipcMain.handle(
    "hv:mcp-set-server",
    // async since round 13: revoking a removed server's credential now reaches
    // the OS keychain through the sidecar, which is a round-trip.
    async (_e, scope: "global" | "workspace", workspaceId: string | null, name: string, cfg: McpServerConfig | null) => {
      const file = scope === "global" ? globalMcpFile() : workspaceMcpFile(workspaceId ?? "");
      writeMcpServer(file, name, cfg);
      void log.append({ type: "mcp.config", workspaceId: workspaceId ?? undefined,
        data: { scope, name, removed: cfg === null } });
      if (cfg === null) {
        // Removal: drop the now-stale status entry so it can't resurface.
        mcpStatusMap.delete(statusKey(scope, workspaceId, name));
        mcpStatusChanged();
        // Revoke local OAuth credentials with the server. The token store is
        // keyed by server NAME and shared across scopes/workspaces (adapter
        // contract), so only when no remaining config still references it.
        const files = [
          path.join(agentDir(), "mcp.json"),
          ...workspaces.list().map((w) => path.join(w, ".mcp.json")),
        ];
        if (!serverNameInFiles(name, files)) {
          // Same fix as Log out, and for the same reason: deleting main's file
          // left the adapter's keychain entry alive, so a "removed" server's
          // credential survived — and a re-add would silently reuse it.
          await logout(name, agentDir(), adapterStore);
          // §13 round 8: catalog-installed API keys are keyed by server name
          // too — drop them on the same condition, or a re-add would silently
          // reuse a key the user thought they had removed.
          removeMcpSecrets(name);
          void log.append({ type: "mcp.auth", workspaceId: workspaceId ?? undefined,
            data: { name, action: "credentials-deleted", reason: "server-removed" } });
        }
      }
      scheduleMcpReload(scope, workspaceId); // apply to running sessions
      return readMcpFile(file);
    },
  );

  // §13 round 8: one-click catalog install. The renderer sends a catalog KEY and
  // form values — never a config object — so a renderer bug cannot write an
  // arbitrary server. Secrets are encrypted here and referenced from mcp.json by
  // ${HV_MCP_…} placeholder only.
  ipcMain.handle(
    "hv:mcp-install-catalog",
    (
      _e,
      catalogKey: string,
      scope: "global" | "workspace",
      workspaceId: string | null,
      values: Record<string, string>,
    ) => {
      const entry = catalogEntry(catalogKey);
      if (!entry) return { ok: false as const, error: "Unknown catalog entry" };

      const file = scope === "global" ? globalMcpFile() : workspaceMcpFile(workspaceId ?? "");
      try {
        const { cfg, secrets } = buildCatalogInstall(entry, values);
        // Encrypt first: if the write then fails on a name collision we drop
        // them again, rather than leaving secrets for a server we never wrote.
        for (const s of secrets) setMcpSecret(entry.key, s.inputId, s.value);
        try {
          writeMcpServer(file, entry.key, cfg, { failIfExists: true });
        } catch (err) {
          removeMcpSecrets(entry.key);
          throw err;
        }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }

      void log.append({
        type: "mcp.config",
        workspaceId: workspaceId ?? undefined,
        data: { scope, name: entry.key, removed: false, source: "catalog" },
      });
      scheduleMcpReload(scope, workspaceId); // apply to running sessions
      return { ok: true as const };
    },
  );

  // §13 round 8: the whole post-install chain in ONE call — connect, and only
  // if the server actually rejects us, run interactive OAuth, then report the
  // tools. Adding a server should land you at "N tools discovered" without a
  // second manual step.
  //
  // probe-first (rather than auth-first) is what makes this work for every
  // entry shape: stdio servers have no url to authenticate against, and
  // key-based servers authenticate via a header, so both simply connect. Only a
  // genuine 401 escalates to the browser flow.
  ipcMain.handle(
    "hv:mcp-connect-flow",
    async (_e, scope: "global" | "workspace", workspaceId: string | null, name: string) => {
      const file = scope === "global" ? globalMcpFile() : workspaceMcpFile(workspaceId ?? "");
      const cfg = readMcpFile(file).mcpServers[name];
      if (!cfg) return { ok: false as const, error: "server not found" };

      const setStatus = (state: McpServerStatus["state"], tools?: { name: string; description?: string }[], error?: string): void => {
        mcpStatusMap.set(statusKey(scope, workspaceId, name), {
          name, scope, workspaceId, state,
          toolCount: tools?.length ?? 0, tools, error, lastChecked: Date.now(),
        });
        mcpStatusChanged();
      };

      setStatus("checking");
      let result = await probe(name, resolveMcpConfig(cfg, providerEnv()), agentDir(), {
        store: adapterStore,
      });

      if (result.state === "needs-auth" && cfg.url) {
        const auth = await authenticate(name, cfg, agentDir(), {
          openExternal: (url) => shell.openExternal(url),
          store: adapterStore,
        });
        void log.append({ type: "mcp.auth", workspaceId: workspaceId ?? undefined,
          data: { name, action: auth.ok ? "authenticated" : "auth-failed", via: "connect-flow" } });
        result = auth.ok
          ? { state: "connected", tools: auth.tools }
          : { state: "needs-auth", error: auth.error };
      }

      setStatus(result.state, result.tools, result.error);
      return result.state === "connected"
        ? { ok: true as const, tools: result.tools ?? [] }
        : { ok: false as const, error: result.error ?? "Could not connect" };
    },
  );

  ipcMain.handle("hv:mcp-status", () => Array.from(mcpStatusMap.values()));

  // §13 round 8: the catalog's stdio entries run through `npx`, which needs the
  // user's own Node — the packaged app does not ship one. Surfaced so those
  // cards can say "needs Node" BEFORE the click.
  ipcMain.handle("hv:node-available", () => hasNodeRuntime());

  ipcMain.handle(
    "hv:mcp-check",
    async (_e, scope: "global" | "workspace", workspaceId: string | null, name?: string) => {
      if (name) {
        await checkServer(scope, workspaceId, name);
        return;
      }
      // Check all servers in scope
      const file =
        scope === "global"
          ? path.join(agentDir(), "mcp.json")
          : workspaceMcpFile(workspaceId ?? "");
      const servers = Object.keys(readMcpFile(file).mcpServers);
      await Promise.all(servers.map((n) => checkServer(scope, workspaceId, n)));
    },
  );

  // ── MCP OAuth: authenticate (add-time) + logout (per-server) ─────────────
  // authenticate awaits the full browser OAuth flow (up to 5 min) — that's
  // fine, it's a per-invoke promise; no global lock that would block other IPC.
  ipcMain.handle(
    "hv:mcp-authenticate",
    async (_e, scope: "global" | "workspace", workspaceId: string | null, name: string) => {
      // Guarded cfg resolution — same boundary as checkServer.
      const file =
        scope === "global"
          ? path.join(agentDir(), "mcp.json")
          : workspaceMcpFile(workspaceId ?? "");
      const cfg = readMcpFile(file).mcpServers[name];
      if (!cfg) return { ok: false, error: "server not found" };

      const result = await authenticate(name, cfg, agentDir(), {
        openExternal: (url) => shell.openExternal(url),
        store: adapterStore,
      });

      mcpStatusMap.set(statusKey(scope, workspaceId, name), {
        name, scope, workspaceId,
        state: result.ok ? "connected" : "needs-auth",
        toolCount: result.ok ? result.tools.length : 0,
        tools: result.ok ? result.tools : undefined,
        error: result.ok ? undefined : result.error,
        lastChecked: Date.now(),
      });
      mcpStatusChanged();
      if (result.ok) scheduleMcpReload(scope, workspaceId); // server now usable → apply to sessions
      return result;
    },
  );

  ipcMain.handle("hv:mcp-logout", async (_e, name: string) => {
    // Awaited: this is the call that actually revokes the agent's access. The
    // old synchronous version deleted a file the adapter had stopped reading,
    // which is why Log out used to leave the session signed in.
    await logout(name, agentDir(), adapterStore);
    // Best-effort: drop any live runtime connection via the utility client.
    try {
      const c = await ensureUtility();
      void c.send({ type: "prompt", message: `/mcp logout ${name}` }).catch(() => {});
    } catch {
      /* utility unavailable — non-fatal */
    }
    // Update every status-map entry for this server name → needs-auth.
    for (const [key, entry] of mcpStatusMap) {
      if (entry.name === name) {
        mcpStatusMap.set(key, {
          ...entry,
          state: "needs-auth",
          toolCount: 0,
          tools: undefined,
          error: undefined,
          lastChecked: Date.now(),
        });
      }
    }
    mcpStatusChanged();
    // A logged-out server must stop working everywhere; tokens are keyed by name
    // (not scope), so reload all live sessions.
    scheduleMcpReload("global", null);
  });

  // ── §14 Skills ─────────────────────────────────────────────────────────────
  // Trust gate lives in main: discovery + content-hash approval + per-workspace
  // activation, enforced at spawn (--no-skills + --skill). Changes apply live via
  // scheduleSkillReload (the MCP live-reload machinery). Every skill dir the
  // renderer names must sit in a known location — never approve an arbitrary path.
  const knownSkillDirs = (): string[] => {
    const { managedDir, bundledDir, linkedDirs } = globalScanDirs();
    return [managedDir, bundledDir, ...linkedDirs, ...workspaces.list().map((w) => path.join(w, ".agents", "skills"))];
  };
  const isKnownSkillDir = (id: string): boolean => {
    const abs = path.resolve(id);
    return knownSkillDirs().some((root) => {
      const r = path.resolve(root);
      return abs === r || abs.startsWith(r + path.sep);
    });
  };
  /** Read one skill dir as a DiscoveredSkill (source inferred from location). */
  const readKnownSkill = (id: string): DiscoveredSkill => {
    if (!isKnownSkillDir(id)) throw new Error("Unknown skill location");
    const { managedDir, bundledDir, linkedDirs } = globalScanDirs();
    const abs = path.resolve(id);
    const under = (root: string) => abs === path.resolve(root) || abs.startsWith(path.resolve(root) + path.sep);
    const source = under(bundledDir) ? "bundled" : under(managedDir) ? "managed" : linkedDirs.some(under) ? "linked" : "workspace";
    return readSkillDir(id, source);
  };

  ipcMain.handle("hv:skills-list", (_e, workspaceId?: string) => {
    const global = discoverGlobalSkills().map((s) => toSkillView(s, skillRegistry));
    if (!workspaceId) return { global, workspace: null };
    const activation = workspaces.getSkillsActive(workspaceId);
    const wsSkills = discoverWorkspace(workspaceId).map((s) => toSkillView(s, skillRegistry, activation));
    // Activation checklist over every APPROVED skill (global + this workspace),
    // showing its active state for this workspace (bundled default off, else on).
    const checklist = [...discoverGlobalSkills(), ...discoverWorkspace(workspaceId)]
      .filter((s) => s.loadable && skillRegistry.approvalStatus(s) === "approved" && skillRegistry.record(s.id)?.enabled)
      .map((s) => {
        const v = toSkillView(s, skillRegistry, activation);
        return { id: s.id, name: s.name, source: s.source, scope: s.source === "workspace" ? "workspace" : "global", active: v.status === "active" };
      });
    return { global, workspace: { skills: wsSkills, checklist } };
  });

  ipcMain.handle("hv:skills-read", (_e, id: string) => {
    const skill = readKnownSkill(id);
    let current = "";
    try { current = fs.readFileSync(skill.skillMdPath, "utf8"); } catch { /* unreadable */ }
    const rec = skillRegistry.record(id);
    // Unlinking drops the whole configured root, not just this subfolder — tell
    // the inspector which root and how many other skills go with it, so the
    // confirm can be honest about the blast radius.
    const linkedRoot = skill.source === "linked" ? findLinkedRoot(skill.id, getLinkedSkillDirs()) : undefined;
    const linkedSiblings = linkedRoot
      ? scanSkillsDir(linkedRoot, "linked").filter((s) => path.resolve(s.id) !== path.resolve(skill.id)).length
      : 0;
    return {
      name: skill.name,
      description: skill.description,
      source: skill.source,
      linkedRoot,
      linkedSiblings,
      files: skill.files,
      scriptCount: skill.scriptCount,
      estTokens: skill.estTokens,
      status: toSkillView(skill, skillRegistry).status,
      provenance: rec?.provenance ?? null,
      current,
      // Re-review diff: the approved snapshot ("before") vs current ("after").
      approved: rec?.snapshot ? rec.snapshot.skillMd : null,
    };
  });

  ipcMain.handle("hv:skills-approve", (_e, id: string) => {
    const skill = readKnownSkill(id);
    skillRegistry.approve(skill, new Date().toISOString());
    void log.append({ type: "skill.approved", data: { id, name: skill.name, source: skill.source } });
    skillsChanged();
    scheduleSkillReload("global", null); // approved skill can now load everywhere it's active
  });

  // "Disable" in the inspector — global off without losing trust (approve re-enables).
  ipcMain.handle("hv:skills-set-enabled", (_e, id: string, enabled: boolean) => {
    if (!isKnownSkillDir(id)) throw new Error("Unknown skill location");
    skillRegistry.setEnabled(id, !!enabled, new Date().toISOString());
    void log.append({ type: enabled ? "skill.enabled" : "skill.disabled", data: { id } });
    skillsChanged();
    scheduleSkillReload("global", null);
  });

  // Per-workspace activation checklist toggle (on|false|null=default).
  ipcMain.handle("hv:skills-set-active", (_e, workspaceId: string, id: string, on: boolean | null) => {
    if (!workspaces.list().some((w) => path.resolve(w) === path.resolve(workspaceId))) throw new Error("Unknown workspace");
    workspaces.setSkillActive(workspaceId, id, on);
    void log.append({ type: "skill.activation", workspaceId, data: { id, active: on } });
    skillsChanged();
    scheduleSkillReload("workspace", workspaceId);
  });

  ipcMain.handle("hv:skills-get-linked", () => getLinkedSkillDirs());
  ipcMain.handle("hv:skills-set-linked", (_e, dirs: string[]) => {
    setLinkedSkillDirs(Array.isArray(dirs) ? dirs : []);
    skillsChanged();
    scheduleSkillReload("global", null);
  });
  ipcMain.handle("hv:skills-add-linked", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"], title: "Link a skills directory" });
    if (r.canceled || !r.filePaths[0]) return getLinkedSkillDirs();
    setLinkedSkillDirs([...getLinkedSkillDirs(), r.filePaths[0]]);
    skillsChanged();
    scheduleSkillReload("global", null);
    return getLinkedSkillDirs();
  });

  // ── §14 Import (Phase 2): local folder + git-URL tarball, both two-phase
  //    (scan → pick → copy). A scan registers a session token; select copies the
  //    chosen skill dirs into the managed dir (global) or <ws>/.agents/skills,
  //    approved at import (the user already saw them). ──────────────────────────
  interface ImportSession {
    skills: Array<{ id: string; name: string; description: string; scriptCount: number }>;
    dirById: Map<string, string>;
    provenance: SkillProvenance;
    cleanup?: () => void;
  }
  const importSessions = new Map<string, ImportSession>();
  let importSeq = 0;
  const registerImport = (skills: DiscoveredSkill[], provenance: SkillProvenance, cleanup?: () => void): { token: string; skills: ImportSession["skills"] } => {
    const token = `imp-${++importSeq}-${Date.now()}`;
    const dirById = new Map(skills.map((s) => [s.id, s.id] as const));
    const view = skills.filter((s) => s.loadable).map((s) => ({ id: s.id, name: s.name, description: s.description, scriptCount: s.scriptCount }));
    importSessions.set(token, { skills: view, dirById, provenance, cleanup });
    return { token, skills: view };
  };
  app.on("will-quit", () => { for (const s of importSessions.values()) s.cleanup?.(); });

  ipcMain.handle("hv:skills-import-local", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"], title: "Import a skill folder (or a folder of skills)" });
    if (r.canceled || !r.filePaths[0]) return null;
    const picked = r.filePaths[0];
    const found = scanSkillsDir(picked, "managed");
    if (found.length === 0) return { token: null, skills: [], error: "No SKILL.md found in that folder." };
    return registerImport(found, { source: "local", importedAt: new Date().toISOString() });
  });

  ipcMain.handle("hv:skills-import-git", async (_e, url: string) => {
    const archive = parseForgeUrl(String(url));
    if (!archive) return { token: null, skills: [], error: "Unsupported URL. Use a GitHub/GitLab/Bitbucket/Codeberg repo URL." };
    const workDir = path.join(userData, "skills-import", `dl-${++importSeq}-${Date.now()}`);
    try {
      const { root, archiveHash } = await downloadAndExtract(archive, workDir);
      const found = scanSkillsDir(root, "managed");
      if (found.length === 0) { fs.rmSync(workDir, { recursive: true, force: true }); return { token: null, skills: [], error: "No skills (SKILL.md) found in that repository." }; }
      return registerImport(
        found,
        { source: "git", sourceUrl: archive.archiveUrl, ref: archive.ref, commitSha: archiveHash, importedAt: new Date().toISOString() },
        () => fs.rmSync(workDir, { recursive: true, force: true }),
      );
    } catch (e) {
      fs.rmSync(workDir, { recursive: true, force: true });
      return { token: null, skills: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Copy chosen skill dirs into the destination parent, confined; approve each.
  ipcMain.handle(
    "hv:skills-import-select",
    (_e, token: string, ids: string[], scope: "global" | "workspace", workspaceId: string | null) => {
      const session = importSessions.get(token);
      if (!session) throw new Error("Import session expired — scan again.");
      const destParent =
        scope === "workspace"
          ? resolveInWorkspace(workspaces.list(), workspaceId ?? "", path.join(".agents", "skills"))
          : managedSkillsDir(agentDir());
      fs.mkdirSync(destParent, { recursive: true });
      const now = new Date().toISOString();
      const importedNames: string[] = [];
      for (const id of ids) {
        const srcDir = session.dirById.get(id);
        if (!srcDir) continue;
        const dest = path.join(destParent, path.basename(srcDir));
        if (path.resolve(dest) !== destParent && !path.resolve(dest).startsWith(path.resolve(destParent) + path.sep)) continue; // confinement
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(srcDir, dest, { recursive: true });
        const skill = readSkillDir(dest, scope === "workspace" ? "workspace" : "managed");
        skillRegistry.approve(skill, now, { enabled: true, provenance: session.provenance });
        importedNames.push(skill.name);
        void log.append({ type: "skill.imported", workspaceId: scope === "workspace" ? workspaceId ?? undefined : undefined, data: { name: skill.name, source: session.provenance.source, scope } });
      }
      session.cleanup?.();
      importSessions.delete(token);
      skillsChanged();
      scheduleSkillReload(scope, scope === "workspace" ? workspaceId : null);
      return importedNames;
    },
  );

  // ── §14 Creation (Phase 3) ──────────────────────────────────────────────
  const SKILL_CREATOR = "skill-creator";
  const findGlobalSkillByName = (name: string): DiscoveredSkill | undefined =>
    discoverGlobalSkills().find((s) => s.name === name);
  /** The skills Pi ACTUALLY loaded for this session (main resolved them at spawn). */
  const sessionSkills = (sessionId: string): Array<{ name: string; scope: "global" | "workspace" }> => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(skillsManifestDir, `${sessionId}.json`), "utf8")) as {
        skills?: Array<{ name: string; scope: "global" | "workspace" }>;
      };
      return (m.skills ?? []).map((s) => ({ name: s.name, scope: s.scope }));
    } catch {
      return []; // no manifest yet (session not spawned) — nothing loaded
    }
  };
  const sessionHasSkill = (sessionId: string, name: string): boolean =>
    sessionSkills(sessionId).some((s) => s.name === name);

  // §14 round 6: the chat top bar shows which skills this session loaded.
  ipcMain.handle("hv:skills-session", (_e, sessionId: string) => {
    if (!index.get(sessionId)) return []; // unknown id — never interpolate it into a path
    return sessionSkills(sessionId);
  });

  // §14 round 6: `/skill:<name>` autocomplete. Pi registers a slash command per
  // loaded skill (enableSkillCommands) and get_commands is a PURE query — no
  // model turn, no cost. The renderer filters to source:"skill" for V1.
  ipcMain.handle("hv:list-commands", async (_e, sessionId: string) => {
    // Deliberately NOT anyClient(): its utility fallback is spawned with
    // skills:[], so it can never list skill commands — and the renderer would
    // cache that empty list for the session's whole life. No live client ⇒ throw,
    // so the renderer retries later instead of caching a lie.
    const client = manager.get(sessionId) as PiClient | null;
    if (!client) throw new Error("Session is not live");
    try {
      const res = await client.send({ type: "get_commands" });
      const cmds = (res.data as { commands?: Array<{ name?: string; source?: string }> })?.commands ?? [];
      // §24: Pi's get_commands carries name/source/description only — never an
      // argumentHint (rpc-types.d.ts:135-144) — so join its list against our own
      // scan BY NAME (a prompt template's command name IS its filename stem).
      const meta = index.get(sessionId);
      const scanned = new Map(
        [...globalPromptTemplates(), ...(meta ? discoverWorkspacePromptTemplates(meta.workspaceId) : [])].map((c) => [c.name, c] as const),
      );
      return cmds
        .filter((c): c is { name: string; source?: string } => typeof c.name === "string")
        .map((c) => {
          const own = scanned.get(c.name);
          return { name: c.name, source: c.source ?? "", description: own?.description, argumentHint: own?.argumentHint };
        });
    } catch {
      return []; // no live client (hibernated/closed) — the composer just shows nothing
    }
  });

  // "New skill" button: ensure the bundled skill-creator is enabled + active for
  // this session's workspace (respawn-resume if it wasn't loaded), so a following
  // `/skill:skill-creator` prompt from the renderer expands. Returns readiness.
  ipcMain.handle("hv:skills-new-skill", async (_e, sessionId: string): Promise<{ ok: boolean; error?: string }> => {
    const meta = index.get(sessionId);
    if (!meta) return { ok: false, error: "No active session." };
    const creator = findGlobalSkillByName(SKILL_CREATOR);
    if (!creator) return { ok: false, error: "The skill-creator skill isn't installed." };
    skillRegistry.approve(creator, new Date().toISOString(), { enabled: true, provenance: skillRegistry.record(creator.id)?.provenance });
    workspaces.setSkillActive(meta.workspaceId, creator.id, true);
    skillsChanged();
    if (!sessionHasSkill(sessionId, SKILL_CREATOR)) {
      reloadReasons.set(sessionId, "skills");
      await reloadSession(sessionId); // respawn-resume so /skill:skill-creator is loaded
    }
    return { ok: true };
  });

  // Remove a skill (§14 round 6): managed/workspace → real delete, bundled →
  // refused (installBundledSkills reinstalls it), linked → unlink the dir
  // reference only (files belong to another tool). Confined delete via
  // removeSkillDir; only known skill roots ever get touched.
  ipcMain.handle("hv:skills-delete", (_e, skillId: string, workspaceId: string | null) => {
    if (!isKnownSkillDir(skillId)) return { ok: false as const, error: "That skill no longer exists." };
    const skill = readKnownSkill(skillId);
    const plan = planSkillRemoval({ id: skill.id, source: skill.source, dir: skill.id });
    if (plan.kind === "refused") return { ok: false as const, error: plan.reason ?? "This skill cannot be deleted." };
    try {
      if (plan.kind === "unlink") {
        // A linked root (e.g. ~/.claude/skills) can contain several skill
        // subfolders; skill.id is the subfolder, not the root, so find the
        // configured root this skill lives under and drop that reference.
        const linkedDirs = getLinkedSkillDirs();
        const root = findLinkedRoot(plan.dir, linkedDirs);
        if (!root) return { ok: false as const, error: "That linked directory is no longer configured." };
        setLinkedSkillDirs(linkedDirs.filter((d) => d !== root));
      } else {
        const allowedRoots = [
          managedSkillsDir(agentDir()),
          ...workspaces.list().map((w) => path.join(w, ".agents", "skills")),
        ];
        removeSkillDir(plan.dir, allowedRoots);
      }
      skillRegistry.forget(skillId, new Date().toISOString());
      void log.append({ type: "skill.deleted", data: { id: skillId, name: skill.name, source: skill.source, kind: plan.kind } });
      skillsChanged();
      // Derive the workspace from the skill's own path — trusting the caller's
      // workspaceId meant a null/mismatched id produced affectedSessionIds([]) :
      // no respawn, no error, and the deleted skill stayed loaded in live sessions.
      const ownerWs =
        skill.source === "workspace"
          ? (workspaces.list().find((w) => {
              const root = path.resolve(path.join(w, ".agents", "skills"));
              const abs = path.resolve(skill.id);
              return abs === root || abs.startsWith(root + path.sep);
            }) ?? workspaceId)
          : null;
      scheduleSkillReload(skill.source === "workspace" ? "workspace" : "global", ownerWs);
      return { ok: true as const, kind: plan.kind };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Promote a workspace skill to global: copy it into the managed dir, approved
  // (same content → carries over). Confined; only from a workspace .agents/skills.
  ipcMain.handle("hv:skills-promote", (_e, id: string) => {
    const abs = path.resolve(id);
    const fromWorkspace = workspaces.list().some((w) => abs.startsWith(path.resolve(path.join(w, ".agents", "skills")) + path.sep));
    if (!fromWorkspace) throw new Error("Only workspace skills can be promoted.");
    const skill = readSkillDir(id, "workspace");
    const destParent = managedSkillsDir(agentDir());
    fs.mkdirSync(destParent, { recursive: true });
    const dest = path.join(destParent, path.basename(id));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(id, dest, { recursive: true });
    const promoted = readSkillDir(dest, "managed");
    skillRegistry.approve(promoted, new Date().toISOString(), { enabled: true, provenance: { source: "promoted", importedAt: new Date().toISOString() } });
    void log.append({ type: "skill.promoted", data: { name: skill.name, from: id, to: dest } });
    skillsChanged();
    scheduleSkillReload("global", null);
    return dest;
  });

  // Auto-approve a NEW workspace skill the agent authored while skill-creator is
  // active in a live session for that workspace (the user drove the creation, so
  // no separate review). Content changes to an already-approved skill still flip
  // to needs-review (unchanged). Called from the workspace watcher.
  const autoApproveCreatedSkills = (workspaceId: string): void => {
    const liveInWs = manager.activeIds().some((id) => index.get(id)?.workspaceId === workspaceId && sessionHasSkill(id, SKILL_CREATOR));
    if (!liveInWs) return;
    let approvedAny = false;
    for (const skill of discoverWorkspace(workspaceId)) {
      if (!skill.loadable || skillRegistry.record(skill.id)) continue; // only brand-new skills
      skillRegistry.approve(skill, new Date().toISOString(), { enabled: true, provenance: { source: "created", importedAt: new Date().toISOString() } });
      void log.append({ type: "skill.created", workspaceId, data: { name: skill.name } });
      approvedAny = true;
    }
    if (approvedAny) { skillsChanged(); scheduleSkillReload("workspace", workspaceId); }
  };

  // Live on-disk change detection for the managed global dir (workspace skill
  // dirs ride the existing workspace watcher below). A change may flip an
  // approved skill back to needs-review (hash mismatch) — recompute + notify.
  const managedDir = managedSkillsDir(agentDir());
  fs.mkdirSync(managedDir, { recursive: true });
  try {
    let skillWatchTimer: ReturnType<typeof setTimeout> | undefined;
    const w = fs.watch(managedDir, { recursive: true }, () => {
      clearTimeout(skillWatchTimer);
      skillWatchTimer = setTimeout(() => skillsChanged(), 200);
    });
    app.on("will-quit", () => { try { w.close(); } catch { /* already closed */ } });
  } catch {
    /* recursive watch unsupported (Linux) — renderer re-fetches on navigation */
  }

  // ── §24 Commands (prompt templates) — IPC ──────────────────────────────────
  // The §14 surface, channel for channel. Two differences worth knowing before
  // reading on: a command is a FILE (so the id is a file path and every scan is
  // flat — the parent dir IS the scan root), and there is no manifest, because
  // Pi expands templates itself and the bridge never sees them.
  const knownPromptTemplateRoots = (): string[] => {
    const { managedDir, bundledDir, linkedDirs } = globalPromptTemplateDirs();
    return [
      managedDir, bundledDir, ...linkedDirs,
      ...workspaces.list().map((w) => workspacePromptTemplatesDir(w)),
    ];
  };
  /** The known scan root this file sits directly in, or null — never trust a renderer path. */
  const promptTemplateRoot = (id: string): string | null => {
    if (!id.endsWith(".md")) return null;
    const parent = path.resolve(path.dirname(id));
    return knownPromptTemplateRoots().find((r) => path.resolve(r) === parent) ?? null;
  };
  /** Read one command file, source inferred from which root it lives in. */
  const readKnownPromptTemplate = (id: string): DiscoveredPromptTemplate => {
    const root = promptTemplateRoot(id);
    if (!root) throw new Error("Unknown prompt location");
    const { managedDir, bundledDir, linkedDirs } = globalPromptTemplateDirs();
    const same = (a: string, b: string): boolean => path.resolve(a) === path.resolve(b);
    const source: PromptTemplateSource = same(root, bundledDir)
      ? "bundled"
      : same(root, managedDir)
        ? "managed"
        : linkedDirs.some((d) => same(root, d))
          ? "linked"
          : "workspace";
    return readPromptTemplateFile(id, source);
  };

  ipcMain.handle("hv:prompt-templates-list", (_e, workspaceId?: string) => {
    const global = globalPromptTemplates().map((c) => toPromptTemplateView(c, promptTemplateRegistry));
    if (!workspaceId) return { global, workspace: null };
    const activation = workspaces.getPromptTemplatesActive(workspaceId);
    const ws = discoverWorkspacePromptTemplates(workspaceId);
    // Activation checklist = every APPROVED + enabled command (global + this
    // workspace), its status computed against this workspace's overrides.
    const checklist = [...globalPromptTemplates(), ...ws]
      .filter((c) => promptTemplateRegistry.approvalStatus(c) === "approved" && promptTemplateRegistry.record(c.id)?.enabled)
      .map((c) => toPromptTemplateView(c, promptTemplateRegistry, activation));
    return { global, workspace: { templates: ws.map((c) => toPromptTemplateView(c, promptTemplateRegistry, activation)), checklist } };
  });

  ipcMain.handle("hv:prompt-templates-read", (_e, id: string) => {
    const cmd = readKnownPromptTemplate(id);
    const rec = promptTemplateRegistry.record(id);
    // Unlinking drops the whole configured root, not just this file — say how
    // many other commands come with it so the confirm can be honest.
    const linkedRoot = cmd.source === "linked" ? promptTemplateRoot(id) ?? undefined : undefined;
    const linkedSiblings = linkedRoot ? Math.max(0, scanPromptTemplatesDir(linkedRoot, "linked").length - 1) : 0;
    return {
      name: cmd.name,
      description: cmd.description,
      argumentHint: cmd.argumentHint,
      source: cmd.source,
      linkedRoot,
      linkedSiblings,
      hasBashInjection: cmd.hasBashInjection,
      estTokens: cmd.estTokens,
      status: toPromptTemplateView(cmd, promptTemplateRegistry).status,
      provenance: rec?.provenance ?? null,
      // Both sides of the re-review diff are the TEMPLATE BODY (frontmatter
      // stripped) — that is what the registry snapshots and what Pi expands.
      current: cmd.body,
      approved: rec?.snapshot ? rec.snapshot.body : null,
    };
  });

  ipcMain.handle("hv:prompt-templates-approve", (_e, id: string) => {
    const cmd = readKnownPromptTemplate(id);
    promptTemplateRegistry.approve(cmd, new Date().toISOString());
    void log.append({ type: "prompt-template.approved", data: { id, name: cmd.name, source: cmd.source } });
    promptTemplatesChanged();
    schedulePromptTemplateReload("global", null);
  });

  ipcMain.handle("hv:prompt-templates-set-enabled", (_e, id: string, enabled: boolean) => {
    if (!promptTemplateRoot(id)) throw new Error("Unknown prompt location");
    promptTemplateRegistry.setEnabled(id, !!enabled, new Date().toISOString());
    void log.append({ type: enabled ? "prompt-template.enabled" : "prompt-template.disabled", data: { id } });
    promptTemplatesChanged();
    schedulePromptTemplateReload("global", null);
  });

  ipcMain.handle("hv:prompt-templates-set-active", (_e, workspaceId: string, id: string, on: boolean | null) => {
    if (!workspaces.list().some((w) => path.resolve(w) === path.resolve(workspaceId))) throw new Error("Unknown workspace");
    workspaces.setPromptTemplateActive(workspaceId, id, on);
    void log.append({ type: "prompt-template.activation", workspaceId, data: { id, active: on } });
    promptTemplatesChanged();
    schedulePromptTemplateReload("workspace", workspaceId);
  });

  ipcMain.handle("hv:prompt-templates-get-linked", () => getLinkedPromptTemplateDirs());
  ipcMain.handle("hv:prompt-templates-set-linked", (_e, dirs: string[]) => {
    setLinkedPromptTemplateDirs(Array.isArray(dirs) ? dirs : []);
    promptTemplatesChanged();
    schedulePromptTemplateReload("global", null);
  });
  ipcMain.handle("hv:prompt-templates-add-linked", async (_e, dir?: string) => {
    // An explicit dir comes from a caller that already knows the path; no arg
    // opens the picker. Linked dirs are referenced in place, never copied.
    let picked = typeof dir === "string" && dir.trim() ? dir : null;
    if (!picked) {
      const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"], title: "Link a prompts directory" });
      if (r.canceled || !r.filePaths[0]) return getLinkedPromptTemplateDirs();
      picked = r.filePaths[0];
    }
    setLinkedPromptTemplateDirs([...getLinkedPromptTemplateDirs(), picked]);
    promptTemplatesChanged();
    schedulePromptTemplateReload("global", null);
    return getLinkedPromptTemplateDirs();
  });

  // ── §24 Import: local folder + git-URL tarball, both two-phase (scan → pick →
  //    copy), reusing §14's gitImport as-is (it is source-agnostic). ───────────
  interface PromptTemplateImportSession {
    templates: Array<{ id: string; name: string; description: string; argumentHint?: string; hasBashInjection: boolean }>;
    provenance: PromptTemplateProvenance;
    cleanup?: () => void;
  }
  const promptTemplateImports = new Map<string, PromptTemplateImportSession>();
  let promptTemplateImportSeq = 0;
  /**
   * Where commands live in an arbitrary folder or repo: the root itself, each
   * immediate subdirectory (`commands/`, `prompts/`), and `.claude/commands`
   * (dotdirs are skipped by the scanner, and that path is the whole point).
   * Deliberately shallow — Pi's own template loading is not recursive either.
   */
  const scanImportRoot = (root: string): DiscoveredPromptTemplate[] => {
    let subs: string[] = [];
    try {
      subs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => path.join(root, d.name));
    } catch {
      /* unreadable root — the flat scan below returns [] too */
    }
    return [root, ...subs, path.join(root, ".claude", "commands")].flatMap((d) => scanPromptTemplatesDir(d, "managed"));
  };
  const registerPromptTemplateImport = (
    found: DiscoveredPromptTemplate[],
    provenance: PromptTemplateProvenance,
    cleanup?: () => void,
  ): { token: string; templates: PromptTemplateImportSession["templates"] } => {
    const token = `pt-${++promptTemplateImportSeq}-${Date.now()}`;
    const templates = found.map((c) => ({ id: c.id, name: c.name, description: c.description, argumentHint: c.argumentHint, hasBashInjection: c.hasBashInjection }));
    promptTemplateImports.set(token, { templates, provenance, cleanup });
    return { token, templates };
  };
  app.on("will-quit", () => { for (const s of promptTemplateImports.values()) s.cleanup?.(); });

  ipcMain.handle("hv:prompt-templates-import-local", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"], title: "Import prompts from a folder" });
    if (r.canceled || !r.filePaths[0]) return null;
    const found = scanImportRoot(r.filePaths[0]);
    if (found.length === 0) return { token: null, templates: [], error: "No .md prompts found in that folder." };
    return registerPromptTemplateImport(found, { source: "local", importedAt: new Date().toISOString() });
  });

  ipcMain.handle("hv:prompt-templates-import-git", async (_e, url: string) => {
    const archive = parseForgeUrl(String(url));
    if (!archive) return { token: null, templates: [], error: "Unsupported URL. Use a GitHub/GitLab/Bitbucket/Codeberg repo URL." };
    const workDir = path.join(userData, "prompt-templates-import", `dl-${++promptTemplateImportSeq}-${Date.now()}`);
    try {
      const { root, archiveHash } = await downloadAndExtract(archive, workDir);
      const found = scanImportRoot(root);
      if (found.length === 0) { fs.rmSync(workDir, { recursive: true, force: true }); return { token: null, templates: [], error: "No .md prompts found in that repository." }; }
      return registerPromptTemplateImport(
        found,
        { source: "git", sourceUrl: archive.archiveUrl, ref: archive.ref, commitSha: archiveHash, importedAt: new Date().toISOString() },
        () => fs.rmSync(workDir, { recursive: true, force: true }),
      );
    } catch (e) {
      fs.rmSync(workDir, { recursive: true, force: true });
      return { token: null, templates: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Copy the chosen files into the destination dir, confined; approve each.
  ipcMain.handle(
    "hv:prompt-templates-import-select",
    (_e, token: string, ids: string[], scope: "global" | "workspace", workspaceId: string | null) => {
      const session = promptTemplateImports.get(token);
      if (!session) throw new Error("Import session expired — scan again.");
      const chosen = session.templates.filter((c) => ids.includes(c.id));
      // PRD §24: Pi matches an extension command BEFORE expanding a template, so
      // importing a name the bridge owns writes a file that can never run.
      // Refuse the batch and name the clash — the session stays open so the user
      // can deselect it and import the rest.
      const reserved = refuseReservedNames(chosen);
      if (reserved) {
        return { imported: [], reserved, error: `"/${reserved}" is a built-in HappyVibe command — a prompt with that name could never run. Rename it and import again.` };
      }
      const destParent =
        scope === "workspace"
          ? resolveInWorkspace(workspaces.list(), workspaceId ?? "", path.join(".agents", "prompts"))
          : managedPromptTemplatesDir(agentDir());
      fs.mkdirSync(destParent, { recursive: true });
      const now = new Date().toISOString();
      const imported: string[] = [];
      for (const c of chosen) {
        const dest = path.join(destParent, path.basename(c.id));
        if (!path.resolve(dest).startsWith(path.resolve(destParent) + path.sep)) continue; // confinement
        fs.copyFileSync(c.id, dest);
        const cmd = readPromptTemplateFile(dest, scope === "workspace" ? "workspace" : "managed");
        promptTemplateRegistry.approve(cmd, now, { enabled: true, provenance: session.provenance });
        imported.push(cmd.name);
        void log.append({ type: "prompt-template.imported", workspaceId: scope === "workspace" ? workspaceId ?? undefined : undefined, data: { name: cmd.name, source: session.provenance.source, scope } });
      }
      session.cleanup?.();
      promptTemplateImports.delete(token);
      promptTemplatesChanged();
      schedulePromptTemplateReload(scope, scope === "workspace" ? workspaceId : null);
      return { imported };
    },
  );

  // ── §25 Plugin marketplaces ───────────────────────────────────────────────
  // Browse a Claude Code marketplace, filter it to the components whose
  // execution funnels through tool_call, and install/remove a plugin as a unit.
  // Nothing here invents a trust mechanism: skills land in skillRegistry,
  // commands in promptTemplateRegistry, servers in mcp.json.
  interface PluginInstallSession {
    marketplaceId: string;
    entry: MarketplaceEntry;
    scan: PluginScan;
    cleanup?: () => void;
  }
  const pluginSessions = new Map<string, PluginInstallSession>();
  let pluginSeq = 0;
  /**
   * The marketplace's own repo, extracted ONCE per run — every bare "./path"
   * entry lives inside it, so without this, opening N first-party plugins
   * downloaded the same ~3 MB N times.
   *
   * Because it is SHARED, a scan session that uses it must not clean it up (see
   * hv:plugins-scan) or dismissing one dialog would delete the tree every other
   * first-party card depends on. It is removed on quit instead.
   */
  const localCheckouts = new Map<string, { dir: string; workDir: string }>();
  const localCheckout = async (url: string): Promise<{ dir: string; workDir: string }> => {
    const hit = localCheckouts.get(url);
    if (hit) return hit;
    const repo = marketplaceRepoArchive(url);
    if (!repo) throw new Error("Could not work out which repo hosts that marketplace.");
    const workDir = path.join(userData, "plugin-import", `mp-${++pluginSeq}-${Date.now()}`);
    const { root } = await downloadAndExtract(
      { archiveUrl: repo.archiveUrl, host: "", owner: "", repo: "", ref: repo.ref },
      workDir,
    );
    const tops = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    const entry = { dir: tops.length === 1 ? path.join(root, tops[0].name) : root, workDir };
    localCheckouts.set(url, entry);
    return entry;
  };
  app.on("will-quit", () => {
    for (const { workDir } of localCheckouts.values()) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  ipcMain.handle("hv:plugins-marketplaces", () => listMarketplaces());

  ipcMain.handle("hv:plugins-add-marketplace", async (_e, url: string) => {
    const clean = String(url ?? "").trim();
    if (!/^https:\/\//.test(clean)) return { ok: false as const, error: "Use an https URL to a marketplace.json." };
    try {
      // Validates that the URL really is a marketplace before recording it.
      // Its plugins are NOT listed yet: phase 2 indexes a user-added marketplace
      // (see the Notion "Let user add markeplace" page) rather than listing
      // unverified entries the user could click and be refused.
      const parsed = await fetchMarketplace(clean);
      const id = parsed.name || clean;
      addMarketplace({ id, url: clean });
      void log.append({ type: "plugin.marketplace-added", data: { id, url: clean, entries: parsed.entries.length } });
      return { ok: true as const, id, entries: parsed.entries.length };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("hv:plugins-remove-marketplace", (_e, id: string) => removeMarketplace(String(id)));

  /**
   * The browse list. Classified from the ENTRY alone — no per-plugin download,
   * which is what makes 278 rows viable. A rejected row is still returned, with
   * its reason: hiding it makes the store look broken to someone who came
   * looking for a plugin they read about.
   */
  ipcMain.handle("hv:plugins-list", () => ({
    ok: true as const,
    name: OFFICIAL_MARKETPLACE.id,
    generatedAt: CATALOG_GENERATED_AT,
    plugins: PLUGIN_CATALOG,
  }));

  /**
   * Download a plugin at its pinned sha, scan it, and return everything the
   * confirm dialog must show BEFORE anything is written.
   */
  ipcMain.handle("hv:plugins-scan", async (_e, marketplaceId: string, name: string) => {
    let workDir: string | undefined;
    try {
      const cat = PLUGIN_CATALOG.find((p) => p.name === name);
      if (!cat) return { ok: false as const, error: `"${name}" is not in the catalog.` };
      // The catalog carries everything a scan needs, so nothing is fetched to
      // find it — only the plugin itself is downloaded, at the sha it was
      // verified at.
      const entry: MarketplaceEntry = {
        name: cat.name,
        description: cat.description,
        category: cat.category,
        homepage: cat.homepage,
        source: cat.source,
        entryComponents: [],
      };
      let localRoot: string | undefined;
      let cleanup: (() => void) | undefined;
      if (entry.source.repoUrl) {
        // Its own repo — its own working dir, cleaned up with the session.
        workDir = path.join(userData, "plugin-import", `pl-${++pluginSeq}-${Date.now()}`);
        const wd = workDir;
        cleanup = () => fs.rmSync(wd, { recursive: true, force: true });
      } else {
        // A "./path" entry lives in the SHARED marketplace checkout. Deliberately
        // no cleanup: removing it here would delete the tree every other
        // first-party card resolves against.
        const url = listMarketplaces().find((m) => m.id === marketplaceId)?.url ?? OFFICIAL_MARKETPLACE.url;
        localRoot = (await localCheckout(url)).dir;
      }
      const { dir } = await fetchPluginDir(entry.source, workDir ?? localRoot ?? "", localRoot);
      const scan = scanPluginDir(dir, entry.entryComponents);
      const token = `pl-${++pluginSeq}-${Date.now()}`;
      pluginSessions.set(token, {
        marketplaceId: String(marketplaceId),
        entry,
        scan,
        cleanup,
      });
      return {
        ok: true as const,
        token,
        name: scan.name,
        description: scan.description,
        accepted: scan.verdict.accepted,
        reason: scan.verdict.reason,
        sha: entry.source.sha,
        ref: entry.source.ref,
        // A rejected skill is reported but not installable — the UI shows it
        // struck through with the reason rather than pretending it isn't there.
        skills: scan.skills.map((s) => ({
          dir: s.dir, name: s.name, description: s.description, scriptCount: s.scriptCount,
          screen: s.screen.verdict, screenReason: s.screen.reason, pluginRootRefs: s.pluginRootRefs,
        })),
        commands: scan.commands.map((c) => ({ file: c.file, name: c.name, description: c.description })),
        mcpServers: Object.keys(scan.mcpServers),
        dropped: scan.dropped,
      };
    } catch (e) {
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(
    "hv:plugins-install",
    (_e, token: string, sel: { skillDirs: string[]; commandFiles: string[]; mcpKeys: string[] }) => {
      const session = pluginSessions.get(token);
      if (!session) return { ok: false as const, error: "That plugin scan expired — open it again." };
      const { scan, entry, marketplaceId } = session;
      if (!scan.verdict.accepted) {
        return { ok: false as const, error: scan.verdict.reason ?? "That plugin is not supported in HappyVibe." };
      }
      const now = new Date().toISOString();
      const provenance = {
        source: "plugin",
        sourceUrl: entry.source.repoUrl ?? undefined,
        ref: entry.source.ref,
        commitSha: entry.source.sha ?? undefined,
        importedAt: now,
        plugin: scan.name,
        marketplace: marketplaceId,
      };
      try {
        // Commands first: they are the only step that can REFUSE on a name
        // collision, and refusing after copying skills would leave a half
        // install with no plugin record to remove.
        const commands = installPluginCommands(scan, {
          destDir: managedPromptTemplatesDir(agentDir()),
          files: sel.commandFiles ?? [],
        });
        for (const name of commands) {
          const file = path.join(managedPromptTemplatesDir(agentDir()), `${name}.md`);
          // enabled:false, exactly like the skills below — a plugin install must
          // not change what the agent can do until the user switches something
          // on, and the install message says so.
          promptTemplateRegistry.approve(readPromptTemplateFile(file, "managed"), now, { enabled: false, provenance });
        }

        const installed = installPluginSkills(scan, {
          destParent: managedSkillsDir(agentDir()),
          skillDirs: sel.skillDirs ?? [],
        });
        for (const s of installed) {
          // §25: enabled:false. Import approves with enabled:true, and
          // per-workspace activation is opt-OUT, so a 62-skill plugin would
          // otherwise pay every card on every turn the moment it landed.
          skillRegistry.approve(s.skill, now, { enabled: false, provenance });
        }

        const servers: string[] = [];
        for (const key of sel.mcpKeys ?? []) {
          const cfg = scan.mcpServers[key];
          if (!cfg) continue;
          // normalize first: a plugin's non-auth header (Miro's X-AI-Source)
          // otherwise suppresses the adapter's OAuth auto-detection, so the
          // server connects unauthenticated in a session even though signing in
          // on the MCP page worked. See plugins/mcpImport.ts.
          // origin is what lets removal take these with it — it must be on the
          // FIRST write or the install is unattributable forever.
          writeMcpServer(
            globalMcpFile(),
            key,
            { ...normalizePluginMcpServer(cfg), origin: pluginOrigin(scan.name, marketplaceId) },
            { failIfExists: true },
          );
          servers.push(key);
        }

        session.cleanup?.();
        pluginSessions.delete(token);
        void log.append({
          type: "plugin.installed",
          data: { plugin: scan.name, marketplace: marketplaceId, sha: entry.source.sha,
                  skills: installed.length, commands: commands.length, servers: servers.length,
                  dropped: scan.dropped },
        });
        if (installed.length > 0) { skillsChanged(); scheduleSkillReload("global", null); }
        if (commands.length > 0) { promptTemplatesChanged(); schedulePromptTemplateReload("global", null); }
        if (servers.length > 0) scheduleMcpReload("global", null);
        return {
          ok: true as const,
          skills: installed.map((s) => s.skill.name),
          substituted: installed.reduce((n, s) => n + s.substituted, 0),
          commands,
          servers,
        };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  /**
   * What is installed, grouped by plugin — derived from the same provenance and
   * origin links removal uses, so the list cannot disagree with what Remove
   * would actually take away.
   */
  ipcMain.handle("hv:plugins-installed", () => {
    const byPlugin = new Map<string, { plugin: string; marketplace?: string; skills: string[]; commands: string[]; servers: string[] }>();
    const bucket = (name: string, marketplace?: string): { plugin: string; marketplace?: string; skills: string[]; commands: string[]; servers: string[] } => {
      const cur = byPlugin.get(name) ?? { plugin: name, marketplace, skills: [], commands: [], servers: [] };
      byPlugin.set(name, cur);
      return cur;
    };
    for (const s of scanSkillsDir(managedSkillsDir(agentDir()), "managed")) {
      const p = skillRegistry.record(s.id)?.provenance;
      if (p?.plugin) bucket(p.plugin, p.marketplace).skills.push(s.name);
    }
    for (const c of scanPromptTemplatesDir(managedPromptTemplatesDir(agentDir()), "managed")) {
      const p = promptTemplateRegistry.record(c.id)?.provenance;
      if (p?.plugin) bucket(p.plugin, p.marketplace).commands.push(c.name);
    }
    for (const [name, cfg] of Object.entries(readMcpFile(globalMcpFile()).mcpServers)) {
      const origin = (cfg as { origin?: { plugin?: string; marketplace?: string } }).origin;
      if (origin?.plugin) bucket(origin.plugin, origin.marketplace).servers.push(name);
    }
    return [...byPlugin.values()].sort((a, b) => a.plugin.localeCompare(b.plugin));
  });

  /**
   * Remove everything a plugin installed, found by its provenance/origin link
   * rather than from a plugin registry we would have to keep in sync with disk.
   */
  /**
   * §25 round 12 — enable everything this plugin installed, in place.
   *
   * The install banner used to be a checklist naming three other pages. It now
   * acts, and this is what it calls.
   *
   * Why a handler rather than ids in the banner: hv:plugins-install returns
   * skill NAMES, while skillsSetEnabled takes a skill's ID (its directory).
   * Rather than plumb a second identifier over the wire, this reuses the exact
   * provenance link hv:plugins-remove scans — so what gets enabled cannot
   * disagree with what got installed.
   *
   * It does NOT reverse the 2026-08-04 rule that an install activates nothing:
   * the click is still the user's gesture, it has just stopped being a hunt.
   */
  ipcMain.handle("hv:plugins-enable-installed", (_e, plugin: string) => {
    const id = String(plugin);
    const now = new Date().toISOString();
    let skills = 0;
    let commands = 0;
    try {
      for (const sk of scanSkillsDir(managedSkillsDir(agentDir()), "managed")) {
        if (skillRegistry.record(sk.id)?.provenance?.plugin !== id) continue;
        skillRegistry.setEnabled(sk.id, true, now);
        skills++;
      }
      for (const c of scanPromptTemplatesDir(managedPromptTemplatesDir(agentDir()), "managed")) {
        if (promptTemplateRegistry.record(c.id)?.provenance?.plugin !== id) continue;
        promptTemplateRegistry.setEnabled(c.id, true, now);
        commands++;
      }
      // Same follow-through as the install path, or the session keeps the old set.
      if (skills > 0) { skillsChanged(); scheduleSkillReload("global", null); }
      if (commands > 0) { promptTemplatesChanged(); schedulePromptTemplateReload("global", null); }
      void log.append({ type: "plugin.enabled", data: { plugin: id, skills, commands } });
      return { ok: true as const, skills, commands };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("hv:plugins-remove", (_e, plugin: string) => {
    const id = String(plugin);
    const now = new Date().toISOString();
    const removedSkills: string[] = [];
    const removedCommands: string[] = [];
    try {
      for (const s of scanSkillsDir(managedSkillsDir(agentDir()), "managed")) {
        if (skillRegistry.record(s.id)?.provenance?.plugin !== id) continue;
        removeSkillDir(s.id, [managedSkillsDir(agentDir())]);
        skillRegistry.forget(s.id, now);
        removedSkills.push(s.name);
      }
      for (const c of scanPromptTemplatesDir(managedPromptTemplatesDir(agentDir()), "managed")) {
        if (promptTemplateRegistry.record(c.id)?.provenance?.plugin !== id) continue;
        removePromptTemplateFile(c.id, [managedPromptTemplatesDir(agentDir())]);
        promptTemplateRegistry.forget(c.id, now);
        removedCommands.push(c.name);
      }
      const servers = findPluginServers(globalMcpFile(), id);
      for (const name of servers) writeMcpServer(globalMcpFile(), name, null);
      void log.append({ type: "plugin.removed", data: { plugin: id, skills: removedSkills.length, commands: removedCommands.length, servers: servers.length } });
      if (removedSkills.length > 0) { skillsChanged(); scheduleSkillReload("global", null); }
      if (removedCommands.length > 0) { promptTemplatesChanged(); schedulePromptTemplateReload("global", null); }
      if (servers.length > 0) scheduleMcpReload("global", null);
      return { ok: true as const, skills: removedSkills, commands: removedCommands, servers };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Remove a command: managed/workspace/claude → delete the file, bundled →
  // refused (it is reinstalled at startup), linked → drop the DIRECTORY
  // reference only (those files belong to another tool).
  ipcMain.handle("hv:prompt-templates-delete", (_e, id: string, _workspaceId: string | null) => {
    if (!promptTemplateRoot(id)) return { ok: false as const, error: "That prompt no longer exists." };
    const cmd = readKnownPromptTemplate(id);
    const plan = planPromptTemplateRemoval({ id: cmd.id, source: cmd.source });
    if (plan.action === "refused") return { ok: false as const, error: plan.reason ?? "This prompt cannot be deleted." };
    try {
      if (plan.action === "unlink") {
        const linked = getLinkedPromptTemplateDirs();
        const root = linked.find((d) => path.resolve(d) === path.resolve(plan.path));
        if (!root) return { ok: false as const, error: "That linked directory is no longer configured." };
        setLinkedPromptTemplateDirs(linked.filter((d) => d !== root));
      } else {
        removePromptTemplateFile(plan.path, [
          managedPromptTemplatesDir(agentDir()),
          ...workspaces.list().map((w) => workspacePromptTemplatesDir(w)),
        ]);
      }
      promptTemplateRegistry.forget(id, new Date().toISOString());
      void log.append({ type: "prompt-template.deleted", data: { id, name: cmd.name, source: cmd.source, action: plan.action } });
      promptTemplatesChanged();
      // Derive the workspace from the command's own path (a caller-supplied id
      // that didn't match meant no respawn and a still-loaded deleted command —
      // the §14 bug this mirrors).
      const owner = cmd.source === "workspace"
        ? workspaces.list().find((w) => path.resolve(workspacePromptTemplatesDir(w)) === path.resolve(path.dirname(id))) ?? null
        : null;
      schedulePromptTemplateReload(owner ? "workspace" : "global", owner);
      return { ok: true as const, action: plan.action };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Promote a workspace prompt to global: copy into the managed
  // dir, approved — same content, so the trust carries over.
  ipcMain.handle("hv:prompt-templates-promote", (_e, id: string) => {
    const root = promptTemplateRoot(id);
    const fromWorkspace = !!root && workspaces.list().some((w) => path.resolve(workspacePromptTemplatesDir(w)) === path.resolve(root));
    if (!fromWorkspace) throw new Error("Only workspace prompts can be promoted.");
    const destParent = managedPromptTemplatesDir(agentDir());
    fs.mkdirSync(destParent, { recursive: true });
    const dest = path.join(destParent, path.basename(id));
    fs.copyFileSync(id, dest);
    const promoted = readPromptTemplateFile(dest, "managed");
    promptTemplateRegistry.approve(promoted, new Date().toISOString(), { enabled: true, provenance: { source: "promoted", importedAt: new Date().toISOString() } });
    void log.append({ type: "prompt-template.promoted", data: { name: promoted.name, from: id, to: dest } });
    promptTemplatesChanged();
    schedulePromptTemplateReload("global", null);
    return dest;
  });

  // Live on-disk change detection for the managed prompts dir (workspace command
  // dirs ride the workspace watcher above). An edit flips an approved command
  // back to needs-review, so the renderer must re-fetch.
  const managedPromptsDir = managedPromptTemplatesDir(agentDir());
  fs.mkdirSync(managedPromptsDir, { recursive: true });
  try {
    let promptTemplateWatchTimer: ReturnType<typeof setTimeout> | undefined;
    const cw = fs.watch(managedPromptsDir, () => {
      clearTimeout(promptTemplateWatchTimer);
      promptTemplateWatchTimer = setTimeout(() => promptTemplatesChanged(), 200);
    });
    app.on("will-quit", () => { try { cw.close(); } catch { /* already closed */ } });
  } catch {
    /* watch unsupported — renderer re-fetches on navigation */
  }
}
