import { useEffect, useMemo, useState } from "react";
import { joinToolPermissions, type AgentInfo, type PermState, type ToolInfo, type ToolRow } from "../agents";

const PERM_TONE: Record<PermState, string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  ask: "bg-honey-soft text-tangerine-deep border-honey/60",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
};

const SOURCE_TONE: Record<string, string> = {
  builtin: "bg-honey-soft text-tangerine-deep border-honey/60",
  project: "bg-leaf-soft text-leaf border-leaf/50",
};

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Agents &amp; tools</h1>
        <p className="text-sm text-ink-soft mb-8">
          Built-in and project subagents you can delegate to, and the tools available to the agent.
        </p>

        {/* Agents */}
        <h2 className="font-bold text-lg mb-3">Agents</h2>
        {sortedAgents === null ? (
          <p className="text-sm text-ink-soft mb-8">Loading…</p>
        ) : sortedAgents.length === 0 ? (
          <p className="text-sm text-ink-soft mb-8">No agents found.</p>
        ) : (
          <div className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg overflow-hidden mb-10">
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

        {/* Tools */}
        <h2 className="font-bold text-lg mb-1">Tools</h2>
        <p className="text-xs text-ink-soft mb-3">
          Permission state comes from your rules. Edit them in{" "}
          <span className="font-bold">Settings → Permissions</span>.
        </p>
        {toolRows === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : toolRows.length === 0 ? (
          <p className="text-sm text-ink-soft">No tools reported.</p>
        ) : (
          <div className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg overflow-hidden">
            {toolRows.map((t) => (
              <div key={t.name} className="px-4 py-2.5 border-b border-line last:border-b-0 flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 shrink-0 ${PERM_TONE[t.permission]}`}>
                  {t.permission}
                </span>
                <span className="font-bold shrink-0">{t.name}</span>
                <span className="text-xs text-ink-soft truncate flex-1 min-w-0" title={t.description}>
                  {t.description}
                </span>
                {t.source && <span className="font-mono text-[10px] text-ink-soft/70 shrink-0">{basename(t.source)}</span>}
              </div>
            ))}
          </div>
        )}
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
