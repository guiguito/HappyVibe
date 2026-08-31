import { useEffect, useState } from "react";
import { AuthFlowModal } from "./AuthFlowModal";
import { GOTO_LABELS } from "./GoTo";
import { parseAuth, type AuthEvent } from "../auth";
import { ONBOARDING_COPY as C } from "../onboarding";

/**
 * §22 onboarding round (2026-09-01) — step 1's three doors.
 *
 * These are NOT ModelsView. That component is 746 lines carrying its own
 * add/draft/probe state, and the round decided against both ways of reusing it:
 * extracting a shared block would be the largest risk here, and embedding it
 * whole would put a full page — its own h1, logo and scroll region — inside a
 * dialog. So the wizard covers the COMMON CASE and links out for the rest.
 *
 * Everything underneath is existing machinery: the same AuthFlowModal, the same
 * detectors, the same key probe. The sign-in list comes from MAIN and is never
 * re-listed here — a provider added upstream appears on its own.
 */

const primaryBtn =
  "rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";
const ghostBtn =
  "rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

function DoorLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="text-[10px] font-bold uppercase tracking-widest text-ink-soft mt-4 mb-2">{children}</div>;
}

/** A local runner worth offering: listening AND holding at least one model. */
interface LocalDoor {
  id: string;
  label: string;
}

export function ProviderDoors({ onChanged }: { onChanged: () => void }): React.JSX.Element {
  const [oauth, setOauth] = useState<HvOAuthProvider[]>([]);
  const [featured, setFeatured] = useState<HvByokProvider[]>([]);
  const [local, setLocal] = useState<LocalDoor[]>([]);
  const [login, setLogin] = useState<{ provider: string; label: string; event: AuthEvent | null } | null>(null);
  const [keyId, setKeyId] = useState<string>("");
  const [keyText, setKeyText] = useState("");
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, ollama, runners] = await Promise.all([
        window.hv.getProviders(),
        window.hv.detectOllama(),
        window.hv.detectLocalRunners(),
      ]);
      setOauth(p.oauth);
      const cards = p.byok.filter((b) => b.featured);
      setFeatured(cards);
      setKeyId((id) => id || (cards[0]?.id ?? ""));
      // "Don't show what cannot work": a runner with no models gives Pi nothing
      // to call, so it is not a door — it is a row that would fail on click.
      setLocal([
        ...(ollama.models.length > 0 ? [{ id: "ollama", label: "Ollama" }] : []),
        ...runners.filter((r) => r.models.length > 0).map((r) => ({ id: r.id, label: r.label })),
      ]);
    })();
  }, []);

  useEffect(() => {
    // The auth flow talks over the same hv.auth ui-requests the Models page
    // reads. Parsing is shared (auth.ts), so the two cannot drift.
    return window.hv.onUiRequest((r) => {
      const e = parseAuth(r);
      if (!e) return;
      if (e.stage === "status" || e.stage === "logged_out") return;
      setLogin((cur) => (cur ? { ...cur, event: e } : cur));
    });
  }, []);

  const startLogin = (id: string, label: string): void => {
    setLogin({ provider: id, label, event: null });
    void window.hv.authLogin(id);
  };

  const cancelLogin = (): void => {
    if (!login) return;
    void window.hv.authLoginCancel(login.provider);
    // A flow blocked on an input/select must be unblocked, or Pi waits forever.
    if (login.event && (login.event.method === "input" || login.event.method === "select")) {
      window.hv.respondInput(login.event.reqId, null);
    }
    setLogin(null);
  };

  const closeLogin = (): void => {
    setLogin(null);
    onChanged();
  };

  const saveKey = async (): Promise<void> => {
    const key = keyText.trim();
    if (!key || !keyId) return;
    setSaving(true);
    // The key is saved either way — this only reports what the provider said
    // when asked. Same probe the Models page runs, same wording.
    const probe = await window.hv.setProviderKey(keyId, key);
    setSaving(false);
    setKeyText("");
    setKeyNote(
      probe.status === "bad" ? probe.error : probe.status === "unverified" ? C.step1KeyUnverified : null,
    );
    onChanged();
  };

  return (
    <div>
      <DoorLabel>{C.step1SignIn}</DoorLabel>
      <div className="flex flex-wrap gap-2">
        {oauth.map((p) => (
          <button key={p.id} type="button" className={ghostBtn} onClick={() => startLogin(p.id, p.label)}>
            {p.label}
          </button>
        ))}
      </div>
      {oauth
        .filter((p) => p.caveat)
        .map((p) => (
          <p key={p.id} className="text-xs text-ink-soft mt-1.5">
            {p.label}: {p.caveat}
          </p>
        ))}

      {local.length > 0 && (
        <>
          <DoorLabel>{C.step1Local}</DoorLabel>
          <div className="flex flex-wrap gap-2">
            {local.map((r) => (
              <button
                key={r.id}
                type="button"
                className={primaryBtn}
                // Nothing to save: syncModelsJson writes the entry before every
                // spawn. Main emits no event for a detector, so this is the one
                // door that has to nudge the gate itself.
                onClick={onChanged}
              >
                Use {r.label} — found on this Mac
              </button>
            ))}
          </div>
        </>
      )}

      <DoorLabel>{C.step1Key}</DoorLabel>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={keyId}
          onChange={(e) => { setKeyId(e.target.value); setKeyNote(null); }}
          className="rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm font-bold cursor-pointer"
        >
          {featured.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <input
          type="password"
          value={keyText}
          onChange={(e) => { setKeyText(e.target.value); setKeyNote(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void saveKey(); }}
          placeholder="sk-…"
          className="flex-1 min-w-40 rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm focus:outline-none placeholder:text-ink-soft/60"
        />
        <button type="button" className={ghostBtn} disabled={saving || !keyText.trim()} onClick={() => void saveKey()}>
          {C.step1KeySave}
        </button>
      </div>
      {keyNote && <p className="text-xs text-berry font-bold mt-1.5">{keyNote}</p>}

      {/* AuthFlowModal portals to <body>, and it mounts AFTER the wizard's own
          portal — both carry .hv-dialog, i.e. the SAME layer, so document order
          is the whole z-order. Never render it above the wizard in the tree.
          (Spelling the tailwind class here would trip modal-layer's scan, which
          reads comments too — say it in words.) */}
      {login && (
        <AuthFlowModal providerLabel={login.label} event={login.event} onCancel={cancelLogin} onClose={closeLogin} />
      )}
    </div>
  );
}

/**
 * The escape hatch. It cannot be a plain `GoTo`: App's `navigate` refuses while
 * no model resolves (App.tsx `keyState !== "present"`), which is exactly when
 * this link is needed — so the wizard hands the job back to App, which dismisses
 * first and lets the settings redirect land it on the same page. The DESTINATION
 * WORD is still derived from the sidebar's own NAV, so a rename cannot orphan it.
 */
export function ModelsEscape({ onGo }: { onGo: () => void }): React.JSX.Element {
  return (
    <p className="text-xs text-ink-soft mt-4">
      {C.step1EscapeLead}{" "}
      <button type="button" onClick={onGo} className="font-bold underline underline-offset-2 hover:text-tangerine cursor-pointer">
        {GOTO_LABELS.models}
      </button>{" "}
      {C.step1EscapeTail}
    </p>
  );
}
