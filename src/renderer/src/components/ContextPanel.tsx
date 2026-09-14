import { useEffect, useMemo, useState } from "react";
import { basename } from "../basename";
import {
  categoryCount, compositionSegments, computeGauge, groupItems, summarizeGroups, totalEstTokens,
  type CategorySummary, type ContextItem, type ContextSnapshot, type Gauge, type SessionStats,
} from "../context";
import { EmptyState } from "./EmptyState";
import { HowItWorks } from "./HowItWorks";

const estTok = (n: number): string => `≈${n.toLocaleString()} tok`;

/**
 * Context breakdown panel (opened from the gauge). W2.4: opens on a category
 * SUMMARY (name + count + size + share per category); clicking a category
 * drills into its item list, with a back affordance. The honest split:
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
  turns,
  onClose,
  onCompact,
  leaving,
}: {
  /** Animations round: true while ChatView holds this mounted for its exit. */
  leaving?: boolean;
  sessionId: string;
  snapshot: ContextSnapshot | null;
  stats: SessionStats | null;
  fallbackWindow?: number | null;
  /** Bumps once per agent_end / compaction_end — re-fetches the snapshot so an
   *  open panel isn't stale after a compaction changed what's in context. */
  turns: number;
  onClose: () => void;
  onCompact: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmCompact, setConfirmCompact] = useState(false);
  // Summary-first: null = category summary; a key = drilled into that
  // category. Component state, so reopening the panel starts at the summary.
  const [drill, setDrill] = useState<CategorySummary["key"] | null>(null);

  // Refresh the snapshot on open, session change, or a turn/compaction bump
  // (fire-and-forget; result streams back through the hv.context notify the
  // parent captures).
  useEffect(() => {
    void window.hv.contextSnapshot(sessionId);
  }, [sessionId, turns]);

  const marks = useMemo(() => new Set(snapshot?.marks ?? []), [snapshot]);
  const gauge: Gauge | null = computeGauge(stats, fallbackWindow);
  const groups = groupItems(snapshot?.items ?? []);
  const total = snapshot ? totalEstTokens(snapshot) : 0;
  const summary = summarizeGroups(snapshot?.items ?? [], snapshot?.system ?? null, snapshot?.marks ?? []);
  // Drilled category, if it still exists after a refresh (else fall back to summary).
  const drilled = drill != null ? summary.find((r) => r.key === drill) : undefined;
  const drilledGroup = drilled ? groups.find((g) => g.key === drilled.key) : undefined;

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
    // Round 15: an IN-PANE panel, not a full-window scrim drawer.
    //
    // It used to be `fixed inset-0` from the screen edge, so opening the cost of
    // ONE session dimmed the whole app and covered every other pane — including
    // the second chat that was streaming beside it. Cost and context are
    // properties of a session, so the panel is bounded by the pane that owns
    // the pill: `absolute` inside ChatView's relative content area, below the
    // top bar the pill sits in, exactly where the Files and Changes panels sit
    // relative to the top bar THEY are opened from.
    //
    // Deliberately not a right-drawer panel beside Files/Changes: the drawer is
    // workspace-global, and in a 2x2 with two chats it would have to guess which
    // session you meant. The scrim becomes a transparent catcher confined to the
    // same pane, so click-outside still closes without dimming anything.
    <div className="absolute inset-0 z-30 flex justify-end" onMouseDown={onClose}>
      <div
        // Animations round (2026-09-10): it slides in from its OWN edge, 12px,
        // never from off-screen — the browser-pane rule, and the same distance
        // the Files drawer travels, since this is the same gesture one surface
        // over. `leaving` is supplied by ChatView, which owns the conditional
        // render and therefore owns the exit.
        data-leaving={leaving || undefined}
        className="w-[30rem] max-w-full h-full bg-paper border-l-2 border-line-strong shadow-sticker-lg flex flex-col motion-safe:transition-[opacity,translate] motion-safe:duration-270 motion-safe:ease-hv-out motion-safe:starting:opacity-0 motion-safe:starting:translate-x-3 motion-safe:data-[leaving]:opacity-0 motion-safe:data-[leaving]:translate-x-3 motion-safe:data-[leaving]:duration-180 motion-safe:data-[leaving]:ease-hv-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b-2 border-line">
          <h2 className="font-black text-lg flex-1">Context window</h2>
          {/* Round 15: no close button. The pill in the top bar that opened
              this is a toggle now and shows a pressed state, so a second exit
              inside the panel is the same duplication the Files panel's ⇥ was
              — one entry point, one exit, the same control. Clicking outside
              still closes. */}
        </div>

        {/* Gauge summary */}
        <div className="px-5 py-3 border-b-2 border-line">
          {gauge?.source === "pending" ? (
            <div className="flex items-baseline gap-2">
              <span className="font-black text-2xl text-ink-soft animate-pulse">measuring…</span>
              <span className="font-mono text-xs text-ink-soft">re-measuring after compaction</span>
            </div>
          ) : gauge ? (
            <div className="flex items-baseline gap-2">
              <span className="font-black text-2xl">{gauge.percent}%</span>
              <span className="font-mono text-xs text-ink-soft">
                {gauge.tokens!.toLocaleString()} / {gauge.contextWindow.toLocaleString()} tokens
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
          <HowItWorks copy="contextNumbers" />
        </div>

        {/* v5: compaction is always available (Pi-native compact) — urgent
            styling only in the red zone, otherwise a quiet manual control. */}
        <div
          className={`mx-5 mt-3 rounded-xl border-2 px-4 py-3 ${redZone ? "border-berry/50 bg-berry-soft" : "border-line bg-paper-deep/30"}`}
        >
          {redZone && <div className="font-bold text-berry text-sm">Context is filling up.</div>}
          <p className={`text-xs text-ink-soft ${redZone ? "mt-1" : ""}`}>
            Compaction summarizes older turns to free space, keeping recent work and key decisions. Nothing is
            deleted from your session file.
          </p>
          <button
            type="button"
            onClick={() => setConfirmCompact(true)}
            className={`mt-2 rounded-lg font-bold text-xs px-3 py-1.5 border-2 cursor-pointer ${
              redZone
                ? "bg-berry text-paper border-berry hover:brightness-110"
                : "bg-card border-line-strong hover:bg-paper-deep/40"
            }`}
          >
            Compact now…
          </button>
        </div>

        {/* Body: category summary first; click a category to drill in */}
        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-4">
          {!snapshot && <div className="text-sm text-ink-soft">Loading breakdown…</div>}

          {snapshot && !drilled && (
            summary.length === 0 ? (
              <EmptyState copy="context" />
            ) : (
              <>
              {/* v5: proportional composition surface (a segmented bar), inspired
                  by Claude Code's /context. Sizes are estimated (chars/4). v5.1:
                  scaled to the whole window (incl. free space) when measured. */}
              {(() => {
                const usedPercent = gauge && gauge.source !== "pending" ? gauge.percent ?? undefined : undefined;
                const segs = compositionSegments(summary, usedPercent);
                if (segs.length === 0) return null;
                return (
                  <div className="mb-1">
                    <div className="flex h-4 w-full overflow-hidden rounded-lg border-2 border-line">
                      {segs.map((s) => (
                        <div
                          key={s.key}
                          className={`${s.color} h-full`}
                          style={{ width: `${s.share}%` }}
                          title={`${s.label} · ${s.share}%`}
                        />
                      ))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      {segs.map((s) => (
                        <span key={s.key} className="flex items-center gap-1 text-[10px] text-ink-soft">
                          <span className={`size-2 rounded-sm ${s.color}`} />
                          {s.label} {s.share}%
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 text-[10px] text-ink-soft/70">estimated (≈ chars/4)</div>
                  </div>
                );
              })()}
              <ul className="flex flex-col gap-2">
                {summary.map((row) => {
                  // #9: unmeasured categories (tool definitions) aren't drillable —
                  // render a static row that shows the count and labels the size.
                  if (row.measured === false) {
                    return (
                      <li key={row.key}>
                        <div className="rounded-xl border-2 border-dashed border-line px-3 py-2">
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-sm flex-1 min-w-0 truncate">{row.label}</span>
                            <span className="font-mono text-[10px] text-ink-soft shrink-0">
                              {row.count} {row.count === 1 ? "tool" : "tools"}
                            </span>
                            <span className="font-mono text-[10px] text-ink-soft/70 shrink-0">size not measured</span>
                          </div>
                        </div>
                      </li>
                    );
                  }
                  return (
                  <li key={row.key}>
                    <button
                      type="button"
                      onClick={() => setDrill(row.key)}
                      className="w-full text-left rounded-xl border-2 border-line px-3 py-2 hover:border-line-strong hover:bg-paper-deep/30 cursor-pointer"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-bold text-sm flex-1 min-w-0 truncate">{row.label}</span>
                        <span className="font-mono text-[10px] text-ink-soft shrink-0">
                          {categoryCount(row.count, row.key)}
                        </span>
                        <span className="font-mono text-[10px] text-ink-soft shrink-0">{estTok(row.estTokens)}</span>
                        <span className="font-mono text-[10px] font-bold shrink-0 w-9 text-right">{row.share}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-paper-deep overflow-hidden">
                        <div className="h-full rounded-full bg-tangerine" style={{ width: `${row.share}%` }} />
                      </div>
                      {row.removedCount > 0 && (
                        <div className="mt-1 text-[10px] text-ink-soft">{row.removedCount} removed</div>
                      )}
                    </button>
                  </li>
                  );
                })}
              </ul>
              </>
            )
          )}

          {snapshot && drilled && (
            <section>
              <button
                type="button"
                onClick={() => setDrill(null)}
                className="mb-2 text-xs font-bold text-ink-soft hover:text-ink cursor-pointer"
              >
                ← All categories
              </button>
              <GroupHeader label={drilled.label} est={drilled.estTokens} />

              {drilled.key === "system" && snapshot.system && (
                <div className="text-[11px] text-ink-soft mt-1">
                  {snapshot.system.toolCount} tools · {snapshot.system.chars.toLocaleString()} chars
                </div>
              )}

              {/* Discoverability: the injected "Available subagents" roster. */}
              {drilled.key === "system" && (snapshot.system?.agents?.length ?? 0) > 0 && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {snapshot.system!.agents!.map((a) => (
                    <li key={a.name} className="flex items-center gap-2 text-xs">
                      <span className="font-mono shrink-0">{a.name}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wide rounded border border-line px-1 py-0.5 text-ink-soft shrink-0">
                        subagent
                      </span>
                      <span className="flex-1" />
                      <span className="text-ink-soft shrink-0">{estTok(Math.ceil(a.chars / 4))}</span>
                    </li>
                  ))}
                  <li className="mt-1 pt-1 border-t border-line text-[10px] text-ink-soft/70">
                    injected so the model can delegate (part of the system prompt above)
                  </li>
                </ul>
              )}

              {drilled.key === "files" && snapshot.system && (
                <ul className="mt-1 flex flex-col gap-1">
                  {snapshot.system.contextFiles.map((f) => (
                    <li key={f.path} className="flex items-center gap-2 text-xs">
                      <span className="font-mono truncate flex-1 min-w-0" title={f.path}>
                        {basename(f.path)}
                      </span>
                      <span className="text-ink-soft shrink-0">{estTok(f.estTokens)}</span>
                    </li>
                  ))}
                  {/* W2.3: nested AGENTS.md, bridge-injected for touched subtrees. */}
                  {(snapshot.system.nested ?? []).map((f) => (
                    <li key={f.path} className="flex items-center gap-2 text-xs">
                      <span className="font-mono shrink-0">AGENTS.md</span>
                      <span className="text-[9px] font-bold uppercase tracking-wide rounded border border-line px-1 py-0.5 text-ink-soft shrink-0">
                        nested
                      </span>
                      <span className="font-mono text-[10px] text-ink-soft truncate flex-1 min-w-0" title={f.path}>
                        {f.dir}/
                      </span>
                      <span className="text-ink-soft shrink-0">{estTok(Math.ceil(f.chars / 4))}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* v5: per-tool estimated sizes (labeled estimated). */}
              {drilled.key === "tools" && snapshot.system?.toolDefs && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {[...snapshot.system.toolDefs]
                    .sort((a, b) => b.chars - a.chars)
                    .map((t) => (
                      <li key={t.name} className="flex items-center gap-2 text-xs">
                        <span className="font-mono truncate flex-1 min-w-0" title={t.name}>{t.name}</span>
                        <span className="text-ink-soft shrink-0">{estTok(Math.ceil(t.chars / 4))}</span>
                      </li>
                    ))}
                  <li className="mt-1 pt-1 border-t border-line text-[10px] text-ink-soft/70">
                    estimated from each tool's schema (≈ chars/4)
                  </li>
                </ul>
              )}

              {(drilled.key === "skills-global" || drilled.key === "skills-workspace" || drilled.key === "memory-global" || drilled.key === "memory-workspace") && (
                <div className="space-y-1">
                  {(drilled.skills ?? []).map((s) => (
                    <div key={s.name} className="flex items-baseline justify-between text-xs">
                      <span className="font-medium">{s.name}</span>
                      <span className="tabular-nums text-ink-soft">≈{s.tokens} tok</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] text-ink-soft">
                    Name + description are paid every turn. The skill's body only enters context when it is loaded.
                  </p>
                </div>
              )}

              {drilledGroup && (
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {drilledGroup.items.map((it) => (
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
              )}
            </section>
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
    <div className="hv-overlay fixed inset-0 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onCancel}>
      <div
        className="hv-dialog-flow w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6"
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
