import { useEffect, useState } from "react";
import { isSignedIn, parseAuth, type AuthEvent, type AuthProviderStatus } from "../auth";
import { AuthFlowModal } from "./AuthFlowModal";
import { BrandLogo } from "./BrandLogo";
import { ModelSelect } from "./ModelSelect";
import { Section } from "./Section";

/**
 * Round 8: the old "LLM Setup" section of the single Settings scroll, promoted
 * to its own page — the "LLM" wording is dropped because it said nothing to a
 * beginner. First-run onboarding lives here: hooking up a provider IS the
 * onboarding.
 */


/**
 * The "More providers…" search (2026-08-29). Rows that already have a card
 * above the box — the featured five, plus anything with a key configured — are
 * excluded, or the same key input would be offered twice. An empty query lists
 * NOTHING: the point of the box is that 29 providers do not become 29 inputs.
 */
export function filterCatalog<T extends { id: string; label: string; source: unknown; featured: boolean }>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return rows.filter((r) => !r.featured && !r.source && `${r.label} ${r.id}`.toLowerCase().includes(q));
}

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

/** Group label inside the "Add provider" area. */
function GroupLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mt-4 mb-2">{children}</div>;
}

/** Prompt-cache retention. Off by default and worded as a trade-off, not a win:
    on Anthropic a 1h cache write costs 2× input (vs 1.25×), so it only pays off
    when turns are minutes apart. Applied at the next spawn — no respawn, since
    that would reset live sessions' grants for a TTL change. */
function LongCacheToggle(): React.JSX.Element {
  const [on, setOn] = useState(false);
  useEffect(() => { void window.hv.getLongCache().then(setOn); }, []);
  return (
    <div className="mt-4 rounded-xl border-2 border-line bg-card p-4 flex items-start justify-between gap-4">
      <div>
        <div className="font-bold">Extended prompt cache</div>
        <p className="text-sm text-ink-soft mt-0.5">
          Keeps the cached conversation prefix alive for 1 hour on Anthropic (24h on OpenAI) instead of the 5-minute
          default, so a session you come back to later still gets cache-priced prompt tokens. Anthropic bills a
          long-lived cache write at 2× the input rate, so this wins when your turns are minutes apart and loses when
          you type continuously. Other providers ignore it. Takes effect for new sessions.
        </p>
      </div>
      <button
        type="button"
        onClick={() => { const next = !on; setOn(next); void window.hv.setLongCache(next); }}
        className={`shrink-0 rounded-full border-2 px-4 py-1.5 font-bold text-sm cursor-pointer ${
          on ? "bg-leaf text-paper border-leaf" : "bg-card text-ink border-line hover:border-leaf"
        }`}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

export function ModelsView({
  firstRun,
  onSaved,
}: {
  firstRun: boolean;
  onSaved: () => void;
}): React.JSX.Element {
  const [byok, setByok] = useState<HvByokProvider[]>([]);
  /**
   * The sign-in list comes from MAIN (providers.ts), which derives it from Pi's
   * own OAuth registry. It used to be hardcoded here too, so a provider added
   * to one copy silently never appeared in the other.
   */
  const [oauthProviders, setOauthProviders] = useState<HvOAuthProvider[]>([]);
  const [auth, setAuth] = useState<Record<string, AuthProviderStatus>>({});
  const [ollama, setOllama] = useState<{ running: boolean; models: string[] } | null>(null);
  /** LM Studio / llama.cpp found listening — zero-config, same as Ollama. */
  const [localRunners, setLocalRunners] = useState<{ id: string; label: string; models: string[] }[]>([]);
  const [models, setModels] = useState<HvModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyProbes, setKeyProbes] = useState<Record<string, HvKeyProbe>>({});
  const [providerQuery, setProviderQuery] = useState("");
  const [login, setLogin] = useState<{ provider: string; label: string; event: AuthEvent | null } | null>(null);
  // "Add provider" area — expanded during first-run (it IS the onboarding).
  const [adding, setAdding] = useState(firstRun);
  // §16 (2026-07-30): custom OpenAI-compatible endpoints + the add-form draft.
  const [custom, setCustom] = useState<{ endpoints: HvCustomEndpoint[]; keyStatus: Record<string, boolean> }>(
    { endpoints: [], keyStatus: {} },
  );
  const [draft, setDraft] = useState<{ label: string; baseUrl: string; preset: HvCustomEndpoint["preset"]; key: string } | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; models: string[]; error?: string } | null>(null);
  /** Main rejects bad ids / reserved ids / bad URLs — show it instead of failing silently. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /**
   * Selected model id → its per-model settings. `ctx` is the context window (Pi
   * defaults to 128000; §9's gauge reads it). `priceIn`/`priceOut` are USD per
   * MILLION tokens and are OPTIONAL: without them Pi prices every call at $0 and
   * the session cost pill reports the spend as unknown rather than free.
   */
  const [picked, setPicked] = useState<Record<string, { ctx: number; priceIn?: number; priceOut?: number }>>({});

  const refresh = async (): Promise<void> => {
    const p = await window.hv.getProviders();
    setByok(p.byok);
    setOauthProviders(p.oauth);
    setDefaultModel(p.defaultModel);
    setOllama(await window.hv.detectOllama());
    setLocalRunners(await window.hv.detectLocalRunners());
    setCustom(await window.hv.getCustomEndpoints());
    await window.hv.authStatus(); // status arrives as an hv.auth ui-request
    setModels(await window.hv.listModels());
  };

  useEffect(() => {
    // Deferred: refresh() sets state from async IPC results, not render data.
    void Promise.resolve().then(refresh);
    // Round 11: seed from the state main holds. The success notify is fired ONCE
    // and only while this page is mounted — signing in and navigating away used
    // to lose it permanently. Main now keeps it and pushes changes, so this page
    // is correct whenever it mounts.
    void window.hv.authState().then(setAuth);
    const offAuthState = window.hv.onAuthStateChanged(setAuth);
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
    return () => {
      off();
      offAuthState();
    };
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
    // The key is saved regardless — this only reports what the provider said
    // when asked. "bad" means it answered 401/403; "unverified" means we could
    // not tell (no /models route, or the host was unreachable).
    const probe = await window.hv.setProviderKey(id, key);
    setKeyProbes((p) => ({ ...p, [id]: probe }));
    setKeyInputs((k) => ({ ...k, [id]: "" }));
    await refresh();
    if (firstRun) onSaved();
  };

  /** What the key check said, per provider. Cleared when the key is removed. */
  const keyProbeNote = (id: string): React.JSX.Element | null => {
    const probe = keyProbes[id];
    if (!probe || probe.status === "ok") return null;
    return probe.status === "bad" ? (
      <p className="mt-1 text-xs font-bold text-berry">
        Saved, but {byok.find((b) => b.id === id)?.label ?? id} rejected this key ({probe.error}).
      </p>
    ) : (
      <p className="mt-1 text-xs text-ink-soft">Saved. We couldn&apos;t verify this key here.</p>
    );
  };

  /** One provider's key input. Used by BOTH the featured cards and the search
   *  results, so a provider found by search behaves exactly like a listed one. */
  const keyCard = (p: HvByokProvider): React.JSX.Element => (
    <div key={p.id} className="rounded-xl border-2 border-line bg-paper px-4 py-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="font-bold text-sm flex-1 min-w-0">{p.label}</div>
        <span className="text-[10px] text-ink-soft font-medium">{p.modelCount} models</span>
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
      {keyProbeNote(p.id)}
      <p className="text-xs text-ink-soft mt-1.5">Keys are encrypted with your OS keychain.</p>
    </div>
  );

  const signedIn = (id: string): boolean => isSignedIn(auth[id]);

  // ── configured-providers summary ──
  const configured: Array<{ key: string; label: string; chip: string; action?: React.ReactNode }> = [
    ...oauthProviders.filter((p) => signedIn(p.id)).map((p) => ({
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
    ...localRunners.map((r) => ({
      key: r.id,
      label: `${r.label} (${r.models.length} local model${r.models.length === 1 ? "" : "s"})`,
      chip: "running",
    })),
    ...(ollama?.running
      ? [{ key: "ollama", label: `Ollama (${ollama.models.length} local model${ollama.models.length === 1 ? "" : "s"})`, chip: "running" }]
      : []),
    ...custom.endpoints.map((e) => ({
      key: e.id,
      label: `${e.label} (${e.models.length} model${e.models.length === 1 ? "" : "s"})`,
      chip: custom.keyStatus[e.id] ? "key saved" : "no key",
    })),
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

  const oauthCard = (p: HvOAuthProvider): React.JSX.Element => (
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        {firstRun ? (
          <>
            <BrandLogo size="lg" className="mb-5" />
            <h1 className="font-black text-3xl tracking-tight">
              Welcome to Happy<span className="text-tangerine">Vibe</span>
            </h1>
            <p className="text-ink-soft mt-2 mb-8">
              Hook up a model provider to wake the agent up. Everything stays on this machine.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-black text-3xl tracking-tight mb-2">Models</h1>
            <p className="text-sm text-ink-soft mb-8">Providers the agent can talk to, and the default model.</p>
          </>
        )}

        <Section icon="models" title="Providers" subtitle="Sign in with a plan, add an API key, or point at a local server.">
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
              <div className="flex flex-col gap-3">{oauthProviders.map(oauthCard)}</div>

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
                {byok.filter((p) => p.featured || p.source).map(keyCard)}
              </div>

              {/* The long tail of Pi's registry. One search box, one input per
                  pick — never 29 inputs stacked down the page. */}
              <div className="mt-3">
                <input
                  type="search"
                  value={providerQuery}
                  onChange={(e) => setProviderQuery(e.target.value)}
                  placeholder={`More providers… (search ${byok.length} supported by Pi)`}
                  className="w-full text-sm rounded-lg border-2 border-line bg-card px-3 py-2 focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
                />
                {providerQuery.trim() && (
                  <div className="flex flex-col gap-3 mt-3">
                    {filterCatalog(byok, providerQuery).length === 0 ? (
                      <p className="text-xs text-ink-soft px-1">No provider matches “{providerQuery}”.</p>
                    ) : (
                      filterCatalog(byok, providerQuery).map(keyCard)
                    )}
                  </div>
                )}
              </div>

              <GroupLabel>Custom endpoint</GroupLabel>
              <div className="flex flex-col gap-3">
                {custom.endpoints.map((e) => (
                  <div key={e.id} className="rounded-xl border-2 border-line bg-paper px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="font-bold text-sm">{e.label}</div>
                      <Chip tone={custom.keyStatus[e.id] ? "leaf" : "muted"}>
                        {custom.keyStatus[e.id] ? "key saved" : "no key"}
                      </Chip>
                      <span className="text-xs text-ink-soft font-mono flex-1 min-w-0 truncate">{e.baseUrl}</span>
                      <button
                        type="button"
                        className={`${smallBtn} bg-card text-berry border-berry hover:bg-berry-soft`}
                        onClick={() => {
                          void window.hv.removeCustomEndpoint(e.id)
                            .then(() => window.hv.getCustomEndpoints())
                            .then(setCustom);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}

                {draft === null ? (
                  <button
                    type="button"
                    className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep self-start`}
                    onClick={() => { setDraft({ label: "", baseUrl: "", preset: "other", key: "" }); setProbe(null); setPicked({}); }}
                  >
                    + OpenAI-compatible endpoint
                  </button>
                ) : (
                  <div className="rounded-xl border-2 border-line bg-paper px-4 py-3 flex flex-col gap-2">
                    <input
                      placeholder="Name (e.g. My vLLM)"
                      value={draft.label}
                      onChange={(ev) => setDraft({ ...draft, label: ev.target.value })}
                      className="rounded-lg border-2 border-line bg-card px-3 py-2 text-sm focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
                    />
                    <input
                      placeholder="Base URL (e.g. http://localhost:8000/v1)"
                      value={draft.baseUrl}
                      onChange={(ev) => setDraft({ ...draft, baseUrl: ev.target.value })}
                      className="rounded-lg border-2 border-line bg-card px-3 py-2 font-mono text-xs focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
                    />
                    <select
                      value={draft.preset}
                      onChange={(ev) => setDraft({ ...draft, preset: ev.target.value as HvCustomEndpoint["preset"] })}
                      className="rounded-lg border-2 border-line bg-card px-3 py-2 text-sm"
                    >
                      <option value="vllm">vLLM</option>
                      <option value="lmstudio">LM Studio</option>
                      <option value="llamacpp">llama.cpp</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      type="password"
                      placeholder="API key (leave blank if the server needs none)"
                      value={draft.key}
                      onChange={(ev) => setDraft({ ...draft, key: ev.target.value })}
                      className="rounded-lg border-2 border-line bg-card px-3 py-2 font-mono text-xs focus:outline-none focus:border-tangerine placeholder:text-ink-soft/60"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep`}
                        onClick={() => {
                          void window.hv.fetchEndpointModels(draft.baseUrl, draft.key || undefined).then(setProbe);
                        }}
                      >
                        Fetch models
                      </button>
                      <button
                        type="button"
                        className={`${smallBtn} bg-card text-ink border-line hover:bg-paper-deep`}
                        onClick={() => setDraft(null)}
                      >
                        Cancel
                      </button>
                    </div>

                    {probe?.error && <p className="text-sm text-berry">Could not reach it: {probe.error}</p>}
                    {probe?.ok && probe.models.length === 0 && (
                      <p className="text-sm text-ink-soft">Reached it, but it listed no models.</p>
                    )}
                    {probe?.ok && probe.models.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="text-xs text-ink-soft">
                          Pick the models to expose and set each context window — the token gauge reads it.
                          Prices are optional ($ per million tokens, from the provider's pricing page);
                          without them this endpoint's calls show as <span className="font-mono">unpriced</span>{" "}
                          in the session cost panel instead of a misleading $0.00.
                        </p>
                        {probe.models.map((id) => (
                          <div key={id} className="flex flex-col gap-1">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={id in picked}
                                onChange={(ev) =>
                                  setPicked((p) => {
                                    const next = { ...p };
                                    if (ev.target.checked) next[id] = { ctx: 128000 };
                                    else delete next[id];
                                    return next;
                                  })
                                }
                              />
                              <span className="font-mono text-xs flex-1 min-w-0 truncate">{id}</span>
                              {id in picked && (
                                <input
                                  type="number"
                                  min={1}
                                  value={picked[id].ctx}
                                  aria-label={`Context window for ${id}`}
                                  title="Context window (tokens)"
                                  // Number("") is 0, and Pi DELETES a provider whose
                                  // model has contextWindow <= 0 — so an emptied
                                  // field falls back to Pi's own default instead.
                                  onChange={(ev) =>
                                    setPicked((p) => ({ ...p, [id]: { ...p[id], ctx: Number(ev.target.value) || 128000 } }))
                                  }
                                  className="w-24 rounded-lg border-2 border-line bg-card px-2 py-1 text-xs"
                                />
                              )}
                            </label>
                            {id in picked && (
                              <div className="flex items-center gap-2 pl-6 text-xs text-ink-soft">
                                {/* Both or neither: main refuses a half-priced model,
                                    because one rate alone yields a total that is
                                    quietly half right. "" → undefined = unpriced. */}
                                {([
                                  ["priceIn", "in"],
                                  ["priceOut", "out"],
                                ] as const).map(([field, label]) => (
                                  <label key={field} className="flex items-center gap-1">
                                    <span>$/Mtok {label}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      placeholder="—"
                                      value={picked[id][field] ?? ""}
                                      aria-label={`Price per million ${label === "in" ? "input" : "output"} tokens for ${id}`}
                                      onChange={(ev) =>
                                        setPicked((p) => ({
                                          ...p,
                                          [id]: {
                                            ...p[id],
                                            [field]: ev.target.value === "" ? undefined : Number(ev.target.value),
                                          },
                                        }))
                                      }
                                      className="w-20 rounded-lg border-2 border-line bg-card px-2 py-1 text-xs"
                                    />
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          disabled={Object.keys(picked).length === 0 || draft.label.trim() === ""}
                          className={`${smallBtn} bg-tangerine text-paper border-tangerine-deep enabled:hover:brightness-105 disabled:opacity-40 self-start mt-1`}
                          onClick={() => {
                            // Main derives providerKey (hv-<id>) and auth, and
                            // validates — see hv:save-custom-endpoint.
                            const endpoint = {
                              id: draft.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
                              label: draft.label.trim(),
                              baseUrl: draft.baseUrl.trim(),
                              preset: draft.preset,
                              models: Object.entries(picked).map(([id, m]) => ({
                                id,
                                contextWindow: m.ctx,
                                ...(m.priceIn === undefined ? {} : { priceIn: m.priceIn }),
                                ...(m.priceOut === undefined ? {} : { priceOut: m.priceOut }),
                              })),
                            };
                            setSaveError(null);
                            void window.hv.saveCustomEndpoint(endpoint, draft.key || undefined)
                              .then(() => window.hv.getCustomEndpoints())
                              .then((c) => { setCustom(c); setDraft(null); setProbe(null); setPicked({}); })
                              .catch((err: unknown) =>
                                setSaveError(err instanceof Error ? err.message : String(err)),
                              );
                          }}
                        >
                          Save endpoint
                        </button>
                        {saveError && <p className="text-sm text-berry">Could not save: {saveError}</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </Section>

        {!firstRun && (
          <Section
            icon="models"
            title="Default model"
            subtitle="Used for new sessions unless a workspace or session overrides it."
          >
            {models.length === 0 ? (
              <p className="text-sm text-ink-soft">No models available yet — configure a provider above.</p>
            ) : (
              <ModelSelect
                models={models}
                value={defaultModel}
                onPick={(m) => {
                  setDefaultModel({ provider: m.provider, modelId: m.id });
                  void window.hv.setDefaultModel(m.provider, m.id);
                }}
                menuWidthClassName="w-full"
              />
            )}
            <p className="text-xs text-ink-soft mt-2">Only models from configured providers show up.</p>
            <LongCacheToggle />
          </Section>
        )}
      </div>

      {login && (
        <AuthFlowModal providerLabel={login.label} event={login.event} onCancel={cancelLogin} onClose={closeLogin} />
      )}
    </div>
  );
}
