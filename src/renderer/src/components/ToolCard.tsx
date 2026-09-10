import { useEffect, useState } from "react";
import { MEMORY_TYPE_LABEL } from "../memoryFact";
import { toolDiff, type DiffLine } from "../diffs";
import { toolLabel, type IconKind } from "../toolLabel";
import { asyncResultInfo, delegationLabel, inspectToResults, subagentUsageLine, type SubagentResult, type SubagentTrace } from "../agents";
import { basename, resolveCardPath } from "../tabs";
import { isDocumentPath } from "../../../../pi-runtime/extensions/hv-document";
import { costEstimateLabel, fmtNum } from "../analytics-format";
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
  /** §12/§19: what this delegation cost. One RUN-level figure, not one per
   *  child: upstream's per-child `usage` carries no provider, so only the run's
   *  own session files can be classified honestly (metered/plan/unknown). */
  cost?: HvLedgerTotal;
  /**
   * §12 (2026-08-30): an ASYNC delegation's outcome.
   *
   * It cannot come from `result`: an async `tool_execution_end` carries a
   * dispatch receipt, and the run finishes minutes later on an `hv.subagent`
   * complete notify keyed by `asyncId`. Without this the card said "running in
   * the background" forever — reported from a real session twenty minutes after
   * the run had finished.
   */
  delegation?: { outcome: "done" | "failed" | "stopped"; summary?: string };
  /**
   * §33: a memory card's structured fields — scope, type, name, description.
   *
   * On a LIVE card these also sit in `result`'s details, but a RESTORED one has only what
   * restore.ts named (restoreMap.ts's rule), and the Forget button needs the scope and the slug
   * to call anything at all. Carried as a field so both paths render the same card.
   */
  memory?: { scope: "global" | "workspace"; type?: string; name: string; description?: string; replaced?: boolean };
  /**
   * §12 (2026-08-30): a detached delegation's run id.
   *
   * Live cards read it off `result.details.asyncId`; a RESTORED card cannot,
   * because restore.ts flattens the result to its text blocks — so main sends it
   * as its own field (restore.ts → restoreMap.ts). It is what the expanded card
   * inspects the child's transcript with, and a reopened card had none, which
   * made that expansion an empty panel.
   */
  asyncId?: string;
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

/**
 * There is NO status glyph. The coloured dot at the head of the row already
 * encodes `card.status`, from the same single field, and a second mark derived
 * from it said the same thing twice — literally so for a denied card, which
 * rendered the dot plus TWO identical red crosses (the badge and the status),
 * and for a skipped one, which rendered two identical skip glyphs.
 *
 * The dot wins because it is the only one that can show `running`: an animation
 * says "still going" where no static shape can, so the dot has to exist anyway
 * and a glyph beside it is pure addition.
 *
 * Named trade-off: status is now carried by COLOUR alone for a sighted reader
 * (green done / red error / amber skipped). The dot keeps `title` and
 * `aria-label`, so a screen reader is unaffected, and the two cases where
 * confusion would cost something both carry a second, non-colour signal — a
 * denied card has a berry BORDER, and an error card has the red summary bar
 * under it. If a colour-blind reader ever reports the remaining ambiguity, the
 * fix is a shape inside the dot, not a second mark beside it.
 */

/** The badges that used to be pill-shaped words. */
export const BADGE_MARKS = {
  allowed: { kind: "check", title: "Allowed by you", tone: "text-leaf" },
  session: { kind: "clock", title: "Allowed for this session", tone: "text-tangerine-deep" },
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
  // §33: two interlocking rings — the knot you tie to remember something. Chosen over a brain
  // (every product's memory icon, and it says "AI" where §19 pins that word to one use) and
  // over a bookmark (too close to the book that already means Skills).
  memory: (
    <>
      <circle cx="8.5" cy="12" r="5" />
      <circle cx="15.5" cy="12" r="5" />
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

/**
 * Round 16 — a tool result's TEXT, the sibling of `resultImages`.
 *
 * A result is `{content:[{type:"text",text}], details, usage}`, and the card
 * used to hand the whole envelope to JSON.stringify — so a bash command's
 * output arrived as escaped newlines inside braces. The RESTORE path never had
 * this bug (`restore.ts` sets a plain string), which is why the same command
 * read correctly in a reopened session and badly in a live one. This is the
 * live path adopting what restore already does.
 */
export function resultText(result: unknown): string | null {
  if (typeof result === "string") return result.trim() ? result : null;
  const content = (result as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((b) => (b as { type?: string }).type === "text")
    .map((b) => (b as { text?: string }).text ?? "")
    .join("\n");
  return text.trim() ? text : null;
}

/**
 * The tools whose result IS command output, and therefore get a tail on the
 * card itself — the same three-line treatment the terminal run rail uses in its
 * hover readout, which is the "always the same pattern" half of the feedback.
 *
 * `terminal_kill` is deliberately out: it acknowledges, it does not produce
 * output. `edit`/`write` are out because their payload is the diff, which the
 * card already renders above this.
 */
export const OUTPUT_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "terminal_run",
  "terminal_read",
  // §32: a web result IS the thing the user wants to see, and its FIRST line
  // carries the fact §32 asks the card face to show — "41,203 chars total,
  // showing 0–16,000" — so they preview from the head (see previewLines).
  "web_search",
  "web_fetch",
  "web_map",
  "web_crawl",
]);

/** Tools whose preview reads from the TOP. A command's interesting output is
 * its end; a page's is its header line and first words. */
const HEAD_PREVIEW_TOOLS: ReadonlySet<string> = new Set(["web_search", "web_fetch", "web_map", "web_crawl"]);

/** The last `lines` non-blank lines — the run rail's own tail rule. */
export function outputTail(text: string, lines = 3): string[] {
  return text.split("\n").filter((l) => l.trim().length > 0).slice(-lines);
}

/**
 * The card-face preview for one tool's output.
 *
 * Two things it must get right for §32. The direction is per tool (above), and
 * the UNTRUSTED banner is dropped: that line is addressed to the MODEL, and
 * spending one of three preview lines telling the user their page is untrusted
 * pushes the char count — the reason the preview exists — off the card.
 */
export function previewLines(toolName: string, text: string, lines = 3): string[] {
  const kept = text
    .split("\n")
    .filter((l) => l.trim().length > 0 && !l.startsWith("[UNTRUSTED"));
  return HEAD_PREVIEW_TOOLS.has(toolName) ? kept.slice(0, lines) : kept.slice(-lines);
}

/** W1.1: raw tool name + args + result — always behind the "details" toggle. */
function TechnicalDetails({ card }: { card: ToolCardData }): React.JSX.Element {
  // Images are rendered as pictures above; never dumped as base64 here.
  // Round 16: a result's TEXT is printed as text. Only a result with no text
  // block at all (a pure-details tool) falls back to the JSON envelope, which
  // is the one case where the envelope IS the information.
  const text = resultText(card.result);
  const shown = stripImages(card.result);
  const result =
    card.result === undefined ? null
    : text !== null ? text
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
  // §31: resolveCardPath returns null for a document — a .docx in CodeMirror is
  // zip bytes on screen — so the ONE action it gets is Reveal in Finder, on the
  // original file rather than on the Markdown the model read.
  if (!rel && isDocumentPath(raw) && raw.startsWith("/")) {
    return (
      <span className="group/path shrink-0 flex items-center gap-1 min-w-0">
        <span className="max-w-48 truncate font-mono text-[11px] text-ink-soft" title={raw}>
          {basename(raw)}
        </span>
        <button
          type="button"
          aria-label="Reveal in Finder"
          title="Reveal in Finder"
          onClick={() => void window.hv.revealDocument(raw)}
          className="hidden group-hover/path:block rounded p-0.5 text-ink-soft hover:text-ink cursor-pointer"
        >
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </span>
    );
  }
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
 * A failed delegation carries its reason in the tool result's text content, not
 * in the (empty) trace — surfaced so "failed" is explainable, not a dead end.
 * Module-level because `delegationSummary` needs the same read.
 */
function resultErrorText(result: unknown): string {
  return ((result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
}

/**
 * The collapsed line under a delegation's headline.
 *
 * Exported and pure because the renderer suite has no DOM: the copy is pinned
 * as data (tests/delegation-card-outcome.test.ts) rather than by rendering.
 *
 * The ORDER matters. `card.delegation` wins over everything, because it is the
 * only field that knows an async run has ended — `card.result` is a dispatch
 * receipt that never changes, which is exactly why this card used to claim
 * background work forever.
 */
export function delegationSummary(card: ToolCardData): string {
  const d = card.delegation;
  if (d) {
    const s = d.summary?.trim().replace(/\s+/g, " ");
    if (s) return s;
    return d.outcome === "done"
      ? "done — the result was folded into the conversation"
      : `${d.outcome} — nothing was folded into the conversation`;
  }
  if (asyncResultInfo(card.result)) return "running in the background — result arrives when it finishes";
  if (card.status === "error") {
    const err = resultErrorText(card.result);
    if (err) return err.replace(/\s+/g, " ");
  }
  return card.trace?.results?.[0]?.finalOutput?.trim().replace(/\s+/g, " ") ?? "";
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
function SubagentCard({ card, sessionId }: { card: ToolCardData; sessionId?: string | null }): React.JSX.Element {
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
  const errorText = card.status === "error" ? resultErrorText(card.result) : "";
  // §12 (2026-08-30): set once the completion notify has landed. Until then an
  // async run's only recorded state is "dispatched", which is what froze.
  const outcome = card.delegation?.outcome;
  const delegationStatus = running
    ? "delegating…"
    : denied
      ? "denied"
      : card.status === "error"
        ? "failed"
        : (outcome ?? (async ? "dispatched" : "done"));
  const summary = delegationSummary(card);
  /**
   * §12 (2026-08-30): a FINISHED async delegation's child transcript, on demand.
   *
   * An async `tool_execution_end` carries a dispatch receipt, so this card has
   * never had a transcript to show — expanding it said "waiting" and nothing
   * else. Upstream answers `/subagents-inspect-rpc` from its own artifacts with
   * NO model turn and keeps answering after delivery, so the ask is affordable —
   * but only when ASKED: it is an RPC round trip with a 10 s timeout, and there
   * can be many of these cards in one transcript.
   *
   * Dropped on collapse rather than cached, so reopening re-reads. Same rule the
   * run card's thinking view uses, for the same reason.
   */
  const [inspected, setInspected] = useState<SubagentResult[] | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  // `card.asyncId` first: a RESTORED card has it as its own field, because its
  // result was flattened to text and `asyncResultInfo` finds nothing there —
  // and the restore path is the one where this fetch is actually needed, since a
  // live run streams its own transcript.
  const asyncId = card.asyncId ?? async?.asyncId ?? null;
  useEffect(() => {
    if (!open || !asyncId || !sessionId || results.length > 0) {
      setInspected(null);
      setInspectError(null);
      return;
    }
    let alive = true;
    void window.hv.subagentInspect(sessionId, asyncId).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setInspected(inspectToResults(r.reply, req?.agent ?? "subagent"));
        setInspectError(null);
      } else {
        // Named, never a spinner: inspection is scoped to the current session's
        // children, so a respawn answers foreign_session and that is a FACT
        // about this run, not a failure to report.
        setInspectError(
          r.code === "foreign_session"
            ? "This delegation belongs to an earlier session — its transcript is no longer readable from here."
            : `Could not read this delegation's transcript: ${r.error}`,
        );
        setInspected(null);
      }
    });
    return () => {
      alive = false;
    };
  }, [open, asyncId, sessionId, results.length, req?.agent]);
  return (
    // A1 (2026-09-10): where the card→circle flight takes off from. The id is a
    // DOM attribute rather than something parsed out of the card's text — the
    // rail looks this up by exact value, and text is not an identifier.
    <div
      data-hv-run-card={card.toolCallId}
      className={`rounded-xl border-2 border-l-4 bg-card shadow-sticker overflow-hidden ${denied ? "border-berry/50" : "border-sky/60"}`}
    >
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
            className={`mt-1 size-2.5 rounded-full shrink-0 ${
              running
                ? "bg-sky animate-pulse"
                : denied || card.status === "error" || outcome === "failed" || outcome === "stopped"
                  ? "bg-berry"
                  : "bg-leaf"
            }`}
            title={delegationStatus}
            aria-label={delegationStatus}
            role="img"
          />
          <ToolIcon kind={"robot" as IconKind} className="mt-0.5 size-4 shrink-0 text-sky" />
          <span className="text-sm min-w-0 break-words flex-1" title={req?.task}>
            <span className="text-ink-soft">→ asked</span> <span className="font-bold">{req?.agent ?? results[0]?.agent ?? "a subagent"}</span>
            {label && <span className="text-ink-soft">: {label}</span>}
          </span>
          {/* No status glyph here either, for the reason given above the badge
              table: the dot beside the agent name already carries
              `delegationStatus` in its title. The one thing the dot's COLOUR
              cannot separate — dispatched from done, both leaf — is spelled out
              in words on the summary line right below ("running in the
              background — result arrives when it finishes"). */}
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
      {/* B1 (Animations round, 2026-09-10): the body UNFOLDS. A card that grows
          by its own height in one frame shoves every message below it, which is
          the whole reason this is a height reveal (`grid-template-rows` 0fr→1fr,
          already the app's idiom) rather than a fade. The content mounts only
          when open, so a long child transcript costs nothing while collapsed. */}
      <div className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-180 motion-safe:ease-hv-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">
      {open && (
        <div className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2.5 flex flex-col gap-3">
          {errorText && results.length === 0 && !inspected?.length ? (
            <p className="text-xs text-berry whitespace-pre-wrap break-words">{errorText}</p>
          ) : (
            <>
              <SubagentTraceView
                results={results.length > 0 ? results : (inspected ?? [])}
                cost={card.cost}
                outcome={outcome}
              />
              {inspectError && <p className="text-xs text-ink-soft italic">{inspectError}</p>}
            </>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

/**
 * V2.C1: the child-transcript rendering (live during tool_execution_update,
 * final at end) — shared by the in-flow SubagentCard's expand toggle and the
 * sticky delegation section (ChatView), so the two never drift apart.
 */
export function SubagentTraceView({
  results,
  cost,
  outcome,
}: {
  results: SubagentResult[];
  cost?: HvLedgerTotal;
  /**
   * §12 (2026-08-30): set once an async run has finished. "Waiting" would then
   * be a lie about a run that ended — the same lie `cost` already caught for a
   * REOPENED session, which is why that guard existed and never fired live.
   */
  outcome?: "done" | "failed" | "stopped";
}): React.JSX.Element {
  return (
    <>
      {/* ONE run-level figure, not one per child. Upstream's per-child `usage`
          carries no provider, so only the run's own session files can be
          classified honestly (PRD §19) — per-child rows keep tokens and turns.
          The live card and a reopened one both get this from the same parser
          over the same files, so they cannot disagree. */}
      {cost && (
        <div className="flex items-center gap-2 text-[11px] font-mono text-ink-soft" title="This delegation's spend — an estimate, like every cost in the app">
          <span>{fmtNum(cost.input + cost.output)} tok</span>
          <span>·</span>
          <span>{costEstimateLabel(cost)}</span>
        </div>
      )}
      {/* A restored delegation has no transcript (the completion arrives as a
          notify, which the session file does not record structurally), but it
          DOES have a cost — so "waiting" would be a lie about a run that
          finished long ago. */}
      {results.length === 0 && !cost && !outcome && (
        <p className="text-xs text-ink-soft italic">Waiting for the subagent to respond…</p>
      )}
      {results.map((r, i) => (
        <div key={i} className="rounded-lg border border-line bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line text-[11px]">
            <span className="font-bold">{r.agent}</span>
            {r.model && <span className="font-mono text-ink-soft">{r.model}</span>}
            <span className="flex-1" />
            {subagentUsageLine(r.usage) && (
              <span className="font-mono text-ink-soft" title="input/output tokens · turns">
                {subagentUsageLine(r.usage)}
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
  sessionId,
  onOpenFile,
}: {
  card: ToolCardData;
  /** W2.2: session workspace — card paths resolve against it. */
  workspace?: string | null;
  /** §12 (2026-08-30): needed only by the subagent card, which inspects a
   *  finished child by asyncId — inspection is session-scoped. */
  sessionId?: string | null;
  onOpenFile?: (relPath: string) => void;
}): React.JSX.Element {
  if (card.toolName === "subagent") return <SubagentCard card={card} sessionId={sessionId} />;
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
  // §31: main computes the facts line and sends it structured on `details`, so
  // the card renders one string rather than re-deriving a format from raw
  // numbers — the same division of labour the delegation cards use.
  const factsLine =
    card.toolName === "document_read"
      ? ((card.result as { details?: { factsLine?: unknown } } | undefined)?.details?.factsLine as string | undefined)
      : undefined;
  return (
    <div
      // A1: the generic root serves `terminal_run` too, so it is the other
      // take-off point for the flight.
      data-hv-run-card={card.toolCallId}
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
              (a pulse says "still going" better than any shape can).

              B1 (2026-09-10): running → done is the one moment this card
              reports an outcome, so the dot POPS on the change. `key` is the
              status, which remounts the span and lets `@starting-style` fire;
              without it React reuses the node and there is no enter to play.
              The colour transitions too, so a card that merely changes shade
              does not jump. */}
          <span
            key={card.status}
            className={`size-2.5 rounded-full shrink-0 motion-safe:transition-[scale,background-color] motion-safe:duration-200 motion-safe:ease-hv-pop motion-safe:starting:scale-50 ${s.dot}`}
            title={s.label}
            aria-label={s.label}
            role="img"
          />
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
        {/* §31: what the model actually got — family, size and the slice it was
            shown. Muted, beside the path, because it is a receipt rather than a
            headline. */}
        {factsLine && (
          <span className="shrink-0 font-mono text-[11px] text-ink-soft" title={factsLine}>
            {factsLine}
          </span>
        )}
        {/* Round 15: the badges are icons, each carrying the word it replaced in
            `title` + aria-label. Only badges that say something the status DOT
            cannot survive here: who approved the call, why it was skipped, and
            whether the command destroys something. "Denied" was dropped — the
            dot and the berry border already say it, twice over. */}
        {card.approval && (
          <CardGlyph mark={card.approval === "Allow" ? BADGE_MARKS.allowed : BADGE_MARKS.session} />
        )}
        {/* §23: a tool blocked by plan mode reads as calm guidance, not an error. */}
        {card.status === "skipped" && <CardGlyph mark={BADGE_MARKS.plan} />}
        {/* V2.A: destructive bash command (rm/rmdir) — flagged next to the status. */}
        {destructive && <CardGlyph mark={BADGE_MARKS.destructive} />}
        <DetailsToggle open={details} onClick={() => setDetails(!details)} />
      </div>
      {diff && openDiff && <DiffView lines={diff.lines} />}
      {/* §33: what was remembered, on the card itself rather than behind `details`.
          The whole promise is that nothing is saved behind your back, so the memory has to be
          visible where the save happened — a JSON envelope three clicks away is not that. */}
      <MemoryCardBody card={card} workspaceId={workspace ?? null} />
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
      {/* Round 16: a command's output belongs on the card, not three clicks
          away inside a JSON envelope. Three lines, the same tail the terminal
          run rail shows on hover — ⋯ still has the whole thing. */}
      {!details && OUTPUT_TOOLS.has(card.toolName) && card.status !== "error" && (() => {
        const text = resultText(card.result);
        const tail = text ? previewLines(card.toolName, text) : [];
        return tail.length === 0 ? null : (
          <button
            type="button"
            onClick={() => setDetails(true)}
            title="Show the full output"
            className="block w-full text-left border-t-2 border-line bg-paper-deep/60 px-3.5 py-2 font-mono text-[11px] leading-snug text-ink-soft hover:bg-paper-deep cursor-pointer"
          >
            {tail.map((l, i) => (
              <span key={i} className="block truncate">{l}</span>
            ))}
          </button>
        );
      })()}
      {/* B1: the same unfold. `details` mounts only when open — the raw
          envelope can be very large, and paying to render it while collapsed
          is the cost this reveal must not introduce. */}
      <div className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-180 motion-safe:ease-hv-out ${details ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">{details && <TechnicalDetails card={card} />}</div>
      </div>
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

/**
 * §33 — a LIVE memory card's fields, off the tool result's structured `details` sibling.
 *
 * Exported so a test can drive it with the real wire shape: the renderer suite has no DOM, so
 * the only way to pin the live path is to assert on this function rather than on the card.
 */
export function memoryFromResult(result: unknown): ToolCardData["memory"] | undefined {
  const d = (result as { details?: Record<string, unknown> } | undefined)?.details;
  if (!d || typeof d.name !== "string" || !d.name) return undefined;
  return {
    scope: d.scope === "workspace" ? "workspace" : "global",
    name: d.name,
    ...(typeof d.type === "string" ? { type: d.type } : {}),
    ...(typeof d.description === "string" ? { description: d.description } : {}),
    ...(typeof d.replaced === "boolean" ? { replaced: d.replaced } : {}),
  };
}

/**
 * §33 — what a memory card may offer, given what the store says.
 *
 * Exported and pure because the renderer suite has no DOM: the rule is pinned here, and the
 * component only lays it out.
 *
 * "checking" is not a loading spinner — it is the state in which the card MAKES NO CLAIM. It
 * covers both the moment before the answer arrives and the case where memory is switched off,
 * because in neither does the card know whether the memory is still there. Saying "Forgotten."
 * about a file that is still on disk would be the same class of lie this whole feature is
 * built to avoid.
 */
export type MemoryCardState = "checking" | "present" | "gone";

export function memoryCardState(presence: HvMemoryPresence | null, forgottenHere: boolean): MemoryCardState {
  // A Forget clicked on THIS card wins outright: the answer below may predate it.
  if (forgottenHere) return "gone";
  if (presence === null || presence === "unavailable") return "checking";
  return presence === "yes" ? "present" : "gone";
}

/**
 * §33 — a memory card's body: the fact, and a Forget that undoes it in one click.
 *
 * Forget is the UNDO for a save, and it is why rewind says nothing about memory: memory lives
 * outside the workspace, so a rewind never touches it, and this button is the way back.
 *
 * Reads `card.memory` (the structured field) rather than the result text, so a RESTORED card —
 * which has only what restore.ts named — renders exactly the same as a live one.
 */
function MemoryCardBody({ card, workspaceId }: { card: ToolCardData; workspaceId: string | null }): React.JSX.Element | null {
  // `workspaceId` is the workspace PATH: WorkspaceRegistry keys by path, so the id the IPC
  // wants and the `workspace` prop the card already receives are the same string.
  const [forgotten, setForgotten] = useState(false);
  const [busy, setBusy] = useState(false);
  // Does it still exist? A REOPENED transcript otherwise offers Forget for a memory that is
  // already gone — reported after a memory saved in one session had been forgotten later, and
  // the card still showed the button. The transcript is right to keep the card (a save DID
  // happen); it is the affordance that has to tell the truth.
  //
  // A memory re-saved under the same name is deliberately treated as present: upsert-by-name is
  // the model's whole identity rule, so the same name IS that memory, updated.
  const [presence, setPresence] = useState<HvMemoryPresence | null>(null);
  // TWO sources, and needing both is the whole lesson of this card.
  //
  // A RESTORED card has only what restore.ts named (`card.memory`); a LIVE one has never been
  // through restore and carries the tool result itself, with the same fields on its `details`.
  // The first cut read only the structured field, so the live card — the one you see the moment
  // you approve a save — rendered its headline and nothing else: no body, no Forget. Every unit
  // test fed a restored card and passed. Found in the GUI, exactly as §12's delegation card was.
  const mem = card.memory ?? memoryFromResult(card.result);
  const isSaveCard = card.toolName === "memory_save";
  const scope = mem?.scope;
  const name = mem?.name;
  useEffect(() => {
    // Only a SAVE card offers Forget, so only it needs to ask. One local read on mount; the
    // answer is not re-polled, because the card is a record of a past turn, not a live view.
    if (!isSaveCard || !scope || !name) return;
    let live = true;
    void window.hv
      .memoryExists(scope, scope === "workspace" ? workspaceId : null, name)
      .then((p) => {
        if (live) setPresence(p);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isSaveCard, scope, name, workspaceId]);
  if (!mem || !card.toolName.startsWith("memory_")) return null;
  // Nothing was saved, so there is nothing to show or undo.
  if (card.status === "error" || card.status === "denied") return null;

  const body = resultText(card.result);
  const isRecall = card.toolName === "memory_recall";
  const state = memoryCardState(presence, forgotten);

  return (
    <div className="border-t-2 border-line bg-paper-deep/40 px-3.5 py-2.5">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border border-ink/20 bg-ink/5 px-2 py-0.5 text-ink-soft">
          {/* "everywhere", not "about you": the KIND pill beside this one already says "About
              you" for a `user` memory, and the GUI pass showed the two rendering as ABOUT YOU ·
              ABOUT YOU. The scope answers WHERE it applies; the kind answers WHAT it is. */}
          {mem.scope === "workspace" ? "this project" : "everywhere"}
        </span>
        {mem.type && (
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border border-ink/20 bg-ink/5 px-2 py-0.5 text-ink-soft">
            {MEMORY_TYPE_LABEL[mem.type] ?? mem.type}
          </span>
        )}
        <span className="font-bold text-sm break-words">{mem.name}</span>
      </div>
      {mem.description && <p className="text-sm text-ink-soft mb-1.5 break-words">{mem.description}</p>}
      {/* On a recall the RESULT is the memory; on a save the body is what the model sent, which
          the result line does not repeat. Either way, show what is now remembered. */}
      {isRecall && body && (
        <pre className="rounded-lg border-2 border-line bg-paper px-3 py-2 text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
          {body}
        </pre>
      )}
      {isSaveCard && state === "gone" && <p className="text-xs font-bold text-ink-soft">Forgotten.</p>}
      {isSaveCard &&
        state === "present" &&
        (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void window.hv
                .memoryForget(mem.scope, mem.scope === "workspace" ? workspaceId : null, mem.name)
                .then((ok) => {
                  setForgotten(ok);
                  setBusy(false);
                });
            }}
            className="rounded-lg border-2 border-line bg-card px-2.5 py-1 text-xs font-bold text-berry shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50"
          >
            Forget this
          </button>
        )}
    </div>
  );
}
