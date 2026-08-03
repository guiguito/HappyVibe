import { useEffect, useMemo, useState } from "react";

/**
 * §25 plugin marketplace browser.
 *
 * Browsing is one fetch of the marketplace list; a plugin is only downloaded
 * when the user opens it, and even then nothing is written until they confirm.
 *
 * Rejected plugins are shown greyed WITH their reason rather than hidden — the
 * same one-line branch either way, and it turns the restriction into a visible
 * safety claim instead of an apparent gap.
 */

type Card = HvPluginCard;

/** Selection state inside the confirm dialog. */
interface Chosen {
  skills: Set<string>;
  commands: Set<string>;
  servers: Set<string>;
}

export function PluginsSection(): React.JSX.Element {
  const [marketplaces, setMarketplaces] = useState<Array<{ id: string; url: string }>>([]);
  const [active, setActive] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showRejected, setShowRejected] = useState(true);
  const [category, setCategory] = useState<string | null>(null);

  const [scan, setScan] = useState<HvPluginScan | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen>({ skills: new Set(), commands: new Set(), servers: new Set() });
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState<{ skills: string[]; commands: string[]; servers: string[]; substituted: number } | null>(null);

  useEffect(() => {
    void window.hv.pluginMarketplaces().then((ms) => {
      setMarketplaces(ms);
      setActive((cur) => cur ?? ms[0]?.id ?? null);
    });
  }, []);

  const load = (id: string, force = false): void => {
    setLoading(true);
    setListError(null);
    void window.hv.pluginList(id, force).then((res) => {
      setLoading(false);
      setCards(res.plugins);
      if (!res.ok) setListError(res.error);
    });
  };

  useEffect(() => {
    if (active) load(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const categories = useMemo(
    () => [...new Set(cards.map((c) => c.category).filter((c): c is string => !!c))].sort(),
    [cards],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (!showRejected && !c.accepted) return false;
      if (category && c.category !== category) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
    });
  }, [cards, query, showRejected, category]);

  const acceptedCount = cards.filter((c) => c.accepted).length;

  const openPlugin = (card: Card): void => {
    if (!active) return;
    setScanning(card.name);
    setScanError(null);
    setDone(null);
    void window.hv.pluginScan(active, card.name).then((res) => {
      setScanning(null);
      if (!("ok" in res) || res.ok !== true) {
        setScanError((res as { error: string }).error);
        return;
      }
      setScan(res);
      // Preselect everything installable — the picker is the consent surface,
      // and skills land disabled anyway.
      setChosen({
        skills: new Set(res.skills.filter((s) => s.screen !== "reject").map((s) => s.dir)),
        commands: new Set(res.commands.map((c) => c.file)),
        servers: new Set(res.mcpServers),
      });
    });
  };

  const toggle = (key: keyof Chosen, id: string): void =>
    setChosen((c) => {
      const next = new Set(c[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...c, [key]: next };
    });

  const install = (): void => {
    if (!scan) return;
    setInstalling(true);
    setScanError(null);
    void window.hv
      .pluginInstall(scan.token, {
        skillDirs: [...chosen.skills],
        commandFiles: [...chosen.commands],
        mcpKeys: [...chosen.servers],
      })
      .then((res) => {
        setInstalling(false);
        if (!res.ok) {
          setScanError(res.error);
          return;
        }
        setDone({ skills: res.skills, commands: res.commands, servers: res.servers, substituted: res.substituted });
        setScan(null);
      });
  };

  const totalChosen = chosen.skills.size + chosen.commands.size + chosen.servers.size;

  return (
    <div className="space-y-4">
      {/* ── marketplace picker + search ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {marketplaces.length > 1 && (
          <select
            value={active ?? ""}
            onChange={(e) => setActive(e.target.value)}
            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm"
          >
            {marketplaces.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plugins…"
          className="flex-1 min-w-40 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => active && load(active, true)}
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold hover:bg-paper-soft"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <button
          onClick={() => setCategory(null)}
          className={`rounded-full px-2.5 py-1 font-semibold ${category === null ? "bg-ink text-paper" : "border border-line hover:bg-paper-soft"}`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-2.5 py-1 font-semibold ${category === c ? "bg-ink text-paper" : "border border-line hover:bg-paper-soft"}`}
          >
            {c}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-ink-soft">
          <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
          Show unsupported
        </label>
      </div>

      {loading && <p className="text-sm text-ink-soft">Loading the marketplace…</p>}
      {listError && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{listError}</p>
      )}
      {!loading && !listError && (
        <p className="text-xs text-ink-soft">
          {acceptedCount} of {cards.length} plugins are supported here. The rest are shown greyed with the reason.
        </p>
      )}
      {scanError && !scan && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{scanError}</p>
      )}
      {done && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          Installed{" "}
          {[
            done.skills.length ? `${done.skills.length} skill${done.skills.length > 1 ? "s" : ""}` : null,
            done.commands.length ? `${done.commands.length} prompt${done.commands.length > 1 ? "s" : ""}` : null,
            done.servers.length ? `${done.servers.length} MCP server${done.servers.length > 1 ? "s" : ""}` : null,
          ].filter(Boolean).join(" · ") || "nothing"}
          .{" "}
          {done.skills.length > 0 && (
            <>The skills are <strong>off</strong> until you enable them on the Skills page.</>
          )}
          {done.substituted > 0 && ` ${done.substituted} plugin-root path${done.substituted > 1 ? "s were" : " was"} rewritten to the install location.`}
        </div>
      )}

      {/* ── cards ───────────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map((c) => (
          <button
            key={c.name}
            disabled={!c.accepted || scanning !== null}
            onClick={() => openPlugin(c)}
            title={c.accepted ? undefined : c.reason}
            className={`text-left rounded-xl border p-3 transition ${
              c.accepted
                ? "border-line bg-paper hover:border-ink/40 hover:shadow-sm"
                : "border-line/60 bg-paper-soft/40 opacity-60 cursor-not-allowed"
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-sm truncate">{c.name}</span>
              {c.category && <span className="text-[10px] uppercase tracking-wide text-ink-soft">{c.category}</span>}
              {scanning === c.name && <span className="ml-auto text-xs text-ink-soft">opening…</span>}
            </div>
            <p className="mt-1 text-xs text-ink-soft line-clamp-2">{c.description}</p>
            {!c.accepted && <p className="mt-1.5 text-xs font-medium text-ink-soft">⃠ {c.reason}</p>}
          </button>
        ))}
      </div>
      {!loading && shown.length === 0 && <p className="text-sm text-ink-soft">Nothing matches that search.</p>}

      {/* ── confirm dialog ──────────────────────────────────────────────── */}
      {scan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-paper p-5 shadow-xl">
            <h3 className="font-black text-lg tracking-tight">{scan.name}</h3>
            <p className="mt-1 text-sm text-ink-soft">{scan.description}</p>

            {!scan.accepted ? (
              <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {scan.reason}
              </p>
            ) : (
              <>
                {/* Disclosure: computed, shown only when non-empty. */}
                {Object.keys(scan.dropped).length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <strong>This is a Claude Code plugin.</strong> HappyVibe installs skills, top-level
                    prompts and MCP servers only — so{" "}
                    {Object.entries(scan.dropped).map(([k, n], i, arr) => (
                      <span key={k}>
                        {n} {k}
                        {i < arr.length - 2 ? ", " : i === arr.length - 2 ? " and " : ""}
                      </span>
                    ))}{" "}
                    will not be installed, and behaviour may differ from the author's setup.
                  </div>
                )}

                <PickList
                  title="Skills"
                  note="Installed switched OFF — enable them on the Skills page."
                  rows={scan.skills.map((s) => ({
                    id: s.dir,
                    label: s.name,
                    sub: s.description,
                    disabled: s.screen === "reject",
                    warn:
                      s.screen === "reject"
                        ? s.screenReason
                        : s.screen === "warn"
                          ? s.screenReason
                          : s.pluginRootRefs > 0
                            ? `${s.pluginRootRefs} plugin-root path${s.pluginRootRefs > 1 ? "s" : ""} will be rewritten to the install location`
                            : undefined,
                    badge: s.scriptCount > 0 ? `${s.scriptCount} scripts` : undefined,
                  }))}
                  chosen={chosen.skills}
                  onToggle={(id) => toggle("skills", id)}
                />
                <PickList
                  title="Prompts"
                  note="Typed as /name."
                  rows={scan.commands.map((c) => ({ id: c.file, label: `/${c.name}`, sub: c.description }))}
                  chosen={chosen.commands}
                  onToggle={(id) => toggle("commands", id)}
                />
                <PickList
                  title="MCP servers"
                  note="Written to your global mcp.json, and removed with the plugin."
                  rows={scan.mcpServers.map((k) => ({ id: k, label: k }))}
                  chosen={chosen.servers}
                  onToggle={(id) => toggle("servers", id)}
                />

                <p className="mt-4 text-[11px] text-ink-soft">
                  Installing from commit{" "}
                  <code className="font-mono">{scan.sha ? scan.sha.slice(0, 10) : "the marketplace checkout"}</code>
                  {scan.ref && <> ({scan.ref})</>}.
                </p>
              </>
            )}

            {scanError && (
              <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{scanError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => { setScan(null); setScanError(null); }}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-paper-soft"
              >
                Cancel
              </button>
              {scan.accepted && (
                <button
                  disabled={installing || totalChosen === 0}
                  onClick={install}
                  className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
                >
                  {installing ? "Installing…" : `Install ${totalChosen} item${totalChosen === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PickList({
  title,
  note,
  rows,
  chosen,
  onToggle,
}: {
  title: string;
  note: string;
  rows: Array<{ id: string; label: string; sub?: string; disabled?: boolean; warn?: string; badge?: string }>;
  chosen: Set<string>;
  onToggle: (id: string) => void;
}): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-bold">{title}</h4>
        <span className="text-[11px] text-ink-soft">{note}</span>
      </div>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <li key={r.id}>
            <label
              className={`flex gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs ${
                r.disabled ? "opacity-55" : "cursor-pointer hover:bg-paper-soft"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={r.disabled}
                checked={chosen.has(r.id)}
                onChange={() => onToggle(r.id)}
              />
              <span className="min-w-0">
                <span className="font-semibold">{r.label}</span>
                {r.badge && <span className="ml-1.5 text-[10px] text-ink-soft">{r.badge}</span>}
                {r.sub && <span className="block text-ink-soft line-clamp-2">{r.sub}</span>}
                {r.warn && <span className="block mt-0.5 text-amber-700">⚠ {r.warn}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PluginsSection;
