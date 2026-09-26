/**
 * hv-child-guard — HappyVibe's permission gate INSIDE a sub-agent child.
 *
 * Injected by `pi-runtime/bin/pi-node.sh` (POSIX) or `bin/pi-child.mjs` (Windows),
 * not by an agent's `extensions:` key.
 * That is upstream's own documented pattern for child bash policy and it has two
 * properties nothing else does: it reaches EVERY child with no per-agent
 * stamping, and a capability ceiling's `denyExtensions` cannot strip it, because
 * the wrapper runs after `pi-args` has finished building argv.
 *
 * It never prompts, and cannot — see hv-child-rules.ts. `ask` means deny here.
 *
 * Everything it needs already arrives for free: all three of pi-subagents' child
 * spawn sites do `{...process.env}`, so HV_RULES_FILE, HV_BYPASS and
 * HV_CHILD_AUDIT_DIR are inherited from the session's own Pi process.
 *
 * Deliberately NOT gated on `PI_SUBAGENT_CHILD`: this file is only ever loaded by
 * the children-only wrapper, and gating on an env var would mean a future rename
 * silently disables the whole gate rather than failing loudly.
 */
import * as fs from "node:fs";
import { containsPath, isAbsolutePath } from "./hv-paths";
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

/** Exported for the contract test — the audit row shape main ingests (FR7). */
export interface ChildAuditRow {
  ts: string;
  runId: string;
  tool: string;
  decision: "allow" | "deny";
  wouldHave: "allow" | "ask" | "deny";
  source: "child" | "bypass";
  summary: string;
}

/**
 * The child's OWN task file, taken from its own argv — never a pattern.
 *
 * pi-subagents hands the task to a child as a trailing `@<abs path>` positional
 * pointing at `<tmpdir>/pi-subagent-<rand>/task.md`. That used to happen only
 * for tasks over 8,000 chars, so we never met it; 0.63.0 (#1793, "keep macOS
 * subagent tasks out of argv") added `platform === "darwin"` to
 * `shouldDeliverTaskViaFile`, which makes it UNCONDITIONAL for every HappyVibe
 * user. There is no opt-out — `SubagentTaskDelivery` is `"auto" | "file"` and
 * `auto` resolves to file on darwin.
 *
 * The file lives outside the workspace, so the parent's rules resolve a read of
 * it to `ask`, and `ask` means deny in here — the child was refused its own
 * task and did nothing, while the audit row read as if the agent had tried to
 * snoop a temp file. Whether it surfaced at all depended on whether Pi expanded
 * the `@` itself or the model called `read` on the literal, so this failed
 * intermittently (measured 2 of 3 runs), which is worse than failing always.
 *
 * Read from argv rather than matched by shape ON PURPOSE. This exempts exactly
 * the one file this child was told to read: a sibling run's task.md is still
 * refused, and if upstream stops passing the positional the exemption never
 * arms rather than silently widening. Measured argv (child-guard-bridge, 0.64):
 *   … --system-prompt /var/…/pi-subagent-ltj8yX/writer.md
 *     @/var/…/pi-subagent-ltj8yX/task.md
 * Exported for the contract test.
 */
export function taskFileFromArgv(argv: readonly string[]): string | undefined {
  // Separator-agnostic (PRD §4, Windows round). The original matched `@/` and
  // `/task.md`, both POSIX-only, so on Windows the positional `@C:\…\task.md` was
  // never recognised — and an unrecognised task file is not a cosmetic miss: the
  // child's read of its OWN instructions then resolves against the parent's rules,
  // lands outside the workspace, and `ask` means DENY in here. The child is refused
  // the task it was spawned to do. pi-args only takes the file route on Windows for
  // tasks over 8,000 chars, which is what kept it rare rather than absent.
  //
  // `isAbsolutePath` is what the `@/` prefix was really testing — an absolute path,
  // never a relative `@sub/task.md`.
  const arg = argv.find((a) => a.startsWith("@") && isAbsolutePath(a.slice(1)) && /[\\/]task\.md$/.test(a));
  return arg ? path.resolve(arg.slice(1)) : undefined;
}

/** True for the one `read` that is pi-subagents' delivery mechanism, not agent behaviour. */
export function isOwnTaskRead(tool: string, input: Record<string, unknown>, taskFile: string | undefined): boolean {
  if (tool !== "read" || !taskFile) return false;
  const p = input.path;
  if (typeof p !== "string" || p === "") return false;
  return path.resolve(p) === taskFile;
}

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
}): { action: "allow" | "deny"; reason?: string; wouldHave: RuleAction } {
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
  if (d.action === "deny") return { action: "deny", reason: d.reason, wouldHave: d.wouldHave };
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
  pi.on("tool_call", (event) => {
    const tool = typeof event.toolName === "string" ? event.toolName : "tool";
    const input = (event.input ?? {}) as Record<string, unknown>;
    const d = guardDecision({ tool, input, boundary, rules, rulesReadable, bypass, workspace: process.cwd() });
    try {
      policy.audit({ tool, decision: d.action, wouldHave: d.wouldHave, summary: summarise(input), agentId: who?.agentId, type: who?.type, reason: d.reason });
    } catch {
      // An audit failure must NEVER change a permission outcome.
    }
    return d.action === "deny" ? { block: true, reason: d.reason } : undefined;
  });
}

export default function hvChildGuard(pi: {
  on: (event: string, handler: (event: { toolName?: string; input?: unknown }) => unknown) => void;
}): void {
  // tintinweb (PRD §12, 2026-09-26): an in-process child finds the bridge's policy on
  // globalThis. A separate nicobailon child process never does, and keeps the env path below.
  const policy = childPolicy();
  if (policy) {
    inProcessGuard(pi, policy);
    return;
  }
  let rules: RulesFile = EMPTY_RULES;
  let rulesReadable = false;
  const file = process.env.HV_RULES_FILE;
  if (file) {
    try {
      rules = parseRulesFile(fs.readFileSync(file, "utf8"));
      rulesReadable = true;
    } catch {
      // Left false ON PURPOSE: unreadable rules fail CLOSED for gated tools
      // (hv-child-rules.ts). A missing file must never read as "no restrictions".
      rulesReadable = false;
    }
  }
  const bypass = process.env.HV_BYPASS === "1";
  // PI_SUBAGENT_RUN_ID is set by pi-args for every child (pi-args.ts:783). The pid
  // fallback keeps rows attributable if upstream ever renames it — main joins
  // agent names by runId from the run card it already holds, so a pid-named file
  // degrades the join rather than losing the audit.
  const runId = process.env.PI_SUBAGENT_RUN_ID || `pid-${process.pid}`;
  const auditDir = process.env.HV_CHILD_AUDIT_DIR;

  const record = (row: ChildAuditRow): void => {
    if (!auditDir) return;
    try {
      fs.mkdirSync(auditDir, { recursive: true, mode: 0o700 });
      fs.appendFileSync(path.join(auditDir, `${runId}.jsonl`), `${JSON.stringify(row)}\n`, { mode: 0o600 });
    } catch {
      // An unwritable audit file must NEVER change a permission outcome. Losing a
      // record is bad; letting a write failure decide policy is worse.
    }
  };

  const taskFile = taskFileFromArgv(process.argv);
  // pi-subagents' own per-run output location, handed over by spawn.ts. It is
  // outside the workspace by design and main both creates and sweeps it, so it
  // is app state rather than a place the agent chose. Unset ⇒ no exemption.
  const artifactsDir = process.env.HV_ARTIFACTS_DIR;
  const writeRoots = artifactsDir ? [artifactsDir] : [];

  pi.on("tool_call", (event) => {
    const tool = typeof event.toolName === "string" ? event.toolName : "tool";
    const input = (event.input ?? {}) as Record<string, unknown>;
    // Not a permission event: this is how the child RECEIVES its instructions.
    // Unaudited on purpose — a row per delegation saying "read task.md, allow"
    // is infrastructure noise in a log a user reads to see what the agent did.
    if (isOwnTaskRead(tool, input, taskFile)) return undefined;
    const workspace = process.cwd();
    const d = childDecision(
      rules,
      { tool, input, workspace, caseInsensitivePaths: CI_PATHS },
      { bypass, rulesReadable },
    );
    // PRD §12: a sub-agent's work belongs in the workspace. Applied AFTER
    // childDecision so `wouldHave` still reports what the RULES said (the
    // engine's RuleAction, per the audit-row convention) while `decision`
    // reports what confinement did. Yields to bypass, like every other gate
    // here — "bypass means bypass" (PRD §10), and a bypassed child already has
    // bash.
    const escaped =
      bypass || d.action === "deny" ? undefined : escapesWorkspace(tool, input, workspace, writeRoots);
    record({
      ts: new Date().toISOString(),
      runId,
      tool,
      decision: escaped ? "deny" : d.action,
      wouldHave: d.wouldHave,
      source: bypass ? "bypass" : "child",
      // Factual, and capped: the parent's audit summary convention (§13 — a user
      // reviews what RAN, never the model's own words about it).
      //
      // `path` is hoisted to the FRONT. The cap is 300 chars and a write's
      // `content` can be thousands, so a plain JSON.stringify put the one field
      // a reviewer needs — WHICH FILE — past the cut every time. Observed on a
      // real delegation: two write rows, one allowed and one denied, and neither
      // showed a path. An audit row that cannot say what it acted on is not an
      // audit row.
      summary: summarise(input),
    });
    if (escaped) {
      // Names the workspace, not just the refusal. Pi feeds a block reason back
      // to the model, so a refusal that says WHERE to write turns a dead turn
      // into a corrected retry — measured: without the second sentence the
      // child gave up after one attempt and the user still got no file.
      return {
        block: true,
        reason:
          `${tool} outside the workspace is not allowed: ${escaped}. ` +
          `Write inside the workspace instead — it is ${workspace}, and a relative path lands there. ` +
          `Never write next to your task file; that directory is temporary and the user cannot see it.`,
      };
    }
    return d.action === "deny" ? { block: true, reason: d.reason } : undefined;
  });
}
