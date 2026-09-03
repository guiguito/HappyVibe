import { Fragment, useEffect, useState } from "react";
import { AuthFlowModal } from "./AuthFlowModal";
import { GOTO_LABELS } from "./GoTo";
import { parseAuth, type AuthEvent } from "../auth";
import { ONBOARDING_COPY as C, rankProviders } from "../onboarding";

/**
 * §22 onboarding round — step 1's doors.
 *
 * These are NOT ModelsView. That component is 746 lines carrying its own
 * add/draft/probe state, and the round decided against both ways of reusing it:
 * extracting a shared block would be the largest risk here, and embedding it
 * whole would put a full page — its own h1, logo and scroll region — inside a
 * dialog. So the wizard covers the COMMON CASE and links out for the rest.
 *
 * Design round 2 (2026-09-03): the three rungs of §16's ladder are a CHOICE
 * first, and only the chosen one shows its providers. Rendering all three lists
 * at once is what pushed step 2 below the fold, so the user could not see the
 * two things the header promises. Everything underneath is still existing
 * machinery: the same AuthFlowModal, the same detectors, the same key probe,
 * and a sign-in list that comes from MAIN and is never re-listed here.
 */

const primaryBtn =
  "rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine-deep shadow-sticker cursor-pointer hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";
const ghostBtn =
  "rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep active:translate-x-[2px] active:translate-y-[2px] active:shadow-none";

/** Which rung of §16's ladder is open. Starts on rung 1, the recommended one. */
type Rung = "plan" | "local" | "key";

/**
 * All rungs occupy the SAME grid cell, so the card is always as tall as the
 * tallest one and switching rungs cannot resize it.
 *
 * A fixed pixel height would do the same thing and then be wrong the day a
 * provider is added — this derives the height from the content that is actually
 * there. `invisible` (not `hidden`) is what keeps the hidden panels measurable,
 * and it also takes them out of the tab order.
 */
function RungPanel({ show, children }: { show: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={`col-start-1 row-start-1 ${show ? "" : "invisible pointer-events-none"}`}>
      {children}
    </div>
  );
}

function RungChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border-2 px-3.5 py-2 text-sm font-bold shadow-sticker cursor-pointer active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
        active
          ? "bg-tangerine text-paper border-tangerine-deep"
          : "bg-card text-ink border-line hover:bg-paper-deep"
      }`}
    >
      {children}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-soft">
      {children}
    </div>
  );
}

/**
 * All the API-key providers the catalog knows (29 today), popular first,
 * searchable.
 *
 * Not `ModelSelect`: that is typed to a MODEL (`{provider, modelId}`) and
 * reusing it here would mean dressing providers up as models. Not
 * `filterCatalog` either — it returns nothing until you type, because it backs
 * the Models page's "More providers…" box rather than a picker.
 *
 * Dismissal is the app's `fixed inset-0` click-catcher, never onBlur: pressing
 * a button does not focus it, so a blur guard unmounts the menu BETWEEN
 * mousedown and mouseup and the click lands on nothing. Inside this dialog the
 * catcher covers the dialog rather than the viewport — Dialog.Content carries a
 * transform, which makes it the containing block for `fixed` children — and
 * that is exactly the area that needs catching.
 */
function ProviderPicker({
  rows,
  value,
  onPick,
}: {
  rows: HvByokProvider[];
  value: string;
  onPick: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = rankProviders(rows, query);
  const selected = rows.find((r) => r.id === value);
  const grouped = query.trim() === "";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQuery(""); }}
        className="flex items-center gap-2 rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm font-bold cursor-pointer hover:bg-paper-deep"
      >
        <span className="truncate max-w-40">{selected ? selected.label : C.step1PickProvider}</span>
        <span className="text-ink-soft" aria-hidden>▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 w-64 rounded-xl border-2 border-ink/70 bg-card shadow-pop overflow-hidden">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={C.step1Search}
              className="w-full border-b-2 border-line bg-paper px-3 py-2 text-sm focus:outline-none placeholder:text-ink-soft/60"
            />
            <div className="max-h-52 overflow-y-auto">
              {shown.map((r, i) => (
                <Fragment key={r.id}>
                  {grouped && i === 0 && r.featured && <GroupLabel>{C.step1Popular}</GroupLabel>}
                  {grouped && i > 0 && !r.featured && shown[i - 1].featured && (
                    <GroupLabel>{C.step1AllProviders}</GroupLabel>
                  )}
                  <button
                    type="button"
                    onClick={() => { onPick(r.id); setOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-sm font-semibold cursor-pointer hover:bg-honey-soft ${
                      r.id === value ? "bg-honey-soft" : ""
                    }`}
                  >
                    {r.label}
                  </button>
                </Fragment>
              ))}
              {shown.length === 0 && (
                <p className="px-3 py-2 text-sm text-ink-soft">{C.step1NoProvider}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A local runner worth offering: listening AND holding at least one model. */
interface LocalDoor {
  id: string;
  label: string;
}

export function ProviderDoors({
  onChanged,
  onNote,
}: {
  onChanged: () => void;
  /**
   * What the provider said about the key, lifted OUT of this component.
   *
   * `setProviderKey` saves the key whatever the answer, so a typo'd key still
   * flips `hv:has-any-provider` — step 1 checks, this whole component unmounts,
   * and the refusal it just rendered disappears with it. Measured: a bogus
   * Anthropic key checked step 1 and showed nothing at all. The note has to
   * outlive the collapse, so the dialog owns it.
   */
  onNote: (note: string | null) => void;
}): React.JSX.Element {
  const [rung, setRung] = useState<Rung>("plan");
  const [oauth, setOauth] = useState<HvOAuthProvider[]>([]);
  const [byok, setByok] = useState<HvByokProvider[]>([]);
  const [local, setLocal] = useState<LocalDoor[]>([]);
  const [login, setLogin] = useState<{ provider: string; label: string; event: AuthEvent | null } | null>(null);
  const [keyId, setKeyId] = useState<string>("");
  const [keyText, setKeyText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, ollama, runners] = await Promise.all([
        window.hv.getProviders(),
        window.hv.detectOllama(),
        window.hv.detectLocalRunners(),
      ]);
      setOauth(p.oauth);
      setByok(p.byok);
      setKeyId((id) => id || (p.byok.find((b) => b.featured)?.id ?? p.byok[0]?.id ?? ""));
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
    const note =
      probe.status === "bad" ? probe.error : probe.status === "unverified" ? C.step1KeyUnverified : null;
    onNote(note);
    onChanged();
  };

  return (
    <div>
      {/* §16's ladder, in its own order: a plan you already pay for, then a free
          local one, then bring-your-own-key. */}
      <div className="flex flex-wrap gap-2">
        <RungChip active={rung === "plan"} onClick={() => setRung("plan")}>{C.step1SignIn}</RungChip>
        {local.length > 0 && (
          <RungChip active={rung === "local"} onClick={() => setRung("local")}>{C.step1Local}</RungChip>
        )}
        <RungChip active={rung === "key"} onClick={() => setRung("key")}>{C.step1Key}</RungChip>
      </div>

      <div className="mt-3 grid">
        <RungPanel show={rung === "plan"}>
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
              // Main's own string, unprefixed — it already names the plan it is
              // about, and "Claude: Heads up: on Claude Pro/Max…" said it twice.
              <p key={p.id} className="text-xs text-ink-soft mt-2">
                {p.caveat}
              </p>
            ))}
        </RungPanel>

        <RungPanel show={rung === "local"}>
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
        </RungPanel>

        <RungPanel show={rung === "key"}>
          <div className="flex flex-wrap items-center gap-2">
          <ProviderPicker rows={byok} value={keyId} onPick={(id) => { setKeyId(id); onNote(null); }} />
          <input
            type="password"
            value={keyText}
            onChange={(e) => { setKeyText(e.target.value); onNote(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void saveKey(); }}
            placeholder="sk-…"
            className="flex-1 min-w-36 rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm focus:outline-none placeholder:text-ink-soft/60"
          />
          <button type="button" className={ghostBtn} disabled={saving || !keyText.trim()} onClick={() => void saveKey()}>
            {C.step1KeySave}
            </button>
          </div>
        </RungPanel>
      </div>

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
    <p className="text-xs text-ink-soft mt-3">
      {C.step1EscapeLead}{" "}
      <button type="button" onClick={onGo} className="font-bold underline underline-offset-2 hover:text-tangerine cursor-pointer">
        {GOTO_LABELS.models}
      </button>{" "}
      {C.step1EscapeTail}
    </p>
  );
}
