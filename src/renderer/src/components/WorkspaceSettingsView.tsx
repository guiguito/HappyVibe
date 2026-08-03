import { useCallback, useEffect, useState } from "react";
import { PermissionRulesSection } from "./PermissionRulesSection";
import { ModelSelect } from "./ModelSelect";
import { Section } from "./Section";
import { ImportControls, SkillInspector, STATUS_LABEL, STATUS_TONE } from "./SkillsSection";
import { PromptTemplateImportControls, PromptTemplateInspector, PromptTemplateRowPills, PromptTemplateStatusPill } from "./PromptTemplatesSection";
import { McpServersSection } from "./McpServersSection";
import { McpCatalogSection } from "./McpCatalogSection";

/**
 * Workspace settings (PRD §16 round 8): model override, permission rules +
 * bypass, workspace skills, workspace MCP. Opened from the gear on a workspace
 * row in the sidebar.
 *
 * Round 8 turned this from a Radix dialog into a full page — it was the
 * genuinely packed surface — and removed the per-workspace system-prompt
 * additions (the same idea as AGENTS.md, told twice, where the two can
 * disagree). Rules and the bypass toggle now share one section: they are one
 * topic, and the bypass sitting three sections below the rules read as
 * unrelated.
 */

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function WorkspaceSettingsView({ workspace }: { workspace: string }): React.JSX.Element {
  const [models, setModels] = useState<HvModel[]>([]);
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [bypass, setBypass] = useState<boolean | null>(null); // #14: tri-state override
  const [confirmBypass, setConfirmBypass] = useState(false);

  useEffect(() => {
    void window.hv.listModels().then(setModels);
    void window.hv.getWorkspaceModel(workspace).then(setModel);
    void window.hv.getWorkspaceBypass(workspace).then(setBypass);
  }, [workspace]);

  const applyBypass = (v: boolean | null): void => {
    setBypass(v);
    void window.hv.setWorkspaceBypass(workspace, v);
  };

  const pickModel = (value: string): void => {
    // "" = use the global default (clears the override).
    const next = value ? { provider: value.split("/")[0], modelId: value.split("/").slice(1).join("/") } : null;
    setModel(next);
    void window.hv.setWorkspaceModel(workspace, next);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-1 truncate">{basename(workspace)}</h1>
        <p className="text-xs text-ink-soft font-mono truncate mb-8">{workspace}</p>

        <Section
          icon="models"
          title="Model"
          subtitle="Sessions here start with this model instead of the global default."
        >
          <ModelSelect
            models={models}
            value={model}
            onPick={(m) => pickModel(`${m.provider}/${m.id}`)}
            onClear={() => pickModel("")}
            clearLabel="Use global default"
            placeholder="Use global default"
            menuWidthClassName="w-full"
          />
          <p className="text-xs text-ink-soft mt-1.5">Applies to new or restarted sessions.</p>
        </Section>

        <Section
          icon="permissions"
          title="Permissions"
          subtitle="Rules for this workspace, layered over the global ones."
        >
          <PermissionRulesSection workspace={workspace} />

          <div className="mt-6 rounded-xl border-2 border-berry/50 bg-berry-soft/40 p-4">
            <div className="font-bold text-berry mb-2">⚠ Bypass ALL permissions</div>
            <div className="flex items-center gap-2">
              <select
                value={bypass === null ? "inherit" : bypass ? "on" : "off"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "on") setConfirmBypass(true);
                  else applyBypass(v === "off" ? false : null);
                }}
                aria-label="Bypass all permissions in this workspace"
                className="rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm focus:outline-none focus:border-tangerine cursor-pointer"
              >
                <option value="inherit">Inherit global</option>
                <option value="on">On — auto-approve everything</option>
                <option value="off">Off — always ask</option>
              </select>
              {bypass === true && <span className="text-xs font-bold text-berry">⚠ prompts disabled here</span>}
            </div>
            <p className="text-xs text-ink-soft mt-1.5">
              Overrides the global setting for this workspace. "On" auto-approves every action with no prompts (a red
              banner shows in each session). Applies to new or restarted sessions.
            </p>
          </div>

          {confirmBypass && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" onClick={() => setConfirmBypass(false)}>
              <div className="w-full max-w-md rounded-2xl border-2 border-berry bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
                <div className="font-bold text-berry mb-1">⚠ Auto-approve every action in this workspace?</div>
                <p className="text-sm text-ink-soft mb-4">
                  The agent may write files and run shell commands here without asking. Only enable if you fully trust
                  what you're running.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmBypass(false)}
                    className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => { setConfirmBypass(false); applyBypass(true); }}
                    className="rounded-xl bg-berry text-paper font-bold text-sm px-4 py-2 border-2 border-berry shadow-sticker cursor-pointer hover:brightness-105"
                  >
                    Enable bypass
                  </button>
                </div>
              </div>
            </div>
          )}
        </Section>

        <Section icon="skills" title="Skills" subtitle="This project's skills, and which global ones are on here.">
          <WorkspaceSkillsBlock workspace={workspace} />
        </Section>

        <Section
          icon="sysprompt"
          title="Prompts"
          subtitle="This project's prompts, and which global ones are on here."
        >
          <WorkspacePromptTemplatesBlock workspace={workspace} />
        </Section>

        <Section icon="mcp" title="Workspace MCP" subtitle="Servers for this project only.">
          <WorkspaceMcpBlock workspace={workspace} />
        </Section>
      </div>
    </div>
  );
}

/**
 * §14: the ONLY surface for workspace-scoped skills — review of project
 * `.agents/skills`, plus the per-workspace activation checklist over EVERY
 * approved skill (global + workspace). A session in this workspace spawns with
 * the skills toggled on here (bundled off by default, others on).
 */
/**
 * Workspace-tier MCP. Writes .mcp.json at the repo root — the standard format
 * other MCP hosts read, so it can be committed and shared with the team.
 *
 * This lives here rather than on the global MCP page for the reason §14 already
 * settled for skills: several workspaces can be live at once, so a global page
 * cannot answer "which workspace?" without guessing. Here the workspace is
 * named in the dialog header.
 */
function WorkspaceMcpBlock({ workspace }: { workspace: string }): React.JSX.Element {
  const [installedTick, setInstalledTick] = useState(0);
  const [serversTick, setServersTick] = useState(0);
  return (
    <>
      <p className="text-xs text-ink-soft mb-3">
        Written to <span className="font-mono">.mcp.json</span> in this workspace, so it can be
        committed and shared. Servers added on the MCP page apply everywhere instead.
      </p>
      <McpCatalogSection
        workspaceId={workspace}
        scope="workspace"
        collapsible
        refreshKey={serversTick}
        onInstalled={() => setInstalledTick((n) => n + 1)}
      />
      {/* Tight: the collapsed summary already carries its own bottom margin,
          and the list brings its own header row. */}
      <div className="mt-1">
        <McpServersSection
          key={installedTick}
          workspaceId={workspace}
          scope="workspace"
          embedded
          onServersChanged={() => setServersTick((n) => n + 1)}
        />
      </div>
    </>
  );
}

function WorkspaceSkillsBlock({ workspace }: { workspace: string }): React.JSX.Element {
  const [data, setData] = useState<HvSkillsList["workspace"]>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.hv.skillsList(workspace).then((l) => setData(l.workspace));
  }, [workspace]);
  useEffect(() => {
    refresh();
    return window.hv.onSkillsChanged(refresh);
  }, [refresh]);

  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;

  const toggle = (id: string, on: boolean): void => {
    void window.hv.skillsSetActive(workspace, id, on);
  };
  // The checklist mixes global + this workspace's own approved skills (ipc.ts
  // hv:skills-list); only the global half belongs in "Global skills in this
  // workspace" — the workspace's own skills already have their own section above.
  const globalChecklist = data.checklist.filter((c) => c.scope === "global");

  return (
    <>
      <ImportControls scope="workspace" workspaceId={workspace} />

      <div className="mb-4">
        <div className="text-[11px] font-semibold text-ink-soft mb-1.5">This project's skills (.agents/skills)</div>
        {data.skills.length === 0 ? (
          <p className="text-xs text-ink-soft">No project skills yet. Import one above, or use the guided skill creator from a session.</p>
        ) : (
          <div className="rounded-xl border-2 border-line overflow-hidden">
            {data.skills.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setInspecting(s.id)}
                className="w-full text-left px-3 py-2 border-b border-line last:border-b-0 hover:bg-paper-deep/30 cursor-pointer flex items-center gap-2"
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 shrink-0 ${STATUS_TONE[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
                <span className="font-bold text-sm">{s.name}</span>
                {s.scriptCount > 0 && <span className="text-[10px] text-berry font-bold">· {s.scriptCount} script{s.scriptCount > 1 ? "s" : ""}</span>}
                <span className="ml-auto text-ink-soft">›</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="text-[11px] font-semibold text-ink-soft mb-1.5">Global skills in this workspace</div>
      {globalChecklist.length === 0 ? (
        <p className="text-xs text-ink-soft">No approved global skills yet. Approve skills in the Global skills view.</p>
      ) : (
        <div className="rounded-xl border-2 border-line overflow-hidden">
          {globalChecklist.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-b-0 hover:bg-paper-deep/30">
              <input
                type="checkbox"
                checked={c.active}
                onChange={(e) => toggle(c.id, e.target.checked)}
                className="size-4 accent-tangerine cursor-pointer"
              />
              <button type="button" onClick={() => setInspecting(c.id)} className="font-bold text-sm text-left hover:underline cursor-pointer">
                {c.name}
              </button>
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">{c.scope}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-ink-soft mt-1.5">
        Toggling a skill respawns this workspace's sessions to apply the change (the conversation is preserved).
      </p>

      {inspecting && (
        <SkillInspector
          id={inspecting}
          workspaceId={workspace}
          canApprove={!globalChecklist.some((c) => c.id === inspecting)}
          onClose={() => setInspecting(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

/**
 * §24: the ONLY surface for workspace-scoped commands — review of this
 * project's `.agents/prompts` and `.claude/commands`, plus the per-workspace
 * activation checklist over every approved global command. Same rights split as
 * skills: a project command is clickable AND approvable here; a global one is
 * clickable but can only be switched off for this workspace.
 */
function WorkspacePromptTemplatesBlock({ workspace }: { workspace: string }): React.JSX.Element {
  const [data, setData] = useState<HvPromptTemplatesList["workspace"]>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.hv.promptTemplatesList(workspace).then((l) => setData(l.workspace));
  }, [workspace]);
  useEffect(() => {
    refresh();
    return window.hv.onPromptTemplatesChanged(refresh);
  }, [refresh]);

  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;

  const toggle = (id: string, on: boolean): void => {
    void window.hv.promptTemplatesSetActive(workspace, id, on);
  };
  // The checklist mixes global + this project's approved commands; only the
  // global half belongs under "Global prompts in this workspace" — the
  // project's own already have their section above.
  const globalChecklist = data.checklist.filter((c) => c.source !== "workspace");

  return (
    <>
      <PromptTemplateImportControls scope="workspace" workspaceId={workspace} />

      <div className="mb-4">
        <div className="text-[11px] font-semibold text-ink-soft mb-1.5">
          This project's prompts (.agents/prompts)
        </div>
        {data.templates.length === 0 ? (
          <p className="text-xs text-ink-soft">
            No project prompts yet. Import one above, or drop a .md file into .agents/prompts.
          </p>
        ) : (
          <div className="rounded-xl border-2 border-line overflow-hidden">
            {data.templates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setInspecting(c.id)}
                className="w-full text-left px-3 py-2 border-b border-line last:border-b-0 hover:bg-paper-deep/30 cursor-pointer flex items-center gap-2 flex-wrap"
              >
                <PromptTemplateStatusPill status={c.status} />
                <span className="font-mono font-bold text-sm">/{c.name}</span>
                <PromptTemplateRowPills cmd={c} />
                <span className="ml-auto text-ink-soft">›</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="text-[11px] font-semibold text-ink-soft mb-1.5">Global prompts in this workspace</div>
      {globalChecklist.length === 0 ? (
        <p className="text-xs text-ink-soft">No approved global prompts yet. Approve them in the Prompts view.</p>
      ) : (
        <div className="rounded-xl border-2 border-line overflow-hidden">
          {globalChecklist.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-b-0 hover:bg-paper-deep/30">
              <input
                type="checkbox"
                checked={c.status === "active"}
                onChange={(e) => toggle(c.id, e.target.checked)}
                className="size-4 accent-tangerine cursor-pointer"
              />
              <button type="button" onClick={() => setInspecting(c.id)} className="font-mono font-bold text-sm text-left hover:underline cursor-pointer">
                /{c.name}
              </button>
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">{c.source}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-ink-soft mt-1.5">
        Toggling a prompt respawns this workspace's sessions to apply the change (the conversation is preserved).
      </p>

      {inspecting && (
        <PromptTemplateInspector
          id={inspecting}
          workspaceId={workspace}
          canApprove={!globalChecklist.some((c) => c.id === inspecting)}
          onClose={() => setInspecting(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
