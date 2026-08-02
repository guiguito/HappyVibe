import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripSkillFrontMatter } from "../skillMd";
import { SkillDiff, SOURCE_TONE, STATUS_LABEL, STATUS_TONE } from "./SkillsSection";

/**
 * §24 Commands — the GLOBAL commands surface (managed + linked + bundled),
 * rendered in the Commands sidebar page. Workspace commands (`.agents/prompts`
 * and `.claude/commands`) live only in workspace settings, for §14's reason:
 * several workspaces can be live at once, so a global page cannot answer
 * "which workspace?" without guessing.
 *
 * A near-clone of SkillsSection — same review-before-active promise, same
 * import controls, same re-review diff — with three deliberate differences from
 * PRD §24:
 *  - no "includes N scripts" pill: a command is one .md file, never a script
 *    bundle. Its risk is the inline !`bash` Pi silently drops, so that's the pill.
 *  - a `shadowed` status, where skills have `error`: a bridge /hv-* command wins
 *    the name before Pi ever looks at prompt templates.
 *  - no token-weight line in the inspector: a command costs nothing until it is
 *    invoked, which is exactly why it has no context-panel row either.
 */

/** Commands have no `error` state and skills have no `shadowed` one; everything
 *  else is the same palette, so map rather than restate the classes. */
const CMD_STATUS_TONE: Record<HvCommandView["status"], string> = {
  active: STATUS_TONE.active,
  disabled: STATUS_TONE.disabled,
  "needs-review": STATUS_TONE["needs-review"],
  shadowed: STATUS_TONE.error,
};
const CMD_STATUS_LABEL: Record<HvCommandView["status"], string> = {
  active: STATUS_LABEL.active,
  disabled: STATUS_LABEL.disabled,
  "needs-review": STATUS_LABEL["needs-review"],
  shadowed: "shadowed",
};
/** `claude` is the one source skills don't have — plum, the one unused tone. */
const CMD_SOURCE_TONE: Record<HvCommandView["source"], string> = {
  ...SOURCE_TONE,
  claude: "bg-plum-soft text-plum border-plum/50",
};

const BASH_RISK =
  "This command uses Claude Code's inline !`bash` injection, which Pi does not support: the prompt will contain the literal text instead of the command's output.";
const SHADOW_RISK =
  "A built-in /hv-… command owns this name. Pi matches built-ins before prompt templates, so this file can never run — rename it to use it.";

const importBtn =
  "text-xs font-bold rounded-lg border-2 border-line px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer disabled:opacity-40";

/**
 * §24 import controls — local folder, git-URL tarball, linked dir, plus the
 * one-click `~/.claude/commands` suggestion (by far the highest-value source,
 * PRD §24). That directory is LINKED in place, never copied: it is typically
 * git-tracked and team-owned, so a copy would drift on the next pull.
 */
export function CommandImportControls({
  scope,
  workspaceId,
}: {
  scope: "global" | "workspace";
  workspaceId: string | null;
}): React.JSX.Element {
  const [scan, setScan] = useState<HvCommandImportScan | null>(null);
  const [gitOpen, setGitOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non-null only when ~/.claude/commands exists AND isn't linked yet. */
  const [claudeDir, setClaudeDir] = useState<{ path: string; exists: boolean } | null>(null);

  useEffect(() => {
    if (scope !== "global") return; // workspace .claude/commands is a scan root, not a link
    void Promise.all([window.hv.commandsClaudeDir(), window.hv.commandsGetLinked()])
      .then(([d, linked]) => setClaudeDir(d.exists && !linked.includes(d.path) ? d : null))
      .catch(() => setClaudeDir(null));
  }, [scope]);

  const linkClaude = async (): Promise<void> => {
    if (!claudeDir) return;
    setBusy(true);
    setError(null);
    try {
      const linked = await window.hv.commandsGetLinked();
      if (!linked.includes(claudeDir.path)) await window.hv.commandsSetLinked([...linked, claudeDir.path]);
      setClaudeDir(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runScan = async (fn: () => Promise<HvCommandImportScan | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r) return; // dialog cancelled
      if (r.error || !r.token) setError(r.error ?? "No commands found.");
      else if (r.commands.length === 0) setError("No commands found in that source.");
      else setScan(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        {claudeDir && (
          <button
            type="button"
            disabled={busy}
            title={`Watch ${claudeDir.path} in place. Nothing is copied — the files stay where Claude Code put them.`}
            className="text-xs font-bold rounded-lg bg-tangerine text-paper border-2 border-tangerine-deep px-3 py-1.5 shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40"
            onClick={() => void linkClaude()}
          >
            Link ~/.claude/commands
          </button>
        )}
        <button type="button" disabled={busy} className={importBtn} onClick={() => void runScan(() => window.hv.commandsImportLocal())}>
          Import folder
        </button>
        <button type="button" disabled={busy} className={importBtn} onClick={() => setGitOpen(true)}>
          Import from Git URL
        </button>
        {scope === "global" && (
          <button type="button" disabled={busy} className={importBtn} onClick={() => void window.hv.commandsAddLinked()}>
            Link a directory
          </button>
        )}
        {busy && <span className="text-xs text-ink-soft">Working…</span>}
      </div>
      {error && <p className="mt-1.5 text-xs font-semibold text-berry">{error}</p>}

      {gitOpen && (
        <GitUrlModal
          onClose={() => setGitOpen(false)}
          onScan={async (url) => {
            setGitOpen(false);
            await runScan(() => window.hv.commandsImportGit(url));
          }}
        />
      )}
      {scan?.token && <ImportPicker scan={scan} scope={scope} workspaceId={workspaceId} onClose={() => setScan(null)} />}
    </div>
  );
}

function GitUrlModal({ onClose, onScan }: { onClose: () => void; onScan: (url: string) => void }): React.JSX.Element {
  const [url, setUrl] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="font-black text-lg mb-1">Import from Git URL</h3>
        <p className="text-xs text-ink-soft mb-3">
          Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which
          commands to import.
        </p>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) onScan(url.trim()); }}
          placeholder="https://github.com/owner/repo"
          className="w-full rounded-lg border-2 border-line bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:border-tangerine"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border-2 border-line font-bold text-sm px-4 py-2 hover:bg-paper-deep/40 cursor-pointer">Cancel</button>
          <button type="button" disabled={!url.trim()} onClick={() => onScan(url.trim())} className="rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40">Fetch</button>
        </div>
      </div>
    </div>
  );
}

function ImportPicker({
  scan,
  scope,
  workspaceId,
  onClose,
}: {
  scan: HvCommandImportScan;
  scope: "global" | "workspace";
  workspaceId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scan.commands.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string): void => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const doImport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Main refuses the whole batch when a name a bridge /hv-* command already
      // owns is in it (PRD §24) and names the clash — keep the picker open so
      // the user can deselect that one and import the rest.
      const res = await window.hv.commandsImportSelect(scan.token!, [...selected], scope, workspaceId);
      if (res.error) { setError(res.error); return; }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-5 flex flex-col max-h-[80vh]" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="font-black text-lg mb-1">Import commands</h3>
        <p className="text-xs text-ink-soft mb-3">
          Choose which commands to import. They're approved on import ({scope === "workspace" ? "into this workspace" : "as global commands"}).
        </p>
        <div className="flex items-center gap-2 pb-1 text-[11px] font-bold text-ink-soft">
          <button className="underline hover:text-ink" onClick={() => setSelected(new Set(scan.commands.map((c) => c.id)))}>Select all</button>
          <span>·</span>
          <button className="underline hover:text-ink" onClick={() => setSelected(new Set())}>Deselect all</button>
          <span className="ml-auto tabular-nums">{selected.size}/{scan.commands.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto rounded-xl border-2 border-line">
          {scan.commands.map((c) => (
            <label key={c.id} className="flex items-start gap-2 px-3 py-2 border-b border-line last:border-b-0 cursor-pointer hover:bg-paper-deep/30">
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="mt-1 size-4 accent-tangerine cursor-pointer" />
              <div className="min-w-0">
                <span className="font-mono font-bold text-sm">/{c.name}</span>
                <p className="text-xs text-ink-soft line-clamp-2">{c.description}</p>
              </div>
            </label>
          ))}
        </div>
        {error && <p className="mt-2 text-xs font-semibold text-berry">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border-2 border-line font-bold text-sm px-4 py-2 hover:bg-paper-deep/40 cursor-pointer">Cancel</button>
          <button type="button" disabled={busy || selected.size === 0} onClick={() => void doImport()} className="rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40">
            Import {selected.size > 0 ? selected.size : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Status pill — exported so the workspace block shows the same four states. */
export function CommandStatusPill({ status }: { status: HvCommandView["status"] }): React.JSX.Element {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 shrink-0 ${CMD_STATUS_TONE[status]}`}>
      {CMD_STATUS_LABEL[status]}
    </span>
  );
}

/** The pills that sit after the name on a row — shared by the global list and
 *  the workspace block so the two surfaces can't drift apart. */
export function CommandRowPills({ cmd }: { cmd: HvCommandView }): React.JSX.Element {
  return (
    <>
      <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${CMD_SOURCE_TONE[cmd.source]}`}>
        {cmd.source}
      </span>
      {cmd.status === "shadowed" && (
        <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border border-berry/40 bg-berry-soft/60 text-berry px-2 py-0.5" title={SHADOW_RISK}>
          reserved name
        </span>
      )}
      {cmd.hasBashInjection && (
        <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border border-honey/60 bg-honey-soft text-tangerine-deep px-2 py-0.5" title={BASH_RISK}>
          !`bash` not run
        </span>
      )}
    </>
  );
}

export function CommandsSection({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
  const [commands, setCommands] = useState<HvCommandView[] | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.hv.commandsList(workspaceId ?? undefined).then((l) => setCommands(l.global));
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    return window.hv.onCommandsChanged(refresh);
  }, [refresh]);

  const needsReview = commands?.filter((c) => c.status === "needs-review").length ?? 0;

  return (
    <>
      <CommandImportControls scope="global" workspaceId={workspaceId} />
      {needsReview > 0 && (
        <div className="mb-3 rounded-xl border-2 border-honey/60 bg-honey-soft px-3 py-2 text-sm font-semibold text-tangerine-deep">
          {needsReview === 1
            ? "1 command needs review before it can run."
            : `${needsReview} commands need review before they can run.`}
        </div>
      )}
      {commands === null ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : commands.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No global commands yet. Drop a <span className="font-mono">.md</span> file into the managed commands
          directory, or link an existing commands directory to review it here.
        </p>
      ) : (
        <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden">
          {commands.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setInspecting(c.id)}
              className="w-full text-left px-4 py-3 border-b border-line last:border-b-0 hover:bg-paper-deep/30 cursor-pointer block"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <CommandStatusPill status={c.status} />
                <span className="font-mono font-bold">/{c.name}</span>
                {c.argumentHint && <span className="font-mono text-xs text-ink-soft">{c.argumentHint}</span>}
                <CommandRowPills cmd={c} />
                <span className="ml-auto shrink-0 text-ink-soft">›</span>
              </div>
              <p className="text-sm text-ink-soft mt-1 line-clamp-2">{c.description || "(no description)"}</p>
            </button>
          ))}
        </div>
      )}

      {inspecting && <CommandInspector id={inspecting} onClose={() => setInspecting(null)} onChanged={refresh} />}
    </>
  );
}

/** Row click → the inspector: the rendered prompt body, its argument hint,
 *  provenance, approve/disable/delete, and a before/after diff when the file
 *  changed after approval. No file list and no token weight: a command is one
 *  file, and it costs nothing until it is invoked.
 *  Exported so workspace settings can reuse it for project-command review. */
export function CommandInspector({
  id,
  workspaceId,
  canApprove = true,
  onClose,
  onChanged,
}: {
  id: string;
  /** Set when opened from workspace settings, so delete/unlink scopes the reload to this workspace. */
  workspaceId?: string | null;
  /** false in workspace settings for a global command: inspectable, but approval only happens from the Commands page. */
  canApprove?: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [detail, setDetail] = useState<HvCommandDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void window.hv.commandsRead(id).then(setDetail).catch(() => setDetail(null));
  }, [id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      onChanged();
      load();
    } finally {
      setBusy(false);
    }
  };

  const changed = !!detail?.approved && detail.approved !== detail.current;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6 flex flex-col max-h-[85vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {detail === null ? (
          <div className="py-10 text-center text-ink-soft">Loading…</div>
        ) : (
          <>
            <div className="flex items-start gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-black text-xl leading-tight font-mono">
                  /{detail.name}
                  {detail.argumentHint && <span className="text-ink-soft font-bold"> {detail.argumentHint}</span>}
                </h2>
                <p className="text-sm text-ink-soft mt-0.5">{detail.description}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${CMD_STATUS_TONE[detail.status]}`}>
                    {CMD_STATUS_LABEL[detail.status]}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${CMD_SOURCE_TONE[detail.source]}`}>
                    {detail.source}
                  </span>
                  <span className="text-[11px] text-ink-soft" title="A command is expanded into your prompt only when you type it — it is not part of the system prompt">
                    costs nothing until you type it
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg border-2 border-line px-2.5 py-1 text-xs font-bold text-ink-soft hover:bg-paper-deep/40 cursor-pointer"
              >
                Close
              </button>
            </div>

            {error && <p className="mb-3 text-xs font-semibold text-berry">{error}</p>}

            {detail.status === "shadowed" && (
              <div className="mb-3 rounded-xl border-2 border-berry/40 bg-berry-soft/50 px-3 py-2 text-sm text-berry font-semibold">
                {SHADOW_RISK}
              </div>
            )}

            {detail.hasBashInjection && (
              <div className="mb-3 rounded-xl border-2 border-honey/60 bg-honey-soft px-3 py-2 text-sm text-tangerine-deep font-semibold">
                {BASH_RISK}
              </div>
            )}

            {detail.provenance && (
              <p className="mb-3 font-mono text-[11px] text-ink-soft break-all">
                <span className="uppercase tracking-wider text-ink-soft/70">source </span>
                {detail.provenance.source}
                {detail.provenance.sourceUrl ? ` · ${detail.provenance.sourceUrl}` : ""}
                {detail.provenance.ref ? ` @ ${detail.provenance.ref}` : ""}
              </p>
            )}

            {changed && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setShowDiff((d) => !d)}
                  className="text-xs font-bold rounded-lg border-2 border-honey/60 bg-honey-soft text-tangerine-deep px-3 py-1.5 cursor-pointer"
                >
                  {showDiff ? "Hide changes" : "Content changed since you approved — review the diff"}
                </button>
                {showDiff && <SkillDiff before={detail.approved!} after={detail.current} />}
              </div>
            )}

            {!showDiff && (
              <div className="md flex-1 overflow-y-auto rounded-xl border-2 border-line bg-card px-4 py-3 text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {stripSkillFrontMatter(detail.current) || "*(empty command)*"}
                </ReactMarkdown>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              {(detail.source === "workspace" || detail.source === "claude") && detail.status !== "needs-review" && detail.status !== "shadowed" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => window.hv.commandsPromote(id).then(() => undefined))}
                  className="rounded-xl border-2 border-line font-bold text-sm px-4 py-2 hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40 mr-auto"
                  title="Copy this project command into the global managed dir"
                >
                  Promote to global
                </button>
              )}
              {/* Deleting is STRICTLY stronger than approving, so it needs at least the
                  same right: a workspace-settings pane (canApprove=false for global
                  commands) must not remove a command for every workspace. Bundled
                  commands are never deletable — the runtime reinstalls them. */}
              {detail.source !== "bundled" && canApprove && (
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-md border-2 border-berry/60 px-2 py-1 text-xs font-bold text-berry hover:bg-berry-soft disabled:opacity-40"
                  onClick={async () => {
                    const unlink = detail.source === "linked";
                    const msg = unlink
                      ? `Unlink this directory?\n\n${detail.linkedRoot ?? id}\n\nHappyVibe stops looking at the whole directory${
                          detail.linkedSiblings
                            ? `, so “/${detail.name}” and ${detail.linkedSiblings} other command${detail.linkedSiblings === 1 ? "" : "s"} from it will disappear`
                            : `, so “/${detail.name}” will disappear`
                        }. No files are deleted — the directory belongs to another tool.`
                      : detail.source === "workspace" || detail.source === "claude"
                        ? `Delete “/${detail.name}”?\n\n${id}\n\nThis deletes a file from your project, which is probably tracked by git.`
                        : `Delete “/${detail.name}”?\n\n${id}\n\nThe file is removed from disk.`;
                    if (!window.confirm(msg)) return;
                    setError(null);
                    setBusy(true); // same in-flight guard as Approve/Disable — this is destructive
                    try {
                      const res = await window.hv.commandsDelete(id, workspaceId ?? null);
                      if (!res.ok) { setError(res.error); return; }
                      onChanged();
                      onClose();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {detail.source === "linked" ? "Unlink" : "Delete"}
                </button>
              )}
              {detail.status === "shadowed" ? (
                <span className="text-sm text-berry font-semibold self-center">This command can never run.</span>
              ) : detail.status === "needs-review" ? (
                canApprove ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => window.hv.commandsApprove(id))}
                    className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40"
                  >
                    {changed ? "Re-approve" : "Approve"}
                  </button>
                ) : (
                  <p className="text-[11px] text-ink-soft self-center">
                    Approve this command from the Commands page — a workspace can only turn a global command off for
                    itself.
                  </p>
                )
              ) : detail.status === "active" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => window.hv.commandsSetEnabled(id, false))}
                  className="rounded-xl border-2 border-line font-bold text-sm px-5 py-2 hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40"
                >
                  Disable
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => window.hv.commandsSetEnabled(id, true))}
                  className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40"
                >
                  Enable
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
