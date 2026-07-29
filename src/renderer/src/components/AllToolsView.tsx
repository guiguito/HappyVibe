import { useEffect, useState } from "react";
import { joinToolPermissions, type PermState, type ToolInfo, type ToolRow } from "../agents";
import { Section } from "./Section";

const PERM_TONE: Record<PermState, string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  ask: "bg-honey-soft text-tangerine-deep border-honey/60",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
};

/** v5: how many tools to show before the "Show more" toggle. */
const TOOLS_PREVIEW = 10;

/** Round 4 #5: a tool row that expands to show the full (often-truncated)
    description, source path, and permission state. */
function ToolRowItem({ t }: { t: ToolRow }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-paper-deep/30 cursor-pointer"
      >
        <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 shrink-0 ${PERM_TONE[t.permission]}`}>
          {t.permission}
        </span>
        <span className="font-bold shrink-0">{t.name}</span>
        {!open && (
          <span className="text-xs text-ink-soft truncate flex-1 min-w-0">{t.description}</span>
        )}
        <span className={`ml-auto shrink-0 text-ink-soft transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="px-4 pb-3 pt-0 flex flex-col gap-2">
          <p className="text-sm text-ink whitespace-pre-wrap">{t.description || "No description provided."}</p>
          {t.source && (
            <p className="font-mono text-[11px] text-ink-soft break-all">
              <span className="uppercase tracking-wider text-ink-soft/70">source </span>
              {t.source}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * All-tools page (split out of the old combined Skills/MCP/Agents/Tools view).
 * Lists every built-in tool with its current permission state (joined from the
 * B4 rules via hv:eval-rules — read-only here; rules are edited in Settings).
 *
 * A later task (Wave D) prepends a second, configurable-built-ins block above
 * this list — kept as its own top-level Section so that's a simple insert.
 */
export function AllToolsView({
  tools,
  sessionId,
  workspaceId,
}: {
  tools: ToolInfo[] | null;
  sessionId: string | null;
  workspaceId: string | null;
}): React.JSX.Element {
  const [toolRows, setToolRows] = useState<ToolRow[] | null>(null);
  const [showAllTools, setShowAllTools] = useState(false); // v5: tools list shows 10, then "Show more"

  // Refresh the tool inventory on mount (fire-and-forget; results stream back
  // as an hv.tools notify the parent captures).
  useEffect(() => {
    void window.hv.listTools(sessionId ?? undefined);
  }, [sessionId]);

  // Join tools against the SAME rules engine the bridge runs (hv:eval-rules).
  useEffect(() => {
    if (!tools) return setToolRows(null);
    const ws = workspaceId ?? "";
    let stale = false;
    void Promise.all(
      tools.map((t) => window.hv.evalRules(ws, t.name, {}).then((v) => [t.name, v.action] as const)),
    ).then((pairs) => {
      if (stale) return;
      const verdicts = Object.fromEntries(pairs) as Record<string, PermState>;
      setToolRows(joinToolPermissions(tools, verdicts));
    });
    return () => {
      stale = true;
    };
  }, [tools, workspaceId]);

  const visibleTools = toolRows && !showAllTools ? toolRows.slice(0, TOOLS_PREVIEW) : toolRows;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">All Tools</h1>
        <p className="text-sm text-ink-soft mb-8">Everything the agent can call.</p>

        <Section icon="tools" title="Tools" subtitle="Everything the agent can call. Permission state comes from your rules (Settings → Permissions).">
          {toolRows === null ? (
            <p className="text-sm text-ink-soft">Loading…</p>
          ) : toolRows.length === 0 ? (
            <p className="text-sm text-ink-soft">No tools reported.</p>
          ) : (
            <>
              <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden">
                {visibleTools!.map((t) => (
                  <ToolRowItem key={t.name} t={t} />
                ))}
              </div>
              {toolRows.length > TOOLS_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllTools((s) => !s)}
                  className="mt-3 text-xs font-bold rounded-lg border-2 border-line px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer"
                >
                  {showAllTools ? "Show fewer" : `Show all ${toolRows.length} tools`}
                </button>
              )}
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
