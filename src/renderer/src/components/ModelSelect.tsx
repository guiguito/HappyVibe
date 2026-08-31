import { useEffect, useRef, useState, type ReactNode } from "react";
import { GoTo } from "./GoTo";

/**
 * WS1: the searchable model dropdown, extracted from the chat chip so Settings
 * (global default + workspace override) get the same search box the chat has.
 *
 * Dumb display + pick — resolution (session → workspace → global) stays with the
 * caller. Open state is controllable so the chat chip can force-close on a
 * session switch; uncontrolled (Settings) it manages itself.
 */

interface HvModelLike {
  provider: string;
  id: string;
  name: string;
}

export function ModelSelect({
  models,
  value,
  onPick,
  onClear,
  clearLabel = "Use global default",
  placeholder = "Pick a model…",
  emptyHint = <>No models yet — set one up on the <GoTo view="models" /> page.</>,
  loading = false,
  disabled = false,
  direction = "down",
  open: openProp,
  onOpenChange,
  renderTrigger,
  triggerClassName,
  menuWidthClassName = "w-72",
}: {
  models: HvModelLike[];
  value: { provider: string; modelId: string } | null;
  onPick: (m: HvModelLike) => void;
  /** When provided, a clear row is shown (e.g. workspace "use global default"). */
  onClear?: () => void;
  clearLabel?: string;
  placeholder?: string;
  emptyHint?: React.ReactNode;
  /** models still loading — distinguishes "loading" from "none configured". */
  loading?: boolean;
  disabled?: boolean;
  direction?: "up" | "down";
  /** Controlled open state (chat). Omit for self-managed (Settings). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  renderTrigger?: (args: { name: string | null; open: boolean; toggle: () => void }) => ReactNode;
  triggerClassName?: string;
  menuWidthClassName?: string;
}): React.JSX.Element {
  const [openSelf, setOpenSelf] = useState(false);
  const [filter, setFilter] = useState("");
  const open = openProp ?? openSelf;
  const setOpen = (o: boolean): void => {
    if (!o) setFilter("");
    onOpenChange?.(o);
    if (openProp === undefined) setOpenSelf(o);
  };
  // Controlled close (session switch) should also drop the filter.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (prevOpen.current && !open) setFilter("");
    prevOpen.current = open;
  }, [open]);

  const name =
    value != null
      ? models.find((m) => m.provider === value.provider && m.id === value.modelId)?.name ?? value.modelId
      : null;

  const q = filter.trim().toLowerCase();
  const shown = models.filter((m) => !q || `${m.name} ${m.provider} ${m.id}`.toLowerCase().includes(q));

  const toggle = (): void => setOpen(!open);

  return (
    <div className="relative">
      {renderTrigger ? (
        renderTrigger({ name, open, toggle })
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          onClick={toggle}
          className={
            triggerClassName ??
            "w-full flex items-center justify-between gap-2 rounded-xl border-2 border-line bg-paper px-3.5 py-2.5 text-sm font-bold text-left focus:outline-none focus:border-tangerine enabled:cursor-pointer disabled:opacity-50"
          }
        >
          <span className="truncate">{name ?? placeholder}</span>
          <span className="text-ink-soft shrink-0">▾</span>
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute ${direction === "up" ? "bottom-full mb-2" : "top-full mt-2"} left-0 z-20 ${menuWidthClassName} max-h-80 overflow-hidden flex flex-col rounded-xl border-2 border-line-strong bg-card shadow-sticker-lg py-1 text-sm`}
          >
            {models.length > 5 && (
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search models…"
                className="mx-2 mb-1 px-2 py-1 rounded-lg border-2 border-line bg-paper text-[13px] focus:outline-none focus:border-tangerine"
              />
            )}
            <div className="overflow-y-auto">
              {onClear && (
                <button
                  type="button"
                  onClick={() => { onClear(); setOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer ${value == null ? "font-bold text-tangerine-deep" : "font-medium"}`}
                >
                  {clearLabel}
                </button>
              )}
              {shown.map((m) => {
                const active = value != null && m.provider === value.provider && m.id === value.modelId;
                return (
                  <button
                    key={`${m.provider}/${m.id}`}
                    type="button"
                    onClick={() => { onPick(m); setOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-paper-deep/40 cursor-pointer ${active ? "font-bold text-tangerine-deep" : "font-medium"}`}
                  >
                    <span className="block truncate">{m.name}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-soft">{m.provider}/{m.id}</span>
                  </button>
                );
              })}
              {models.length === 0 && (
                <div className="px-3 py-2 text-xs text-ink-soft font-medium">{loading ? "Loading models…" : emptyHint}</div>
              )}
              {models.length > 0 && shown.length === 0 && (
                <div className="px-3 py-2 text-xs text-ink-soft font-medium">No models match “{filter}”.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
