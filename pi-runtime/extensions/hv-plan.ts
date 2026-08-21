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
const BLOCKED_PLAN_TOOLS = new Set(["edit", "write", "multi_edit", "terminal_run", "browser_click", "browser_type", "browser_evaluate"]);
/** Read-only tools that pass straight through the plan gate. */
const PLAN_PASS_TOOLS = new Set([
  // use_skill only returns an ALREADY-APPROVED SKILL.md's text (spawn-time trust
  // gate, §14) — strictly a read. Without it, planning raised a permission modal
  // on every skill load.
  "read", "grep", "glob", "list", "ls", "find", "ask_user", "use_skill", "plan_complete", "plan_start", "plan_status_update",
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
]);

import { isReadOnlyBoundary, writeCapableIn } from "./hv-subagent-boundary";

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

/**
 * Read-only extras enabled by default in Plan Mode (the ported policy leaves
 * these opt-in; all are read-only so they're safe for planning).
 */
export const PLAN_SAFE_SUBCOMMANDS: SafeSubcommands = {
  git: ["rev-parse", "blame", "describe", "merge-base", "ls-tree", "cat-file"],
  gh: ["pr view", "pr list", "issue view", "issue list"],
};

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
      if (boundary && isReadOnlyBoundary(boundary.tools)) return { kind: "floor-ask" };
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

export function gatePlanCall(toolName: string, input: unknown): PlanGate {
  // Checked FIRST so the intent is unmissable: `subagent` is deliberately absent
  // from BLOCKED_PLAN_TOOLS, and this is where that shows. Planning IS
  // exploration, and delegating a long codebase search to a read-only explorer is
  // the most useful thing a planning session can do — which the old clamp
  // forbade for a reason (§12, 2026-07-19) that the capability ceiling removed.
  if (toolName === "subagent") return { kind: "needs-boundary" };
  if (BLOCKED_PLAN_TOOLS.has(toolName)) {
    return { kind: "block", reason: `Plan mode is read-only — '${toolName}' is blocked. Explore and draft a plan; the user implements it later.` };
  }
  if (toolName === "bash") {
    const cmd = readCommand(input);
    if (isSafeCommand(cmd, PLAN_SAFE_SUBCOMMANDS)) return { kind: "pass" };
    return { kind: "block", reason: `Plan mode blocks mutating or non-allowlisted shell commands.\nCommand: ${cmd}` };
  }
  if (PLAN_PASS_TOOLS.has(toolName)) return { kind: "pass" };
  return { kind: "floor-ask" };
}

// ── 3-phase planning prompt (appended in before_agent_start) ─────────────────

const PLAN_PROMPT_MARKER = "[HAPPYVIBE PLAN MODE ACTIVE]";

export function buildPlanPrompt(append = ""): string {
  const body = `${PLAN_PROMPT_MARKER}
# Plan Mode (read-only)

You are in Plan Mode. You may explore and ask, but you CANNOT modify anything —
file edits, writes, installs, commits, and sub-agents are blocked, and shell is
limited to read-only inspection. Produce a decision-complete implementation plan
that the user will approve; do NOT implement it.

## Phase 1 — Ground in the repository
- Explore first. Read files, search, inspect config, run read-only checks to
  resolve every discoverable fact before asking the user anything.
- Do not ask what the repository or system can answer.

## Phase 2 — Clarify intent
- Use the ask_user tool for genuine decisions, tradeoffs, or missing product
  intent that exploration cannot resolve (1-4 concise questions, 2-4 real
  options each). If a high-impact ambiguity remains, ask — do not guess.

## Phase 3 — Finalize
- When the plan leaves no implementation decisions open, call plan_complete
  ALONE as your final action, passing the complete plan as Markdown. Never end a
  turn merely announcing you will present the plan — submit it with plan_complete.
- Every turn must end EITHER with an ask_user question OR with plan_complete.

## Required plan structure (Markdown)
- A clear \`# <title>\` heading.
- A short summary of the approach.
- Grouped behavior-level changes (not a file-by-file dump).
- A \`## Tasks\` section as a GFM checklist (\`- [ ] …\`) — each task a discrete
  step; you will tick these off during implementation.
- A \`## Verification\` section describing how to confirm it worked (tests to run,
  behavior to observe) — this becomes the acceptance script.
- Explicit assumptions/defaults where you chose one.

If the user later requests revisions, call plan_complete again with a complete
replacement plan (not a delta).`;
  // Additive only: this cannot widen what the agent is allowed to do — enforcement
  // is gatePlanCall (BLOCKED_PLAN_TOOLS/PLAN_PASS_TOOLS/PLAN_SAFE_SUBCOMMANDS), not
  // this prompt text. A user append lands strictly after the built-in body, never
  // interleaved, and can't touch the marker above.
  const extra = append.trim();
  return extra ? `${body}\n\n${extra}` : body;
}

// ═══════════════════════════════════════════════════════════════════════════
// Bash allowlist — PORTED from @narumitw/pi-plan-mode src/tool-policy.ts (MIT).
// Fail-closed: read-only commands + reviewed git/gh/npm queries only; rejects
// redirects, substitutions, subshells, background jobs, mutating flags, and any
// chain with an unsafe segment. Ported verbatim; do not relax.
// ═══════════════════════════════════════════════════════════════════════════

export interface SafeSubcommands {
  git?: string[];
  gh?: string[];
}

const MUTATING_COMMANDS = new Set([
  "rm", "rmdir", "mv", "cp", "mkdir", "touch", "chmod", "chown", "chgrp", "ln",
  "tee", "truncate", "dd", "sudo", "su", "kill", "pkill", "killall", "reboot",
  "shutdown", "vim", "vi", "nano", "emacs", "code", "subl",
]);
const READ_ONLY_COMMANDS = new Set([
  "cat", "head", "tail", "grep", "find", "ls", "pwd", "echo", "printf", "wc",
  "sort", "uniq", "diff", "file", "stat", "du", "df", "tree", "which", "whereis",
  "type", "printenv", "uname", "whoami", "id", "date", "uptime", "ps", "jq",
  "rg", "fd", "bat", "eza",
]);

export function readCommand(input: unknown): string {
  const command = input as { command?: unknown } | undefined;
  return typeof command?.command === "string" ? command.command : "";
}

export function isSafeCommand(command: string, safeSubcommands: SafeSubcommands = {}): boolean {
  const segments = splitShellSegments(command);
  return (
    segments !== undefined &&
    segments.length > 0 &&
    segments.every((segment) => isSafeSegment(segment, safeSubcommands))
  );
}

function splitShellSegments(command: string): string[] | undefined {
  const trimmed = command.trim();
  if (!trimmed || /[\n\r`]/.test(trimmed)) return undefined;

  const segments: string[] = [];
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ">" || character === "<" || character === "(" || character === ")") {
      return undefined;
    }
    const next = trimmed[index + 1];
    if (character === "&" && next !== "&") return undefined;
    const separatorLength =
      character === ";" || character === "|"
        ? next === character
          ? 2
          : 1
        : character === "&" && next === "&"
          ? 2
          : 0;
    if (separatorLength === 0) continue;
    const segment = trimmed.slice(start, index).trim();
    if (!segment) return undefined;
    segments.push(segment);
    index += separatorLength - 1;
    start = index + 1;
  }
  if (quote || escaped) return undefined;
  const finalSegment = trimmed.slice(start).trim();
  if (!finalSegment) return undefined;
  segments.push(finalSegment);
  return segments;
}

function isSafeSegment(segment: string, safeSubcommands: SafeSubcommands): boolean {
  if (hasShellExpansion(segment) || /(^|\s)[A-Za-z_][A-Za-z0-9_]*=/.test(segment)) {
    return false;
  }
  const tokens = shellWords(segment);
  if (!tokens || tokens.length === 0) return false;
  const command = tokens[0]?.toLowerCase();
  if (!command || MUTATING_COMMANDS.has(command)) return false;
  const args = tokens.slice(1);
  if (!hasSafeArguments(command, args)) return false;
  if (READ_ONLY_COMMANDS.has(command)) return true;
  return isSafeStructuredCommand(command, args, safeSubcommands);
}

function hasShellExpansion(segment: string): boolean {
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of segment) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "$" && quote === '"') return true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (["$", "*", "?", "[", "{"].includes(character)) return true;
  }
  return false;
}

function shellWords(segment: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of segment) {
    if (escaped) {
      word += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (/\s/.test(character)) {
      if (word) words.push(word);
      word = "";
    } else word += character;
  }
  if (quote || escaped) return undefined;
  if (word) words.push(word);
  return words;
}

function hasSafeArguments(command: string, args: string[]): boolean {
  const forbidden = new Set(["-i", "--in-place", "--fix", "--write", "-delete", "--delete"]);
  if (args.some((argument) => forbidden.has(argument))) return false;
  if (
    command === "sed" &&
    args.some(
      (argument) =>
        argument.startsWith("--in-place=") ||
        (/^-[^-]+/.test(argument) && argument.slice(1).includes("i")),
    )
  ) {
    return false;
  }
  if (
    command === "find" &&
    args.some((argument) =>
      ["-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(argument),
    )
  ) {
    return false;
  }
  if (command === "date" && args.some((argument) => argument === "-s" || argument.startsWith("--set"))) {
    return false;
  }
  if (
    (command === "sort" || command === "tree") &&
    args.some(
      (argument) =>
        argument === "-o" ||
        (argument.startsWith("-o") && !argument.startsWith("--")) ||
        argument.startsWith("--output"),
    )
  ) {
    return false;
  }
  if (
    command === "sort" &&
    args.some(
      (argument) =>
        argument === "-T" ||
        (argument.startsWith("-T") && argument.length > 2) ||
        argument.startsWith("--temporary-directory") ||
        argument.startsWith("--compress-program"),
    )
  ) {
    return false;
  }
  if (
    command === "diff" &&
    args.some((argument) => argument === "--output" || argument.startsWith("--output="))
  ) {
    return false;
  }
  if (command === "uniq" && args.filter((argument) => !argument.startsWith("-")).length > 1) {
    return false;
  }
  if (
    command === "fd" &&
    args.some((argument) =>
      ["-x", "-X", "--exec", "--exec-batch"].some((flag) => argument === flag || argument.startsWith(`${flag}=`)),
    )
  ) {
    return false;
  }
  if (command === "rg" && args.some((argument) => argument === "--pre" || argument.startsWith("--pre="))) {
    return false;
  }
  if (command === "bat" && args.some((argument) => argument === "--pager" || argument.startsWith("--pager="))) {
    return false;
  }
  return true;
}

type ArgumentValidator = (args: string[]) => boolean;
const allowReadOnlyArguments: ArgumentValidator = () => true;
const BUILTIN_GIT_VALIDATORS: Record<string, ArgumentValidator> = {
  status: allowReadOnlyArguments,
  log: isSafeGitLogArguments,
  diff: isSafeGitDiffArguments,
  show: requiresNoTextconv,
  branch: isSafeGitBranchArguments,
  remote: isSafeGitRemoteArguments,
  "ls-files": allowReadOnlyArguments,
  grep: isSafeGitGrepArguments,
};
const CONFIGURABLE_GIT_VALIDATORS: Record<string, ArgumentValidator> = {
  "rev-parse": allowReadOnlyArguments,
  blame: requiresNoTextconv,
  describe: allowReadOnlyArguments,
  "merge-base": allowReadOnlyArguments,
  "ls-tree": allowReadOnlyArguments,
  "cat-file": isSafeGitCatFileArguments,
};
const GH_VALIDATORS: Record<string, ArgumentValidator> = {
  "pr view": isSafeGhReadArguments,
  "pr list": isSafeGhReadArguments,
  "issue view": isSafeGhReadArguments,
  "issue list": isSafeGhReadArguments,
};

function isSafeStructuredCommand(command: string, args: string[], safeSubcommands: SafeSubcommands): boolean {
  if (command === "git") return isSafeGitCommand(args, safeSubcommands);
  if (command === "gh") return isSafeGhCommand(args, safeSubcommands);

  const subcommandIndex = args.findIndex((argument) => !argument.startsWith("-"));
  const subcommand = args[subcommandIndex]?.toLowerCase();
  const subcommandArgs = subcommandIndex >= 0 ? args.slice(subcommandIndex + 1) : [];
  if (command === "sed") {
    const script = args.find((argument) => !argument.startsWith("-"));
    return (
      Boolean(script) &&
      (args.includes("-n") || args.some((argument) => /^-[^-]*n[^-]*$/.test(argument))) &&
      /^\d+(,\d+)?p$/.test(script ?? "")
    );
  }
  if (["node", "python", "python3", "tsc", "biome", "ruff", "ty"].includes(command)) {
    if (args.includes("--version")) return true;
    return (
      command === "tsc" &&
      args.includes("--noEmit") &&
      !args.some(
        (argument) =>
          argument === "--incremental" ||
          argument.startsWith("--incremental=") ||
          argument === "--tsBuildInfoFile" ||
          argument.startsWith("--tsBuildInfoFile=") ||
          argument === "--generateTrace" ||
          argument.startsWith("--generateTrace="),
      )
    );
  }
  if (command === "npm") {
    if (subcommand === "audit" && subcommandArgs.includes("fix")) return false;
    if (["list", "ls", "view", "info", "search", "outdated", "audit", "test"].includes(subcommand ?? "")) {
      return true;
    }
    return subcommand === "run" && ["test", "check", "typecheck", "lint"].includes(args[1] ?? "");
  }
  if (["cargo", "go", "pytest", "vitest", "jest"].includes(command)) {
    return (
      ["test", "check"].includes(subcommand ?? "") || ["pytest", "vitest", "jest"].includes(command)
    );
  }
  return false;
}

function isSafeGitCommand(args: string[], safeSubcommands: SafeSubcommands): boolean {
  let subcommandIndex = 0;
  while (args[subcommandIndex] === "--no-pager") subcommandIndex += 1;
  const subcommand = args[subcommandIndex]?.toLowerCase();
  if (!subcommand || subcommand.startsWith("-")) return false;
  const subcommandArgs = args.slice(subcommandIndex + 1);
  const builtinValidator = BUILTIN_GIT_VALIDATORS[subcommand];
  const configuredValidator = CONFIGURABLE_GIT_VALIDATORS[subcommand];
  const configured = safeSubcommands.git?.includes(subcommand) === true;
  const validator = builtinValidator ?? (configured ? configuredValidator : undefined);
  return validator !== undefined && hasSafeGitArguments(subcommand, subcommandArgs) && validator(subcommandArgs);
}

function hasSafeGitArguments(subcommand: string, args: string[]): boolean {
  return !args.some(
    (argument) =>
      argument === "--help" ||
      argument === "--show-signature" ||
      argument.startsWith("--show-signature=") ||
      argument.includes("%G") ||
      argument === "--output" ||
      argument.startsWith("--output=") ||
      argument === "--ext-diff" ||
      argument.startsWith("--ext-diff=") ||
      argument === "--textconv" ||
      argument.startsWith("--textconv=") ||
      argument === "--paginate" ||
      argument === "--open-files-in-pager" ||
      argument.startsWith("--open-files-in-pager=") ||
      (subcommand === "grep" && (argument === "-O" || argument.startsWith("-O"))),
  );
}

function isSafeGitCatFileArguments(args: string[]): boolean {
  return !args.some(
    (argument) =>
      matchesLongOptionPrefix(argument, "--filters", "--fi") ||
      matchesLongOptionPrefix(argument, "--textconv", "--t"),
  );
}

function isSafeGitGrepArguments(args: string[]): boolean {
  return !args.some(
    (argument) =>
      matchesLongOptionPrefix(argument, "--textconv", "--textc") ||
      matchesLongOptionPrefix(argument, "--open-files-in-pager", "--op") ||
      matchesLongOptionPrefix(argument, "--ext-grep", "--ext"),
  );
}

function matchesLongOptionPrefix(argument: string, option: string, shortest: string): boolean {
  const optionName = argument.split("=", 1)[0] ?? "";
  return optionName.length >= shortest.length && option.startsWith(optionName);
}

function isSafeGitDiffArguments(args: string[]): boolean {
  return args.includes("--check") || (args.includes("--no-ext-diff") && args.includes("--no-textconv"));
}

function isSafeGitLogArguments(args: string[]): boolean {
  if (args.includes("--no-textconv")) return true;
  return !args.some(requiresTextconvGuardForGitLog);
}

function requiresTextconvGuardForGitLog(argument: string): boolean {
  return (
    argument === "-p" ||
    argument.startsWith("-p") ||
    argument === "-u" ||
    argument.startsWith("-U") ||
    argument === "-c" ||
    argument === "--patch" ||
    argument.startsWith("--patch=") ||
    argument.startsWith("--patch-with-") ||
    argument === "--unified" ||
    argument.startsWith("--unified=") ||
    argument === "--binary" ||
    argument === "--cc" ||
    argument === "--remerge-diff" ||
    argument.startsWith("-S") ||
    argument.startsWith("-G") ||
    argument === "--find-object" ||
    argument.startsWith("--find-object=")
  );
}

function requiresNoTextconv(args: string[]): boolean {
  return args.includes("--no-textconv");
}

function isSafeGitBranchArguments(args: string[]): boolean {
  if (args.some((argument) => !argument.startsWith("-"))) return false;
  return !args.some(
    (argument) =>
      /^-[^-]*[dDmMcCu]/.test(argument) ||
      matchesLongOptionPrefix(argument, "--delete", "--del") ||
      matchesLongOptionPrefix(argument, "--move", "--mov") ||
      matchesLongOptionPrefix(argument, "--copy", "--cop") ||
      matchesLongOptionPrefix(argument, "--edit-description", "--e") ||
      matchesLongOptionPrefix(argument, "--unset-upstream", "--u") ||
      matchesLongOptionPrefix(argument, "--set-upstream-to", "--set-u") ||
      matchesLongOptionPrefix(argument, "--create-reflog", "--creat"),
  );
}

function isSafeGitRemoteArguments(args: string[]): boolean {
  const actionIndex = args.findIndex((argument) => !argument.startsWith("-"));
  if (actionIndex < 0) return true;
  const action = args[actionIndex];
  if (action === "get-url") return true;
  if (action !== "show") return false;

  const showArgs = args.slice(actionIndex + 1);
  if (showArgs.includes("--")) return false;
  const remotes = showArgs.filter((argument) => !argument.startsWith("-"));
  return remotes.length === 0 || (remotes.length === 1 && showArgs.includes("-n"));
}

function isSafeGhCommand(args: string[], safeSubcommands: SafeSubcommands): boolean {
  const group = args[0]?.toLowerCase();
  const action = args[1]?.toLowerCase();
  if (!group || !action || group.startsWith("-") || action.startsWith("-")) return false;
  const path = `${group} ${action}`;
  if (!safeSubcommands.gh?.includes(path)) return false;
  const validator = GH_VALIDATORS[path];
  return validator?.(args.slice(2)) ?? false;
}

function isSafeGhReadArguments(args: string[]): boolean {
  return !args.some(isUnsafeGhReadArgument) && hasGhJsonOutput(args);
}

function isUnsafeGhReadArgument(argument: string): boolean {
  return (
    argument.startsWith("-w") ||
    argument === "--web" ||
    argument.startsWith("--web=") ||
    argument === "--browser" ||
    argument.startsWith("--browser=") ||
    argument === "--paginate" ||
    argument === "--pager" ||
    argument.startsWith("--pager=") ||
    argument === "--output" ||
    argument.startsWith("--output=")
  );
}

function hasGhJsonOutput(args: string[]): boolean {
  let hasJson = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return false;
      hasJson = true;
      index += 1;
    } else if (argument.startsWith("--json=")) {
      if (argument === "--json=") return false;
      hasJson = true;
    }
  }
  return hasJson;
}
