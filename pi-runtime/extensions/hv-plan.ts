/**
 * HappyVibe Plan Mode (§23) — PURE module, zero imports.
 *
 * Lives next to the bridge so Pi's extension loader can resolve it at runtime,
 * and is imported directly by src/main (plan-file writer reuses the parser) and
 * by vitest — one engine, logic never forks.
 *
 * Plan Mode is a per-session read-only mode: the agent explores + asks
 * questions, then submits an implementation plan via `plan_complete`; the app
 * writes it to a workspace file (`.agents/plans/NNN-<slug>.md`) and the user
 * approves implementation. This module holds the three pure pieces:
 *   1. the fail-closed read-only bash allowlist,
 *   2. the tool-call gate decision (`gatePlanCall`),
 *   3. the plan-file front-matter / checkbox parser + status rewriter,
 *   4. the plan-state appendEntry round-trip helpers,
 *   5. the 3-phase planning system prompt.
 *
 * The bash allowlist (isSafeCommand + helpers below) is PORTED from
 * @narumitw/pi-plan-mode `src/tool-policy.ts` (MIT, © narumiruna) — ported
 * verbatim, do not "improve" it: it is fail-closed by construction.
 */

// ── Plan state (persisted via pi.appendEntry, restored on session_start) ─────

export const PLAN_STATE_TYPE = "hv-plan-state";

export interface PlanState {
  enabled: boolean;
  /** Workspace-relative path of the current plan file, once written. */
  planPath?: string;
}

/** Minimal session-entry shape (mirrors hv-context.SessionEntry — kept local to stay import-free). */
export interface PlanSessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

/**
 * On a `restored` (session_start / respawn) plan notify, decide whether main
 * must force plan mode OFF. Plan mode only makes sense while the plan file is a
 * `draft`: a resume that comes back `enabled` over a non-draft or missing plan
 * (status === null) is the mid-turn-toggle wedge surviving a respawn — force it
 * off so the session isn't stuck read-only. Live toggles (restored === false)
 * are always honored, so re-entering plan mode after implementing still works.
 */
export function shouldReconcilePlanOff(restored: boolean, enabled: boolean, status: PlanStatus | null): boolean {
  return restored && enabled && status !== "draft";
}

/**
 * §13 round 6: Plan Mode turned off globally ⇒ force any restored plan state off.
 * The plan tools and the human-only /hv-plan exit are unregistered when the
 * feature is disabled, so leaving restored state enabled would keep the
 * gatePlanCall clamp running with no way for anyone — model or user — to lift it.
 */
export function shouldForcePlanOff(featureEnabled: boolean, state: PlanState): boolean {
  return !featureEnabled && (state.enabled || state.planPath !== undefined);
}

/**
 * The plan state a session takes when the feature is force-disabled: clamp off,
 * but planPath KEPT — the plan file is the user's artifact and re-enabling Plan
 * mode should still find it. The bridge persists this, so re-enabling the
 * feature cannot silently re-clamp the session from a stale session file.
 */
export function forcedPlanOffState(state: PlanState): PlanState {
  return { ...state, enabled: false };
}

/** Newest hv-plan-state custom entry wins — it's a full snapshot. */
export function restorePlanState(entries: PlanSessionEntry[]): PlanState {
  let state: PlanState = { enabled: false };
  for (const e of entries) {
    if ((e.type === "custom" || e.type === "custom_message") && e.customType === PLAN_STATE_TYPE) {
      const d = e.data as Partial<PlanState> | undefined;
      if (d && typeof d.enabled === "boolean") {
        state = { enabled: d.enabled, planPath: typeof d.planPath === "string" ? d.planPath : undefined };
      }
    }
  }
  return state;
}

// ── Plan file: front-matter status + checkbox progress ───────────────────────

export type PlanStatus = "draft" | "implementing" | "implemented" | "cancelled";
const PLAN_STATUSES: readonly PlanStatus[] = ["draft", "implementing", "implemented", "cancelled"];

export interface ParsedPlan {
  status: PlanStatus;
  createdAt?: string;
  updatedAt?: string;
  /** Ticked `- [x]` task count. */
  done: number;
  /** Total `- [ ]`/`- [x]` task count. */
  total: number;
}

/** Parse a plan markdown file: YAML-ish front-matter + GFM task checkboxes. */
export function parsePlanFile(md: string): ParsedPlan {
  const fm = readFrontMatter(md);
  const rawStatus = fm["status"];
  const status = (PLAN_STATUSES as readonly string[]).includes(rawStatus ?? "")
    ? (rawStatus as PlanStatus)
    : "draft";
  const body = stripFrontMatter(md);
  let done = 0;
  let total = 0;
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[( |x|X)\]\s+/.exec(line);
    if (m) {
      total += 1;
      if (m[1] !== " ") done += 1;
    }
  }
  return { status, createdAt: fm["createdAt"], updatedAt: fm["updatedAt"], done, total };
}

function readFrontMatter(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function stripFrontMatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Build a plan file (front-matter + body). If `existing` is given, its
 * createdAt is preserved (a revision), otherwise `now` seeds createdAt.
 */
export function buildPlanFile(body: string, status: PlanStatus, now: string, existing?: string): string {
  const prev = existing ? readFrontMatter(existing) : {};
  const createdAt = prev["createdAt"] ?? now;
  const fm = [`---`, `status: ${status}`, `createdAt: ${createdAt}`, `updatedAt: ${now}`, `---`].join("\n");
  return `${fm}\n${stripFrontMatter(body).replace(/^\n+/, "")}\n`;
}

/** Rewrite only the status (and updatedAt) of an existing plan file, keeping the body. */
export function withPlanStatus(md: string, status: PlanStatus, now: string): string {
  return buildPlanFile(md, status, now, md);
}

/** Derive a filesystem slug from a plan's first markdown heading (or fallback). */
export function planSlug(body: string): string {
  const heading = /^#\s+(.+)$/m.exec(stripFrontMatter(body));
  const source = heading ? heading[1] : "plan";
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "plan";
}

// ── Tool-call gate (runs BEFORE dangerous/bypass + rules in the bridge) ──────

/** Tools that mutate and are always blocked while planning.
 * §26: terminal_run must be NAMED. An unrecognised tool falls to floor-ask,
 * which prompts forever but never blocks — and plan mode is read-only, so a
 * planning agent must not be able to start a process at all. */
// §28: acting on a page is a side effect, so click/type/evaluate are blocked
// outright. `browser_open`/`browser_navigate` are deliberately NOT here — they
// fall through to floor-ask, because opening documentation to read it is
// legitimate planning, and a GET the user approves per-call is not a mutation.
// §12 (2026-09-26): a tintinweb workflow is a SCRIPT that runs inside the app's own Pi process
// — approving one is approving code — so planning blocks it outright; a single read-only
// `Agent` delegation stays available below, which is what exploration needs.
// §13 round 27: generate_image writes a file and spends money — blocked while planning (and in read-only runs).
export const BLOCKED_PLAN_TOOLS = new Set(["edit", "write", "multi_edit", "terminal_run", "browser_click", "browser_type", "browser_evaluate", "SubagentWorkflow", "generate_image"]);
/** Read-only tools that pass straight through the plan gate. */
const PLAN_PASS_TOOLS = new Set([
  // §13 (2026-10-05): read-only MCP discovery — finding a tool or listing resources changes nothing.
  "tool_search", "list_mcp_resources", "list_mcp_resource_templates",
  // use_skill only returns an ALREADY-APPROVED SKILL.md's text (spawn-time trust
  // gate, §14) — strictly a read. Without it, planning raised a permission modal
  // on every skill load.
  "read", "grep", "glob", "list", "ls", "find", "ask_user", "use_skill", "plan_complete", "plan_start", "plan_status_update",
  // §12 (2026-09-26): steering a run already inside an approved boundary, and reading a
  // result, change nothing a plan could mutate.
  "steer_subagent", "get_subagent_result",
  // §26: reading a log is a read. Killing REMOVES power rather than exercising
  // it, and a planning agent that started something before entering plan mode
  // must be able to stop it — neither is worth a modal. floor-ask would clamp
  // allow→ask and prompt on every single poll.
  "terminal_read", "terminal_kill",
  // §28: same two categories. Reading a page is a read (and get_text is polled
  // while a page loads, so floor-ask would prompt repeatedly); closing the pane
  // removes power. These must be NAMED — an unnamed tool floor-asks, which for a
  // poll is the friction that makes a model stop using the tool at all.
  "browser_get_text", "browser_read_console", "browser_read_network", "browser_screenshot", "browser_close",
  // §33: all three memory tools pass. Memory is not the workspace, and a planning session
  // learning "the user prefers X" is exactly when memory earns its keep. Passing means the RULE
  // ENGINE decides, so save and forget still ask — plan mode neither widens nor narrows them.
  // They must be NAMED: an unnamed tool floor-asks, which would prompt on every recall.
  "memory_save", "memory_recall", "memory_forget",
  // §35: reading the schedules is a read. It must be NAMED — an unnamed tool
  // floor-asks, which would raise a modal every time a planning session looked
  // at what is scheduled. The three WRITERS are deliberately absent: they are
  // side effects and floor-ask is exactly right for them.
  "schedule_list",
  // §32: headless reads of the public web — no cookies, no side effects, and
  // nothing in the workspace is touched. "pass" leaves the verdict alone, so
  // the browser:<host> gate still runs INSIDE plan mode; it only means the
  // plan clamp does not override it. Deliberately unlike browser_navigate,
  // which keeps its floor-ask because that pane is a persistent, possibly
  // logged-in Chromium where a navigation can act. NAMED, because an unnamed
  // tool floor-asks and a paged read that prompts per page is a tool the
  // model abandons (§26/§28 both record it).
  "web_search", "web_fetch", "web_map", "web_crawl",
  // §31: a document read is a read. NAMED for the same reason — an unnamed
  // tool falls to floor-ask, which clamps allow→ask and would raise a modal on
  // every `offset` step through a long document.
  "document_read",
]);

import { isReadOnlyBoundary, writeCapableIn } from "./hv-subagent-boundary";
import { isDelegationTool, isShellTool } from "./hv-rules";
import { AGENT_SHELL } from "./hv-terminal";
import { isSafeCommand, readCommand, READONLY_SUBCOMMANDS, type SafeSubcommands } from "./hv-shell";
// The ported classifier lives in hv-shell.ts so the permission engine can share it.
export { isSafeCommand, readCommand, type SafeSubcommands } from "./hv-shell";

export type PlanGate =
  | { kind: "block"; reason: string }
  | { kind: "floor-ask" }
  | { kind: "pass" }
  /**
   * §23 (2026-08-21) — a delegation, whose verdict depends on the child's
   * RESOLVED toolset. This module is pure and synchronous; preflight is neither,
   * so the answer is deferred to the bridge rather than guessed here.
   *
   * A DISTINCT variant rather than `pass` or `floor-ask`, on purpose: the union's
   * exhaustiveness check makes a caller that forgets to resolve the boundary fail
   * the TYPECHECK, instead of silently letting an unbounded child run during a
   * mode whose whole promise is that it is read-only. The one property that keeps
   * a read-only mode honest is that its gate cannot be removed by accident.
   */
  | { kind: "needs-boundary" };

/** The read-only extras both Plan Mode and the read-only shell default use (hv-shell.ts). */
export const PLAN_SAFE_SUBCOMMANDS: SafeSubcommands = READONLY_SUBCOMMANDS;

/**
 * Decide how the plan clamp treats a tool call. The bridge calls this BEFORE
 * the dangerous/bypass check and the rule engine:
 *   block     → return {block:true, reason} (edit/write/subagent or unsafe bash)
 *   pass      → continue to the normal gates (read-only builtins, allowlisted bash)
 *   floor-ask → run the rule engine but clamp any `allow` to `ask` (MCP/unknown)
 */
/** What the bridge actually does, once a delegation's boundary is known. */
export type PlanVerdict =
  | { kind: "block"; reason: string }
  | { kind: "floor-ask" }
  | { kind: "pass" };

/**
 * Collapse a PlanGate into a verdict, resolving `needs-boundary` against the
 * child's actual reach.
 *
 * This lives HERE rather than in the bridge for one concrete reason:
 * `happyvibe-bridge.ts` is in neither tsconfig, so an exhaustiveness check
 * written there is decorative — verified by deleting a branch and watching the
 * typecheck stay green. `hv-plan.ts` IS typechecked, so the `never` below is real:
 * a future PlanGate variant nobody handles fails `npm run build` instead of
 * falling through to the permissive path in a mode whose whole promise is that it
 * is read-only.
 */
export function resolvePlanVerdict(
  g: PlanGate,
  boundary: { agent: string; tools: readonly string[] } | undefined,
): PlanVerdict {
  switch (g.kind) {
    case "block":
    case "floor-ask":
    case "pass":
      return g;
    case "needs-boundary": {
      // §23: read-only delegation is allowed while planning; anything wider is
      // not, because the calm banner would otherwise be lying.
      // Round 29: it passes — a read-only child does nothing the session itself cannot
      // do without asking, so the bridge runs it as a safe default here too.
      if (boundary && isReadOnlyBoundary(boundary.tools)) return { kind: "pass" };
      const why = boundary
        ? `'${boundary.agent}' can use ${writeCapableIn(boundary.tools).join(", ") || "tools outside the read-only set"}`
        : "its reach could not be resolved";
      return {
        kind: "block",
        reason: `Plan mode is read-only — ${why}. Delegate a read-only exploration instead, or leave plan mode to run it.`,
      };
    }
    default: {
      const unhandled: never = g;
      return unhandled;
    }
  }
}

export function gatePlanCall(toolName: string, input: unknown, opts?: { mcpReadOnly?: boolean }): PlanGate {
  // Checked FIRST so the intent is unmissable: `subagent` is deliberately absent
  // from BLOCKED_PLAN_TOOLS, and this is where that shows. Planning IS
  // exploration, and delegating a long codebase search to a read-only explorer is
  // the most useful thing a planning session can do — which the old clamp
  // forbade for a reason (§12, 2026-07-19) that the capability ceiling removed.
  if (isDelegationTool(toolName)) return { kind: "needs-boundary" };
  if (BLOCKED_PLAN_TOOLS.has(toolName)) {
    return { kind: "block", reason: `Plan mode is read-only — '${toolName}' is blocked. Explore and draft a plan; the user implements it later.` };
  }
  // isShellTool, not === "bash": a PowerShell session would otherwise fall through to
  // floor-ask, turning plan mode's block into a permission PROMPT for arbitrary shell.
  if (isShellTool(toolName)) {
    const cmd = readCommand(input);
    if (isSafeCommand(cmd, PLAN_SAFE_SUBCOMMANDS)) return { kind: "pass" };
    return { kind: "block", reason: `Plan mode blocks mutating or non-allowlisted shell commands.\nCommand: ${cmd}` };
  }
  // §13 (2026-10-05): a tool its MCP server marks read-only follows the RULES (checked after every block above, so a hint
  // can never lift one) while planning
  // instead of being clamped to ask. The server can lie, so this only lifts the clamp — an
  // allow still has to come from a rule the user wrote.
  if (opts?.mcpReadOnly) return { kind: "pass" };
  if (PLAN_PASS_TOOLS.has(toolName)) return { kind: "pass" };
  return { kind: "floor-ask" };
}

// ── 3-phase planning prompt (appended in before_agent_start) ─────────────────

const PLAN_PROMPT_MARKER = "[HAPPYVIBE PLAN MODE ACTIVE]";

export function buildPlanPrompt(append = "", registeredTools?: Iterable<string>, agentShell: string = AGENT_SHELL, askUser = true): string {
  // A3 (Improve-prompts round, 2026-09-10) — the blocked list is DERIVED, and
  // filtered to tools that exist this session.
  //
  // It used to be re-typed prose beside the gate that decides it (§20
  // Principle 11's exact hazard — the same sentence is how "sub-agents are
  // blocked" stayed wrong for months after the capability ceiling allowed
  // them). And §26's rule holds here too: a prompt must never name a tool the
  // model does not have, which four of these are whenever their built-in group
  // is switched off. With no tool list given (the settings panel, unit tests)
  // the full set is shown, because that page is about what the mode does.
  const have = registeredTools ? new Set(registeredTools) : null;
  const blocked = [...BLOCKED_PLAN_TOOLS].filter((t) => !have || have.has(t));
  // §13 round 26: the shell and sub-agents can be switched off, so their clauses follow the
  // tools too. With no list (settings panel) both show, as the blocked list does.
  // The session's OWN shell: on macOS Pi registers an inactive powershell too, so "whichever
  // shell is registered" would name a tool the model cannot call.
  const shell = !have || have.has(agentShell) ? agentShell : undefined;
  const shellClause = shell ? `; ${shell} is limited to a\nread-only allowlist` : "";
  const delegateClause = !have || have.has("Agent")
    ? ` Delegating to a read-only sub-agent starts without asking, and it is the
most useful thing a planning session can do; a sub-agent that can change things needs the user's approval first.`
    : "";
  // 2026-10-10: Ask user can be off with Plan on, so the phases ask in the reply when it is.
  // `askUser` lets the settings panel (no tool list) show the variant the agent really gets.
  const ask = askUser && (!have || have.has("ask_user"));
  const phase2 = ask
    ? `- Use the ask_user tool for genuine decisions, tradeoffs, or missing product
  intent that exploration cannot resolve (1-4 concise questions, 2-4 real
  options each). If a high-impact ambiguity remains, ask rather than guess.`
    : `- Ask genuine decisions, tradeoffs, or missing product intent that
  exploration cannot resolve in your reply (1-4 concise questions, 2-4 real
  options each), then stop. If a high-impact ambiguity remains, ask rather
  than guess.`;
  const phase3 = ask
    ? `- Finish with plan_complete once no decision is open; if one is, ask it with
  ask_user. Do not end a turn by only announcing the plan — submit it.`
    : `- Finish with plan_complete once no decision is open; if one is, ask it in
  your reply and stop. Do not end a turn by only announcing the plan — submit it.`;
  const body = `${PLAN_PROMPT_MARKER}
# Plan Mode (read-only)

You are in Plan Mode: explore, ask, and produce a decision-complete
implementation plan the user will approve. The user implements it later, not
you. Blocked while planning: ${blocked.join(", ")}${shellClause}.${delegateClause}

## Phase 1 — Ground in the repository
- Explore first. Read files, search, inspect config, run read-only checks to
  resolve every discoverable fact before asking the user anything.
- Do not ask what the repository or system can answer.

## Phase 2 — Clarify intent
${phase2}

## Phase 3 — Finalize
${phase3}
- If the user later requests revisions, call plan_complete again with a
  complete replacement plan, not a delta.

## Required plan structure (Markdown)
- A clear \`# <title>\` heading and a short summary of the approach.
- Grouped behavior-level changes, not a file-by-file dump. Name the existing
  helpers the plan reuses, with paths.
- A \`## Tasks\` section as a GFM checklist (\`- [ ] …\`) — each task a discrete
  step; you will tick these off during implementation.
- A \`## Verification\` section describing how to confirm it worked (tests to run,
  behavior to observe) — this becomes the acceptance script.
- Explicit assumptions/defaults where you chose one.`;
  // Additive only: this cannot widen what the agent is allowed to do — enforcement
  // is gatePlanCall (BLOCKED_PLAN_TOOLS/PLAN_PASS_TOOLS/PLAN_SAFE_SUBCOMMANDS), not
  // this prompt text. A user append lands strictly after the built-in body, never
  // interleaved, and can't touch the marker above.
  const extra = append.trim();
  // X4: one delimiter family. The marker stays the first line INSIDE the
  // element — restorePlanState and the settings readout both look for it.
  return `<happyvibe_plan_mode>\n${extra ? `${body}\n\n${extra}` : body}\n</happyvibe_plan_mode>`;
}
