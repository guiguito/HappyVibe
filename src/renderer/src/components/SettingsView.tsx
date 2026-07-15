import { useEffect, useState } from "react";
import { parseAuth, type AuthEvent, type AuthProviderStatus } from "../auth";
import { AuthFlowModal } from "./AuthFlowModal";
import { PermissionRulesSection } from "./PermissionRulesSection";
import { AuditView } from "./AuditView";
import { DashboardView } from "./DashboardView";

/** OAuth "sign in with your plan" providers (PRD "Providers & models"). */
const OAUTH_PROVIDERS: { id: string; label: string; caveat?: string }[] = [
  {
    id: "anthropic",
    label: "Claude",
    // Honest billing caveat — locked product decision.
    caveat: "Heads up: on Claude Pro/Max this uses your plan's extra usage.",
  },
  { id: "github-copilot", label: "GitHub Copilot" },
  { id: "openai-codex", label: "ChatGPT (Codex)" },
];

const smallBtn =
  "rounded-lg border-2 px-3 py-1.5 text-xs font-bold shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

function Chip({ tone, children }: { tone: "leaf" | "honey" | "muted"; children: React.ReactNode }): React.JSX.Element {
  const cls =
    tone === "leaf"
      ? "bg-leaf-soft text-leaf border-leaf/50"
      : tone === "honey"
        ? "bg-honey-soft text-ink border-honey/60"
        : "bg-paper-deep text-ink-soft border-line";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

/** Section header icons — inline SVG, sidebar style (24 viewBox, stroke 2.2). */
const ICONS: Record<string, React.JSX.Element> = {
  llm: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  sysprompt: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </>
  ),
  permissions: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  audit: (
    <>
      <path d="M9 12h6M9 16h6M9 8h2" />
      <path d="M5 4a1 1 0 0 1 1-1h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
    </>
  ),
  dashboard: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
};

function SectionIcon({ name, className }: { name: string; className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "size-4 shrink-0"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg p-6 mb-6">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="size-8 rounded-lg bg-paper-deep border-2 border-line flex items-center justify-center shrink-0">
          <SectionIcon name={icon} />
        </div>
        <h2 className="font-bold text-lg">{title}</h2>
      </div>
      <p className="text-sm text-ink-soft mb-4">{subtitle}</p>
      {children}
    </section>
  );
}

/** Group label inside the "Add provider" area. */
function GroupLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mt-4 mb-2">{children}</div>;
}

// ── System Prompt section (W1.4) ─────────────────────────────────────────────

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

function SystemPromptSection({ sessionId }: { sessionId: string | null }): React.JSX.Element {
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
    <Section
      icon="sysprompt"
      title="System Prompt"
      subtitle="What the main agent is told before every conversation. The base prompt is the same (global) for every session; per-workspace additions layer on top."
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">resolved prompt (read-only)</span>
        {resolved && fromCache && <span className="text-[10px] text-ink-soft/70">· from your last session</span>}
      </div>
      {resolved ? (
        <pre className="font-mono text-xs bg-ink text-paper rounded-xl px-4 py-3 overflow-auto whitespace-pre-wrap break-words max-h-72 mb-4">
          {resolved}
        </pre>
      ) : (
        <p className="text-sm text-ink-soft rounded-xl border-2 border-dashed border-line px-4 py-3 mb-4">
          {resolved === undefined && sessionId
            ? "Fetching the resolved prompt…"
            : "Run a session once and the resolved prompt is captured and shown here (it stays visible afterwards)."}
        </p>
      )}

      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-2">your global additions</div>
      <textarea
        value={additions}
        onChange={(e) => {
          setAdditions(e.target.value);
          setDirty(true);
          setSaved(false);
        }}
        rows={6}
        placeholder="Extra instructions appended to the system prompt for every workspace…"
        className="w-full font-mono text-xs rounded-xl border-2 border-line bg-paper px-3 py-2.5 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60 resize-y"
      />
      <div className="flex items-center gap-2 mt-2">
        <p className="text-xs text-ink-soft flex-1">
          Applies to new or restarted sessions. A workspace with its own additions replaces these entirely for that
          workspace (they don't combine).
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
  );
}

// ── Settings view ────────────────────────────────────────────────────────────

type SettingsPage = "main" | "audit" | "dashboard";

/** Round 3 #14: global "Bypass ALL permissions" toggle. Enabling requires a
    scary confirm; while active every session shows a red banner. */
function GlobalBypassToggle(): React.JSX.Element {
  const [on, setOn] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { void window.hv.getGlobalBypass().then(setOn); }, []);
  return (
    <div className="mt-6 rounded-xl border-2 border-berry/50 bg-berry-soft/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-bold text-berry">⚠ Bypass ALL permissions</div>
          <p className="text-sm text-ink-soft mt-0.5">
            Auto-approve every action — file writes, shell commands, MCP calls — in every workspace, with no prompts.
            A red banner shows in each session while this is on. Individual workspaces can override this.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (on) { setOn(false); void window.hv.setGlobalBypass(false); }
            else setConfirming(true);
          }}
          className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer ${
            on ? "bg-berry text-paper border-berry" : "bg-card text-ink border-line hover:border-berry"
          }`}
        >
          {on ? "On" : "Off"}
        </button>
      </div>
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" onClick={() => setConfirming(false)}>
          <div className="w-full max-w-md rounded-2xl border-2 border-berry bg-card p-5 shadow-sticker-lg" onClick={(e) => e.stopPropagation()}>
            <div className="font-bold text-berry mb-1">⚠ Auto-approve every action?</div>
            <p className="text-sm text-ink-soft mb-4">
              This turns off ALL permission prompts globally — the agent may write files and run shell commands without
              asking. Only enable this if you fully trust what you're running.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setConfirming(false); setOn(true); void window.hv.setGlobalBypass(true); }}
                className="rounded-xl bg-berry text-paper font-bold text-sm px-4 py-2 border-2 border-berry shadow-sticker cursor-pointer hover:brightness-105"
              >
                Enable bypass
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsView({
  firstRun,
  onSaved,
  sessionId,
  sessions,
  workspaces,
}: {
  firstRun: boolean;
  onSaved: () => void;
  /** Focused session — its live Pi holds the captured resolved system prompt. */
  sessionId: string | null;
  /** For the embedded audit-log view's filters. */
  sessions: SessionMeta[];
  workspaces: string[];
}): React.JSX.Element {
  const [page, setPage] = useState<SettingsPage>("main");
  const [byok, setByok] = useState<HvByokProvider[]>([]);
  const [auth, setAuth] = useState<Record<string, AuthProviderStatus>>({});
  const [ollama, setOllama] = useState<{ running: boolean; models: string[] } | null>(null);
  const [models, setModels] = useState<HvModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [login, setLogin] = useState<{ provider: string; label: string; event: AuthEvent | null } | null>(null);
  // "Add provider" area — expanded during first-run (it IS the onboarding).
  const [adding, setAdding] = useState(firstRun);

  const refresh = async (): Promise<void> => {
    const p = await window.hv.getProviders();
    setByok(p.byok);
    setDefaultModel(p.defaultModel);
    setOllama(await window.hv.detectOllama());
    await window.hv.authStatus(); // status arrives as an hv.auth ui-request
    setModels(await window.hv.listModels());
  };

  useEffect(() => {
    // Deferred: refresh() sets state from async IPC results, not render data.
    void Promise.resolve().then(refresh);
    const off = window.hv.onUiRequest((r) => {
      const e = parseAuth(r);
      if (!e) return;
      if (e.stage === "status") {
        setAuth(e.providers ?? {});
        return;
      }
      if (e.stage === "logged_out") {
        void window.hv.authStatus();
        void window.hv.listModels().then(setModels);
        return;
      }
      setLogin((cur) => (cur && cur.provider === e.provider ? { ...cur, event: e } : cur));
      if (e.stage === "success") {
        // Login is live immediately in the running Pi (s0.2 §3) — refresh lists.
        void window.hv.authStatus();
        void window.hv.listModels().then(setModels);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startLogin = (id: string, label: string): void => {
    setLogin({ provider: id, label, event: null });
    void window.hv.authLogin(id);
  };

  const cancelLogin = (): void => {
    if (!login) return;
    void window.hv.authLoginCancel(login.provider);
    // If the flow is blocked on an input/select, unblock it with a cancel.
    if (login.event && (login.event.method === "input" || login.event.method === "select")) {
      window.hv.respondInput(login.event.reqId, null);
    }
    setLogin(null);
  };

  const closeLogin = (): void => {
    const ok = login?.event?.stage === "success";
    setLogin(null);
    if (ok && firstRun) onSaved();
  };

  const saveKey = async (id: string): Promise<void> => {
    const key = keyInputs[id]?.trim();
    if (!key) return;
    await window.hv.setProviderKey(id, key);
    setKeyInputs((k) => ({ ...k, [id]: "" }));
    await refresh();
    if (firstRun) onSaved();
  };

  const signedIn = (id: string): boolean => auth[id]?.configured === true && auth[id]?.source === "stored";

  // ── configured-providers summary (top of LLM Setup) ──
  const configured: Array<{ key: string; label: string; chip: string; action?: React.ReactNode }> = [
    ...OAUTH_PROVIDERS.filter((p) => signedIn(p.id)).map((p) => ({
      key: p.id,
      label: p.label,
      chip: "signed in",
      action: (
        <button
          type="button"
          className={`${smallBtn} bg-card text-berry border-berry hover:bg-berry-soft`}
          onClick={() => void window.hv.authLogout(p.id)}
        >
          Sign out
        </button>
      ),
    })),
    ...(ollama?.running
      ? [{ key: "ollama", label: `Ollama (${ollama.models.length} local model${ollama.models.length === 1 ? "" : "s"})`, chip: "running" }]
      : []),
    ...byok
      .filter((p) => p.source)
      .map((p) => ({
        key: p.id,
        label: p.label,
        chip: p.source === "env" ? ".env" : "key saved",
        action:
          p.source === "stored" ? (
            <button
              type="button"
              className={`${smallBtn} bg-card text-berry border-berry hover:bg-berry-soft`}
              onClick={() => void window.hv.removeProviderKey(p.id).then(refresh)}
            >
              Remove
            </button>
          ) : undefined,
      })),
  ];

  const oauthCard = (p: (typeof OAUTH_PROVIDERS)[number]): React.JSX.Element => (
    <div key={p.id} className="rounded-xl border-2 border-line bg-paper px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="font-bold text-sm flex-1 min-w-0">{p.label}</div>
        {signedIn(p.id) ? (
          <Chip tone="leaf">signed in</Chip>
        ) : (
          <button
            type="button"
            className={`${smallBtn} bg-tangerine text-paper border-tangerine-deep hover:brightness-105`}
            onClick={() => startLogin(p.id, p.label)}
          >
            Sign in
          </button>
        )}
      </div>
      {p.caveat && !signedIn(p.id) && <p className="text-xs text-ink-soft mt-1.5">{p.caveat}</p>}
    </div>
  );

  // ── audit / dashboard sub-pages (moved out of the sidebar, W1.4) ──
  if (page !== "main") {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-3 px-8 pt-6 pb-1 shrink-0">
          <button
            type="button"
            onClick={() => setPage("main")}
            className="text-xs font-bold text-tangerine hover:text-tangerine-deep cursor-pointer"
          >
            ← Settings
          </button>
        </div>
        {page === "audit" ? (
          <AuditView sessions={sessions} workspaces={workspaces} />
        ) : (
          <DashboardView workspaces={workspaces} />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-xl mx-auto w-full px-8 py-10">
        {firstRun ? (
          <>
            <div className="size-14 rounded-2xl bg-tangerine border-2 border-ink/80 shadow-pop rotate-3 flex items-center justify-center mb-5">
              <span className="text-paper font-black text-xl -rotate-3">hv</span>
            </div>
            <h1 className="font-black text-3xl tracking-tight">
              Welcome to Happy<span className="text-tangerine">Vibe</span>
            </h1>
            <p className="text-ink-soft mt-2 mb-8">
              Hook up a model provider to wake the agent up. Everything stays on this machine.
            </p>
          </>
        ) : (
          <h1 className="font-black text-3xl tracking-tight mb-8">Settings</h1>
        )}

        <Section icon="llm" title="LLM Setup" subtitle="Providers the agent can talk to, and the default model.">
          {/* Configured summary */}
          {configured.length === 0 ? (
            <p className="text-sm text-ink-soft mb-3">No providers configured yet — add one below.</p>
          ) : (
            <div className="flex flex-col gap-2 mb-3">
              {configured.map((c) => (
                <div key={c.key} className="rounded-xl border-2 border-line bg-paper px-4 py-2.5 flex items-center gap-3">
                  <div className="font-bold text-sm flex-1 min-w-0 truncate">{c.label}</div>
                  <Chip tone={c.chip === ".env" ? "honey" : "leaf"}>{c.chip}</Chip>
                  {c.action}
                </div>
              ))}
            </div>
          )}

          {!firstRun && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className={`${smallBtn} ${adding ? "bg-card text-ink border-line hover:bg-paper-deep" : "bg-tangerine text-paper border-tangerine-deep hover:brightness-105"}`}
            >
              {adding ? "Hide providers" : "+ Add provider"}
            </button>
          )}

          {adding && (
            <div>
              <GroupLabel>Sign in with your plan</GroupLabel>
              <div className="flex flex-col gap-3">{OAUTH_PROVIDERS.map(oauthCard)}</div>

              <GroupLabel>Local</GroupLabel>
              <div className="rounded-xl border-2 border-line bg-paper px-4 py-3">
                {ollama === null ? (
                  <p className="text-sm text-ink-soft">Looking for Ollama…</p>
                ) : ollama.running ? (
                  <div className="flex items-center gap-3">
                    <div className="font-bold text-sm">Ollama</div>
                    <Chip tone="leaf">running</Chip>
                    <span className="text-sm text-ink-soft flex-1">
                      {ollama.models.length} local model{ollama.models.length === 1 ? "" : "s"} — zero keys, zero cloud.
                    </span>
                    {firstRun && ollama.models.length > 0 && (
                      <button
                        type="button"
                        className={`${smallBtn} bg-tangerine text-paper border-tangerine-deep hover:brightness-105`}
                        onClick={onSaved}
                      >
                        Use Ollama
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="font-bold text-sm">Ollama</div>
                    <Chip tone="muted">not found</Chip>
                    <span className="text-sm text-ink-soft flex-1">
                      Install from ollama.com and pull a model — HappyVibe picks it up automatically.
                    </span>
                    <button
                      type="button"
                      className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep`}
                      onClick={() => void window.hv.detectOllama().then(setOllama)}
                    >
                      Check again
                    </button>
                  </div>
                )}
              </div>

              <GroupLabel>Cloud API keys</GroupLabel>
              <div className="flex flex-col gap-3">
                {byok.map((p) => (
                  <div key={p.id} className="rounded-xl border-2 border-line bg-paper px-4 py-3">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="font-bold text-sm flex-1 min-w-0">{p.label}</div>
                      {p.source === "env" && <Chip tone="honey">.env</Chip>}
                      {p.source === "stored" && <Chip tone="leaf">key saved</Chip>}
                    </div>
                    <form
                      className="flex gap-2"
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        void saveKey(p.id);
                      }}
                    >
                      <input
                        type="password"
                        placeholder={p.source ? "Paste a new key to replace…" : "Paste API key…"}
                        value={keyInputs[p.id] ?? ""}
                        onChange={(e) => setKeyInputs((k) => ({ ...k, [p.id]: e.target.value }))}
                        className="flex-1 min-w-0 font-mono text-xs rounded-lg border-2 border-line bg-card px-3 py-2 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
                      />
                      <button
                        type="submit"
                        disabled={!keyInputs[p.id]?.trim()}
                        className={`${smallBtn} bg-tangerine text-paper border-tangerine-deep enabled:hover:brightness-105 disabled:opacity-40`}
                      >
                        Save
                      </button>
                    </form>
                    <p className="text-xs text-ink-soft mt-1.5">Keys are encrypted with your OS keychain.</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Global default model */}
          {!firstRun && (
            <>
              <GroupLabel>Global default model</GroupLabel>
              {models.length === 0 ? (
                <p className="text-sm text-ink-soft">No models available yet — configure a provider above.</p>
              ) : (
                <select
                  value={defaultModel ? `${defaultModel.provider}/${defaultModel.modelId}` : ""}
                  onChange={(e) => {
                    const [provider, ...rest] = e.target.value.split("/");
                    const modelId = rest.join("/");
                    setDefaultModel({ provider, modelId });
                    void window.hv.setDefaultModel(provider, modelId);
                  }}
                  className="w-full rounded-xl border-2 border-line bg-paper px-3.5 py-2.5 text-sm font-bold focus:outline-none focus:border-tangerine cursor-pointer"
                >
                  <option value="" disabled>
                    Pick a model…
                  </option>
                  {[...new Set(models.map((m) => m.provider))].map((prov) => (
                    <optgroup key={prov} label={prov}>
                      {models
                        .filter((m) => m.provider === prov)
                        .map((m) => (
                          <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                            {m.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              )}
              <p className="text-xs text-ink-soft mt-2">
                Used for new sessions unless a workspace or session overrides it. Only models from configured
                providers show up.
              </p>
            </>
          )}
        </Section>

        {/* W1.4: system prompt + permissions + bottom entries hide during first-run onboarding. */}
        {!firstRun && (
          <>
            <SystemPromptSection sessionId={sessionId} />

            <Section
              icon="permissions"
              title="Permissions"
              subtitle="Global rules for every workspace. Per-workspace overrides live in each workspace's settings (the gear in the sidebar)."
            >
              <PermissionRulesSection />
              <GlobalBypassToggle />
            </Section>

            <div className="border-t-2 border-line my-8" />

            {(["audit", "dashboard"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className="w-full flex items-center gap-3 rounded-2xl bg-card border-2 border-line shadow-sticker px-5 py-3.5 mb-3 text-sm font-bold cursor-pointer hover:bg-paper-deep transition-colors"
              >
                <SectionIcon name={p} />
                <span className="flex-1 text-left">{p === "audit" ? "Audit log" : "Dashboard"}</span>
                <span className="text-ink-soft">›</span>
              </button>
            ))}
          </>
        )}
      </div>

      {login && (
        <AuthFlowModal providerLabel={login.label} event={login.event} onCancel={cancelLogin} onClose={closeLogin} />
      )}
    </div>
  );
}
