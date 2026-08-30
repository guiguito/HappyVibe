import { useEffect, useState } from "react";

/** hv.audit payload logged by main as permission.decision (docs/validation/d1.md §B4). */
interface Decision {
  ts: string;
  sessionId?: string;
  workspaceId?: string;
  tool: string;
  summary: string;
  decision: "allow" | "allow-session" | "deny";
  /** "dangerous" is the pre-round-15 name for "bypass" — old logs keep it. */
  source: "rule" | "user" | "bypass" | "dangerous" | "safe-default" | "plan" | "terminal" | "subagent";
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

export type Row =
  | ({ row: "decision" } & Decision)
  | ({ row: "oneshot" } & OneShot)
  | ({ row: "excluded" } & ModelExcluded);

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
  return { row: "decision", ...(e.data as unknown as Decision), ...base };
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
const SOURCE_LABEL: Record<string, string> = { dangerous: "bypass", subagent: "sub-agent" };
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
    return (!decision || r.decision === decision) && (!source || (SOURCE_LABEL[r.source] ?? r.source) === source);
  };
  const shown = rows?.filter(matches) ?? null;

  const sessionTitle = (id?: string): string => sessions.find((s) => s.id === id)?.title ?? (id ? id.slice(0, 8) : "—");
  const wsSessions = workspaceId ? sessions.filter((s) => s.workspaceId === workspaceId) : sessions;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Audit log</h1>
        <p className="text-sm text-ink-soft mb-6">Every permission decision — and every model call the app made on your behalf — per session and per workspace.</p>

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
            <option value="terminal">Terminal</option>
            <option value="assistant">The app itself</option>
            <option value="model">Model availability</option>
          </select>
        </div>

        {shown === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-soft">
            {rows?.length ? "No decisions match these filters." : "No permission decisions logged yet."}
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
