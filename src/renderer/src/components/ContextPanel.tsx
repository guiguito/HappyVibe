import { useEffect, useMemo, useState } from "react";
import {
  computeGauge, groupItems, totalEstTokens,
  type ContextItem, type ContextSnapshot, type Gauge, type SessionStats,
} from "../context";

const estTok = (n: number): string => `≈${n.toLocaleString()} tok`;

/**
 * Context breakdown panel (opened from the gauge). Shows the honest split:
 * System prompt / Context files / Conversation / Tool calls / Compaction
 * summaries. Char-based sizes are LABELED estimated. Removable items (completed
 * turns only) get checkboxes → "Remove from context"; removed items show
 * struck-through with a restore affordance. Pairing is handled by the bridge
 * (selecting either half of a tool pair removes both).
 */
export function ContextPanel({
  sessionId,
  snapshot,
  stats,
  fallbackWindow,
  onClose,
  onCompact,
}: {
  sessionId: string;
  snapshot: ContextSnapshot | null;
  stats: SessionStats | null;
  fallbackWindow?: number | null;
  onClose: () => void;
  onCompact: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmCompact, setConfirmCompact] = useState(false);

  // Refresh the snapshot when the panel opens (fire-and-forget; result streams
  // back through the hv.context notify the parent captures).
  useEffect(() => {
    void window.hv.contextSnapshot(sessionId);
  }, [sessionId]);

  const marks = useMemo(() => new Set(snapshot?.marks ?? []), [snapshot]);
  const gauge: Gauge | null = computeGauge(stats, fallbackWindow);
  const groups = groupItems(snapshot?.items ?? []);
  const total = snapshot ? totalEstTokens(snapshot) : 0;

  const toggle = (key: string): void =>
    setSelected((p) => {
      const next = new Set(p);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const removeSelected = (): void => {
    if (selected.size === 0) return;
    void window.hv.contextRemove(sessionId, [...selected]);
    setSelected(new Set());
  };
  const restore = (key: string): void => void window.hv.contextRestore(sessionId, [key]);

  const redZone = gauge?.zone === "red";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onMouseDown={onClose}>
      <div
        className="w-[30rem] max-w-full h-full bg-paper border-l-2 border-line-strong shadow-sticker-lg flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b-2 border-line">
          <h2 className="font-black text-lg flex-1">Context window</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-soft hover:text-ink text-xl leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Gauge summary */}
        <div className="px-5 py-3 border-b-2 border-line">
          {gauge ? (
            <div className="flex items-baseline gap-2">
              <span className="font-black text-2xl">{gauge.percent}%</span>
              <span className="font-mono text-xs text-ink-soft">
                {gauge.tokens.toLocaleString()} / {gauge.contextWindow.toLocaleString()} tokens
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                  gauge.source === "measured" ? "bg-leaf-soft text-leaf" : "bg-paper-deep text-ink-soft"
                }`}
              >
                {gauge.source}
              </span>
            </div>
          ) : (
            <div className="text-sm text-ink-soft">Usage not available yet.</div>
          )}
          <div className="mt-1 text-[11px] text-ink-soft">
            Breakdown sizes are <span className="font-bold">estimated</span> (≈ chars/4).
          </div>
        </div>

        {/* Red-zone compaction affordance */}
        {redZone && (
          <div className="mx-5 mt-3 rounded-xl border-2 border-berry/50 bg-berry-soft px-4 py-3">
            <div className="font-bold text-berry text-sm">Context is filling up.</div>
            <p className="text-xs text-ink-soft mt-1">
              Compaction summarizes older turns to free space, keeping recent work and key decisions. Nothing is
              deleted from your session file.
            </p>
            <button
              type="button"
              onClick={() => setConfirmCompact(true)}
              className="mt-2 rounded-lg bg-berry text-paper font-bold text-xs px-3 py-1.5 border-2 border-berry hover:brightness-110 cursor-pointer"
            >
              Compact now…
            </button>
          </div>
        )}

        {/* System prompt + context files */}
        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-4">
          {snapshot?.system && (
            <section>
              <GroupHeader label="System prompt" est={snapshot.system.estTokens} />
              <div className="text-[11px] text-ink-soft mt-1">
                {snapshot.system.toolCount} tools · {snapshot.system.chars.toLocaleString()} chars
              </div>
              {snapshot.system.contextFiles.length > 0 && (
                <div className="mt-2">
                  <GroupHeader label="Context files" est={snapshot.system.contextFiles.reduce((n, f) => n + f.estTokens, 0)} />
                  <ul className="mt-1 flex flex-col gap-1">
                    {snapshot.system.contextFiles.map((f) => (
                      <li key={f.path} className="flex items-center gap-2 text-xs">
                        <span className="font-mono truncate flex-1 min-w-0" title={f.path}>
                          {f.path.split("/").pop()}
                        </span>
                        <span className="text-ink-soft shrink-0">{estTok(f.estTokens)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {!snapshot && <div className="text-sm text-ink-soft">Loading breakdown…</div>}

          {groups.map((g) => (
            <section key={g.key}>
              <GroupHeader label={g.label} est={g.estTokens} />
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {g.items.map((it) => (
                  <ContextRow
                    key={it.entryId}
                    item={it}
                    removed={it.markKey != null && marks.has(it.markKey)}
                    checked={it.markKey != null && selected.has(it.markKey)}
                    onToggle={() => it.markKey && toggle(it.markKey)}
                    onRestore={() => it.markKey && restore(it.markKey)}
                  />
                ))}
              </ul>
            </section>
          ))}

          {snapshot && groups.length === 0 && !snapshot.system && (
            <div className="text-sm text-ink-soft">Nothing in context yet.</div>
          )}
        </div>

        {/* Footer: remove action */}
        <div className="border-t-2 border-line px-5 py-3 flex items-center gap-3">
          <span className="text-xs text-ink-soft flex-1">
            {snapshot ? <>≈{total.toLocaleString()} tokens across breakdown (est.)</> : null}
          </span>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={removeSelected}
            className="rounded-lg bg-tangerine text-paper font-bold text-xs px-3 py-1.5 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40"
          >
            Remove from context{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>

      {confirmCompact && (
        <CompactDialog
          onCancel={() => setConfirmCompact(false)}
          onConfirm={() => {
            setConfirmCompact(false);
            onCompact();
          }}
        />
      )}
    </div>
  );
}

function GroupHeader({ label, est }: { label: string; est: number }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2 border-b border-line pb-1">
      <h3 className="font-bold text-[11px] uppercase tracking-widest text-ink-soft flex-1">{label}</h3>
      <span className="font-mono text-[10px] text-ink-soft">{estTok(est)}</span>
    </div>
  );
}

function ContextRow({
  item,
  removed,
  checked,
  onToggle,
  onRestore,
}: {
  item: ContextItem;
  removed: boolean;
  checked: boolean;
  onToggle: () => void;
  onRestore: () => void;
}): React.JSX.Element {
  const label = item.toolName ? item.toolName : item.role ?? "item";
  return (
    <li className={`flex items-start gap-2 text-xs ${removed ? "opacity-60" : ""}`}>
      {removed ? (
        <button
          type="button"
          onClick={onRestore}
          title="Restore to context"
          className="mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wide rounded border border-line px-1.5 py-0.5 text-ink-soft hover:border-leaf hover:text-leaf cursor-pointer"
        >
          restore
        </button>
      ) : item.removable ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 shrink-0 accent-tangerine cursor-pointer"
          title="Select to remove (removing a tool call also removes its result)"
        />
      ) : (
        <span
          className="mt-0.5 shrink-0 size-3.5 rounded border border-line/60 bg-paper-deep/40"
          title="In-flight turn — can't be removed while the agent is working on it"
        />
      )}
      <div className="min-w-0 flex-1">
        <span className={`font-bold ${removed ? "line-through" : ""}`}>{label}</span>
        {item.preview && (
          <span className={`ml-1.5 text-ink-soft ${removed ? "line-through" : ""}`}>{item.preview}</span>
        )}
      </div>
      <span className="shrink-0 font-mono text-[10px] text-ink-soft" title={item.usage?.total ? "measured usage" : "estimated"}>
        {item.usage?.total ? `${item.usage.total.toLocaleString()} tok` : estTok(item.estTokens)}
      </span>
    </li>
  );
}

function CompactDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="font-black text-xl">Compact this conversation?</h2>
        <p className="text-sm text-ink-soft mt-2">
          Compaction replaces older turns with a summary so the agent has room to keep going. It keeps recent
          messages and important decisions, and your full session history stays on disk — nothing is lost.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border-2 border-line-strong text-ink-soft font-bold text-sm px-4 py-2 hover:bg-paper-deep/40 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker hover:brightness-105 cursor-pointer"
          >
            Compact now
          </button>
        </div>
      </div>
    </div>
  );
}
