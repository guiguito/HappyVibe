import { useEffect, useState } from "react";

/**
 * B4 rules editor — Global tab + one tab per workspace (overrides layer on
 * top; most-restrictive wins). Saving rewrites permission-rules.json in main,
 * which broadcasts /hv-rules-reload to every live session.
 */

const EMPTY: HvRulesFile = { global: [], workspaces: {} };
const LAYERS: HvRule["layer"][] = ["tool", "path", "command"];
const ACTIONS: HvRule["action"][] = ["allow", "ask", "deny"];

const smallBtn =
  "rounded-lg border-2 px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";
const field =
  "rounded-lg border-2 border-line bg-card px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-tangerine";

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

const VERDICT_TONE: Record<string, string> = {
  deny: "text-berry",
  ask: "text-ink",
  allow: "text-leaf",
};

function TestBox({ workspace }: { workspace: string }): React.JSX.Element {
  const [tool, setTool] = useState("bash");
  const [arg, setArg] = useState("");
  const [verdict, setVerdict] = useState<HvVerdict | null>(null);

  const run = async (): Promise<void> => {
    // bash-ish tools carry a command; everything else a path — same keys the engine scans.
    const input = tool === "bash" ? { command: arg } : { path: arg };
    setVerdict(await window.hv.evalRules(workspace, tool, input));
  };

  return (
    <div className="rounded-xl border-2 border-line bg-paper-deep px-4 py-3 mt-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-2">test a call</div>
      <form
        className="flex gap-2 items-center"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input value={tool} onChange={(e) => setTool(e.target.value)} placeholder="tool" className={`${field} w-24`} />
        <input
          value={arg}
          onChange={(e) => setArg(e.target.value)}
          placeholder={tool === "bash" ? "command…" : "path…"}
          className={`${field} flex-1 min-w-0 font-mono`}
        />
        <button type="submit" className={`${smallBtn} bg-card text-ink border-line hover:bg-paper`}>
          Evaluate
        </button>
      </form>
      {verdict && (
        <p className="text-xs mt-2">
          → <span className={`font-black uppercase ${VERDICT_TONE[verdict.action]}`}>{verdict.action}</span>{" "}
          <span className="text-ink-soft">
            {verdict.source === "rule" && verdict.rule
              ? `(${verdict.rule.scope} ${verdict.rule.layer} rule: ${verdict.rule.pattern})`
              : verdict.source === "safe-default"
                ? "(safe tool default)"
                : "(no rule matched — default is ask)"}
          </span>
        </p>
      )}
    </div>
  );
}

export function PermissionRulesSection(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [rules, setRules] = useState<HvRulesFile>(EMPTY);
  const [tab, setTab] = useState(""); // "" = global, else workspace path
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.hv.getRules().then(setRules);
    void window.hv.listWorkspaces().then(setWorkspaces);
  }, []);

  const current: HvRule[] = tab ? (rules.workspaces[tab] ?? []) : rules.global;

  const setCurrent = (next: HvRule[]): void => {
    setRules((r) => (tab ? { ...r, workspaces: { ...r.workspaces, [tab]: next } } : { ...r, global: next }));
    setDirty(true);
    setSaved(false);
  };

  const patch = (i: number, p: Partial<HvRule>): void => setCurrent(current.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const save = async (): Promise<void> => {
    setRules(await window.hv.setRules(rules)); // main sanitizes + broadcasts reload
    setDirty(false);
    setSaved(true);
  };

  const tabBtn = (id: string, label: string): React.JSX.Element => (
    <button
      key={id || "global"}
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-lg px-2.5 py-1 text-xs font-bold cursor-pointer border-2 ${
        tab === id ? "bg-honey-soft border-honey/60" : "border-transparent text-ink-soft hover:bg-paper-deep"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg p-6 mb-6">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1">permissions</div>
      <h2 className="font-bold text-lg mb-1">Rules</h2>
      <p className="text-sm text-ink-soft mb-4">
        Tool, path and command rules. Global first, workspace overrides on top — the most restrictive match wins
        (deny &gt; ask &gt; allow). No match falls back to asking you.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {tabBtn("", "Global")}
        {workspaces.map((ws) => tabBtn(ws, basename(ws)))}
      </div>

      <div className="flex flex-col gap-2">
        {current.length === 0 && <p className="text-xs text-ink-soft">No {tab ? "workspace" : "global"} rules yet.</p>}
        {current.map((r, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select value={r.layer} onChange={(e) => patch(i, { layer: e.target.value as HvRule["layer"] })} className={`${field} cursor-pointer`}>
              {LAYERS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <input
              value={r.pattern}
              onChange={(e) => patch(i, { pattern: e.target.value })}
              placeholder={r.layer === "tool" ? "bash" : r.layer === "path" ? "src/**" : "git push*"}
              className={`${field} flex-1 min-w-0 font-mono`}
            />
            <select value={r.action} onChange={(e) => patch(i, { action: e.target.value as HvRule["action"] })} className={`${field} cursor-pointer`}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="Delete rule"
              onClick={() => setCurrent(current.filter((_, j) => j !== i))}
              className="text-ink-soft hover:text-berry cursor-pointer font-bold text-sm px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => setCurrent([...current, { layer: "tool", pattern: "", action: "ask" }])}
          className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep`}
        >
          + Add rule
        </button>
        <span className="flex-1" />
        {saved && <span className="text-xs font-bold text-leaf">Saved — live in all sessions.</span>}
        <button
          type="button"
          disabled={!dirty || current.some((r) => !r.pattern.trim())}
          onClick={() => void save()}
          className={`${smallBtn} bg-tangerine text-paper border-tangerine-deep enabled:hover:brightness-105 disabled:opacity-40`}
        >
          Save rules
        </button>
      </div>

      <TestBox workspace={tab} />
    </section>
  );
}
