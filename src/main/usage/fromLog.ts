/**
 * §39 — EventLog row → usage event, through an explicit picker. NEVER spread
 * `data`: rows carry summaries, commands, paths, branch names and messages.
 * Each case reads the fields it names, and nothing else.
 */
import type { LogEvent } from "../log";
import { PLUGIN_CATALOG } from "../plugins/catalog.generated";
import { OFFICIAL_MARKETPLACE_ID } from "../plugins/officialMarketplace";
import type { UsageEventName, UsageParams } from "./events";
import { toolKind } from "./features";

export interface TapContext {
  waitSec(sessionId: string): number | undefined;
  aiMessage(workspaceId: string | undefined, message: unknown): boolean;
  isStorePlugin(plugin: unknown, marketplace: unknown): string | null;
  isScheduleSession(sessionId: string | undefined): boolean;
  inWorktree(workspaceId: string | undefined): boolean;
}
type Out = { name: UsageEventName; params: UsageParams } | null;

const WEB_CODES = new Set(["UNAVAILABLE", "DEFAULT_PAUSED", "CUSTOM_URL_INVALID", "DEADLINE", "CANCELLED", "TOO_LARGE", "BAD_RESPONSE", "CRAWL_FAILED"]);
/** A code the service itself returned is untrusted text: only our own codes pass. */
export function mapWebCode(code: unknown): string {
  if (typeof code !== "string") return "other";
  if (WEB_CODES.has(code)) return code;
  return /^HTTP_4\d\d$/.test(code) ? "HTTP_4XX" : "other";
}

const STORE = new Set(PLUGIN_CATALOG.map((e) => e.name));
/** The store's verified id, or null — a plugin from any other marketplace is `custom`. */
export function storePluginId(plugin: unknown, marketplace: unknown): string | null {
  return marketplace === OFFICIAL_MARKETPLACE_ID && typeof plugin === "string" && STORE.has(plugin) ? plugin : null;
}

const GIT: Record<string, string> = {
  commit: "commit", amend: "amend", switch: "switch", "delete-branch": "delete_branch", merge: "merge",
  "worktree-add": "worktree_add", "worktree-remove": "worktree_remove", sync: "sync", publish: "publish",
  "undo-hunk": "undo_hunk", "undo-file": "undo_file", "discard-untracked": "discard_untracked", init: "init",
};
const PLAN: Record<string, string> = { "plan.enter": "entered", "plan.ready": "plan_ready", "plan.implement": "implemented", "plan.revert": "reverted", "plan.exit": "exited" };
const DECISION: Record<string, string> = { allow: "allow", "allow-session": "allow_session", deny: "deny" };

export function eventFromLog(e: Omit<LogEvent, "ts">, ctx: TapContext): Out {
  const d = e.data ?? {};
  switch (e.type) {
    case "permission.decision": {
      // An allow under an earlier "Allow for session" is audited as the user's
      // but showed no prompt — it is not an answer.
      if (d.source !== "user" || typeof d.tool !== "string" || d.grant === "session") return null;
      const decision = Object.hasOwn(DECISION, String(d.decision)) ? DECISION[String(d.decision)] : null;
      if (!decision) return null;
      const wait = e.sessionId ? ctx.waitSec(e.sessionId) : undefined;
      return {
        name: "permission_answered",
        params: { decision, toolKind: toolKind(d.tool), ...(wait !== undefined ? { waitSec: wait } : {}) },
      };
    }
    case "plan.enter":
    case "plan.ready":
    case "plan.implement":
    case "plan.revert":
    case "plan.exit":
      return { name: "plan_mode_changed", params: { action: PLAN[e.type] } };
    case "context.compact":
      return d.reason === "manual" ? null : { name: "context_changed", params: { action: "compacted", trigger: "auto" } };
    case "git.action": {
      const raw = String(d.action ?? "");
      const action = raw.startsWith("stash-") ? "stash" : Object.hasOwn(GIT, raw) ? GIT[raw] : undefined;
      if (!action) return null;
      return { name: "git_action", params: { action, ...(action === "commit" || action === "amend" ? { aiMessage: ctx.aiMessage(e.workspaceId, d.message) } : {}) } };
    }
    case "web.call": {
      const tool = String(d.tool ?? "").replace(/^web_/, "");
      if (!["search", "fetch", "map", "crawl"].includes(tool)) return null;
      return {
        name: "web_tool_called",
        params: {
          tool,
          service: d.service === "custom" ? "custom" : "default",
          ok: d.ok === true,
          ...(typeof d.ms === "number" ? { ms: d.ms } : {}),
          ...(d.ok !== true ? { errorCode: mapWebCode(d.code) } : {}),
          ...(typeof d.resultChars === "number" ? { chars: d.resultChars } : {}),
          ...(tool === "crawl" && typeof d.pages === "number" ? { pages: d.pages } : {}),
        },
      };
    }
    case "plugin.installed": {
      const id = ctx.isStorePlugin(d.plugin, d.marketplace);
      return { name: "plugin_installed", params: { plugin: id ?? "custom", marketplace: id ? "store" : "custom" } };
    }
    case "session.start":
      if (d.resume !== false || ctx.isScheduleSession(e.sessionId)) return null;
      return { name: "session_opened", params: { kind: "new", inWorktree: ctx.inWorktree(e.workspaceId) } };
    default:
      return null;
  }
}

/**
 * A sub-agent's prompt is answered by a human, but its audit row (source
 * "subagent") mixes those answers with the boundary's automatic decisions, so
 * it is not counted — and its wait must not enter the queue the user's rows pair with.
 */
export function isSubagentPrompt(title: string | undefined): boolean {
  try {
    const p = JSON.parse(title ?? "") as { child?: unknown };
    return !!p && typeof p === "object" && p.child != null;
  } catch {
    return false;
  }
}
