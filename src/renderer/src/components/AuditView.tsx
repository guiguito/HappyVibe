import { useEffect, useState } from "react";

/**
 * §20 round 17 — the one thing this page never explained.
 *
 * Exported as data because the renderer suite has no DOM. Deliberately does NOT
 * restate what every row already says: with a bypass switched on every row is a
 * bypass, and round 15 already learned that repeating it per row highlights
 * nothing (see SOURCE_TONE below).
 */
export const AUDIT_COPY = {
  wouldHave:
    "When a call was let through by a bypass rather than by your rules, the row also says what your rules would have answered on their own — allow, ask or deny.",
} as const;

/** hv.audit payload logged by main as permission.decision (docs/validation/d1.md §B4). */
interface Decision {
  ts: string;
  sessionId?: string;
  workspaceId?: string;
  tool: string;
  summary: string;
  decision: "allow" | "allow-session" | "deny";
  /** "dangerous" is the pre-round-15 name for "bypass" — old logs keep it. */
  source: "rule" | "user" | "bypass" | "dangerous" | "safe-default" | "plan" | "readonly" | "terminal" | "subagent" | "web" | "document";
  /** §12 FR7: set on a decision made INSIDE a sub-agent child. */
  agent?: string;
  runId?: string;
  /** §12 FR7: the child decision was allowed by the bypass, not by a rule. */
  bypass?: boolean;
  /** Round 15: on a bypassed row, what the rule engine would have decided. */
  wouldHave?: "allow" | "ask" | "deny";
  rule?: HvRule & { scope: string };
}

/**
 * Round 15 — the app's own model calls, logged beside the permission rows.
 *
 * These are the four `pi -p --no-session` calls no session ever sees (§19), and
 * the reason they appear HERE rather than only in Stats is the question that
 * asked for them: "does it appear in the audit log?" A call the app made on the
 * user's behalf is exactly the kind of thing an audit log is for.
 *
 * Tokens, labelled estimated. There is no usage record for a sessionless call,
 * so a dollar figure would be invented — see src/main/oneShotLog.ts.
 */
interface OneShot {
  ts: string;
  workspaceId?: string;
  sessionId?: string;
  kind: "title" | "commit-message" | "pr-draft";
  model: string;
  estTokens: number;
  ok: boolean;
}

/**
 * §19 — a model the app is silently NOT using.
 *
 * pi-subagents caches "this model failed" verdicts and then skips the model on
 * every later delegation, saying so only on stderr. The chat keeps showing the
 * model the user picked while their sub-agents run on a fallback, so the fact
 * belongs here: it is something the app did on their behalf, with no decision to
 * make and no cost of its own. See src/main/modelExclusions.ts.
 */
interface ModelExcluded {
  ts: string;
  workspaceId?: string;
  sessionId?: string;
  model?: string;
  notice: string;
  expiresAt?: number;
}

/**
 * §33 — a memory event. Never carries the body: the audit log is readable, exportable and
 * long-lived, and §19's rule is telemetry without content. Scope, kind, name and (for a save)
 * the one-line description are what a reader needs to know what changed.
 */
interface MemoryEvent {
  ts: string;
  workspaceId?: string;
  sessionId?: string;
  kind: "saved" | "refused" | "recalled" | "forgotten" | "edited" | "imported";
  scope?: "global" | "workspace";
  type?: string;
  name?: string;
  description?: string;
  reason?: string;
  replaced?: boolean;
  who?: "agent" | "human";
  count?: number;
}

/**
 * §34 — a feedback submission that LEFT the machine, on the user's say-so.
 *
 * Counts, sizes and ids only: never an answer, never the clientContext. The
 * audit log is readable, exportable and long-lived, and §19's rule is telemetry
 * without content — a feedback report is the one place a user's own words could
 * most easily leak into it.
 */
interface FeedbackEvent {
  ts: string;
  workspaceId?: string;
  sessionId?: string;
  database: "general" | "session";
  formVersion: number;
  submissionId: string;
  status: "accepted" | "duplicate";
  attachments: number;
  bytes: number;
  channel?: string;
}

/**
 * §35: what a schedule did, as a sentence.
 *
 * DERIVED nowhere — this record is the labels, and a test asserts every
 * `schedule.*` type main emits has one, so a new event type surfaces as a red
 * test rather than as a row reading `schedule.whatever`.
 */
export const SCHEDULE_EVENT_LABELS: Record<string, string> = {
  "schedule.create": "created schedule",
  "schedule.update": "changed schedule",
  "schedule.delete": "deleted schedule",
  "schedule.fire": "schedule fired",
  "schedule.skip": "schedule skipped",
  "schedule.done": "schedule run ended",
  "schedule.missed": "schedule missed its time",
};

interface ScheduleEvent {
  ts: string;
  workspaceId?: string;
  sessionId?: string;
  kind: string;
  scheduleId?: string;
  title?: string;
  mode?: string;
  recurrence?: string;
  reason?: string;
  outcome?: string;
  durationMs?: number;
  source?: "user" | "agent";
}

export type Row =
  | ({ row: "decision" } & Decision)
  | ({ row: "oneshot" } & OneShot)
  | ({ row: "excluded" } & ModelExcluded)
  | ({ row: "memory" } & MemoryEvent)
  | ({ row: "schedule" } & ScheduleEvent)
  | ({ row: "feedback" } & FeedbackEvent);

/**
 * One EventLog row → one display row.
 *
 * Exported ONLY so a test can drive it with the real event shapes. It exists as
 * a named function because the inline version discriminated on `data.kind` and
 * misfiled every permission decision: the bridge's audit envelope carries
 * `kind: "hv.audit"` and main stores that payload verbatim, so the field is on
 * BOTH kinds of row. The page then read `estTokens` off a permission decision
 * and rendered nothing at all. Discriminate on the event TYPE — the thing main
 * actually keys rows by.
 */
export function toAuditRow(e: HvAuditEvent): Row {
  const base = { ts: e.ts, sessionId: e.sessionId, workspaceId: e.workspaceId };
  if (e.type === "assistant.oneshot") return { row: "oneshot", ...(e.data as unknown as OneShot), ...base };
  if (e.type === "model.excluded") return { row: "excluded", ...(e.data as unknown as ModelExcluded), ...base };
  if (e.type === "feedback.sent") return { row: "feedback", ...(e.data as unknown as FeedbackEvent), ...base };
  // §35: same rule — discriminate on the TYPE main keyed the row by.
  if (e.type.startsWith("schedule.")) {
    return { row: "schedule", kind: e.type, ...(e.data as unknown as Omit<ScheduleEvent, "kind">), ...base };
  }
  // §33: discriminate on the event TYPE, like every row above — the data payload carries a
  // `kind` field too, and reading THAT is the bug this function was extracted to fix.
  if (e.type.startsWith("memory.")) {
    return { row: "memory", kind: e.type.slice("memory.".length) as MemoryEvent["kind"], ...(e.data as unknown as Omit<MemoryEvent, "kind">), ...base };
  }
  return { row: "decision", ...(e.data as unknown as Decision), ...base };
}

/**
 * §33 — the app's own words for the six memory events. "Remembered" and "forgot" are the UI's
 * vocabulary everywhere (§33's word list), so the log says the same thing the card said.
 *
 * Exported for tests: the renderer suite has no DOM, so wording is pinned as data.
 */
/**
 * The app's own words for a submission. Exported for tests: the renderer suite
 * has no DOM, so wording is pinned as data (§20's two-halves rule).
 */
export function feedbackText(r: FeedbackEvent): string {
  if (r.database === "session") return "Rated the session";
  if (r.status === "duplicate") return "Sent feedback · already received";
  if (r.attachments === 0) return "Sent feedback";
  return `Sent feedback · ${r.attachments} screenshot${r.attachments === 1 ? "" : "s"}`;
}

export function memoryText(r: MemoryEvent): string {
  const who = r.who === "human" ? "you " : "";
  const scope = r.scope === "workspace" ? " (this project)" : "";
  switch (r.kind) {
    case "saved":
      return `${r.replaced ? "updated a memory" : "remembered"}${scope}`;
    case "refused":
      return `refused to remember${scope}`;
    case "recalled":
      return `recalled a memory${scope}`;
    case "forgotten":
      return `${who}forgot a memory${scope}`;
    case "edited":
      return "you edited a memory";
    case "imported":
      return `imported ${r.count ?? 0} memories from Claude Code`;
    default:
      return r.kind;
  }
}

const ONESHOT_LABEL: Record<OneShot["kind"], string> = {
  title: "named a session",
  "commit-message": "wrote a commit message",
  "pr-draft": "drafted a pull request",
};

/**
 * Round 15 — how a source renders.
 *
 * The old code special-cased ONE value into red (`dangerous`), which with a
 * bypass switched on meant every row in the log was red — the colour stopped
 * meaning "look at this" and started meaning "the setting is on". Red now
 * belongs to what a command DOES (the card's destructive badge), never to the
 * mode it ran under, so bypass reads calm and amber marks it as unusual
 * without shouting.
 */
const SOURCE_LABEL: Record<string, string> = { dangerous: "bypass", subagent: "sub-agent", web: "web tools", readonly: "read-only run" };
/**
 * No tone at all — every source renders in the same muted ink.
 *
 * The first attempt kept an amber for `bypass`, and a GUI pass killed it: with a
 * bypass switched on EVERY row is a bypass, so a highlight colour highlights
 * nothing and simply restates the complaint in a new hue. The signal moved to
 * where it can actually vary — the `· rules would have asked` clause, which
 * differs per call — and to the filters. That a bypass is active is already
 * said, loudly and once, by the red banner in every affected session; the log
 * does not need to say it a thousand more times.
 */
const SOURCE_TONE: Record<string, string> = {};

/**
 * "bypass · rules would have asked" — the sentence the column exists for.
 *
 * §12: a sub-agent row NAMES the agent. Without it a denial reads as coming from
 * the session itself, and the one thing a reader needs to know about a child's
 * decision is which child made it.
 *
 * Exported for tests: the renderer suite has no DOM, so the wording is pinned as
 * data (the tests/modal-layer.test.ts pattern).
 */
export function sourceText(r: Decision): string {
  const label = SOURCE_LABEL[r.source] ?? r.source;
  const named = r.source === "subagent" && r.agent ? `${label} ${r.agent}` : label;
  // A child row under bypass says BOTH: which child, and that the bypass decided.
  // Folding it to plain "bypass" made a sub-agent's actions indistinguishable
  // from the parent's, which is the one thing these rows must not do.
  const base = r.source === "subagent" && r.bypass ? `${named} · bypass` : named;
  const would =
    r.wouldHave === "ask" ? "rules would have asked"
    : r.wouldHave === "deny" ? "rules would have DENIED"
    : r.wouldHave === "allow" ? "rules would have allowed"
    : "";
  const rule = r.rule ? ` · ${r.rule.pattern}` : "";
  return would ? `${base} · ${would}${rule}` : `${base}${rule}`;
}

const DECISION_TONE: Record<string, string> = {
  deny: "bg-berry-soft text-berry border-berry/50",
  allow: "bg-leaf-soft text-leaf border-leaf/50",
  "allow-session": "bg-leaf-soft text-leaf border-leaf/50",
};

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function AuditView({
  sessions,
  workspaces,
}: {
  sessions: SessionMeta[];
  workspaces: string[];
}): React.JSX.Element {
  const [workspaceId, setWorkspaceId] = useState("");
  const [sessionId, setSessionId] = useState("");
  // Round 15: with a bypass on, the log is thousands of allows. Filtering by
  // decision is how you find the denies; by source, how you find the rows a
  // RULE decided rather than the mode. Client-side over rows already in hand —
  // the read is already scoped by workspace/session in main.
  const [decision, setDecision] = useState("");
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let stale = false;
    const filter: { sessionId?: string; workspaceId?: string } = {};
    if (sessionId) filter.sessionId = sessionId;
    else if (workspaceId) filter.workspaceId = workspaceId;
    void window.hv.readAudit(filter).then((events) => {
      if (stale) return;
      setRows(
        events
          .map(toAuditRow)
          .reverse(), // newest first
      );
    });
    return () => {
      stale = true;
    };
  }, [workspaceId, sessionId]);

  // "bypass" selects the old "dangerous" rows too — one name, one filter, or
  // the log silently hides everything recorded before the rename.
  const matches = (r: Row): boolean => {
    // A one-shot has no decision and no rule source; it answers to the source
    // filter under its own name so it can be isolated or excluded, and it is
    // hidden whenever a DECISION filter is on, because it is not one.
    if (r.row === "oneshot") return !decision && (!source || source === "assistant");
    // Not a decision either: it answers to the source filter under its own name.
    if (r.row === "excluded") return !decision && (!source || source === "model");
    // §33: a memory event is not a permission decision either — the DECISION that let it
    // happen is its own row, right beside this one. It answers to the source filter under its
    // own name so it can be isolated or excluded.
    if (r.row === "memory") return !decision && (!source || source === "memory");
    // §34: not a decision either. Its own source name, so it can be isolated or
    // excluded, and hidden whenever a DECISION filter is on.
    if (r.row === "feedback") return !decision && (!source || source === "feedback");
    // §35: a schedule event is not a permission decision — the run's own tool
    // calls are those, under this same log. Its own source name so it can be
    // isolated, which is how you answer "what has this thing been doing".
    if (r.row === "schedule") return !decision && (!source || source === "schedule");
    return (!decision || r.decision === decision) && (!source || (SOURCE_LABEL[r.source] ?? r.source) === source);
  };
  const shown = rows?.filter(matches) ?? null;

  const sessionTitle = (id?: string): string => sessions.find((s) => s.id === id)?.title ?? (id ? id.slice(0, 8) : "—");
  const wsSessions = workspaceId ? sessions.filter((s) => s.workspaceId === workspaceId) : sessions;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Audit log</h1>
        <p className="text-sm text-ink-soft mb-2">Every permission decision — and every model call the app made for you, without being asked — per session and per workspace.</p>
        <p className="text-sm text-ink-soft mb-6">{AUDIT_COPY.wouldHave}</p>

        <div className="flex gap-3 mb-5">
          <select
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value);
              setSessionId("");
            }}
            className="rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
          >
            <option value="">All workspaces</option>
            {workspaces.map((ws) => (
              <option key={ws} value={ws}>
                {basename(ws)}
              </option>
            ))}
          </select>
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
          >
            <option value="">All sessions</option>
            {wsSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            aria-label="Filter by decision"
            className="rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
          >
            <option value="">Any decision</option>
            <option value="allow">Allowed</option>
            <option value="allow-session">Allowed for session</option>
            <option value="deny">Denied</option>
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Filter by source"
            className="rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
          >
            <option value="">Any source</option>
            <option value="rule">Rule</option>
            <option value="user">You</option>
            <option value="safe-default">Safe default</option>
            <option value="bypass">Bypass</option>
            <option value="plan">Plan mode</option>
            <option value="readonly">Read-only run</option>
            <option value="schedule">Schedules</option>
            <option value="terminal">Terminal</option>
            <option value="web">Web tools</option>
            <option value="assistant">The app itself</option>
            <option value="model">Model availability</option>
            <option value="memory">Memory</option>
            <option value="feedback">Feedback</option>
          </select>
        </div>

        {shown === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-soft">
            {rows?.length ? "No decisions match these filters." : "No permission decisions yet — they appear here once the agent asks for something."}
          </p>
        ) : (
          <div className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg overflow-hidden">
            {shown.map((r, i) => (
              <div key={`${r.ts}-${i}`} className="px-4 py-2.5 border-b border-line last:border-b-0 text-sm">
                {r.row === "excluded" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 text-ink-soft">
                        model
                      </span>
                      <span className="font-bold shrink-0">{r.model ?? "a model"} not in use</span>
                      <span className="flex-1" />
                      <span className="text-xs text-ink-soft shrink-0" title={r.ts}>
                        {new Date(r.ts).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-ink-soft flex-1 min-w-0">{r.notice}</span>
                      <span className="text-[10px] text-ink-soft/70 shrink-0" title={r.workspaceId}>
                        {r.workspaceId ? basename(r.workspaceId) : ""}
                      </span>
                    </div>
                  </>
                ) : r.row === "memory" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 text-ink-soft">
                        memory
                      </span>
                      <span className="font-bold shrink-0">{memoryText(r)}</span>
                      <span className="text-xs text-ink-soft truncate min-w-0">{r.name}</span>
                      <span className="flex-1" />
                      <span className="text-xs text-ink-soft shrink-0" title={r.ts}>
                        {new Date(r.ts).toLocaleString()}
                      </span>
                    </div>
                    {(r.description || r.reason) && (
                      <div className="text-xs text-ink-soft mt-0.5 truncate">{r.reason ?? r.description}</div>
                    )}
                  </>
                ) : r.row === "schedule" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 text-ink-soft">
                        schedule
                      </span>
                      <span className="font-bold shrink-0">{SCHEDULE_EVENT_LABELS[r.kind] ?? r.kind}</span>
                      <span className="text-xs text-ink-soft truncate min-w-0">{r.title}</span>
                      <span className="flex-1" />
                      <span className="text-xs text-ink-soft shrink-0" title={r.ts}>
                        {new Date(r.ts).toLocaleString()}
                      </span>
                    </div>
                    {(r.reason || r.outcome || r.recurrence) && (
                      <div className="text-xs text-ink-soft mt-0.5 truncate">
                        {[r.recurrence, r.outcome, r.reason, r.source === "agent" ? "asked for by the agent" : null].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </>
                ) : r.row === "feedback" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 text-ink-soft">
                        feedback
                      </span>
                      <span className="font-bold shrink-0">{feedbackText(r)}</span>
                      <span className="flex-1" />
                      <span className="text-xs text-ink-soft shrink-0" title={r.ts}>
                        {new Date(r.ts).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0">
                        {r.submissionId} · form v{r.formVersion}
                        {r.bytes > 0 ? ` · ${Math.max(1, Math.round(r.bytes / 1024))} KB` : ""}
                      </code>
                      <span className="text-[10px] text-ink-soft/70 shrink-0" title={r.workspaceId}>
                        {r.workspaceId ? basename(r.workspaceId) : ""}
                      </span>
                    </div>
                  </>
                ) : r.row === "oneshot" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 text-ink-soft">
                        {r.ok ? "assistant" : "assistant · failed"}
                      </span>
                      <span className="font-bold shrink-0">{ONESHOT_LABEL[r.kind] ?? r.kind}</span>
                      <span className="flex-1" />
                      <span className="text-xs text-ink-soft shrink-0" title={r.ts}>
                        {new Date(r.ts).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0">
                        {r.model} · ~{r.estTokens.toLocaleString()} tok (estimated)
                      </code>
                      <span className="text-[10px] text-ink-soft/70 shrink-0" title={r.workspaceId}>
                        {r.workspaceId ? basename(r.workspaceId) : ""}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 ${DECISION_TONE[r.decision] ?? "bg-paper-deep text-ink-soft border-line"}`}
                      >
                        {r.decision}
                      </span>
                      <span className="font-bold shrink-0">{r.tool}</span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${SOURCE_TONE[r.source] ?? "text-ink-soft"}`}
                        title={r.rule ? `${r.rule.scope} ${r.rule.layer} rule: ${r.rule.pattern}` : undefined}
                      >
                        {sourceText(r)}
                      </span>
                      <span className="flex-1" />
                      <span className="text-xs text-ink-soft shrink-0" title={r.ts}>
                        {new Date(r.ts).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="font-mono text-xs text-ink-soft truncate flex-1 min-w-0" title={r.summary}>
                        {r.summary}
                      </code>
                      <span className="text-[10px] text-ink-soft/70 shrink-0" title={r.workspaceId}>
                        {r.workspaceId ? basename(r.workspaceId) : ""} · {sessionTitle(r.sessionId)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
