import { useState } from "react";
import { toolDiff, type DiffLine } from "../diffs";
import { toolLabel, type IconKind } from "../toolLabel";
import { asyncResultInfo, delegationLabel, type SubagentResult, type SubagentTrace } from "../agents";
import { resolveCardPath } from "../tabs";
import { ZoomableImage } from "./ZoomableImage";

export interface ToolCardData {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: "running" | "done" | "error" | "denied" | "skipped";
  result?: unknown;
  /** §7 round 12: data URLs for a RESTORED result's images (live results carry
   *  the raw blocks on `result` instead — resultImages handles both). */
  images?: string[];
  /** Restored images that exceeded the payload budget — named, never silent. */
  imagesDropped?: boolean;
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
  skipped: { dot: "bg-honey", label: "skipped" },
};

/**
 * Round 15 — every word on a card becomes an icon, its text on hover.
 *
 * A card was carrying up to four uppercase words (DONE · DETAILS · ALLOWED ·
 * DESTRUCTIVE) beside a headline that is itself a sentence, so the row read as
 * a form rather than a statement. The words are not deleted, they move into
 * `title`: colour and shape carry the state at a glance, the text is one hover
 * away, and screen readers keep the same string via aria-label.
 *
 * The mapping is DATA rather than JSX so tests can assert on it — the renderer
 * suite has no DOM (`tests/**\/*.test.ts`, no jsdom), which is also why
 * tests/tool-card-icons.test.ts pairs this with a source scan for the words.
 */
export type CardMarkKind = "check" | "cross" | "skip" | "warn" | "clock" | "dots";

export interface CardMark {
  kind: CardMarkKind;
  /** Tooltip + aria-label — the word this icon replaced. */
  title: string;
  /** Tailwind colour classes for the glyph. */
  tone: string;
}

/** The status shown at the end of the headline row. `running` stays a pulsing
    dot: an animation says "still going" better than any glyph. */
export const STATUS_MARK: Record<ToolCardData["status"], CardMark | null> = {
  running: null,
  done: { kind: "check", title: "Done", tone: "text-leaf" },
  error: { kind: "cross", title: "Error", tone: "text-berry" },
  denied: { kind: "cross", title: "Denied", tone: "text-berry" },
  skipped: { kind: "skip", title: "Skipped", tone: "text-honey" },
};

/** The badges that used to be pill-shaped words. */
export const BADGE_MARKS = {
  allowed: { kind: "check", title: "Allowed by you", tone: "text-leaf" },
  session: { kind: "clock", title: "Allowed for this session", tone: "text-tangerine-deep" },
  denied: { kind: "cross", title: "Denied", tone: "text-berry" },
  plan: { kind: "skip", title: "Skipped — not allowed in plan mode", tone: "text-tangerine-deep" },
  destructive: { kind: "warn", title: "Destructive command", tone: "text-berry" },
} as const satisfies Record<string, CardMark>;

const MARK_PATHS: Record<CardMarkKind, React.JSX.Element> = {
  check: <polyline points="20 6 9 17 4 12" />,
  cross: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  skip: (
    <>
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </>
  ),
  warn: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
};

/** One card mark. `title` doubles as the accessible name — the word it replaced. */
export function CardGlyph({ mark, className }: { mark: CardMark; className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={mark.title}
      className={`shrink-0 size-4 ${mark.tone} ${className ?? ""}`}
    >
      <title>{mark.title}</title>
      {MARK_PATHS[mark.kind]}
    </svg>
  );
}

// ── W1.1 tool-kind icons (inline SVGs — no icon library) ────────────────────

const ICON_PATHS: Record<IconKind, React.JSX.Element> = {
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
    </>
  ),
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
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  rewind: (
    <>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
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

/**
 * One-line gist of a tool error, for the collapsed card (round 11). The full
 * text lives in TechnicalDetails; this is only what the user sees first.
 */
export function errorSummary(result: unknown, max = 120): string {
  const raw = typeof result === "string" ? result : result == null ? "" : JSON.stringify(result);
  const line = raw.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return "The tool reported an error.";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

/**
 * §7 round 12 — the image blocks of a tool result, as data URLs.
 *
 * An MCP browser screenshot comes back as `{content:[{type:"image", data, …}]}`
 * (7 of the 8 image blocks found in real session files were tool results). The
 * card used to hand the whole result to JSON.stringify, so the picture arrived
 * as a megabyte of base64 inside the details block — worse than missing, since
 * it also buried the text that came with it.
 *
 * `restored` covers the reopen path, where main has already turned the blocks
 * into data URLs (restore.ts imagesOf) and the result is a plain string.
 */
export function resultImages(result: unknown, restored?: string[]): string[] {
  if (restored?.length) return restored;
  const content = (result as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((b) => {
    const blk = b as { type?: string; data?: string; mimeType?: string };
    return blk.type === "image" && blk.data
      ? [`data:${blk.mimeType ?? "image/png"};base64,${blk.data}`]
      : [];
  });
}

/** The same result with its image blocks removed — what the details dump shows. */
export function stripImages(result: unknown): unknown {
  const content = (result as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return result;
  const kept = content.filter((b) => (b as { type?: string }).type !== "image");
  return { ...(result as object), content: kept };
}

/** W1.1: raw tool name + args + result — always behind the "details" toggle. */
function TechnicalDetails({ card }: { card: ToolCardData }): React.JSX.Element {
  // Images are rendered as pictures above; never dumped as base64 here.
  const shown = stripImages(card.result);
  const result =
    card.result === undefined
      ? null
      : typeof shown === "string"
        ? shown
        : JSON.stringify(shown, null, 2);
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

/** Round 15: the DETAILS pill is a ⋯ button — the universal "there is more". */
function DetailsToggle({ open, onClick }: { open: boolean; onClick: () => void }): React.JSX.Element {
  const label = open ? "Hide details" : "Show details";
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={open}
      // No ring. The old pill had a border, and shrinking it to fit an icon
      // turned that border into a CIRCLE around two dots — a bullseye where the
      // point was to make the row quieter. The dots are the affordance; the
      // hover tint is the only chrome they need.
      className={`shrink-0 rounded-lg p-1 cursor-pointer transition-colors ${
        open ? "bg-paper-deep text-ink" : "text-ink-soft hover:bg-paper-deep/60 hover:text-ink"
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
        {MARK_PATHS.dots}
      </svg>
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
  // Async dispatch: the tool call returned immediately (details.asyncId) — the
  // real result arrives later as its own turn, so this line records the handoff,
  // not an outcome. Foreground runs keep the finalOutput summary.
  const async = asyncResultInfo(card.result);
  // A failed delegation carries its reason in the tool result's text content, not
  // in the (empty) trace — surface it so "FAILED" is explainable, not a dead end.
  const errorText =
    card.status === "error"
      ? ((card.result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n")
          .trim()
      : "";
  const delegationStatus = running
    ? "delegating…"
    : denied
      ? "denied"
      : card.status === "error"
        ? "failed"
        : async
          ? "dispatched"
          : "done";
  const summary = async
    ? "running in the background — result arrives when it finishes"
    : errorText
      ? errorText.replace(/\s+/g, " ")
      : (results[0]?.finalOutput?.trim().replace(/\s+/g, " ") ?? "");
  return (
    <div className={`rounded-xl border-2 border-l-4 bg-card shadow-sticker overflow-hidden ${denied ? "border-berry/50" : "border-sky/60"}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left cursor-pointer hover:bg-paper-deep/40 transition-colors px-3.5 py-2.5"
      >
        {/* v5: intent wraps (break-words) instead of clipping to one ellipsized line. */}
        <span className="flex items-start gap-2.5">
          {/* Round 15: the delegation's own status word joins the icon rule —
              same treatment as an ordinary card, so the two read alike. */}
          <span
            className={`mt-1 size-2.5 rounded-full shrink-0 ${running ? "bg-sky animate-pulse" : denied || card.status === "error" ? "bg-berry" : "bg-leaf"}`}
            title={delegationStatus}
            aria-label={delegationStatus}
            role="img"
          />
          <ToolIcon kind={"robot" as IconKind} className="mt-0.5 size-4 shrink-0 text-sky" />
          <span className="text-sm min-w-0 break-words flex-1" title={req?.task}>
            <span className="text-ink-soft">→ asked</span> <span className="font-bold">{req?.agent ?? results[0]?.agent ?? "?"}</span>
            {label && <span className="text-ink-soft">: {label}</span>}
          </span>
          {!running && (
            <CardGlyph
              className="mt-0.5"
              mark={
                denied
                  ? BADGE_MARKS.denied
                  : card.status === "error"
                    ? { kind: "cross", title: "Failed", tone: "text-berry" }
                    : async
                      ? { kind: "clock", title: "Dispatched — running in the background", tone: "text-sky" }
                      : { kind: "check", title: "Done", tone: "text-leaf" }
              }
            />
          )}
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
          {errorText && results.length === 0 ? (
            <p className="text-xs text-berry whitespace-pre-wrap break-words">{errorText}</p>
          ) : (
            <SubagentTraceView results={results} />
          )}
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
            {/* pi-subagents >=0.40 projects only tool-call summaries, no prose (see
                agents.ts) — finalOutput is where the child's actual ANSWER lives,
                so the trace would otherwise end on a tool list. */}
            {r.finalOutput && (
              <div className="text-xs border-t border-line pt-1.5 mt-0.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mr-1.5">output</span>
                <span className="whitespace-pre-wrap break-words">{r.finalOutput}</span>
              </div>
            )}
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
  // §7 round 12: live results carry raw image blocks; restored ones arrive as
  // data URLs main already built (restore.ts imagesOf). One call covers both.
  const cardImages = resultImages(card.result, card.images);
  const s = STATUS[card.status];
  const denied = card.status === "denied";
  const { icon, label, path: filePath, destructive, brand } = toolLabel(card.toolName, card.args);
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
          {/* The dot keeps the status too — `running` has no glyph on purpose
              (a pulse says "still going" better than any shape can). */}
          <span className={`size-2.5 rounded-full shrink-0 ${s.dot}`} title={s.label} aria-label={s.label} role="img" />
          {brand ? <i className={`si ${brand} text-[15px] shrink-0 text-ink-soft`} aria-hidden /> : <ToolIcon kind={icon} />}
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
        {/* Round 15: the four badges and the status are icons now, each carrying
            the word it replaced in `title` + aria-label. Colour still does the
            at-a-glance work; the text is one hover away rather than permanently
            occupying the row beside a sentence. */}
        {card.approval && (
          <CardGlyph mark={card.approval === "Allow" ? BADGE_MARKS.allowed : BADGE_MARKS.session} />
        )}
        {denied && <CardGlyph mark={BADGE_MARKS.denied} />}
        {/* §23: a tool blocked by plan mode reads as calm guidance, not an error. */}
        {card.status === "skipped" && <CardGlyph mark={BADGE_MARKS.plan} />}
        {/* V2.A: destructive bash command (rm/rmdir) — flagged next to the status. */}
        {destructive && <CardGlyph mark={BADGE_MARKS.destructive} />}
        {STATUS_MARK[card.status] && <CardGlyph mark={STATUS_MARK[card.status]!} />}
        <DetailsToggle open={details} onClick={() => setDetails(!details)} />
      </div>
      {diff && openDiff && <DiffView lines={diff.lines} />}
      {/* §7 round 12: a screenshot is a picture, not a base64 wall. Shown on the
          card itself rather than behind `details` — the agent took it TO be
          looked at, and hiding it is what made the feature read as missing. */}
      {cardImages.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t-2 border-line px-3.5 py-2.5">
          {cardImages.map((src, i) => (
            <ZoomableImage key={i} src={src} />
          ))}
        </div>
      )}
      {card.imagesDropped && (
        <div className="border-t-2 border-line px-3.5 py-2 text-[11px] font-semibold text-ink-soft">
          image not shown (too large to restore)
        </div>
      )}
      {details && <TechnicalDetails card={card} />}
      {/* Round 11: collapsed to one line — the agent usually recovers by itself, so
          an expanded error per attempt is noise. Click (or the details toggle) for
          the full text, which TechnicalDetails already renders. */}
      {card.status === "error" && !details && (
        <button
          type="button"
          onClick={() => setDetails(true)}
          title="Show the full error"
          className="block w-full text-left border-t-2 border-berry/30 bg-berry-soft/60 px-3.5 py-2 font-mono text-xs text-berry truncate hover:bg-berry-soft cursor-pointer"
        >
          {errorSummary(card.result)}
        </button>
      )}
    </div>
  );
}
