import { DashboardView } from "./DashboardView";

/**
 * Round 8: the analytics dashboard, renamed "Stats" and promoted back into the
 * menu (round 1 had buried it at the bottom of Settings). DashboardView owns
 * its own scrolling and layout, so this is a header, not a wrapper column.
 */
export function StatsView({ workspaces }: { workspaces: string[] }): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-8 pt-10 pb-2 shrink-0">
        <h1 className="font-black text-3xl tracking-tight mb-2">Stats</h1>
        <p className="text-sm text-ink-soft">Local-only. Nothing here is ever sent anywhere.</p>
      </div>
      <DashboardView workspaces={workspaces} />
    </div>
  );
}
