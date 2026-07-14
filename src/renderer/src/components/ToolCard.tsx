import { useState } from "react";
import { toolDiff, type DiffLine } from "../diffs";
import { toolLabel, type IconKind } from "../toolLabel";
import { delegationLabel, type SubagentResult, type SubagentTrace } from "../agents";
import { resolveCardPath } from "../tabs";

export interface ToolCardData {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: "running" | "done" | "error" | "denied";
  result?: unknown;
  /** Set when the permission modal granted this call. */
  approval?: "Allow" | "Allow for session";
  /** B6: subagent delegation trace (toolName "subagent" only) — live + final. */
  trace?: SubagentTrace;
}

const STATUS: Record<ToolCardData["status"], { dot: string; label: string }> = {
  running: { dot: "bg-sky animate-pulse", label: "running" },
  done: { dot: "bg-leaf", label: "done" },
  error: { dot: "bg-berry", label: "error" },
  denied: { dot: "bg-berry", label: "denied" },
};

// ── W1.1 tool-kind icons (inline SVGs — no icon library) ────────────────────

const ICON_PATHS: Record<IconKind, React.JSX.Element> = {
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  edit: <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  "file-plus": (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  robot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" />
      <line x1="9" y1="13" x2="9" y2="15" />
      <line x1="15" y1="13" x2="15" y2="15" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
};

export function ToolIcon({ kind, className }: { kind: IconKind; className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "size-4 shrink-0 text-ink-soft"}
      aria-hidden
    >
      {ICON_PATHS[kind]}
    </svg>
  );
}

const LINE_STYLE: Record<DiffLine["type"], { row: string; sign: string }> = {
  add: { row: "bg-leaf-soft", sign: "+" },
  del: { row: "bg-berry-soft", sign: "−" },
  ctx: { row: "", sign: " " },
};

function DiffView({ lines }: { lines: DiffLine[] }): React.JSX.Element {
  return (
    <pre className="font-mono text-xs bg-card border-t-2 border-line overflow-x-auto overflow-y-auto max-h-64 py-1.5">
      {lines.map((l, i) => {
        const s = LINE_STYLE[l.type];
        return (
          <div key={i} className={`px-3.5 ${s.row}`}>
            <span className="select-none inline-block w-4 text-ink-soft">{s.sign}</span>
            {l.text}
          </div>
        );
      })}
    </pre>
  );
}

/** W1.1: raw tool name + args + result — always behind the "details" toggle. */
function TechnicalDetails({ card }: { card: ToolCardData }): React.JSX.Element {
  const result =
    card.result === undefined
      ? null
      : typeof card.result === "string"
        ? card.result
        : JSON.stringify(card.result, null, 2);
  return (
    <pre className="font-mono text-xs bg-paper-deep/60 border-t-2 border-line px-3.5 py-2.5 overflow-x-auto max-h-64 whitespace-pre-wrap">
      <span className="font-bold">{card.toolName}</span>
      {"\n"}
      {JSON.stringify(card.args, null, 2)}
      {result !== null && (
        <>
          {"\n── result ──\n"}
          {result}
        </>
      )}
    </pre>
  );
}

function DetailsToggle({ open, onClick }: { open: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-ink-soft rounded-full px-2 py-0.5 border border-line hover:bg-paper-deep/60 cursor-pointer"
    >
      {open ? "hide details" : "details"}
    </button>
  );
}

const fmtCost = (c?: number): string => (c != null ? `$${c.toFixed(c < 0.01 ? 5 : 4)}` : "");

/**
 * W2.2 — the file path on a card, made interactive (PRD "Chat experience"):
 * click opens the file in an editor tab; small hover affordances reveal it in
 * Finder (workspace-confined) and copy the absolute path. Paths that resolve
 * outside the session workspace render as plain text (no link, no reveal).
 */
function PathActions({
  raw,
  workspace,
  onOpenFile,
}: {
  raw: string;
  workspace?: string | null;
  onOpenFile?: (relPath: string) => void;
}): React.JSX.Element {
  const rel = workspace ? resolveCardPath(workspace, raw) : null;
  if (!rel || !onOpenFile) {
    return (
      <span className="shrink-0 max-w-48 truncate font-mono text-[11px] text-ink-soft" title={raw}>
        {raw}
      </span>
    );
  }
  const abs = `${workspace!.replace(/\/+$/, "")}/${rel}`;
  return (
    <span className="group/path shrink-0 flex items-center gap-1 min-w-0">
      <button
        type="button"
        onClick={() => onOpenFile(rel)}
        title={`Open ${rel} in the editor`}
        className="max-w-48 truncate font-mono text-[11px] text-tangerine-deep hover:underline underline-offset-2 cursor-pointer"
      >
        {rel}
      </button>
      <span className="hidden group-hover/path:flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Reveal in Finder"
          title="Reveal in Finder"
          onClick={() => void window.hv.revealPath(workspace!, rel)}
          className="rounded p-0.5 text-ink-soft hover:text-ink cursor-pointer"
        >
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Copy path"
          title="Copy absolute path"
          onClick={() => void navigator.clipboard.writeText(abs)}
          className="rounded p-0.5 text-ink-soft hover:text-ink cursor-pointer"
        >
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </span>
    </span>
  );
}

/**
 * W1.2: the in-flow subagent card is a COMPACT call line — "→ asked <agent>:
 * <intent>" plus status and a one-line result summary. Only the call and the
 * final output are what actually occupied the main agent's context (s0.3
 * addendum), so that's all the flow shows; the full nested child transcript
 * (display-only) sits behind an expand toggle, collapsed by default. The live
 * "it's running" signal is the sticky delegation section (ChatView), not this line.
 * W1.1: shares the headline treatment — robot icon + intent-first label.
 */
function SubagentCard({ card }: { card: ToolCardData }): React.JSX.Element {
  const running = card.status === "running";
  const [open, setOpen] = useState(false);
  const req = card.args as { agent?: string; task?: string } | undefined;
  const results = card.trace?.results ?? [];
  const denied = card.status === "denied";
  const label = delegationLabel(card.args);
  const summary = results[0]?.finalOutput?.trim().replace(/\s+/g, " ") ?? "";
  return (
    <div className={`rounded-xl border-2 border-l-4 bg-card shadow-sticker overflow-hidden ${denied ? "border-berry/50" : "border-sky/60"}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left cursor-pointer hover:bg-paper-deep/40 transition-colors px-3.5 py-2.5"
      >
        <span className="flex items-center gap-2.5">
          <span className={`size-2.5 rounded-full shrink-0 ${running ? "bg-sky animate-pulse" : denied || card.status === "error" ? "bg-berry" : "bg-leaf"}`} />
          <ToolIcon kind={"robot" as IconKind} className="size-4 shrink-0 text-sky" />
          <span className="text-sm min-w-0 truncate flex-1" title={req?.task}>
            <span className="text-ink-soft">→ asked</span> <span className="font-bold">{req?.agent ?? results[0]?.agent ?? "?"}</span>
            {label && <span className="text-ink-soft">: {label}</span>}
          </span>
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-soft">
            {running ? "delegating…" : denied ? "denied" : card.status === "error" ? "failed" : "done"}
          </span>
          <span className="shrink-0 text-[11px] text-ink-soft" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </span>
        {!open && summary && (
          <span className="block mt-1 pl-5 text-xs text-ink-soft truncate" title={summary}>
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2.5 flex flex-col gap-3">
          <SubagentTraceView results={results} />
        </div>
      )}
    </div>
  );
}

/**
 * V2.C1: the child-transcript rendering (live during tool_execution_update,
 * final at end) — shared by the in-flow SubagentCard's expand toggle and the
 * sticky delegation section (ChatView), so the two never drift apart.
 */
export function SubagentTraceView({ results }: { results: SubagentResult[] }): React.JSX.Element {
  return (
    <>
      {results.length === 0 && <p className="text-xs text-ink-soft italic">Waiting for the subagent to respond…</p>}
      {results.map((r, i) => (
        <div key={i} className="rounded-lg border border-line bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line text-[11px]">
            <span className="font-bold">{r.agent}</span>
            {r.model && <span className="font-mono text-ink-soft">{r.model}</span>}
            <span className="flex-1" />
            {r.usage && (
              <span className="font-mono text-ink-soft" title="input/output tokens · turns · cost">
                {(r.usage.input ?? 0) + (r.usage.output ?? 0)} tok
                {r.usage.turns != null ? ` · ${r.usage.turns} turn${r.usage.turns === 1 ? "" : "s"}` : ""}
                {r.usage.cost != null ? ` · ${fmtCost(r.usage.cost)}` : ""}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5 px-2.5 py-2 max-h-64 overflow-y-auto">
            {r.messages.map((m, j) => (
              <div key={j} className="text-xs">
                <span className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mr-1.5">{m.role}</span>
                <span className="whitespace-pre-wrap break-words">{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function ToolCard({
  card,
  workspace,
  onOpenFile,
}: {
  card: ToolCardData;
  /** W2.2: session workspace — card paths resolve against it. */
  workspace?: string | null;
  onOpenFile?: (relPath: string) => void;
}): React.JSX.Element {
  if (card.toolName === "subagent") return <SubagentCard card={card} />;
  // W1.1: headline = icon + human label; the technical block (raw name/args/
  // result) lives behind the collapsed "details" toggle. Diffs are NOT
  // technical — they ARE the human content for edit/write — so they render
  // under the headline: edit open by default (the diff is the payload), write
  // toggled by the headline (a full new file can be long).
  const diff = card.toolName === "edit" || card.toolName === "write" ? toolDiff(card.toolName, card.args) : null;
  const [openDiff, setOpenDiff] = useState(diff?.kind === "edit");
  const [details, setDetails] = useState(false);
  const s = STATUS[card.status];
  const denied = card.status === "denied";
  const { icon, label, path: filePath, destructive } = toolLabel(card.toolName, card.args);
  return (
    <div
      className={`rounded-xl border-2 bg-card shadow-sticker overflow-hidden ${
        denied ? "border-berry/50" : "border-line"
      }`}
    >
      <div className="w-full flex items-center gap-2.5 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => (diff ? setOpenDiff(!openDiff) : setDetails(!details))}
          className="flex items-center gap-2.5 text-left cursor-pointer flex-1 min-w-0"
        >
          <span className={`size-2.5 rounded-full shrink-0 ${s.dot}`} />
          <ToolIcon kind={icon} />
          <span className="font-bold text-sm line-clamp-2 break-words flex-1 min-w-0" title={label}>
            {label}
            {diff?.kind === "write" && (
              <span className="ml-2 font-sans text-[10px] font-bold uppercase tracking-wide text-leaf">
                new file · {diff.lines.length} lines
              </span>
            )}
          </span>
        </button>
        {filePath && <PathActions raw={filePath} workspace={workspace} onOpenFile={onOpenFile} />}
        {card.approval && (
          <span
            className={`shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 border ${
              card.approval === "Allow"
                ? "bg-leaf-soft text-leaf border-leaf/40"
                : "bg-honey-soft text-tangerine-deep border-honey/60"
            }`}
          >
            {card.approval === "Allow" ? "allowed" : "session pass"}
          </span>
        )}
        {denied && (
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-berry-soft text-berry border border-berry/40">
            denied
          </span>
        )}
        {/* V2.A: destructive bash command (rm/rmdir) — flagged next to the status. */}
        {destructive && (
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-berry-soft text-berry border border-berry/40">
            destructive
          </span>
        )}
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-soft">{s.label}</span>
        <DetailsToggle open={details} onClick={() => setDetails(!details)} />
      </div>
      {diff && openDiff && <DiffView lines={diff.lines} />}
      {details && <TechnicalDetails card={card} />}
      {/* Errors stay visible even though raw output otherwise sits behind details. */}
      {card.status === "error" && !details && (
        <div className="border-t-2 border-berry/30 bg-berry-soft/60 px-3.5 py-2 font-mono text-xs text-berry whitespace-pre-wrap">
          {typeof card.result === "string" ? card.result : JSON.stringify(card.result)?.slice(0, 400)}
        </div>
      )}
    </div>
  );
}
