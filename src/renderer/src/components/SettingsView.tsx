import { useEffect, useState } from "react";
import { parseAuth, type AuthEvent, type AuthProviderStatus } from "../auth";
import { AuthFlowModal } from "./AuthFlowModal";
import { PermissionRulesSection } from "./PermissionRulesSection";

/** Onboarding ladder rung 1 (PRD B3): OAuth sign-in over RPC. */
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

function Card({
  rung,
  title,
  subtitle,
  children,
}: {
  rung: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg p-6 mb-6">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1">{rung}</div>
      <h2 className="font-bold text-lg mb-1">{title}</h2>
      <p className="text-sm text-ink-soft mb-4">{subtitle}</p>
      {children}
    </section>
  );
}

export function SettingsView({
  firstRun,
  onSaved,
}: {
  firstRun: boolean;
  onSaved: () => void;
}): React.JSX.Element {
  const [byok, setByok] = useState<HvByokProvider[]>([]);
  const [auth, setAuth] = useState<Record<string, AuthProviderStatus>>({});
  const [ollama, setOllama] = useState<{ running: boolean; models: string[] } | null>(null);
  const [models, setModels] = useState<HvModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [login, setLogin] = useState<{ provider: string; label: string; event: AuthEvent | null } | null>(null);

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

        <Card rung="step 1 · easiest" title="Sign in with a plan you already have" subtitle="OAuth sign-in — no API keys to copy around.">
          <div className="flex flex-col gap-3">
            {OAUTH_PROVIDERS.map((p) => (
              <div key={p.id} className="rounded-xl border-2 border-line bg-paper px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="font-bold text-sm flex-1 min-w-0">{p.label}</div>
                  {signedIn(p.id) ? (
                    <>
                      <Chip tone="leaf">signed in</Chip>
                      <button
                        type="button"
                        className={`${smallBtn} bg-card text-berry border-berry hover:bg-berry-soft`}
                        onClick={() => void window.hv.authLogout(p.id)}
                      >
                        Sign out
                      </button>
                    </>
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
            ))}
          </div>
        </Card>

        <Card rung="step 2 · local" title="Ollama" subtitle="Runs on your machine — zero keys, zero cloud.">
          {ollama === null ? (
            <p className="text-sm text-ink-soft">Looking for Ollama…</p>
          ) : ollama.running ? (
            <div className="flex items-center gap-3">
              <Chip tone="leaf">running</Chip>
              <span className="text-sm flex-1">
                {ollama.models.length} local model{ollama.models.length === 1 ? "" : "s"} ready to pick below.
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
        </Card>

        <Card rung="step 3 · bring your own key" title="API keys" subtitle="Curated providers. Keys are encrypted with your OS keychain.">
          <div className="flex flex-col gap-3">
            {byok.map((p) => (
              <div key={p.id} className="rounded-xl border-2 border-line bg-paper px-4 py-3">
                <div className="flex items-center gap-3 mb-2">
                  <div className="font-bold text-sm flex-1 min-w-0">{p.label}</div>
                  {p.source === "env" && <Chip tone="honey">.env</Chip>}
                  {p.source === "stored" && <Chip tone="leaf">key saved</Chip>}
                  {p.source === "stored" && (
                    <button
                      type="button"
                      className={`${smallBtn} bg-card text-berry border-berry hover:bg-berry-soft`}
                      onClick={() => void window.hv.removeProviderKey(p.id).then(refresh)}
                    >
                      Remove
                    </button>
                  )}
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
              </div>
            ))}
          </div>
        </Card>

        <Card rung="default" title="Global default model" subtitle="Used for new sessions. Only models from configured providers show up.">
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
        </Card>

        {/* B4: permission rules — hidden during first-run onboarding to keep the ladder focused. */}
        {!firstRun && <PermissionRulesSection />}
      </div>

      {login && (
        <AuthFlowModal providerLabel={login.label} event={login.event} onCancel={cancelLogin} onClose={closeLogin} />
      )}
    </div>
  );
}
