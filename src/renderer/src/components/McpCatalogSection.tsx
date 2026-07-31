import { useEffect, useState } from "react";
import { MCP_CATALOG, type McpCatalogEntry } from "../../../main/mcpCatalog";

/**
 * §13 round 8: the curated one-click catalog. Browsing is local (the list is
 * bundled — no network fetch); clicking opens a confirm dialog that presents the
 * server and shows exactly what will be written before anything is installed.
 */
export function McpCatalogSection({
  workspaceId,
  onInstalled,
}: {
  workspaceId: string | null;
  onInstalled: () => void;
}): React.JSX.Element {
  const [installedNames, setInstalledNames] = useState<Set<string>>(new Set());
  const [hasNode, setHasNode] = useState(true);
  const [chosen, setChosen] = useState<McpCatalogEntry | null>(null);

  const refreshInstalled = async (): Promise<void> => {
    const r = await window.hv.mcpGet(workspaceId ?? undefined);
    // Lowercased: mcpServers keys are case-sensitive, but writeMcpServer's
    // collision guard is case-insensitive, so a hand-added "Notion" must mark
    // the "notion" card installed — otherwise the card invites a click that the
    // guard then refuses.
    setInstalledNames(
      new Set(
        [
          ...Object.keys(r.global?.mcpServers ?? {}),
          ...Object.keys(r.workspace?.mcpServers ?? {}),
        ].map((n) => n.toLowerCase()),
      ),
    );
  };

  useEffect(() => {
    void refreshInstalled().catch(() => { /* non-fatal — cards just show uninstalled */ });
    // Optimistic default: only badge "needs Node" once we know it's missing.
    void window.hv.nodeAvailable().then(setHasNode).catch(() => setHasNode(true));
  }, [workspaceId]);

  return (
    <div>
      {/* The Section heading already says "recognised … ready to install" — this
          line adds only what that does not cover. */}
      <p className="text-xs text-ink-soft mb-3">
        Every one still goes through your permission rules.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {MCP_CATALOG.map((e) => {
          const installed = installedNames.has(e.key.toLowerCase());
          const blocked = e.transport === "stdio" && !hasNode;
          return (
            <button
              key={e.key}
              type="button"
              disabled={installed}
              onClick={() => setChosen(e)}
              className="text-left rounded-xl bg-card border-2 border-line px-3 py-2.5 hover:border-tangerine disabled:opacity-60 disabled:hover:border-line disabled:cursor-default cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {e.brand ? (
                  <i className={`si ${e.brand} text-base shrink-0`} aria-hidden />
                ) : (
                  <span className="size-4 rounded bg-paper-deep border border-line shrink-0" aria-hidden />
                )}
                <span className="font-bold text-sm truncate">{e.name}</span>
                <span className="flex-1" />
                {installed && (
                  <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-leaf-soft text-leaf border border-leaf/50 shrink-0">
                    installed
                  </span>
                )}
                {!installed && blocked && (
                  <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-honey-soft text-tangerine-deep border border-honey/60 shrink-0">
                    needs Node
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-soft mt-1 mb-1 line-clamp-2">{e.tagline}</p>
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">
                {e.category}
              </span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <McpCatalogConfirm
          entry={chosen}
          workspaceId={workspaceId}
          nodeMissing={chosen.transport === "stdio" && !hasNode}
          onClose={() => setChosen(null)}
          onInstalled={() => {
            setChosen(null);
            void refreshInstalled();
            onInstalled();
          }}
        />
      )}
    </div>
  );
}

function McpCatalogConfirm({
  entry,
  workspaceId,
  nodeMissing,
  onClose,
  onInstalled,
}: {
  entry: McpCatalogEntry;
  workspaceId: string | null;
  nodeMissing: boolean;
  onClose: () => void;
  onInstalled: () => void;
}): React.JSX.Element {
  const [scope, setScope] = useState<"global" | "workspace">("global");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const install = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await window.hv
      .mcpInstallCatalog(entry.key, scope, scope === "workspace" ? workspaceId : null, values)
      .catch((e: unknown) => ({ ok: false as const, error: String(e) }));
    setBusy(false);
    if (res.ok) onInstalled();
    else setError(res.error);
  };

  const inputCls =
    "rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-tangerine w-full";
  const labelCls =
    "text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1 mt-3 block";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6 max-h-[85vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          {entry.brand && <i className={`si ${entry.brand} text-xl shrink-0`} aria-hidden />}
          <h2 className="font-black text-xl leading-tight">Add {entry.name}?</h2>
        </div>
        <p className="text-sm text-ink-soft mb-2">{entry.blurb}</p>
        <a
          href={entry.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-bold text-tangerine-deep underline"
        >
          {entry.name} documentation ↗
        </a>

        <label className={labelCls}>What will be added</label>
        <p className="text-xs text-ink-soft">
          A server named <span className="font-mono font-bold">{entry.key}</span>, in{" "}
          <span className="font-mono">
            {scope === "global" ? "your global MCP config" : ".mcp.json in this workspace"}
          </span>
          .
        </p>
        <p className="text-xs text-ink-soft mt-1 font-mono break-all">
          {entry.transport === "remote"
            ? (entry.build(
                Object.fromEntries(entry.inputs.map((i) => [i.id, values[i.id] ?? `<${i.label}>`])),
                () => "•••",
              ).url as string)
            : (() => {
                const c = entry.build({}, () => "•••");
                return [c.command, ...(c.args ?? [])].join(" ");
              })()}
        </p>
        {entry.auth === "oauth" && (
          <p className="text-xs text-ink-soft mt-1">
            You&apos;ll sign in through your browser after adding it.
          </p>
        )}

        {nodeMissing && (
          <div className="mt-2 rounded-lg bg-honey-soft border border-honey/60 px-3 py-2 text-xs text-tangerine-deep">
            <span className="font-bold">Needs Node.</span> This server runs on your machine via{" "}
            <span className="font-mono">npx</span>, and HappyVibe could not find Node on your PATH.
            Install Node first, or it will fail to start.
          </div>
        )}

        <label className={labelCls}>Scope</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "global" | "workspace")}
          className={inputCls + " cursor-pointer"}
        >
          <option value="global">Global (all workspaces)</option>
          <option value="workspace" disabled={!workspaceId}>
            Workspace (.mcp.json shareable)
          </option>
        </select>

        {entry.inputs.map((input) => (
          <div key={input.id}>
            <label className={labelCls}>{input.label}</label>
            <input
              type={input.secret ? "password" : "text"}
              value={values[input.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [input.id]: e.target.value }))}
              className={inputCls}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-xs text-ink-soft mt-1">
              {input.hint}
              {input.secret && " — stored encrypted, never written to the config file."}
            </p>
          </div>
        ))}

        {error && <div className="mt-3 text-sm font-semibold text-berry">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border-2 border-line px-4 py-2 text-sm font-bold text-ink-soft hover:bg-paper-deep/40 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void install()}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker hover:brightness-105 disabled:opacity-60 cursor-pointer"
          >
            {busy ? "Adding…" : `Add ${entry.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
