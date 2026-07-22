import { useEffect, useMemo, useState } from "react";
import { joinToolPermissions, type AgentInfo, type PermState, type ToolInfo, type ToolRow } from "../agents";
import { McpServersSection } from "./McpServersSection";
import { SkillsSection } from "./SkillsSection";

const PERM_TONE: Record<PermState, string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  ask: "bg-honey-soft text-tangerine-deep border-honey/60",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
};

const SOURCE_TONE: Record<string, string> = {
  builtin: "bg-honey-soft text-tangerine-deep border-honey/60",
  project: "bg-leaf-soft text-leaf border-leaf/50",
};

/** v5: how many tools to show before the "Show more" toggle. */
const TOOLS_PREVIEW = 10;

/** Icon-titled section, matching the Settings page style. */
const SECTION_ICONS: Record<string, React.JSX.Element> = {
  mcp: (
    <>
      <path d="M4 12l8-8 8 8-8 8z" />
      <path d="M8 12l4-4 4 4-4 4z" />
    </>
  ),
  skills: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
  tools: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.6-.6-2.5z" />,
  agents: (
    <>
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M12 4v4M9 13h.01M15 13h.01M2 12h3M19 12h3" />
    </>
  ),
};

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg p-6 mb-6">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="size-8 rounded-lg bg-paper-deep border-2 border-line flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {SECTION_ICONS[icon]}
          </svg>
        </div>
        <h2 className="font-bold text-lg">{title}</h2>
      </div>
      <p className="text-sm text-ink-soft mb-4">{subtitle}</p>
      {children}
    </section>
  );
}

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
 * B6 Agents & tools view. Lists the agent inventory (built-in + project) with
 * edit-system-prompt / duplicate / agent-tier model override, and the built-in
 * tool list with each tool's current permission state (joined from the B4
 * rules via hv:eval-rules — read-only here; rules are edited in Settings).
 */
export function AgentsView({
  agents,
  tools,
  sessionId,
  workspaceId,
}: {
  agents: AgentInfo[] | null;
  tools: ToolInfo[] | null;
  sessionId: string | null;
  workspaceId: string | null;
}): React.JSX.Element {
  const [editing, setEditing] = useState<AgentInfo | null>(null);
  const [toolRows, setToolRows] = useState<ToolRow[] | null>(null);
  const [showAllTools, setShowAllTools] = useState(false); // v5: tools list shows 10, then "Show more"

  // Refresh both inventories on mount (fire-and-forget; results stream back as
  // hv.agents / hv.tools notifies the parent captures).
  useEffect(() => {
    void window.hv.listAgents(sessionId ?? undefined);
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

  const sortedAgents = useMemo(
    () => (agents ? [...agents].sort((a, b) => a.name.localeCompare(b.name)) : null),
    [agents],
  );

  const duplicate = async (a: AgentInfo): Promise<void> => {
    await window.hv.duplicateAgent(a.path);
    void window.hv.listAgents(sessionId ?? undefined); // refresh
  };

  const visibleTools = toolRows && !showAllTools ? toolRows.slice(0, TOOLS_PREVIEW) : toolRows;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Skills, MCP, Agents &amp; Tools</h1>
        <p className="text-sm text-ink-soft mb-8">
          Skills the agent can load, external MCP servers, the tools available to the agent, and the subagents you can
          delegate to.
        </p>

        {/* Skills — global only (workspace skills are managed in each workspace's settings) */}
        <Section
          icon="skills"
          title="Global skills"
          subtitle="Reviewed, gated capability packs the agent can load. Workspace-specific skills are managed in each workspace's settings."
        >
          <SkillsSection workspaceId={workspaceId} sessionId={sessionId} />
        </Section>

        {/* MCP */}
        <Section icon="mcp" title="MCP" subtitle="Connected Model Context Protocol servers, and adding more.">
          <McpServersSection workspaceId={workspaceId} embedded />
        </Section>

        {/* Tools */}
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

        {/* Agents */}
        <Section icon="agents" title="Agents" subtitle="Built-in and project subagents you can delegate to.">
        {sortedAgents === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : sortedAgents.length === 0 ? (
          <p className="text-sm text-ink-soft">No agents found.</p>
        ) : (
          <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden">
            {sortedAgents.map((a) => (
              <div key={a.path} className="px-4 py-3 border-b border-line last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{a.name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${SOURCE_TONE[a.source] ?? "bg-paper-deep text-ink-soft border-line"}`}>
                    {a.source}
                  </span>
                  {a.model && <span className="font-mono text-[10px] text-ink-soft">{a.model}</span>}
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setEditing(a)}
                    className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void duplicate(a)}
                    className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer"
                  >
                    Duplicate
                  </button>
                </div>
                <p className="text-sm text-ink-soft mt-1">{a.description}</p>
                {a.tools && a.tools.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {a.tools.map((t) => (
                      <span key={t} className="font-mono text-[10px] rounded bg-paper-deep px-1.5 py-0.5 text-ink-soft">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </Section>
      </div>

      {editing && (
        <AgentEditor
          agent={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void window.hv.listAgents(sessionId ?? undefined);
          }}
        />
      )}
    </div>
  );
}

/** Edit an agent's system prompt (the .md body) + agent-tier model override. */
function AgentEditor({
  agent,
  onClose,
  onSaved,
}: {
  agent: AgentInfo;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [body, setBody] = useState<string | null>(null);
  const [model, setModel] = useState<string>(agent.model ?? "");
  const [models, setModels] = useState<HvModel[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.hv.readAgent(agent.path).then((r) => {
      setBody(r.body);
      setModel(r.model ?? "");
    }).catch((e) => setError(String(e)));
    void window.hv.listModels().then(setModels).catch(() => {});
  }, [agent.path]);

  const save = async (): Promise<void> => {
    if (body === null) return;
    try {
      await window.hv.writeAgent(agent.path, { body, model: model || null });
      onSaved();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6 flex flex-col max-h-[85vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-black text-xl leading-tight">{agent.name}</h2>
            <p className="text-sm text-ink-soft truncate" title={agent.path}>
              {agent.source} · applies to the next delegation
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border-2 border-line px-2.5 py-1 text-xs font-bold text-ink-soft hover:bg-paper-deep/40 cursor-pointer"
          >
            Close
          </button>
        </div>

        {error && <div className="mb-2 text-sm font-semibold text-berry">{error}</div>}

        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1">Model (agent tier)</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mb-3 rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
        >
          <option value="">Inherit (global / workspace default)</option>
          {models.map((m) => (
            <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
              {m.name}
            </option>
          ))}
        </select>

        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1">System prompt</label>
        {body === null ? (
          <div className="py-10 text-center text-ink-soft">Loading…</div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="flex-1 min-h-48 w-full resize-none rounded-xl border-2 border-line-strong bg-paper px-3.5 py-3 font-mono text-xs focus:outline-none focus:border-tangerine"
          />
        )}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={body === null}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
