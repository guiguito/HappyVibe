import { AuditView } from "./AuditView";

/**
 * Round 8: the audit log promoted back into the menu (round 1 had buried it at
 * the bottom of Settings). AuditView owns its own filters and scrolling.
 */
export function AuditLogView({
  sessions,
  workspaces,
}: {
  sessions: SessionMeta[];
  workspaces: string[];
}): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-8 pt-10 pb-2 shrink-0">
        <h1 className="font-black text-3xl tracking-tight mb-2">Audit log</h1>
        <p className="text-sm text-ink-soft">
          Every tool call and permission decision, per session and per workspace.
        </p>
      </div>
      <AuditView sessions={sessions} workspaces={workspaces} />
    </div>
  );
}
