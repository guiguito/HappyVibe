import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ModelSelect } from "./ModelSelect";

/**
 * §23 Plan Mode — the plan-ready card in the transcript. Self-contained: it
 * reads the plan file, renders it, shows live checklist progress, and drives the
 * human-only transitions (Implement / Discard / Reopen) via window.hv directly.
 * The reasonable-model nudge lives here: an inline picker for the implementation
 * turn's model.
 */

export interface PlanCardData {
  sessionId: string;
  workspaceId: string;
  path: string;
  status: string; // draft | implementing | implemented | cancelled
  done: number;
  total: number;
}

interface HvModel {
  provider: string;
  id: string;
  name: string;
}

const STATUS_META: Record<string, { dot: string; label: string }> = {
  draft: { dot: "bg-sky", label: "plan ready" },
  implementing: { dot: "bg-honey animate-pulse", label: "implementing" },
  implemented: { dot: "bg-leaf", label: "implemented" },
  cancelled: { dot: "bg-ink-soft", label: "cancelled" },
};

export function PlanCard({ card, onOpenFile }: { card: PlanCardData; onOpenFile?: (relPath: string) => void }): React.JSX.Element {
  const [body, setBody] = useState<string>("");
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [models, setModels] = useState<HvModel[]>([]);
  const [pick, setPick] = useState<{ provider: string; modelId: string } | null>(null);

  // Re-read the file whenever its progress/status changes (agent ticks a box,
  // status flips) so the rendered checklist stays live.
  useEffect(() => {
    let alive = true;
    void window.hv.fsRead(card.workspaceId, card.path).then((r) => {
      if (alive && r?.kind === "text") setBody(stripFrontMatter(r.content));
    });
    return () => { alive = false; };
  }, [card.workspaceId, card.path, card.done, card.total, card.status]);

  useEffect(() => {
    void window.hv.listModels().then((m) => setModels(m as HvModel[]));
  }, []);

  const s = STATUS_META[card.status] ?? STATUS_META.draft;
  const isDraft = card.status === "draft";
  const isImplementing = card.status === "implementing";
  const isCancelled = card.status === "cancelled";

  // §23 round 7: roll the workspace back to the Implement baseline. Gated behind
  // a confirm because it writes files; the outcome stays on the card.
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [revertNote, setRevertNote] = useState<string | null>(null);
  const doRevert = (): void => {
    setConfirmRevert(false);
    void window.hv.planRevert(card.sessionId).then((res) => {
      if (!res) {
        setRevertNote("No baseline was captured for this implementation.");
        return;
      }
      const parts = [`${res.restored.length} restored`, `${res.deleted.length} removed`];
      if (res.stale.length) parts.push(`${res.stale.length} left alone (changed since)`);
      setRevertNote(`Reverted — ${parts.join(", ")}.`);
    });
  };
  const revertButton = (
    <button
      type="button"
      onClick={() => setConfirmRevert(true)}
      className="rounded-lg border-2 border-line bg-card text-xs font-bold px-2.5 py-1 text-ink-soft hover:text-berry hover:border-berry/50 cursor-pointer"
    >
      Revert implementation
    </button>
  );

  return (
    <div className={`rounded-xl border-2 bg-card shadow-sticker overflow-hidden ${isCancelled ? "border-line opacity-70" : "border-sky/50"}`}>
      <div className="w-full flex items-center gap-2.5 px-3.5 py-2.5">
        <span className={`size-2.5 rounded-full shrink-0 ${s.dot}`} />
        <span className="text-[15px] shrink-0" aria-hidden>🧭</span>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2 text-left cursor-pointer flex-1 min-w-0">
          <span className="font-bold text-sm truncate">Implementation plan</span>
          <span className="shrink-0 text-[11px] text-ink-soft truncate">{card.path.split("/").pop()}</span>
        </button>
        {card.total > 0 && (
          <span className="shrink-0 text-[11px] font-semibold text-ink-soft tabular-nums">{card.done}/{card.total} tasks</span>
        )}
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-sky-soft text-sky border border-sky/40">{s.label}</span>
      </div>

      {expanded && body && (
        <div className="px-4 pb-2 border-t-2 border-line/60 pt-2">
          <div className="md max-h-96 overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
          {onOpenFile && (
            <button
              type="button"
              onClick={() => onOpenFile(card.path)}
              className="mt-1 text-[11px] font-semibold text-sky hover:underline cursor-pointer"
              title="Open the plan file in the editor"
            >
              Open plan file
            </button>
          )}
        </div>
      )}

      {/* Actions — all human-only transitions. */}
      {isDraft && !dismissed && (
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 border-t-2 border-line/60 bg-paper/40">
          <span className="text-[11px] font-semibold text-ink-soft">Implement with</span>
          <ModelSelect
            models={models}
            value={pick}
            onPick={(m) => setPick({ provider: m.provider, modelId: m.id })}
            placeholder="current model"
            direction="up"
            menuWidthClassName="w-64"
            triggerClassName="rounded-full border-2 border-line bg-paper px-2.5 py-1 text-xs font-semibold"
          />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => void window.hv.planImplement(card.sessionId, card.path, pick)}
            className="rounded-lg bg-tangerine text-paper font-bold text-xs px-3 py-1.5 border-2 border-tangerine-deep hover:brightness-110 cursor-pointer"
          >
            Implement this plan
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-lg border-2 border-line bg-card text-xs font-bold px-2.5 py-1.5 hover:bg-paper cursor-pointer"
          >
            Keep planning
          </button>
          <button
            type="button"
            onClick={() => void window.hv.planDiscard(card.sessionId)}
            className="rounded-lg border-2 border-line bg-card text-xs font-bold px-2.5 py-1.5 text-ink-soft hover:text-berry hover:border-berry/50 cursor-pointer"
          >
            Discard
          </button>
        </div>
      )}
      {isImplementing && (
        <div className="flex items-center gap-2 px-3.5 py-2 border-t-2 border-line/60 bg-paper/40">
          <span className="flex-1 text-[11px] font-semibold text-ink-soft">Implementing this plan…</span>
          <button
            type="button"
            onClick={() => void window.hv.planStatus(card.sessionId, card.path, "cancelled")}
            className="rounded-lg border-2 border-line bg-card text-xs font-bold px-2.5 py-1 text-ink-soft hover:text-berry hover:border-berry/50 cursor-pointer"
          >
            Stop
          </button>
          {revertButton}
        </div>
      )}
      {(card.status === "implemented" || isCancelled) && (
        <div className="flex items-center gap-2 px-3.5 py-2 border-t-2 border-line/60 bg-paper/40">
          <span className="flex-1 text-[11px] font-semibold text-ink-soft">
            {card.status === "implemented" ? "✓ Plan implemented." : "Plan cancelled."}
          </span>
          <button
            type="button"
            onClick={() => void window.hv.planStatus(card.sessionId, card.path, "implementing")}
            className="rounded-lg border-2 border-line bg-card text-xs font-bold px-2.5 py-1 hover:bg-paper cursor-pointer"
          >
            Reopen
          </button>
          {card.status === "implemented" && revertButton}
        </div>
      )}
      {confirmRevert && (
        <div className="px-3.5 py-2 border-t-2 border-line/60 bg-paper/40">
          <div className="text-[11px] font-bold text-ink mb-1">Revert this implementation?</div>
          <p className="text-[11px] text-ink-soft mb-2">
            The workspace goes back to how it was when you pressed Implement. Files that changed since the
            agent touched them are left alone. <strong>The conversation is not affected.</strong>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmRevert(false)}
              className="rounded-lg border-2 border-line bg-card text-xs font-bold px-2.5 py-1 hover:bg-paper cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doRevert}
              className="rounded-lg border-2 border-berry/50 bg-card text-xs font-bold px-2.5 py-1 text-berry hover:bg-berry/10 cursor-pointer"
            >
              Revert
            </button>
          </div>
        </div>
      )}
      {revertNote !== null && (
        <div className="px-3.5 py-2 border-t-2 border-line/60 bg-paper/40 text-[11px] font-semibold text-ink-soft">
          {revertNote}
        </div>
      )}
    </div>
  );
}

function stripFrontMatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
