/**
 * Which workspaces need a filesystem watch.
 *
 * Its OWN module (round 11): App.tsx is a component module, and
 * vite-plugin-react's Fast Refresh needs such a module to export ONLY components.
 * This non-component export — present since §21 round 6 — made every App.tsx edit
 * a full page reload instead of a hot update, and a reload drops the unpersisted
 * tab layout. Moving it, alongside buildGridStyle (paneGrid.ts), is what actually
 * restores Fast Refresh.
 */
import type { PlanCardData } from "./components/PlanCard";
import { allFiles, type WorkspaceTabs } from "./tabs";

/**
 * Workspaces that must stay fs-watched. Two independent reasons, and a workspace
 * qualifying for both is still ONE watch:
 *  - F6: it has an open editor tab, so an agent edit auto-refreshes the tab
 *    (FileTab subscribes to hv:fs-changed) even with the file drawer closed.
 *  - §23: it has an active plan, whose n/m progress rides the same watcher (main
 *    re-parses the plan file and pushes hv:plan-changed). Without this the
 *    "Implementing n/m" badge freezes at its implement-time count whenever the
 *    drawer and every editor tab are closed.
 * Main-side watches are refcounted, so this coexists with the file tree's watch.
 */
export function watchTargets(
  tabsByWs: Record<string, WorkspaceTabs>,
  activePlan: Record<string, PlanCardData>,
): Set<string> {
  const want = new Set(
    Object.entries(tabsByWs).filter(([, t]) => allFiles(t).length > 0).map(([w]) => w),
  );
  for (const p of Object.values(activePlan)) if (p.workspaceId) want.add(p.workspaceId);
  return want;
}
