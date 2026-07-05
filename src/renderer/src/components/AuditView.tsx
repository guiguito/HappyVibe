import { useEffect, useState } from "react";

/** hv.audit payload logged by main as permission.decision (docs/validation/d1.md §B4). */
interface Decision {
  ts: string;
  sessionId?: string;
  workspaceId?: string;
  tool: string;
  summary: string;
  decision: "allow" | "allow-session" | "deny";
  source: "rule" | "user" | "dangerous" | "safe-default";
  rule?: HvRule & { scope: string };
}

const DECISION_TONE: Record<string, string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
  "allow-session": "bg-leaf-soft text-leaf border-leaf/50",
};

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function AuditView({
  sessions,
  workspaces,
}: {
  sessions: SessionMeta[];
  workspaces: string[];
}): React.JSX.Element {
  const [workspaceId, setWorkspaceId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [rows, setRows] = useState<Decision[] | null>(null);

  useEffect(() => {
    let stale = false;
    const filter: { sessionId?: string; workspaceId?: string } = {};
    if (sessionId) filter.sessionId = sessionId;
    else if (workspaceId) filter.workspaceId = workspaceId;
    void window.hv.readAudit(filter).then((events) => {
      if (stale) return;
      setRows(
        events
          .map((e) => ({ ...(e.data as unknown as Decision), ts: e.ts, sessionId: e.sessionId, workspaceId: e.workspaceId }))
          .reverse(), // newest first
      );
    });
    return () => {
      stale = true;
    };
  }, [workspaceId, sessionId]);

  const sessionTitle = (id?: string): string => sessions.find((s) => s.id === id)?.title ?? (id ? id.slice(0, 8) : "—");
  const wsSessions = workspaceId ? sessions.filter((s) => s.workspaceId === workspaceId) : sessions;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Audit log</h1>
        <p className="text-sm text-ink-soft mb-6">Every permission decision, per session and per workspace.</p>

        <div className="flex gap-3 mb-5">
          <select
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value);
              setSessionId("");
            }}
            className="rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
          >
            <option value="">All workspaces</option>
            {workspaces.map((ws) => (
              <option key={ws} value={ws}>
                {basename(ws)}
              </option>
            ))}
          </select>
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
          >
            <option value="">All sessions</option>
            {wsSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>

        {rows === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-soft">No permission decisions logged yet.</p>
        ) : (
          <div className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg overflow-hidden">
            {rows.map((r, i) => (
              <div key={`${r.ts}-${i}`} className="px-4 py-2.5 border-b border-line last:border-b-0 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 ${DECISION_TONE[r.decision] ?? "bg-paper-deep text-ink-soft border-line"}`}
                  >
                    {r.decision}
                  </span>
                  <span className="font-bold shrink-0">{r.tool}</span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${r.source === "dangerous" ? "text-berry" : "text-ink-soft"}`}
                    title={r.rule ? `${r.rule.scope} ${r.rule.layer} rule: ${r.rule.pattern}` : undefined}
                  >
                    {r.source}
                    {r.rule ? ` · ${r.rule.pattern}` : ""}
                  </span>
                  <span className="flex-1" />
                  <span className="text-xs text-ink-soft shrink-0" title={r.ts}>
                    {new Date(r.ts).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0" title={r.summary}>
                    {r.summary}
                  </code>
                  <span className="text-[10px] text-ink-soft/70 shrink-0" title={r.workspaceId}>
                    {r.workspaceId ? basename(r.workspaceId) : ""} · {sessionTitle(r.sessionId)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
