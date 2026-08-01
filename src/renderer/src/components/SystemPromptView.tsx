import { useEffect, useState } from "react";
import { Section } from "./Section";

/**
 * Round 8: the System Prompt section of the old Settings scroll, promoted to
 * its own page. Round 8 also removed the per-workspace additions layer (the
 * same idea as AGENTS.md, told twice) — what remains is global.
 */

const smallBtn =
  "rounded-lg border-2 px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

/** hv.sysprompt notify payload, else null (docs/validation/d1.md §hv.sysprompt). */
function parseSysprompt(r: { method?: string; message?: string }): { text: string | null } | null {
  if (r.method !== "notify") return null;
  try {
    const p = JSON.parse(r.message ?? "") as { kind?: string; text?: string | null };
    return p?.kind === "hv.sysprompt" ? { text: p.text ?? null } : null;
  } catch {
    return null;
  }
}

// Round 4 #8: the resolved prompt is only produced by a running turn, so cache
// the last one we saw — this is what makes it visible in Settings at launch
// (before any session runs this app start).
const SYSPROMPT_CACHE_KEY = "hv:sysprompt-cache";

export function SystemPromptView({ sessionId }: { sessionId: string | null }): React.JSX.Element {
  // undefined = nothing cached and no notify yet; null = captured "no prompt yet".
  const cached = typeof localStorage !== "undefined" ? localStorage.getItem(SYSPROMPT_CACHE_KEY) : null;
  const [resolved, setResolved] = useState<string | null | undefined>(cached ?? undefined);
  const [fromCache, setFromCache] = useState(cached != null);
  const [additions, setAdditions] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.hv.getGlobalAppend().then((c) => setAdditions(c ?? ""));
    const off = window.hv.onUiRequest((r) => {
      const p = parseSysprompt(r);
      if (!p) return;
      // A live turn resolved the prompt — cache it and show it as current.
      // A null payload (no turn yet) leaves any cached value in place.
      if (p.text) {
        localStorage.setItem(SYSPROMPT_CACHE_KEY, p.text);
        setResolved(p.text);
        setFromCache(false);
      }
    });
    void window.hv.sysPromptSnapshot(sessionId ?? undefined);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (): Promise<void> => {
    await window.hv.setGlobalAppend(additions);
    setDirty(false);
    setSaved(true);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">System prompt</h1>
        <p className="text-sm text-ink-soft mb-8">
          What the main agent is told before every conversation. The base prompt is the same for every session; your
          additions layer on top of it.
        </p>

        <Section
          icon="sysprompt"
          title="Resolved prompt"
          subtitle="Exactly what the agent sees, read-only — the same honesty as the context panel."
        >
          <div className="flex items-center gap-2 mb-2">
            {resolved && fromCache && <span className="text-[10px] text-ink-soft/70">from your last session</span>}
          </div>
          {resolved ? (
            <pre className="font-mono text-xs bg-ink text-paper rounded-xl px-4 py-3 overflow-auto whitespace-pre-wrap break-words max-h-96">
              {resolved}
            </pre>
          ) : (
            <p className="text-sm text-ink-soft rounded-xl border-2 border-dashed border-line px-4 py-3">
              {resolved === undefined && sessionId
                ? "Fetching the resolved prompt…"
                : "Run a session once and the resolved prompt is captured and shown here (it stays visible afterwards)."}
            </p>
          )}
        </Section>

        <Section icon="sysprompt" title="Your additions" subtitle="Appended to the system prompt for every workspace.">
          <textarea
            value={additions}
            onChange={(e) => {
              setAdditions(e.target.value);
              setDirty(true);
              setSaved(false);
            }}
            rows={8}
            placeholder="Extra instructions appended to the system prompt for every workspace…"
            className="w-full font-mono text-xs rounded-xl border-2 border-line bg-paper px-3 py-2.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60 resize-y"
          />
          <div className="flex items-center gap-2 mt-2">
            <p className="text-xs text-ink-soft flex-1">
              Applies to new or restarted sessions. For instructions that belong to one project, use that project&apos;s
              AGENTS.md instead.
            </p>
            {saved && <span className="text-xs font-bold text-leaf shrink-0">Saved.</span>}
            <button
              type="button"
              disabled={!dirty}
              onClick={() => void save()}
              className={`${smallBtn} bg-tangerine text-paper border-tangerine-deep enabled:hover:brightness-105 disabled:opacity-40 shrink-0`}
            >
              Save
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
