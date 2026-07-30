import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";
import { stripSkillFrontMatter } from "../skillMd";

/**
 * §14 Skills — the GLOBAL skills surface (managed + linked + bundled), rendered
 * in the Skills sidebar page. Workspace-scoped skills live only
 * in workspace settings (multiple workspaces can be live at once). Review-before-
 * active: a skill is gated until the user reviews it; a content change flips it
 * back to needs-review with a before/after diff.
 */

export const STATUS_TONE: Record<HvSkillView["status"], string> = {
  active: "bg-leaf-soft text-leaf border-leaf/50",
  disabled: "bg-paper-deep text-ink-soft border-line",
  "needs-review": "bg-honey-soft text-tangerine-deep border-honey/60",
  error: "bg-berry-soft text-berry border-berry/50",
};
export const STATUS_LABEL: Record<HvSkillView["status"], string> = {
  active: "active",
  disabled: "disabled",
  "needs-review": "needs review",
  error: "error",
};
export const SOURCE_TONE: Record<HvSkillView["source"], string> = {
  managed: "bg-leaf-soft text-leaf border-leaf/50",
  bundled: "bg-honey-soft text-tangerine-deep border-honey/60",
  linked: "bg-sky-soft text-sky border-sky/50",
  workspace: "bg-paper-deep text-ink-soft border-line",
};

/** Curated shortlist — one-click prefill of the git importer (not a marketplace). */
const CURATED = [
  { label: "anthropics/skills", url: "https://github.com/anthropics/skills" },
  { label: "badlogic/pi-skills", url: "https://github.com/badlogic/pi-skills" },
];

const importBtn =
  "text-xs font-bold rounded-lg border-2 border-line px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer disabled:opacity-40";

/**
 * §14 import controls — local folder, git-URL tarball, linked dir, curated
 * shortlist. Scope-parameterized: the global Skills section imports to the
 * managed dir; workspace settings import to <ws>/.agents/skills. onImported is
 * fired after a successful import (lists refresh via onSkillsChanged anyway).
 */
export function ImportControls({
  scope,
  workspaceId,
  sessionId,
}: {
  scope: "global" | "workspace";
  workspaceId: string | null;
  /** When set, shows the "New skill" (guided, skill-creator) button targeting this session. */
  sessionId?: string | null;
}): React.JSX.Element {
  const [scan, setScan] = useState<HvSkillImportScan | null>(null);
  const [gitOpen, setGitOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newSkill = async (): Promise<void> => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.hv.skillsNewSkill(sessionId);
      if (!r.ok) { setError(r.error ?? "Could not start the skill creator."); return; }
      // skill-creator is now loaded in the session — fire it as a prompt so it
      // interviews the user and writes the skill into .agents/skills.
      await window.hv.promptSession(sessionId, "/skill:skill-creator");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runScan = async (fn: () => Promise<HvSkillImportScan | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r) return; // dialog cancelled
      if (r.error || !r.token) setError(r.error ?? "No skills found.");
      else if (r.skills.length === 0) setError("No skills found in that source.");
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
        {sessionId && (
          <button type="button" disabled={busy} className="text-xs font-bold rounded-lg bg-tangerine text-paper border-2 border-tangerine-deep px-3 py-1.5 shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40" onClick={() => void newSkill()}>
            + New skill
          </button>
        )}
        <button type="button" disabled={busy} className={importBtn} onClick={() => void runScan(() => window.hv.skillsImportLocal())}>
          Import folder
        </button>
        <button type="button" disabled={busy} className={importBtn} onClick={() => setGitOpen(true)}>
          Import from Git URL
        </button>
        {scope === "global" && (
          <button type="button" disabled={busy} className={importBtn} onClick={() => void window.hv.skillsAddLinked()}>
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
            await runScan(() => window.hv.skillsImportGit(url));
          }}
        />
      )}
      {scan?.token && (
        <ImportPicker
          scan={scan}
          scope={scope}
          workspaceId={workspaceId}
          onClose={() => setScan(null)}
        />
      )}
    </div>
  );
}

function GitUrlModal({ onClose, onScan }: { onClose: () => void; onScan: (url: string) => void }): React.JSX.Element {
  const [url, setUrl] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="font-black text-lg mb-1">Import from Git URL</h3>
        <p className="text-xs text-ink-soft mb-3">Public GitHub, GitLab, Bitbucket or Codeberg repo. Downloaded over HTTPS (no git needed); you choose which skills to import.</p>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) onScan(url.trim()); }}
          placeholder="https://github.com/owner/repo"
          className="w-full rounded-lg border-2 border-line bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:border-tangerine"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CURATED.map((c) => (
            <button key={c.url} type="button" onClick={() => setUrl(c.url)} className="text-[11px] rounded-full border border-line px-2 py-0.5 hover:bg-paper-deep/40 cursor-pointer">
              {c.label}
            </button>
          ))}
        </div>
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
  scan: HvSkillImportScan;
  scope: "global" | "workspace";
  workspaceId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scan.skills.map((s) => s.id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string): void => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const doImport = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.hv.skillsImportSelect(scan.token!, [...selected], scope, workspaceId);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-5 flex flex-col max-h-[80vh]" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="font-black text-lg mb-1">Import skills</h3>
        <p className="text-xs text-ink-soft mb-3">Choose which skills to import. They're approved on import ({scope === "workspace" ? "into this workspace" : "as global skills"}).</p>
        <div className="flex items-center gap-2 pb-1 text-[11px] font-bold text-ink-soft">
          <button className="underline hover:text-ink" onClick={() => setSelected(new Set(scan.skills.map((s) => s.id)))}>Select all</button>
          <span>·</span>
          <button className="underline hover:text-ink" onClick={() => setSelected(new Set())}>Deselect all</button>
          <span className="ml-auto tabular-nums">{selected.size}/{scan.skills.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto rounded-xl border-2 border-line">
          {scan.skills.map((s) => (
            <label key={s.id} className="flex items-start gap-2 px-3 py-2 border-b border-line last:border-b-0 cursor-pointer hover:bg-paper-deep/30">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="mt-1 size-4 accent-tangerine cursor-pointer" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">{s.name}</span>
                  {s.scriptCount > 0 && <span className="text-[10px] text-berry font-bold">{s.scriptCount} script{s.scriptCount > 1 ? "s" : ""}</span>}
                </div>
                <p className="text-xs text-ink-soft line-clamp-2">{s.description}</p>
              </div>
            </label>
          ))}
        </div>
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

export function SkillsSection({ workspaceId, sessionId }: { workspaceId: string | null; sessionId?: string | null }): React.JSX.Element {
  const [skills, setSkills] = useState<HvSkillView[] | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.hv.skillsList(workspaceId ?? undefined).then((l) => setSkills(l.global));
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    return window.hv.onSkillsChanged(refresh);
  }, [refresh]);

  const needsReview = skills?.filter((s) => s.status === "needs-review").length ?? 0;

  return (
    <>
      <ImportControls scope="global" workspaceId={workspaceId} sessionId={sessionId} />
      {needsReview > 0 && (
        <div className="mb-3 rounded-xl border-2 border-honey/60 bg-honey-soft px-3 py-2 text-sm font-semibold text-tangerine-deep">
          {needsReview} skill{needsReview > 1 ? "s" : ""} need{needsReview > 1 ? "" : "s"} review before they can run.
        </div>
      )}
      {skills === null ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : skills.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No global skills yet. Drop a skill folder into the managed skills directory, or link an existing skills
          directory to review it here.
        </p>
      ) : (
        <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden">
          {skills.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setInspecting(s.id)}
              className="w-full text-left px-4 py-3 border-b border-line last:border-b-0 hover:bg-paper-deep/30 cursor-pointer block"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 shrink-0 ${STATUS_TONE[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
                <span className="font-bold">{s.name}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${SOURCE_TONE[s.source]}`}>
                  {s.source}
                </span>
                {s.scriptCount > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border border-berry/40 bg-berry-soft/60 text-berry px-2 py-0.5" title="This skill bundles executable scripts the model may run">
                    includes {s.scriptCount} script{s.scriptCount > 1 ? "s" : ""}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-ink-soft">›</span>
              </div>
              <p className="text-sm text-ink-soft mt-1 line-clamp-2">{s.description || "(no description)"}</p>
            </button>
          ))}
        </div>
      )}

      {inspecting && (
        <SkillInspector
          id={inspecting}
          onClose={() => setInspecting(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

/** Row click → the inspector: rendered SKILL.md, files, provenance, token weight,
 *  approve/disable, and a before/after diff when the skill changed after approval.
 *  Exported so workspace settings can reuse it for project-skill review. */
export function SkillInspector({
  id,
  workspaceId,
  canApprove = true,
  onClose,
  onChanged,
}: {
  id: string;
  /** Set when opened from workspace settings, so delete/unlink scopes the reload to this workspace. */
  workspaceId?: string | null;
  /** false in workspace settings for a global skill: inspectable, but approval only happens from the Skills page. */
  canApprove?: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [detail, setDetail] = useState<HvSkillDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void window.hv.skillsRead(id).then(setDetail).catch(() => setDetail(null));
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
                <h2 className="font-black text-xl leading-tight">{detail.name}</h2>
                <p className="text-sm text-ink-soft mt-0.5">{detail.description}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${STATUS_TONE[detail.status]}`}>
                    {STATUS_LABEL[detail.status]}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${SOURCE_TONE[detail.source]}`}>
                    {detail.source}
                  </span>
                  <span className="text-[11px] text-ink-soft" title="Name + description are paid on every turn; the SKILL.md body only when the skill is loaded">
                    ~{detail.estTokens.card} tok always · ~{detail.estTokens.body} tok when loaded
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

            {detail.scriptCount > 0 && (
              <div className="mb-3 rounded-xl border-2 border-berry/40 bg-berry-soft/50 px-3 py-2 text-sm text-berry font-semibold">
                This skill bundles {detail.scriptCount} executable script{detail.scriptCount > 1 ? "s" : ""}. The model may
                run {detail.scriptCount > 1 ? "them" : "it"} — review before approving.
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripSkillFrontMatter(detail.current) || "*(empty SKILL.md)*"}</ReactMarkdown>
                {detail.files.length > 1 && (
                  <div className="mt-4 pt-3 border-t border-line">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1">Files</p>
                    <ul className="font-mono text-[11px] text-ink-soft">
                      {detail.files.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              {detail.source === "workspace" && detail.status !== "needs-review" && detail.status !== "error" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => window.hv.skillsPromote(id).then(() => undefined))}
                  className="rounded-xl border-2 border-line font-bold text-sm px-4 py-2 hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40 mr-auto"
                  title="Copy this workspace skill into the global managed dir"
                >
                  Promote to global
                </button>
              )}
              {/* Deleting is STRICTLY stronger than approving, so it needs at least the
                  same right: a workspace-settings pane (canApprove=false for global
                  skills) must not be able to remove a skill for every workspace.
                  Bundled skills are never deletable — the runtime reinstalls them. */}
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
                            ? `, so “${detail.name}” and ${detail.linkedSiblings} other skill${detail.linkedSiblings === 1 ? "" : "s"} from it will disappear`
                            : `, so “${detail.name}” will disappear`
                        }. No files are deleted — the directory belongs to another tool.`
                      : detail.source === "workspace"
                        ? `Delete “${detail.name}”?\n\n${id}\n\nThis deletes a file from your project, which is probably tracked by git.`
                        : `Delete “${detail.name}”?\n\n${id}\n\nThe folder is removed from disk.`;
                    if (!window.confirm(msg)) return;
                    setError(null);
                    setBusy(true); // same in-flight guard as Approve/Disable — this is destructive
                    try {
                      const res = await window.hv.skillsDelete(id, workspaceId ?? null);
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
              {detail.status === "error" ? (
                <span className="text-sm text-berry font-semibold self-center">This skill cannot be loaded.</span>
              ) : detail.status === "needs-review" ? (
                canApprove ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => window.hv.skillsApprove(id))}
                    className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40"
                  >
                    {changed ? "Re-approve" : "Approve"}
                  </button>
                ) : (
                  <p className="text-[11px] text-ink-soft self-center">
                    Approve this skill from the Skills page — a workspace can only turn a global skill off for itself.
                  </p>
                )
              ) : detail.status === "active" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => window.hv.skillsSetEnabled(id, false))}
                  className="rounded-xl border-2 border-line font-bold text-sm px-5 py-2 hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-40"
                >
                  Disable
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => window.hv.skillsSetEnabled(id, true))}
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

/** Minimal line diff for re-review (added/removed lines). */
function SkillDiff({ before, after }: { before: string; after: string }): React.JSX.Element {
  const parts = diffLines(before, after);
  return (
    <pre className="mt-2 max-h-[50vh] overflow-auto rounded-xl border-2 border-line bg-card px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
      {parts.map((p, i) => (
        <span
          key={i}
          className={p.added ? "bg-leaf-soft text-leaf" : p.removed ? "bg-berry-soft text-berry line-through/0" : "text-ink-soft"}
        >
          {p.value
            .split("\n")
            .filter((_, idx, arr) => idx < arr.length - 1 || arr[idx] !== "")
            .map((line) => (p.added ? "+ " : p.removed ? "- " : "  ") + line)
            .join("\n") + "\n"}
        </span>
      ))}
    </pre>
  );
}
