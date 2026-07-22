import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";

/**
 * §14 Skills — the GLOBAL skills surface (managed + linked + bundled), rendered
 * in the "Skills, MCP, Agents & Tools" view. Workspace-scoped skills live only
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

export function SkillsSection({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
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
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [detail, setDetail] = useState<HvSkillDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.current || "*(empty SKILL.md)*"}</ReactMarkdown>
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
              {detail.status === "error" ? (
                <span className="text-sm text-berry font-semibold self-center">This skill cannot be loaded.</span>
              ) : detail.status === "needs-review" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => window.hv.skillsApprove(id))}
                  className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40"
                >
                  {changed ? "Re-approve" : "Approve"}
                </button>
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
