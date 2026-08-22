/**
 * hv-child-guard — HappyVibe's permission gate INSIDE a sub-agent child.
 *
 * Injected by `pi-runtime/bin/pi-node.sh`, not by an agent's `extensions:` key.
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
import * as path from "node:path";
import { EMPTY_RULES, parseRulesFile, type RulesFile } from "./hv-rules";
import { childDecision } from "./hv-child-rules";

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

export default function hvChildGuard(pi: {
  on: (event: string, handler: (event: { toolName?: string; input?: unknown }) => unknown) => void;
}): void {
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

  pi.on("tool_call", (event) => {
    const tool = typeof event.toolName === "string" ? event.toolName : "tool";
    const input = (event.input ?? {}) as Record<string, unknown>;
    const d = childDecision(rules, { tool, input, workspace: process.cwd() }, { bypass, rulesReadable });
    record({
      ts: new Date().toISOString(),
      runId,
      tool,
      decision: d.action,
      wouldHave: d.wouldHave,
      source: bypass ? "bypass" : "child",
      // Factual, and capped: the parent's audit summary convention (§13 — a user
      // reviews what RAN, never the model's own words about it).
      summary: JSON.stringify(input).slice(0, 300),
    });
    return d.action === "deny" ? { block: true, reason: d.reason } : undefined;
  });
}
