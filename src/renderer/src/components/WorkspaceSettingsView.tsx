import React, { useCallback, useEffect, useState } from "react";
import { PermissionRulesSection } from "./PermissionRulesSection";
import { ModelSelect } from "./ModelSelect";
import { Section } from "./Section";
import { ImportControls, SkillInspector, STATUS_LABEL, STATUS_TONE } from "./SkillsSection";
import { PromptTemplateImportControls, PromptTemplateInspector, PromptTemplateRowPills, PromptTemplateStatusPill } from "./PromptTemplatesSection";
import { McpServersSection } from "./McpServersSection";
import { McpCatalogSection } from "./McpCatalogSection";
import { GoTo } from "./GoTo";
import { MemorySection } from "./MemorySection";

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

export function WorkspaceSettingsView({
  workspace,
  onRemoved,
  onNewSkillSession,
}: {
  workspace: string;
  /** Round 11: the workspace is gone — App refreshes the list and leaves this page. */
  onRemoved: () => void;
  /** Round 11: open (creating if needed) a session in this workspace, and go to it. */
  onNewSkillSession: () => Promise<string | null>;
}): React.JSX.Element {
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
        <p className="text-xs text-ink-soft font-mono truncate mb-2">{workspace}</p>
        <p className="text-sm text-ink-soft mb-8">
          Everything about this project only — model, permissions, skills, prompts and MCP servers
          that apply here and nowhere else.
        </p>

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

        {/* §29 5a: the ONE place the missing-git capability surfaces. The
            Changes tab is absent rather than greyed, so without this line there
            would be nothing anywhere saying why — and a capability belongs on
            the settings page, not as a dead control in the workspace. */}
        <GitCapabilityLine workspace={workspace} />

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
            <div className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/60 p-8" onClick={() => setConfirmBypass(false)}>
              <div className="hv-dialog-flow w-full max-w-md rounded-2xl border-2 border-berry bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
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
          <WorkspaceSkillsBlock workspace={workspace} onNewSkillSession={onNewSkillSession} />
        </Section>

        <Section
          icon="sysprompt"
          title="Prompts"
          subtitle="This project's prompts, and which global ones are on here."
        >
          <WorkspacePromptTemplatesBlock workspace={workspace} />
        </Section>

        <Section icon="memory" title="Memory" subtitle="What the agent remembers about this project.">
          <WorkspaceMemoryBlock workspace={workspace} />
        </Section>

        <Section icon="mcp" title="Workspace MCP" subtitle="Servers for this project only.">
          <WorkspaceMcpBlock workspace={workspace} />
        </Section>

        {/* Round 11: removal moved here from an unconfirmed hover "×" in the
            sidebar. Last section on the page, because it is the one thing here
            that cannot be undone by clicking again. */}
        <Section icon="permissions" title="Remove workspace" subtitle="Take this project out of HappyVibe.">
          <RemoveWorkspaceBlock workspace={workspace} onRemoved={onRemoved} />
        </Section>
      </div>
    </div>
  );
}

/**
 * Round 11: the two ways to remove a workspace, each confirmed and each stating
 * what happens to its sessions — the old "×" asked nothing and silently left
 * every session pointing at a workspace that no longer existed.
 */
function RemoveWorkspaceBlock({ workspace, onRemoved }: { workspace: string; onRemoved: () => void }): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<"forget" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.hv.workspaceSessionCount(workspace).then(setCount);
  }, [workspace]);

  const n = count ?? 0;
  const sessions = `${n} session${n === 1 ? "" : "s"}`;
  const name = basename(workspace);

  const run = async (mode: "forget" | "delete"): Promise<void> => {
    setBusy(true);
    try {
      await window.hv.removeWorkspace(workspace, mode);
      onRemoved();
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <>
      <div className="rounded-xl border-2 border-line bg-card p-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-bold">Forget workspace</div>
          <p className="text-sm text-ink-soft mt-0.5">
            Takes <strong>{name}</strong> out of the workspace list and archives its {sessions}. Nothing on disk is
            touched, and adding the folder again brings them back.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm("forget")}
          className="shrink-0 rounded-xl border-2 border-line-strong bg-card text-ink font-bold text-sm px-4 py-2 hover:bg-paper-deep/40 cursor-pointer disabled:opacity-50"
        >
          Forget
        </button>
      </div>

      <div className="mt-3 rounded-xl border-2 border-berry/50 bg-berry-soft/30 p-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-bold text-berry">Delete permanently</div>
          <p className="text-sm text-ink-soft mt-0.5">
            Removes <strong>{name}</strong> and permanently deletes its {sessions} — conversations, history and sub-agent transcripts included.
            Your files are never touched. This cannot be undone.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm("delete")}
          className="shrink-0 rounded-xl border-2 border-berry bg-berry text-paper font-bold text-sm px-4 py-2 shadow-sticker hover:brightness-105 cursor-pointer disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {/* Same warm dialog pattern as the session-delete confirm and CompactDialog. */}
      {confirm && (
        <div className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/40 px-6" onMouseDown={() => setConfirm(null)}>
          <div
            className="hv-dialog-flow w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="font-black text-xl">
              {confirm === "forget" ? `Forget ${name}?` : `Delete ${name} permanently?`}
            </h2>
            <p className="text-sm text-ink-soft mt-2">
              {confirm === "forget"
                ? `Its ${sessions} will be archived. Add the folder again and they come back.`
                : `Its ${sessions} and their history will be permanently deleted. This cannot be undone.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-xl border-2 border-line-strong text-ink-soft font-bold text-sm px-4 py-2 hover:bg-paper-deep/40 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(confirm)}
                className={`rounded-xl font-bold text-sm px-5 py-2 border-2 shadow-sticker hover:brightness-105 cursor-pointer disabled:opacity-50 ${
                  confirm === "delete"
                    ? "bg-berry text-paper border-berry"
                    : "bg-tangerine text-paper border-tangerine-deep"
                }`}
              >
                {confirm === "forget" ? "Forget" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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

function WorkspaceSkillsBlock({
  workspace,
  onNewSkillSession,
}: {
  workspace: string;
  /** Round 11: §14 put "New skill" on THIS surface, and it never rendered here. */
  onNewSkillSession?: () => Promise<string | null>;
}): React.JSX.Element {
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
      <ImportControls scope="workspace" workspaceId={workspace} onNewSkillSession={onNewSkillSession} />

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
        <p className="text-xs text-ink-soft">No approved global skills yet — approve them on the <GoTo view="skills" /> page.</p>
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
        <p className="text-xs text-ink-soft">No approved global prompts yet — approve them on the <GoTo view="promptTemplates" /> page.</p>
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

/**
 * §29 5a — "Version control: git not found · Install".
 *
 * Rendered ONLY when git is missing: with git present this says nothing, because
 * a line reporting that a normal thing works is noise. `Install` runs
 * `git --version` un-suppressed, which is what makes macOS offer the Command
 * Line Tools installer — we never bundle or download a git ourselves (§3: git is
 * a feature, never a runtime dependency).
 */
function GitCapabilityLine({ workspace }: { workspace: string }): React.JSX.Element | null {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void window.hv
      .gitState(workspace)
      .then((s) => setMissing(!s.available))
      .catch(() => setMissing(false));
  }, [workspace]);

  if (!missing) return null;
  return (
    <Section icon="permissions" title="Version control" subtitle="Saving versions of your work needs git.">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-soft">git isn’t installed on this Mac, so the Changes panel is hidden.</span>
        <button
          type="button"
          onClick={() => void window.hv.gitInstallPrompt()}
          className="rounded-xl bg-tangerine text-paper font-bold text-xs px-3 py-1.5 border-2 border-tangerine shadow-sticker cursor-pointer hover:brightness-105"
        >
          Install
        </button>
      </div>
    </Section>
  );
}

/**
 * §33 — this project's memories, plus the per-project switch.
 *
 * The list is the SAME component the global Memory page uses, with a different scope: one
 * component, two data sources. Turning the switch off is spawn-resolved, so live sessions
 * respawn to apply it — hence the same disclosure every other spawn-resolved switch carries.
 */
function WorkspaceMemoryBlock({ workspace }: { workspace: string }): React.JSX.Element {
  const [on, setOn] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    void window.hv.memoryGetActive(workspace).then(setOn);
  }, [workspace]);

  return (
    <>
      <label className="flex items-start gap-3 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={on ?? true}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            void window.hv.memorySetActive(workspace, next);
          }}
          className="mt-1"
        />
        <span>
          <span className="font-bold text-sm">Use memory in this project</span>
          <span className="block text-xs text-ink-soft">
            When this is off, sessions here get no memories about this project and cannot save any. Global memories
            still apply. Live sessions restart to apply this — permission grants and dangerous mode reset to safe
            defaults for those sessions.
          </span>
        </span>
      </label>
      <MemorySection scope="workspace" workspaceId={workspace} />
      <p className="mt-4 text-sm text-ink-soft">
        Memories about you rather than this project live on the <GoTo view="memory" /> page.
      </p>
    </>
  );
}
