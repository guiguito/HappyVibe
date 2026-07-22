import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useState } from "react";
import { PermissionRulesSection } from "./PermissionRulesSection";
import { ModelSelect } from "./ModelSelect";
import { SkillInspector, STATUS_LABEL, STATUS_TONE } from "./SkillsSection";

/**
 * W1.4 workspace settings (PRD "Settings"): model override, workspace
 * permission rules, workspace system-prompt additions. Opened from the gear
 * on a workspace row in the sidebar.
 */

const smallBtn =
  "rounded-lg border-2 px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function Block({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-6">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-2">{title}</div>
      {children}
    </div>
  );
}

export function WorkspaceSettingsModal({
  workspace,
  onClose,
}: {
  workspace: string;
  onClose: () => void;
}): React.JSX.Element {
  const [models, setModels] = useState<HvModel[]>([]);
  const [model, setModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [additions, setAdditions] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [bypass, setBypass] = useState<boolean | null>(null); // #14: tri-state override
  const [confirmBypass, setConfirmBypass] = useState(false);

  useEffect(() => {
    void window.hv.listModels().then(setModels);
    void window.hv.getWorkspaceModel(workspace).then(setModel);
    void window.hv.getWorkspaceAppend(workspace).then((c) => setAdditions(c ?? ""));
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

  const saveAdditions = async (): Promise<void> => {
    await window.hv.setWorkspaceAppend(workspace, additions);
    setDirty(false);
    setSaved(true);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(38rem,calc(100vw-3rem))] max-h-[85vh] overflow-y-auto rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-6 focus:outline-none">
        <div className="flex items-center gap-3 mb-1">
          <div className="size-9 rounded-xl bg-honey border-2 border-ink/80 flex items-center justify-center -rotate-3 shrink-0">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
            </svg>
          </div>
          <Dialog.Title className="font-black text-xl tracking-tight truncate">{basename(workspace)}</Dialog.Title>
          <span className="flex-1" />
          <Dialog.Close asChild>
            <button type="button" title="Close" className="text-ink-soft hover:text-ink cursor-pointer font-black text-lg px-1">
              ×
            </button>
          </Dialog.Close>
        </div>
        <Dialog.Description className="text-xs text-ink-soft font-mono truncate mb-5">{workspace}</Dialog.Description>

        <Block title="model override">
          <ModelSelect
            models={models}
            value={model}
            onPick={(m) => pickModel(`${m.provider}/${m.id}`)}
            onClear={() => pickModel("")}
            clearLabel="Use global default"
            placeholder="Use global default"
            menuWidthClassName="w-full"
          />
          <p className="text-xs text-ink-soft mt-1.5">
            Sessions in this workspace start with this model instead of the global default. Applies to new or
            restarted sessions.
          </p>
        </Block>

        <Block title="permission rules">
          <PermissionRulesSection workspace={workspace} />
        </Block>

        <Block title="skills">
          <WorkspaceSkillsBlock workspace={workspace} />
        </Block>

        <Block title="bypass all permissions">
          <div className="flex items-center gap-2">
            <select
              value={bypass === null ? "inherit" : bypass ? "on" : "off"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "on") setConfirmBypass(true);
                else applyBypass(v === "off" ? false : null);
              }}
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
        </Block>

        <Block title="system prompt additions">
          <textarea
            value={additions}
            onChange={(e) => {
              setAdditions(e.target.value);
              setDirty(true);
              setSaved(false);
            }}
            rows={5}
            placeholder="Extra instructions for sessions in this workspace…"
            className="w-full font-mono text-xs rounded-xl border-2 border-line bg-paper px-3 py-2.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60 resize-y"
          />
          <div className="flex items-center gap-2 mt-2">
            <p className="text-xs text-ink-soft flex-1">
              Heads up: these REPLACE the global additions for this workspace — they don't combine. Applies to new or
              restarted sessions.
            </p>
            {saved && <span className="text-xs font-bold text-leaf shrink-0">Saved.</span>}
            <button
              type="button"
              disabled={!dirty}
              onClick={() => void saveAdditions()}
              className={`${smallBtn} bg-tangerine text-paper border-tangerine-deep enabled:hover:brightness-105 disabled:opacity-40 shrink-0`}
            >
              Save
            </button>
          </div>
        </Block>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * §14: the ONLY surface for workspace-scoped skills — review of project
 * `.agents/skills`, plus the per-workspace activation checklist over EVERY
 * approved skill (global + workspace). A session in this workspace spawns with
 * the skills toggled on here (bundled off by default, others on).
 */
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

  return (
    <>
      {data.skills.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold text-ink-soft mb-1.5">Project skills (.agents/skills)</div>
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
        </div>
      )}

      <div className="text-[11px] font-semibold text-ink-soft mb-1.5">Active in this workspace</div>
      {data.checklist.length === 0 ? (
        <p className="text-xs text-ink-soft">No approved skills yet. Approve skills in the Global skills view or review project skills above.</p>
      ) : (
        <div className="rounded-xl border-2 border-line overflow-hidden">
          {data.checklist.map((c) => (
            <label key={c.id} className="flex items-center gap-2 px-3 py-2 border-b border-line last:border-b-0 cursor-pointer hover:bg-paper-deep/30">
              <input
                type="checkbox"
                checked={c.active}
                onChange={(e) => toggle(c.id, e.target.checked)}
                className="size-4 accent-tangerine cursor-pointer"
              />
              <span className="font-bold text-sm">{c.name}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">{c.scope}</span>
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-ink-soft mt-1.5">
        Toggling a skill respawns this workspace's sessions to apply the change (the conversation is preserved).
      </p>

      {inspecting && <SkillInspector id={inspecting} onClose={() => setInspecting(null)} onChanged={refresh} />}
    </>
  );
}
