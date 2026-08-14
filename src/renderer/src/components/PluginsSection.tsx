import { useEffect, useMemo, useState } from "react";
import { BrandMark, hasBrandMark } from "./BrandMark";

/**
 * §25 plugin store.
 *
 * Every plugin listed here was verified at release time by the app's own
 * classifier and can be installed — the list is embedded, so this page needs no
 * network and cannot show something that will refuse on click. Plugins using
 * hooks, agents, monitors or LSP servers are absent rather than greyed: a store
 * full of things you cannot install is a worse message than a shorter store.
 *
 * Installing still downloads the plugin at the commit it was verified at, so
 * what was checked is exactly what lands.
 */

type Card = HvPluginCard;

/** Selection state inside the confirm dialog. */
interface Chosen {
  skills: Set<string>;
  commands: Set<string>;
  servers: Set<string>;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** §25 round 12: how many cards a page shows. */
export const PAGE = 24;

/**
 * §25 round 12 — recognised brands first, then alphabetical inside each group.
 *
 * "Recognised" means BrandMark will draw a real logo — asked through
 * `hasBrandMark`, the same predicate the card itself renders from, so the two
 * cannot disagree. Testing `brand` alone was not the same question: `firecrawl`
 * has no simple-icons class but does have an inline vendor glyph, so it drew a
 * flame while sorting among the monograms. A hand-picked "featured" list was
 * rejected for re-introducing the per-release curation tax the generated
 * catalog exists to remove.
 */
export function sortCards<T extends { name: string; brand?: string }>(cards: T[]): T[] {
  return [...cards].sort(
    (a, b) => Number(!hasBrandMark(a)) - Number(!hasBrandMark(b)) || a.name.localeCompare(b.name),
  );
}

/**
 * §25 round 12 — the handover controls.
 *
 * Rendered in TWO places on purpose, and the reason is a defect I shipped
 * first: the banner alone sits above the card grid, so after installing from a
 * dialog it landed BELOW the fold (measured: banner 576→652 in a 638px
 * viewport) — and further off-screen for anyone who had scrolled through 179
 * cards to find the plugin. The actions were there and unseeable, which is
 * §14 round 11's lesson exactly: a feature whose only output lands somewhere
 * the user is not looking has not shipped.
 *
 * So the primary surface is now the dialog the click happened in; the banner
 * keeps them for after it closes. One component, so the two cannot disagree.
 */
function Handover({
  done,
  enabling,
  enabled,
  connecting,
  connected,
  onEnable,
  onConnect,
}: {
  done: { plugin: string; skills: string[]; commands: string[]; servers: string[] };
  enabling: boolean;
  enabled: { skills: number; commands: number } | null;
  connecting: string | null;
  connected: Set<string>;
  onEnable: () => void;
  onConnect: (name: string) => void;
}): React.JSX.Element {
  const btn = "rounded-lg border border-green-700/40 bg-white px-2.5 py-1 font-semibold hover:bg-green-100 disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(done.skills.length > 0 || done.commands.length > 0) && (
        <button disabled={enabling || enabled !== null} onClick={onEnable} className={btn}>
          {enabling
            ? "Enabling…"
            : enabled
              ? "Enabled"
              : `Enable ${[
                  done.skills.length ? plural(done.skills.length, "skill") : null,
                  done.commands.length ? plural(done.commands.length, "prompt") : null,
                ].filter(Boolean).join(" · ")}`}
        </button>
      )}
      {done.servers.map((name) => (
        <button key={name} disabled={connecting === name || connected.has(name)} onClick={() => onConnect(name)} className={btn}>
          {connecting === name ? `Connecting ${name}…` : connected.has(name) ? `${name} connected` : `Connect ${name}`}
        </button>
      ))}
    </div>
  );
}

export function PluginsSection(): React.JSX.Element {
  const [cards, setCards] = useState<Card[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const [scan, setScan] = useState<HvPluginScan | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen>({ skills: new Set(), commands: new Set(), servers: new Set() });
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState<{ plugin: string; skills: string[]; commands: string[]; servers: string[]; substituted: number } | null>(null);
  // §25 round 12: the banner acts, so it holds the outcome of acting.
  const [enabling, setEnabling] = useState(false);
  const [enabled, setEnabled] = useState<{ skills: number; commands: number } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [installed, setInstalled] = useState<
    Array<{ plugin: string; marketplace?: string; skills: string[]; commands: string[]; servers: string[] }>
  >([]);
  const [removing, setRemoving] = useState<string | null>(null);

  const refreshInstalled = (): void => {
    void window.hv.pluginInstalled().then(setInstalled);
  };

  useEffect(() => {
    void window.hv.pluginList().then((res) => {
      setLoading(false);
      setCards(res.plugins);
      setGeneratedAt(res.generatedAt);
    });
    refreshInstalled();
  }, []);

  const installedNames = useMemo(() => new Set(installed.map((p) => p.plugin)), [installed]);

  const categories = useMemo(
    () => [...new Set(cards.map((c) => c.category).filter((c): c is string => !!c))].sort(),
    [cards],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortCards(
      cards.filter((c) => {
        if (category && c.category !== category) return false;
        if (!q) return true;
        return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
      }),
    );
  }, [cards, query, category]);

  // §25 round 12: a first page plus Show more, rather than 179 cards at once.
  // Numbered pagination would need a cursor kept in sync with BOTH the search
  // box and the category chips, to buy nothing this does not.
  const [limit, setLimit] = useState(PAGE);
  // A new filter starts a new list — inheriting a scrolled-open limit would make
  // "Show more (N left)" describe the previous search.
  useEffect(() => setLimit(PAGE), [query, category]);

  const openPlugin = (card: Card): void => {
    setScanning(card.name);
    setError(null);
    setDone(null);
    void window.hv.pluginScan("claude-plugins-official", card.name).then((res) => {
      setScanning(null);
      if (!("ok" in res) || res.ok !== true) {
        setError((res as { error: string }).error);
        return;
      }
      setScan(res);
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
    setError(null);
    setEnabled(null);
    setConnected(new Set());
    void window.hv
      .pluginInstall(scan.token, {
        skillDirs: [...chosen.skills],
        commandFiles: [...chosen.commands],
        mcpKeys: [...chosen.servers],
      })
      .then((res) => {
        setInstalling(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setDone({ plugin: scan.name, skills: res.skills, commands: res.commands, servers: res.servers, substituted: res.substituted });
        // The dialog deliberately STAYS OPEN and turns into the handover: the
        // banner alone rendered below the fold, so the actions existed and could
        // not be seen. Closing is now the user's move, after enabling.
        refreshInstalled();
      });
  };

  const remove = (plugin: string): void => {
    setRemoving(plugin);
    void window.hv.pluginRemove(plugin).then((res) => {
      setRemoving(null);
      refreshInstalled();
      if (!res.ok) setError(res.error);
    });
  };

  const enableInstalled = (): void => {
    if (!done?.plugin) return;
    setEnabling(true);
    void window.hv.pluginEnableInstalled(done.plugin).then((res) => {
      setEnabling(false);
      if (res.ok) setEnabled({ skills: res.skills, commands: res.commands });
      else setError(res.error);
    });
  };

  const connectServer = (name: string): void => {
    setConnecting(name);
    // The same flow the MCP page runs: probe, escalate to browser OAuth only on
    // a genuine 401, then report the tools found.
    void window.hv.mcpConnectFlow("global", null, name).then((res) => {
      setConnecting(null);
      if (res.ok) setConnected((p) => new Set(p).add(name));
      else setError(`${name}: ${res.error}`);
    });
  };

  const totalChosen = chosen.skills.size + chosen.commands.size + chosen.servers.size;

  return (
    <div className="space-y-4">
      {/* ── installed ───────────────────────────────────────────────────── */}
      {installed.length > 0 && (
        <div className="rounded-xl border border-line bg-paper-soft/40 p-3">
          <h4 className="text-sm font-bold">Installed</h4>
          <ul className="mt-1.5 space-y-1.5">
            {installed.map((p) => (
              <li key={p.plugin} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{p.plugin}</span>
                  <span className="ml-1.5 text-ink-soft">
                    {[
                      p.skills.length ? plural(p.skills.length, "skill") : null,
                      p.commands.length ? plural(p.commands.length, "prompt") : null,
                      p.servers.length ? plural(p.servers.length, "server") : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <button
                  disabled={removing === p.plugin}
                  onClick={() => remove(p.plugin)}
                  className="rounded-lg border border-line px-2 py-1 font-semibold hover:bg-paper disabled:opacity-50"
                >
                  {removing === p.plugin ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── search ──────────────────────────────────────────────────────── */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search plugins…"
        className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-sm"
      />

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
      </div>

      {loading && <p className="text-sm text-ink-soft">Loading…</p>}
      {!loading && (
        // Staleness is disclosed rather than hidden: the list is a snapshot, and
        // a plugin added upstream since then appears at the next release.
        <p className="text-xs text-ink-soft">
          {cards.length} plugins, each verified to install here · checked {generatedAt}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
      {done && (
        // The handover. Nothing installed here is live yet, and each kind is
        // finished on a different page — so name only the parts that actually
        // apply rather than reciting all three at someone who installed one skill.
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          <p>
            Installed{" "}
            {[
              done.skills.length ? plural(done.skills.length, "skill") : null,
              done.commands.length ? plural(done.commands.length, "prompt") : null,
              done.servers.length ? plural(done.servers.length, "MCP server") : null,
            ].filter(Boolean).join(" · ") || "nothing"}
            .{" "}
            {enabled ? (
              <strong>Active now.</strong>
            ) : (
              <strong>Nothing from it is active yet — that part is yours:</strong>
            )}
          </p>
          <div className="mt-2">
            <Handover
              done={done}
              enabling={enabling}
              enabled={enabled}
              connecting={connecting}
              connected={connected}
              onEnable={enableInstalled}
              onConnect={connectServer}
            />
          </div>
          {enabled && (
            <p className="mt-1.5">
              {plural(enabled.skills, "skill")} and {plural(enabled.commands, "prompt")} are on. Fine-tune them on the{" "}
              <strong>Skills</strong> and <strong>Prompts</strong> pages.
            </p>
          )}
          {done.substituted > 0 && (
            <p className="mt-1">{plural(done.substituted, "plugin-root path")} rewritten to the install location.</p>
          )}
        </div>
      )}

      {/* ── cards ───────────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.slice(0, limit).map((c) => (
          <button
            key={c.name}
            disabled={scanning !== null}
            onClick={() => openPlugin(c)}
            className="text-left rounded-xl border border-line bg-paper p-3 transition hover:border-ink/40 hover:shadow-sm disabled:opacity-60"
          >
            <div className="flex items-baseline gap-2">
              <BrandMark name={c.name} brand={c.brand} />
              <span className="font-semibold text-sm truncate">{c.name}</span>
              {installedNames.has(c.name) && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-green-700">installed</span>
              )}
              {scanning === c.name && <span className="ml-auto text-xs text-ink-soft">opening…</span>}
            </div>
            <p className="mt-1 text-xs text-ink-soft line-clamp-2">{c.description}</p>
            <p className="mt-1.5 text-[11px] text-ink-soft">
              {[
                c.counts.skills ? plural(c.counts.skills, "skill") : null,
                c.counts.commands ? plural(c.counts.commands, "prompt") : null,
                c.counts.servers ? plural(c.counts.servers, "MCP server") : null,
              ].filter(Boolean).join(" · ")}
              {c.category && <span className="ml-1.5 uppercase tracking-wide opacity-70">{c.category}</span>}
            </p>
          </button>
        ))}
      </div>
      {shown.length > limit && (
        <button
          onClick={() => setLimit((n) => n + PAGE)}
          className="w-full rounded-lg border border-line bg-paper py-2 text-sm font-semibold hover:bg-paper-soft"
        >
          Show more ({shown.length - limit} left)
        </button>
      )}
      {!loading && shown.length === 0 && <p className="text-sm text-ink-soft">Nothing matches that search.</p>}

      {/* ── confirm dialog ──────────────────────────────────────────────── */}
      {scan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-paper p-5 shadow-xl">
            <h3 className="font-black text-lg tracking-tight">{scan.name}</h3>
            <p className="mt-1 text-sm text-ink-soft">{scan.description}</p>

            {/* Computed, and shown only when non-empty. A verified plugin can
                still be dropping namespaced commands Pi cannot read. */}
            {Object.keys(scan.dropped).length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <strong>This plugin ships more than HappyVibe installs.</strong> Skills, top-level
                prompts and MCP servers come in — so{" "}
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
              note="Arrive switched OFF — you can switch them on here, right after installing."
              rows={scan.skills.map((s) => ({
                id: s.dir,
                label: s.name,
                sub: s.description,
                disabled: s.screen === "reject",
                warn:
                  s.screen === "reject" || s.screen === "warn"
                    ? s.screenReason
                    : s.pluginRootRefs > 0
                      ? `${plural(s.pluginRootRefs, "plugin-root path")} will be rewritten to the install location`
                      : undefined,
                badge: s.scriptCount > 0 ? `${s.scriptCount} scripts` : undefined,
              }))}
              chosen={chosen.skills}
              onToggle={(id) => toggle("skills", id)}
            />
            <PickList
              title="Prompts"
              note="Arrive switched OFF — enable them on the Prompts page, then type /name."
              rows={scan.commands.map((c) => ({ id: c.file, label: `/${c.name}`, sub: c.description }))}
              chosen={chosen.commands}
              onToggle={(id) => toggle("commands", id)}
            />
            <PickList
              title="MCP servers"
              note="Added to your global mcp.json but NOT connected — sign in on the MCP page. Removed with the plugin."
              rows={scan.mcpServers.map((k) => ({ id: k, label: k }))}
              chosen={chosen.servers}
              onToggle={(id) => toggle("servers", id)}
            />

            {/* Said BEFORE the click, not only after: installing is not enabling,
                and the follow-up is the user's. The success banner repeats it with
                real counts. */}
            <p className="mt-4 rounded-lg border border-line bg-paper-soft/60 px-3 py-2 text-xs">
              Installing copies these in and nothing more — <strong>skills and prompts arrive switched
              off, and MCP servers arrive unconnected</strong>. Turning each one on, and signing in to
              any server, is your move — offered here as soon as the install finishes.
            </p>

            <p className="mt-3 text-[11px] text-ink-soft">
              Installing from the commit this was verified at:{" "}
              <code className="font-mono">{scan.sha ? scan.sha.slice(0, 10) : "the marketplace snapshot"}</code>
              {scan.ref && <> ({scan.ref})</>}.
            </p>

            {error && (
              <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
            )}

            {/* Installed: this dialog BECOMES the handover rather than closing and
                leaving a banner the user has to find. Same controls, same calls. */}
            {done?.plugin === scan.name ? (
              <div className="mt-5 rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-sm text-green-900">
                <p>
                  Installed{" "}
                  {[
                    done.skills.length ? plural(done.skills.length, "skill") : null,
                    done.commands.length ? plural(done.commands.length, "prompt") : null,
                    done.servers.length ? plural(done.servers.length, "MCP server") : null,
                  ].filter(Boolean).join(" · ") || "nothing"}
                  .{" "}
                  {enabled ? (
                    <strong>Active now.</strong>
                  ) : (
                    <strong>Nothing from it is active yet — one click does it:</strong>
                  )}
                </p>
                <div className="mt-2">
                  <Handover
                    done={done}
                    enabling={enabling}
                    enabled={enabled}
                    connecting={connecting}
                    connected={connected}
                    onEnable={enableInstalled}
                    onConnect={connectServer}
                  />
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => { setScan(null); setError(null); }}
                    className="rounded-lg border border-green-700/40 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-green-100"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => { setScan(null); setError(null); }}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-paper-soft"
                >
                  Cancel
                </button>
                <button
                  disabled={installing || totalChosen === 0}
                  onClick={install}
                  className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
                >
                  {installing ? "Installing…" : `Install ${plural(totalChosen, "item")}`}
                </button>
              </div>
            )}
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
