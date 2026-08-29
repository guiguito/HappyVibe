import { useEffect, useMemo, useState } from "react";
import { agentBlurb, agentTokenCost, rosterTokenCost, sortAgents, type AgentInfo } from "../agents";
import { Section } from "./Section";
import { Toggle } from "./Toggle";

/**
 * §12 (2026-08-29): five sources, because there are five. `bundled` is ours and
 * keeps the honey the page has always used; `builtin` is UPSTREAM's packaged
 * roster, which this page hid entirely until this round, and takes a neutral
 * tone so the ones the user can edit stay the ones that stand out.
 *
 * Exported as DATA: the renderer suite has no DOM, so this mapping is how the
 * visual contract gets pinned (tests/agents-renderer.test.ts).
 */
export const SOURCE_TONE: Record<string, string> = {
  bundled: "bg-honey-soft text-tangerine-deep border-honey/60",
  builtin: "bg-paper-deep text-ink-soft border-line-strong",
  project: "bg-leaf-soft text-leaf border-leaf/50",
  user: "bg-plum-soft text-plum border-plum/50",
  package: "bg-sky-soft text-sky border-sky/50",
};

/** Where `hv:write-agent` is path-confined to — the only rows Edit can serve. */
export const EDITABLE_SOURCES: ReadonlySet<string> = new Set(["bundled", "project"]);

/**
 * Agents page (split out of the old combined Skills/MCP/Agents/Tools view).
 * Lists the agent inventory — bundled, upstream builtin, project, user and
 * package — with edit-system-prompt / duplicate / agent-tier model override.
 *
 * The list comes from pi-subagents' own discovery via the bridge (§12,
 * 2026-08-29). Before that it was a two-directory scan, and this page showed
 * two agents while sessions could delegate to nine or more.
 */
export function AgentsView({
  agents,
  sessionId,
}: {
  agents: AgentInfo[] | null;
  sessionId: string | null;
}): React.JSX.Element {
  const [editing, setEditing] = useState<AgentInfo | null>(null);
  const [viewing, setViewing] = useState<AgentInfo | null>(null);

  // Refresh the agent inventory on mount (fire-and-forget; results stream
  // back as an hv.agents notify the parent captures).
  useEffect(() => {
    void window.hv.listAgents(sessionId ?? undefined);
  }, [sessionId]);

  // §12 (2026-08-29): grouped by source — the user's own first, HappyVibe's
  // bundled last (sortAgents in agents.ts, shared with the composer's roster
  // chip so the two lists of the same thing cannot disagree).
  const sortedAgents = useMemo(() => (agents ? sortAgents(agents) : null), [agents]);

  /** §12 (2026-08-30): switch one agent on/off. No respawn — the bridge rebuilds
   *  the roster every turn, so this lands on the next message. */
  const toggle = async (a: AgentInfo): Promise<void> => {
    await window.hv.setAgentEnabled(a.name, a.enabled === false);
    void window.hv.listAgents(sessionId ?? undefined); // refreshes page AND composer chip
  };

  const duplicate = async (a: AgentInfo): Promise<void> => {
    await window.hv.duplicateAgent(a.path);
    void window.hv.listAgents(sessionId ?? undefined); // refresh
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Agents</h1>
        <p className="text-sm text-ink-soft mb-8">Every subagent this workspace can delegate to — yours, this project's, and the ones your Pi runtime and installed packages provide.</p>

        {/* Agents */}
        <Section
          icon="agents"
          title="Agents"
          subtitle={
            sortedAgents === null
              ? "Bundled, built-in, project, user and package subagents you can delegate to."
              // The context lever, stated plainly: the roster is injected into the
              // system prompt on EVERY turn, so an agent left on has a standing cost.
              : `${sortedAgents.filter((a) => a.enabled !== false).length} on · about ${rosterTokenCost(sortedAgents)} tokens of context every turn. Switch off the ones you do not use.`
          }
        >
        {sortedAgents === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : sortedAgents.length === 0 ? (
          <p className="text-sm text-ink-soft">No agents found.</p>
        ) : (
          <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden">
            {sortedAgents.map((a) => (
              <div key={a.path} className={`px-4 py-3 border-b border-line last:border-b-0 ${a.enabled === false ? "opacity-55" : ""}`}>
                <div className="flex items-center gap-2">
                  {/* A switch, not a checkbox: it applies immediately (next turn)
                      rather than waiting on a Save. A disabled agent stays listed
                      and dimmed — you have to see it to turn it back on. */}
                  <Toggle
                    on={a.enabled !== false}
                    onChange={() => void toggle(a)}
                    label={`${a.enabled === false ? "Enable" : "Disable"} ${a.name}`}
                    title={a.enabled === false ? `Switch ${a.name} on` : `Switch ${a.name} off — frees about ${agentTokenCost(a)} tokens every turn`}
                  />
                  <span className="font-bold">{a.name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${SOURCE_TONE[a.source] ?? "bg-paper-deep text-ink-soft border-line"}`}>
                    {a.source}
                  </span>
                  {a.model && <span className="font-mono text-[10px] text-ink-soft">{a.model}</span>}
                  <span className="font-mono text-[10px] text-ink-soft" title="What this agent's line costs in the system prompt, every turn">
                    ~{agentTokenCost(a)} tok
                  </span>
                  <span className="flex-1" />
                  {/* §12 (2026-08-29): Edit only where we can actually write.
                      hv:write-agent is path-confined to the app-owned and
                      project dirs, so Edit on an upstream builtin, a ~/.agents
                      agent or a package agent would simply fail. Omit it rather
                      than grey it out — Duplicate is the honest route to a copy
                      the user CAN edit. */}
                  {/* §12 (2026-08-29): a read-only agent's prompt is still worth
                      READING — these are the agents the model will actually
                      delegate to, and until this round they were invisible
                      entirely. The prompt rides the discovery notify, so this
                      needs no file read outside the dirs main owns. */}
                  {!EDITABLE_SOURCES.has(a.source) && a.systemPrompt && (
                    <button
                      type="button"
                      onClick={() => setViewing(a)}
                      className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer"
                    >
                      View
                    </button>
                  )}
                  {EDITABLE_SOURCES.has(a.source) && (
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void duplicate(a)}
                    className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer"
                  >
                    Duplicate
                  </button>
                </div>
                <p className="text-sm text-ink-soft mt-1">{agentBlurb(a)}</p>

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

      {viewing && <AgentPromptView agent={viewing} onClose={() => setViewing(null)} />}

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

/**
 * Read-only view of an agent HappyVibe cannot write: upstream's builtins, a
 * `~/.agents` agent, a package agent. The prompt comes from the discovery
 * notify rather than a file read, so showing it costs main no widening of the
 * path confinement that keeps writes inside dirs the app owns.
 */
function AgentPromptView({ agent, onClose }: { agent: AgentInfo; onClose: () => void }): React.JSX.Element {
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
              {agent.source} · read-only — duplicate it to make a version you can edit
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

        {agent.tools && agent.tools.length > 0 && (
          <>
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1">Tools it may use</label>
            <div className="mb-3 flex flex-wrap gap-1">
              {agent.tools.map((t) => (
                <span key={t} className="font-mono text-[10px] rounded bg-paper-deep px-1.5 py-0.5 text-ink-soft">{t}</span>
              ))}
            </div>
          </>
        )}

        <label className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1">System prompt</label>
        <pre className="flex-1 min-h-48 overflow-auto whitespace-pre-wrap rounded-xl border-2 border-line-strong bg-paper px-3.5 py-3 font-mono text-xs">
          {agent.systemPrompt}
        </pre>
      </div>
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
