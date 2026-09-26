/**
 * The seam between HappyVibe and tintinweb's in-process children (PRD §3/§12,
 * 2026-09-26). IMPORT-FREE on purpose: the bridge publishes it, the child guard
 * reads it, and tests import it — none may drag anything else along.
 *
 * Two symbols, two owners:
 *  - CHILD_POLICY is OURS. The bridge sets it; the owned patch (scripts/tintinweb-hunks.mjs,
 *    P1/P3) reads it every time a child is built. Under HV_HOST=1 a child built while it
 *    is absent FAILS ("child policy missing") rather than loading with no guard.
 *  - CHILD_SPAWN is THEIRS, added by the patch (P3-context): a getter for the child
 *    currently being constructed. It is only set while the child's resource loader
 *    runs, so the guard must read it at FACTORY time and keep what it read.
 */

export const CHILD_POLICY = Symbol.for("hv:child-policy");
export const CHILD_SPAWN = Symbol.for("pi-subagents:child-spawn");

/** Who a child is: tintinweb's record id and agent type. */
export interface ChildSpawnInfo {
  agentId?: string;
  type?: string;
}

/** One child tool-call decision, reported to the parent for its audit log. */
export interface PolicyAuditRow {
  tool: string;
  decision: "allow" | "deny";
  wouldHave: "allow" | "ask" | "deny";
  summary: string;
  agentId?: string;
  type?: string;
  reason?: string;
}

/** A child's `ask`, raised on the parent's channel (Phase 4). */
export interface ChildAsk {
  agentId?: string;
  type?: string;
  tool: string;
  permTool: string;
  summary: string;
}

export interface ChildPolicy {
  /** Absolute paths of the ONLY extensions a child loads (the guard). */
  extensionPaths(): string[];
  /** The approved ∩ enabled ∩ active skill dirs — the only skills a child loads. */
  skillPaths(): string[];
  /** A reason to refuse building this child, or undefined to allow it. */
  refuseSpawn(type: string): string | undefined;
  /** The tools the user approved for this agent type; the read-only floor when none. */
  boundaryFor(type: string | undefined): readonly string[];
  /** Report one decision to the parent's audit log. */
  audit(row: PolicyAuditRow): void;
  /** Phase 4: does the PARENT already hold a session grant for this rule name? */
  hasSessionGrant?(permTool: string): boolean;
  /** Phase 4: ask the human on the parent's channel. */
  ask?(req: ChildAsk): Promise<"allow" | "allow-run" | "deny">;
}

type SymbolBag = Record<symbol, unknown>;

export const childPolicy = (): ChildPolicy | undefined => (globalThis as SymbolBag)[CHILD_POLICY] as ChildPolicy | undefined;

export const setChildPolicy = (p: ChildPolicy | undefined): void => {
  (globalThis as SymbolBag)[CHILD_POLICY] = p;
};

export const currentChildSpawn = (): ChildSpawnInfo | undefined =>
  ((globalThis as SymbolBag)[CHILD_SPAWN] as (() => ChildSpawnInfo | undefined) | undefined)?.();
