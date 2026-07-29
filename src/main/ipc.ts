import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EMPTY_RULES, evaluate, parseRulesFile, type RulesFile } from "../../pi-runtime/extensions/hv-rules";
import { PiClient } from "./pi/PiClient";
import { resolvePiSpawn } from "./pi/spawn";
import { piRuntimeDir } from "./pi/runtimeDir";
import {
  agentDir, builtinAgentsDir, getApiKey, getDefaultModel, getGlobalBypass, getLinkedSkillDirs, getOnboardingSeen,
  getWorkspaceBypass, installBuiltinAgents, providerEnv, providerKeyStatus, removeProviderKey, setLinkedSkillDirs, writeSubagentConfig,
  resolveBypass, rulesFile, sessionDir, setApiKey, setDefaultModel, setGlobalBypass, setOnboardingSeen,
  setProviderKey, setWorkspaceBypass,
} from "./config";
import {
  bundledSkillsDir, buildManifest, discoverGlobal, discoverWorkspace, downloadAndExtract, installBundledSkills,
  managedSkillsDir, parseForgeUrl, planSkillRemoval, readSkillDir, removeSkillDir, resolveActiveSkills, scanSkillsDir,
  SkillRegistry, toSkillView,
  type DiscoveredSkill, type SkillProvenance,
} from "./skills";
import { allowedAgentDirs, duplicateAgent, readAgentBody, writeAgentEdit } from "./agents";
import {
  authJsonProviders, BYOK_PROVIDERS, detectOllama, isByokProvider, syncOllamaModels,
  type ByokProvider,
} from "./providers";
import { deleteSessionFile, SessionIndex, WorkspaceRegistry, type SessionMeta } from "./store";
import { SessionManager, sweepOrphans, type SessionExit } from "./SessionManager";
import { SessionActivity } from "./activity";
import { parseSubagentNotify } from "./subagentEvents";
import { pollSubagentStatus } from "./subagentStatus";
import { EventLog } from "./log";
import { aggregate, type AnalyticsFilter } from "./analytics";
import { generateTitle } from "./titles";
import { promptCommand, type PromptBehavior, type PromptImage } from "./pi/commands";
import { copyClaudeMdToAgentsMd, hasClaudeMd, proposeAgentsMd, readAgentsMd, writeAgentsMd, writeAgentsMdFiles } from "./agentsMd";
import { buildMentionBlocks, createDir, createFile, importEntries, listDir, listRecursive, moveEntry, readWorkspaceFile, resolveInWorkspace, statDetails, statMtime, writeWorkspaceFile } from "./files";
import { unwatchAll, unwatchWorkspace, watchWorkspace } from "./watch";
import { readPlan, setPlanStatus, writePlanFile, PLAN_DIR } from "./plans";
import { shouldReconcilePlanOff, type PlanStatus } from "../../pi-runtime/extensions/hv-plan";
import { restoreItems, type RestoreItem } from "./restore";
import { globalAppendFile, readAppend, resolveWorkspaceAppend, writeAppend } from "./appendSystem";
import { readMcpFile, writeMcpServer, serverNameInFiles, type McpServerConfig } from "./mcp";
import { deleteAuthEntry } from "./mcpAuthStore";
import { probe } from "./mcpClient";
import { authenticate, logout } from "./mcpOAuth";
import { statusKey } from "./mcpStatusKey";
import { affectedSessionIds, type ReloadSession } from "./mcpReloadScope";


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
  const userData = app.getPath("userData");
  const index = new SessionIndex(path.join(userData, "session-index.json"));
  // Heal stale absolute piSessionFile paths after a userData move (the
  // hv-scaffold → HappyVibe rename), else resume loads no history.
  index.rebaseSessionFiles(sessionDir());
  const workspaces = new WorkspaceRegistry(path.join(userData, "workspaces.json"));
  const log = new EventLog(path.join(userData, "events.jsonl"));
  const pidFile = path.join(userData, "pi-pids.json");

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
    return file;
  };
  const skillsChanged = (): void => send("hv:skills-changed");

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

  /** Everything a Pi spawn needs from provider config (B3) + rules delivery (B4).
   *  Model resolution (W2.1, full PRD hierarchy): session override → workspace
   *  override → global default. Mirrors resolveModel in renderer composer.ts. */
  const spawnOpts = (workspace?: string, resumeFile?: string, sessionId?: string) => {
    // §14: resolve the approved ∩ enabled ∩ active-for-workspace skill set and
    // write the per-session manifest the bridge reads (HV_SKILLS_FILE). Only for
    // real chat sessions — the utility client ($HOME, no workspace/id) loads none.
    const entries = workspace && sessionId ? activeSkillEntries(workspace) : [];
    return {
      model:
        (sessionId ? index.get(sessionId)?.model : null) ??
        (workspace ? workspaces.getModel(workspace) : null) ??
        getDefaultModel(),
      agentDir: agentDir(),
      providerEnv: providerEnv(),
      resumeFile,
      rulesFile: rulesFile(),
      // #14: persistent bypass resolved workspace ?? global ?? off; re-applied on
      // every (re)spawn so it survives respawns (unlike session dangerous mode).
      bypass: resolveBypass(workspace ?? null),
      skills: entries.map((e) => e.skill.id),
      skillsFile: sessionId ? writeSkillsManifest(sessionId, entries) : undefined,
    };
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

  const startUtility = async (): Promise<PiClient> => {
    utility?.stop();
    utility = null;
    // Sync Ollama models into the app-owned agent dir so local models are
    // selectable with zero config.
    await syncOllamaModels(agentDir()).catch(() => {});
    const c = new PiClient(resolvePiSpawn(os.homedir(), sessionDir(), piRuntimeDir(), spawnOpts()));
    c.on("ui-request", (r: { id: string; message?: string }) => {
      uiOwners.set(r.id, UTILITY);
      send("hv:ui-request", { ...r, sessionId: UTILITY });
      // Auth landed/left → the model list changed (OAuth results only flow as
      // hv.auth ui-requests, so this is where main learns about them).
      try {
        const p = JSON.parse(r.message ?? "") as { kind?: string; stage?: string };
        if (p?.kind === "hv.auth" && (p.stage === "success" || p.stage === "logged_out")) providersChanged();
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
  const mcpStatusChanged = (): void =>
    send("hv:mcp-status-changed", Array.from(mcpStatusMap.values()));

  const checkServer = async (
    scope: "global" | "workspace",
    workspaceId: string | null,
    name: string,
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
    const result = await probe(name, cfg, agentDir());
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
  void (async () => {
    const globalServers = Object.keys(readMcpFile(path.join(agentDir(), "mcp.json")).mcpServers);
    const wsPaths = workspaces.list();
    const allChecks: Promise<void>[] = [
      ...globalServers.map((n) => checkServer("global", null, n)),
      ...wsPaths.flatMap((ws) =>
        Object.keys(readMcpFile(path.join(ws, ".mcp.json")).mcpServers).map((n) =>
          checkServer("workspace", ws, n),
        ),
      ),
    ];
    await Promise.allSettled(allChecks);
    const byState: Record<string, number> = {};
    for (const s of mcpStatusMap.values()) byState[s.state] = (byState[s.state] ?? 0) + 1;
    void log.append({ type: "mcp.startup_check", data: { total: allChecks.length, byState } });
  })().catch((e) => console.warn("[hv] mcp startup sweep failed:", e));

  const maybeTitle = (sessionId: string): void => {
    const meta = index.get(sessionId);
    const msg = firstPrompt.get(sessionId);
    if (!meta || meta.titleSource !== "fallback" || !msg) return;
    firstPrompt.delete(sessionId);
    // Fire-and-forget — never blocks the chat; fallback title stays on failure.
    void generateTitle(piRuntimeDir(), meta.workspaceId, msg, {
      model: getDefaultModel(),
      // BYOK keys via env; OAuth creds live in auth.json under the agent dir.
      env: { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
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
      send("hv:pi-event", { ...e, sessionId });
      if (e.type === "agent_end") {
        maybeTitle(sessionId);
        if (meta && !index.get(sessionId)?.piSessionFile) void captureSessionFile(sessionId, client);
        drainPendingReload(sessionId); // apply a deferred MCP reload now the turn is done
      }
    });
    client.on("ui-request", (r: { id: string; method?: string; message?: string }) => {
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

  manager.on("session-exit", ({ sessionId, code, intentional }: SessionExit) => {
    activity.remove(sessionId);
    pendingMcpReload.delete(sessionId); // don't reload a session that's gone
    // Stop this session's status pollers. The detached runners survive (they're
    // unref'd); a resume re-adopts + re-polls via /hv-subagent-list.
    for (const [runId, p] of subagentPollers) if (p.sessionId === sessionId) stopSubagentPoll(runId);
    const meta = index.get(sessionId);
    if (!intentional) {
      void log.append({ type: "session.crash", sessionId, workspaceId: meta?.workspaceId, data: { code } });
    }
    send("hv:pi-exit", { sessionId, code, intentional });
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
    await syncOllamaModels(agentDir()).catch(() => {});
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

  // Reason for each pending/in-flight reload (mcp | skills) — cosmetic (renderer
  // notice text); coalesced last-writer-wins per session.
  const reloadReasons = new Map<string, "mcp" | "skills">();
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
  const pendingScopes: Array<{ scope: "global" | "workspace"; workspaceId: string | null; reason: "mcp" | "skills" }> = [];
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
  // single reload pass. §14 skills reuse the exact same machinery (one mechanism,
  // two config sources) — only the reason label differs.
  const scheduleRuntimeReload = (reason: "mcp" | "skills", scope: "global" | "workspace", workspaceId: string | null): void => {
    pendingScopes.push({ scope, workspaceId, reason });
    clearTimeout(mcpReloadTimer);
    mcpReloadTimer = setTimeout(() => { void runMcpReloadPass(); }, 500);
  };
  const scheduleMcpReload = (scope: "global" | "workspace", workspaceId: string | null): void =>
    scheduleRuntimeReload("mcp", scope, workspaceId);
  const scheduleSkillReload = (scope: "global" | "workspace", workspaceId: string | null): void =>
    scheduleRuntimeReload("skills", scope, workspaceId);

  app.on("will-quit", () => {
    clearTimeout(mcpReloadTimer); // don't spawn during teardown
    manager.stopAll();
    utility?.stop();
    unwatchAll(); // WS8: close fs watchers
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
  ipcMain.handle("hv:remove-workspace", (_e, ws: string) => workspaces.remove(ws));

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
    async (_e, sessionId: string): Promise<{ meta: SessionMeta; messages: RestoreItem[] | null }> => {
      const meta = index.get(sessionId);
      if (!meta) throw new Error("Unknown session");
      if (manager.get(sessionId)) return { meta, messages: null }; // already active — renderer keeps its transcript
      const client = await startClient(meta, !!meta.piSessionFile);
      let messages: RestoreItem[] | null = null;
      if (meta.piSessionFile) {
        try {
          const res = await client.send({ type: "get_messages" });
          const raw =
            (res.data as { messages?: Parameters<typeof restoreItems>[0] })?.messages ?? [];
          messages = restoreItems(raw);
          // §23: fill each restored plan card with the plan file's real status +
          // checklist progress, so a reopened card shows "implementing" (etc.)
          // and the right CTA — not a stale "draft".
          for (const it of messages) {
            if (it.kind !== "plan") continue;
            const parsed = readPlan(workspaces.list(), meta.workspaceId, it.planPath);
            if (parsed) { it.status = parsed.status; it.done = parsed.done; it.total = parsed.total; }
          }
        } catch {
          messages = []; // resumed but history unreadable — start visually fresh
        }
      }
      sessionsChanged();
      return { meta, messages };
    }
  );

  // Shared by close and delete: capture stats best-effort, log session.end,
  // stop the process.
  const endSession = async (sessionId: string): Promise<void> => {
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

  ipcMain.handle("hv:close-session", (_e, sessionId: string) => endSession(sessionId));

  // V2.C2: permanent delete — confirm happens renderer-side. Stop first if
  // live (same stats/session.end capture as close), drop the index entry,
  // delete the Pi session file (sessionDir-confined; missing file fine).
  ipcMain.handle("hv:delete-session", async (_e, sessionId: string) => {
    const meta = index.get(sessionId);
    if (!meta) return;
    if (manager.get(sessionId)) await endSession(sessionId);
    index.remove(sessionId);
    deleteSessionFile(sessionDir(), meta.piSessionFile);
    void log.append({ type: "session.delete", sessionId, workspaceId: meta.workspaceId });
    sessionsChanged();
  });

  ipcMain.handle("hv:rename-session", (_e, sessionId: string, title: string) => {
    index.update(sessionId, { title: title.trim() || "Untitled", titleSource: "user" });
    sessionsChanged();
  });

  ipcMain.handle("hv:archive-session", (_e, sessionId: string, archived: boolean) => {
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
    async (_e, sessionId: string, msg: string, behavior?: PromptBehavior, images?: PromptImage[], mentions?: string[]) => {
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
      const { blocks, warnings: w } = buildMentionBlocks(workspaces.list(), meta.workspaceId, mentions);
      if (blocks) outgoing = `${msg}\n\n${blocks}`;
      warnings = w;
    }
    await client.send(promptCommand(outgoing, behavior, images));
    return { warnings };
  });

  ipcMain.handle("hv:abort-session", async (_e, sessionId: string) => {
    await (manager.get(sessionId) as PiClient | null)?.send({ type: "abort" });
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
  ipcMain.handle("hv:plan-set", async (_e, sessionId: string, enabled: boolean) => {
    if (!index.get(sessionId)) throw new Error("Unknown session");
    await abortIfBusy(sessionId);
    planCmd(sessionId, `/hv-plan ${enabled ? "on" : "off"}`);
  });

  // Implement: exit plan mode, restore tools, hand the plan file to a normal
  // turn. Optional per-implementation model override (the reasonable-model nudge).
  ipcMain.handle(
    "hv:plan-implement",
    async (_e, sessionId: string, relPath: string, model?: { provider: string; modelId: string } | null) => {
      const meta = index.get(sessionId);
      if (!meta?.workspaceId) throw new Error("Unknown session");
      const wsId = meta.workspaceId;
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
    const c = await ensureUtility();
    void c.send({ type: "prompt", message: "/hv-auth-status" }).catch(() => {});
  });

  ipcMain.handle("hv:detect-ollama", () => detectOllama());

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

  ipcMain.handle("hv:read-audit", (_e, filter?: { sessionId?: string; workspaceId?: string }) =>
    log.read({ type: "permission.decision", ...filter }));

  // ── B7: local analytics (read + aggregate in main, never leaves the machine) ──
  ipcMain.handle("hv:get-analytics", async (_e, filter?: AnalyticsFilter) =>
    aggregate(await log.read(), filter ?? {}));

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
      model: getDefaultModel(),
      env: { ...providerEnv(), PI_CODING_AGENT_DIR: agentDir() },
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
  ipcMain.handle("hv:get-workspace-append", (_e, workspaceId: string) =>
    readAppend(resolveWorkspaceAppend(workspaces.list(), workspaceId)));
  ipcMain.handle("hv:set-workspace-append", (_e, workspaceId: string, content: string) =>
    writeAppend(resolveWorkspaceAppend(workspaces.list(), workspaceId), String(content)));

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
  // WS8: native fs watching — auto-refresh the tree (replaces the refresh button).
  ipcMain.handle("hv:watch-workspace", (_e, workspaceId: string) => {
    resolveInWorkspace(workspaces.list(), workspaceId, ""); // confinement gate
    watchWorkspace(workspaceId, (relDirs) => {
      send("hv:fs-changed", { workspaceId, relDirs });
      // §14: a change under .agents/skills may flip an approved workspace skill
      // back to needs-review (hash mismatch) — tell the renderer to re-fetch, and
      // auto-approve skills the agent just authored via skill-creator.
      if (relDirs.some((d) => d.startsWith(".agents/skills") || d === ".agents" || d === "")) {
        skillsChanged();
        autoApproveCreatedSkills(workspaceId);
      }
      // §23: when a plan dir changed, re-parse plan files and push live progress.
      if (relDirs.some((d) => d === PLAN_DIR || d === ".agents" || d === "")) {
        let names: { name: string; kind: string }[] = [];
        try { names = listDir(workspaces.list(), workspaceId, PLAN_DIR); } catch { /* no plans yet */ }
        for (const f of names) {
          if (f.kind !== "file" || !f.name.endsWith(".md")) continue;
          const rel = `${PLAN_DIR}/${f.name}`;
          const parsed = readPlan(workspaces.list(), workspaceId, rel);
          if (parsed) send("hv:plan-changed", { workspaceId, path: rel, status: parsed.status, done: parsed.done, total: parsed.total });
        }
      }
    });
  });
  ipcMain.handle("hv:unwatch-workspace", (_e, workspaceId: string) => unwatchWorkspace(workspaceId));

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
  // matching, same trust boundary as resolveWorkspaceAppend.
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
    (_e, scope: "global" | "workspace", workspaceId: string | null, name: string, cfg: McpServerConfig | null) => {
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
          deleteAuthEntry(agentDir(), name);
          void log.append({ type: "mcp.auth", workspaceId: workspaceId ?? undefined,
            data: { name, action: "credentials-deleted", reason: "server-removed" } });
        }
      }
      scheduleMcpReload(scope, workspaceId); // apply to running sessions
      return readMcpFile(file);
    },
  );

  ipcMain.handle("hv:mcp-status", () => Array.from(mcpStatusMap.values()));

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
    logout(name, agentDir());
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
    return {
      name: skill.name,
      description: skill.description,
      source: skill.source,
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
  const sessionHasSkill = (sessionId: string, name: string): boolean => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(skillsManifestDir, `${sessionId}.json`), "utf8")) as { skills?: Array<{ name: string }> };
      return (m.skills ?? []).some((s) => s.name === name);
    } catch {
      return false;
    }
  };

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
    const plan = planSkillRemoval(
      { id: skill.id, source: skill.source, dir: skill.id },
      { managed: managedSkillsDir(agentDir()), bundled: bundledSkillsDir(piRuntimeDir()), workspaces: workspaces.list() },
    );
    if (plan.kind === "refused") return { ok: false as const, error: plan.reason ?? "This skill cannot be deleted." };
    try {
      if (plan.kind === "unlink") {
        // A linked root (e.g. ~/.claude/skills) can contain several skill
        // subfolders; skill.id is the subfolder, not the root, so find the
        // configured root this skill lives under and drop that reference.
        const linkedDirs = getLinkedSkillDirs();
        const abs = path.resolve(plan.dir);
        const root = linkedDirs.find((d) => { const r = path.resolve(d); return abs === r || abs.startsWith(r + path.sep); });
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
      scheduleSkillReload(skill.source === "workspace" ? "workspace" : "global", skill.source === "workspace" ? workspaceId : null);
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
}
