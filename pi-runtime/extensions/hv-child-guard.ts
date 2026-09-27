/**
 * hv-child-guard — HappyVibe's permission gate INSIDE a sub-agent child.
 *
 * tintinweb builds every child in the parent's own Pi process, and the owned patch
 * (scripts/tintinweb-hunks.mjs, P3) loads exactly the extensions the bridge's child
 * policy names — this file, and nothing else the child's agent file asks for. So it
 * reaches EVERY child with no per-agent stamping.
 *
 * An `ask` inside the approved boundary is put to the human on the PARENT's channel
 * (policy.ask, §10 Phase 4); with no one to ask (a read-only scheduled run, an older
 * policy) it stays a deny, as hv-child-rules.ts describes.
 */
import * as fs from "node:fs";
import { containsPath } from "./hv-paths";
import * as path from "node:path";
import { EMPTY_RULES, parseRulesFile, SAFE_TOOLS, type RuleAction, type RulesFile } from "./hv-rules";
import { childDecision } from "./hv-child-rules";
import { childPolicy, currentChildSpawn, type ChildPolicy } from "./hv-child-policy";

/**
 * PRD §4 (Windows round): the filesystem is case-insensitive on win32, so every path
 * a rule inspects folds case and separators first. Read here rather than inside the
 * engine, which stays import-free because the renderer loads it too.
 */
const CI_PATHS = process.platform === "win32";

/**
 * Pi's own fs-writing builtins that take a `path`, and the ONLY tools this
 * confinement can honestly cover.
 *
 * Derived from Pi's registrations, not guessed: `write.js` and `edit.js` both
 * declare `path: Type.String()` (edit's is `editSchema`, alongside `edits[]`).
 * `bash` is deliberately absent — it is the one fs writer that cannot be
 * path-confined, which is a documented limit of the gate, not an oversight
 * here. tests/child-write-confine.test.ts pins the derivation.
 */
export const CONFINED_WRITE_TOOLS = new Set(["write", "edit"]);

/** realpath the nearest EXISTING ancestor, then re-attach the rest. */
function resolveThroughLinks(target: string): string {
  let head = target;
  const tail: string[] = [];
  for (;;) {
    try {
      // `.native` expands Windows 8.3 SHORT NAMES, which the plain call leaves alone
      // (`C:\PROGRA~1` stays `C:\PROGRA~1`). The child's task file lives under TEMP,
      // which is exactly where Windows hands out short names — so without this the
      // exemption compares two spellings of one path and the child is refused its own
      // instructions. Its own copy because this tree is vendored and loads inside Pi.
      const real = fs.realpathSync.native ? fs.realpathSync.native(head) : fs.realpathSync(head);
      return path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(head);
      // Reached the filesystem root without finding anything that exists.
      if (parent === head) return target;
      tail.push(path.basename(head));
      head = parent;
    }
  }
}

/**
 * The resolved path a write would land on, IF it escapes the workspace.
 *
 * A sub-agent's work belongs in the workspace (PRD §12). Nothing enforced that:
 * `childDecision` matches on the TOOL NAME only, so a rule of
 * `{layer:"tool", pattern:"write", action:"allow"}` reached the whole
 * filesystem. The hole was structural and pre-dated any pin, but 0.63's task
 * file is what made a child exercise it — once the child could read
 * `<tmpdir>/pi-subagent-<rand>/task.md`, the model started writing its OUTPUT
 * next to it. Measured: across 13 runs before the read exemption every write
 * was relative or inside the workspace; in the 6 runs after, two landed in
 * a `pi-subagent-<rand>` tempdir and the user's file simply was not there.
 *
 * Symlinks are resolved through the nearest existing ancestor, so a link
 * planted inside the workspace cannot be used to step outside it. A path that
 * is absent or not a string is left alone — that is a schema violation for Pi
 * to reject, and inventing a decision for it would be guessing.
 */
export function escapesWorkspace(
  tool: string,
  input: Record<string, unknown>,
  workspace: string,
  alsoAllowed: readonly string[] = [],
): string | undefined {
  if (!CONFINED_WRITE_TOOLS.has(tool)) return undefined;
  const p = input.path;
  if (typeof p !== "string" || p === "") return undefined;
  const target = resolveThroughLinks(path.resolve(workspace, p));
  const roots = [workspace, ...alsoAllowed]
    .filter((r) => typeof r === "string" && r !== "")
    .map((r) => resolveThroughLinks(path.resolve(r)));
  for (const root of roots) {
    // containsPath folds separators and case on win32 (PRD §4, Windows round): a
    // child writing to `c:/ws/out.md` is inside `C:\ws`, and a bare startsWith would
    // have let `C:\ws-evil` through on any platform.
    if (containsPath(root, target, CI_PATHS)) return undefined;
  }
  return target;
}

/**
 * Audit summary: the acted-on path first, then the rest, capped at 300.
 *
 * Exported for the contract test. Never reorders anything else — the row stays
 * factual JSON, this only guarantees the path survives the cap.
 */
export function summarise(input: Record<string, unknown>, cap = 300): string {
  const p = input.path;
  if (typeof p !== "string" || p === "") return JSON.stringify(input).slice(0, cap);
  const rest = { ...input };
  delete rest.path;
  const head = JSON.stringify({ path: p });
  if (head.length >= cap) return head.slice(0, cap);
  const tail = JSON.stringify(rest);
  // Splice the two objects back into one, so the row is still parseable JSON
  // whenever it fits, and a truncated one still begins with the path.
  return (tail === "{}" ? head : `${head.slice(0, -1)},${tail.slice(1)}`).slice(0, cap);
}

/**
 * The three §12 layers for one child tool call, composed in ONE place (PRD §12,
 * 2026-09-26 — tintinweb's in-process children):
 *
 *  1. the BOUNDARY the user approved for this agent — a tool outside it is refused
 *     whatever the rules say, and under bypass too: bypass skips prompts, it does
 *     not widen what a delegation was approved to reach (the nicobailon ceiling held
 *     under bypass the same way);
 *  2. the rule engine with ask→deny (`childDecision`) — Phase 4 turns the ask into a
 *     prompt on the parent's channel;
 *  3. write confinement (`escapesWorkspace`), after the rules so `wouldHave` still
 *     reports what the RULES said.
 */
export function guardDecision(args: {
  tool: string;
  input: Record<string, unknown>;
  boundary: readonly string[];
  rules: RulesFile;
  rulesReadable: boolean;
  bypass: boolean;
  workspace: string;
  writeRoots?: readonly string[];
}): { action: "allow" | "deny"; reason?: string; wouldHave: RuleAction; askable?: { grantable: boolean } } {
  const { tool, input, workspace } = args;
  const d = childDecision(
    args.rules,
    { tool, input, workspace, caseInsensitivePaths: CI_PATHS },
    { bypass: args.bypass, rulesReadable: args.rulesReadable },
  );
  if (!SAFE_TOOLS.has(tool) && !args.boundary.includes(tool)) {
    return {
      action: "deny",
      wouldHave: d.wouldHave,
      reason:
        `Blocked: '${tool}' is outside the boundary approved for this sub-agent (it may use: ${args.boundary.join(", ") || "nothing"}). ` +
        "Do not retry it and do not work around it. Finish what you can with the tools you have and report what you " +
        "could not do, so the main session can run it where each call is checked individually.",
    };
  }
  if (d.action === "deny") {
    // Only a genuine rules `ask` (not an unreadable-rules fail-close, not a deny) may be put
    // to the human — and a parent session grant may cover it only when no ask RULE decided.
    const askable = d.wouldHave === "ask" && args.rulesReadable && d.source !== undefined
      ? { grantable: d.source === "default" || d.source === "outside-workspace" }
      : undefined;
    return { action: "deny", reason: d.reason, wouldHave: d.wouldHave, ...(askable ? { askable } : {}) };
  }
  const escaped = args.bypass ? undefined : escapesWorkspace(tool, input, workspace, args.writeRoots ?? []);
  if (escaped) {
    return {
      action: "deny",
      wouldHave: d.wouldHave,
      reason:
        `${tool} outside the workspace is not allowed: ${escaped}. ` +
        `Write inside the workspace instead — it is ${workspace}, and a relative path lands there.`,
    };
  }
  return { action: "allow", wouldHave: d.wouldHave };
}

/** Rules as the child sees them: read once, when the child is built. Unreadable ⇒ fail closed. */
function readRules(): { rules: RulesFile; rulesReadable: boolean } {
  const file = process.env.HV_RULES_FILE;
  if (!file) return { rules: EMPTY_RULES, rulesReadable: false };
  try {
    return { rules: parseRulesFile(fs.readFileSync(file, "utf8")), rulesReadable: true };
  } catch {
    return { rules: EMPTY_RULES, rulesReadable: false };
  }
}

/**
 * The guard inside a tintinweb child (same process as the bridge). WHO the child is
 * and WHAT it was approved for are read at FACTORY time: the patch's child-spawn store
 * is only set while the child's loader runs, and pinning the boundary then means a
 * later approval can never widen a child that is already running.
 */
function inProcessGuard(
  pi: { on: (event: string, handler: (event: { toolName?: string; input?: unknown }) => unknown) => void },
  policy: ChildPolicy,
): void {
  const who = currentChildSpawn();
  const boundary = [...policy.boundaryFor(who?.type)];
  const { rules, rulesReadable } = readRules();
  const bypass = process.env.HV_BYPASS === "1";
  // §35: a read-only scheduled run has nobody to answer, so an ask stays a deny.
  const canAsk = process.env.HV_READONLY !== "1" && typeof policy.ask === "function";
  // "Allow for this run": per CHILD (this factory runs once per child), so it dies with the run.
  const runGrants = new Set<string>();
  const report = (tool: string, input: Record<string, unknown>, decision: "allow" | "deny", wouldHave: RuleAction, reason?: string): void => {
    try {
      policy.audit({ tool, decision, wouldHave, summary: summarise(input), agentId: who?.agentId, type: who?.type, reason });
    } catch {
      // An audit failure must NEVER change a permission outcome.
    }
  };
  pi.on("tool_call", async (event) => {
    const tool = typeof event.toolName === "string" ? event.toolName : "tool";
    const input = (event.input ?? {}) as Record<string, unknown>;
    const d = guardDecision({ tool, input, boundary, rules, rulesReadable, bypass, workspace: process.cwd() });
    if (d.action === "deny" && d.askable && canAsk) {
      const covered = runGrants.has(tool) || (d.askable.grantable && policy.hasSessionGrant?.(tool) === true);
      const answer = covered
        ? "allow"
        : await policy.ask!({ agentId: who?.agentId, type: who?.type, tool, permTool: tool, summary: summarise(input), input }).catch(() => "deny" as const);
      if (answer === "allow-run") runGrants.add(tool);
      if (answer !== "deny") {
        report(tool, input, "allow", d.wouldHave);
        return undefined;
      }
      const reason = `The user denied '${tool}' for this sub-agent. Do not retry it; finish what you can and report what you could not do.`;
      report(tool, input, "deny", d.wouldHave, reason);
      return { block: true, reason };
    }
    report(tool, input, d.action, d.wouldHave, d.reason);
    return d.action === "deny" ? { block: true, reason: d.reason } : undefined;
  });
}

export default function hvChildGuard(pi: {
  on: (event: string, handler: (event: { toolName?: string; input?: unknown }) => unknown) => void;
}): void {
  // The bridge publishes the policy on globalThis before any child exists. Without it
  // (a load order nobody intended) nothing can say what this child was approved for,
  // so every call is refused rather than run ungoverned.
  const policy = childPolicy();
  if (policy) {
    inProcessGuard(pi, policy);
    return;
  }
  pi.on("tool_call", () => ({
    block: true,
    reason: "HappyVibe: this sub-agent has no permission policy, so none of its tool calls can run.",
  }));
}
