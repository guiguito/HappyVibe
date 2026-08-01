import fs from "node:fs";
import path from "node:path";
import { listDir, resolveInWorkspace } from "./files";
import {
  buildPlanFile, parsePlanFile, planSlug, withPlanStatus, type ParsedPlan, type PlanStatus,
} from "../../pi-runtime/extensions/hv-plan";

/**
 * §23 Plan Mode — plan-file writer (main process). The bridge NEVER writes the
 * plan file (it's read-only while planning); the app does, path-confined and
 * audited, mirroring agentsMd.ts. The plan lives at
 * `.agents/plans/NNN-<slug>.md` with front-matter status + a Tasks checklist.
 *
 * Numbering is serialized through a module-level promise chain so parallel
 * sessions in one workspace never collide.
 * ponytail: global write queue, fine at human plan rates.
 */

const PLAN_DIR = ".agents/plans";

let writeQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => T): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => undefined);
  return run;
}

function nextPlanNumber(dir: string): number {
  let max = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = /^(\d+)-/.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    /* dir may not exist yet */
  }
  return max + 1;
}

export interface WrittenPlan {
  relPath: string;
  parsed: ParsedPlan;
}

/**
 * Write (or revise) a plan file. If `existingRelPath` is given and present, its
 * body is overwritten while front-matter createdAt is preserved (a revision);
 * otherwise a new `NNN-<slug>.md` is created with status `draft`.
 * Returns the workspace-relative path.
 */
export function writePlanFile(
  registeredWorkspaces: string[],
  workspaceId: string,
  planMarkdown: string,
  now: string,
  existingRelPath?: string,
): Promise<string> {
  return serialize(() => {
    const dirAbs = resolveInWorkspace(registeredWorkspaces, workspaceId, PLAN_DIR);
    fs.mkdirSync(dirAbs, { recursive: true });

    let relPath = existingRelPath;
    let existing: string | undefined;
    if (relPath) {
      const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
      try {
        existing = fs.readFileSync(abs, "utf8");
      } catch {
        relPath = undefined; // vanished — fall through to a fresh file
      }
    }
    if (!relPath) {
      const n = String(nextPlanNumber(dirAbs)).padStart(3, "0");
      relPath = path.join(PLAN_DIR, `${n}-${planSlug(planMarkdown)}.md`);
    }

    const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
    fs.writeFileSync(abs, buildPlanFile(planMarkdown, "draft", now, existing), "utf8");
    return relPath;
  });
}

/** Rewrite only the status (+ updatedAt) of an existing plan file. */
export function setPlanStatus(
  registeredWorkspaces: string[],
  workspaceId: string,
  relPath: string,
  status: PlanStatus,
  now: string,
): Promise<ParsedPlan> {
  return serialize(() => {
    const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
    const md = fs.readFileSync(abs, "utf8");
    const next = withPlanStatus(md, status, now);
    fs.writeFileSync(abs, next, "utf8");
    return parsePlanFile(next);
  });
}

/** Read + parse a plan file (status + checkbox progress). Null if unreadable. */
export function readPlan(
  registeredWorkspaces: string[],
  workspaceId: string,
  relPath: string,
): ParsedPlan | null {
  try {
    const abs = resolveInWorkspace(registeredWorkspaces, workspaceId, relPath);
    return parsePlanFile(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Every plan file in a workspace with its parsed status + checkbox progress —
 * i.e. the `hv:plan-changed` payloads (minus workspaceId). Used both when a plan
 * dir change arrives from the watcher and once when a workspace starts being
 * watched: progress only moves on a watcher event, so boxes ticked while nobody
 * was watching would otherwise stay invisible until the next write.
 */
export function listPlanProgress(
  registeredWorkspaces: string[],
  workspaceId: string,
): { path: string; status: PlanStatus; done: number; total: number }[] {
  // Confinement first: a bare try/catch around listDir would also swallow an
  // unregistered/escaping workspace and report it as "no plans", hiding misuse.
  resolveInWorkspace(registeredWorkspaces, workspaceId, PLAN_DIR);
  let names: { name: string; kind: string }[];
  try {
    names = listDir(registeredWorkspaces, workspaceId, PLAN_DIR);
  } catch {
    return []; // no plans dir yet
  }
  const out: { path: string; status: PlanStatus; done: number; total: number }[] = [];
  for (const f of names) {
    if (f.kind !== "file" || !f.name.endsWith(".md")) continue;
    const rel = `${PLAN_DIR}/${f.name}`;
    const parsed = readPlan(registeredWorkspaces, workspaceId, rel);
    if (parsed) out.push({ path: rel, status: parsed.status, done: parsed.done, total: parsed.total });
  }
  return out;
}

/** Is a workspace-relative path a plan file under `.agents/plans/`? */
export function isPlanPath(relPath: string): boolean {
  const norm = relPath.split(path.sep).join("/");
  return norm.startsWith(`${PLAN_DIR}/`) && norm.endsWith(".md");
}

export { PLAN_DIR };
