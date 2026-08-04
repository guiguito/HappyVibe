import { useEffect, useRef, useState } from "react";
import { brandIconFor } from "../toolLabel";
import { BrandMark } from "./BrandMark";

interface McpServer {
  scope: "global" | "workspace";
  name: string;
  cfg: Record<string, unknown>;
}

function flatten(file: { mcpServers?: Record<string, unknown> } | null, scope: "global" | "workspace"): McpServer[] {
  return Object.entries(file?.mcpServers ?? {}).map(([name, cfg]) => ({
    scope,
    name,
    cfg: (cfg as Record<string, unknown>) ?? {},
  }));
}

function statusKey(scope: string, workspaceId: string | null, name: string): string {
  return `${scope}:${workspaceId ?? ""}:${name}`;
}

// ---------------------------------------------------------------------------
// McpConnectResult — shown after authenticate/check resolves
// ---------------------------------------------------------------------------

export type ConnectResultState =
  | { phase: "connecting"; serverName: string }
  | { phase: "ok"; serverName: string; tools: { name: string; description?: string }[] }
  | { phase: "error"; serverName: string; error: string; retry: () => void };

/**
 * A server's tools with their descriptions. Shared by the post-install confirm
 * modal and (round 11) the tool-count disclosure on each server row — the same
 * data, and it was already fetched for both.
 */
export function McpToolList({
  tools,
  className = "",
}: {
  tools: { name: string; description?: string }[];
  className?: string;
}): React.JSX.Element {
  return (
    <ul className={`rounded-xl bg-card border border-line divide-y divide-line max-h-48 overflow-y-auto ${className}`}>
      {tools.map((t) => (
        <li key={t.name} className="px-3 py-2">
          <span className="font-mono text-xs font-bold">{t.name}</span>
          {t.description && <span className="block text-xs text-ink-soft mt-0.5">{t.description}</span>}
        </li>
      ))}
    </ul>
  );
}

export function McpConnectResult({
  state,
  onClose,
}: {
  state: ConnectResultState;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6 max-h-[85vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {state.phase === "connecting" && (
          <>
            <h2 className="font-black text-xl leading-tight mb-2">Connecting to {state.serverName}</h2>
            {/* Generic on purpose: this modal now also fronts the catalog's
                connect flow, where a stdio or key-based server never opens a
                browser. Promising one that never appears reads as a hang. */}
            <p className="text-sm text-ink-soft mb-4">
              If this server needs you to sign in, your browser will open — approve access, then
              return to HappyVibe.
            </p>
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              {/* ponytail: CSS spinner, no lib */}
              <span
                className="inline-block w-4 h-4 rounded-full border-2 border-tangerine border-t-transparent animate-spin shrink-0"
                aria-hidden
              />
              Waiting for authorisation…
              <span className="flex-1" />
              {/* Abandoning the browser sign-in must not trap the user behind a
                  spinner that only clears on the auth timeout. Dismissing is
                  cosmetic — main's attempt runs to completion and its result is
                  ignored — so the server is simply left unauthenticated, which
                  the status badge already reports. */}
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-bold text-ink-soft underline hover:text-ink cursor-pointer shrink-0"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {state.phase === "ok" && (
          <>
            <h2 className="font-black text-xl leading-tight mb-1">
              Connected to {state.serverName}
            </h2>
            <p className="text-sm text-ink-soft mb-3">
              {state.tools.length} {state.tools.length === 1 ? "tool" : "tools"} discovered.
            </p>
            {state.tools.length > 0 && <McpToolList tools={state.tools} className="mb-4" />}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker hover:brightness-105 cursor-pointer"
              >
                Done
              </button>
            </div>
          </>
        )}

        {state.phase === "error" && (
          <>
            <h2 className="font-black text-xl leading-tight mb-2 text-berry">
              Could not connect to {state.serverName}
            </h2>
            <p className="text-sm font-mono bg-berry-soft/30 text-berry rounded-lg px-3 py-2 mb-4 break-all">
              {state.error}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border-2 border-line px-4 py-2 text-sm font-bold text-ink-soft hover:bg-paper-deep/40 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => { state.retry(); }}
                className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker hover:brightness-105 cursor-pointer"
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// McpServersSection
// ---------------------------------------------------------------------------

/**
 * MCP servers CRUD (Agents & Tools page). Writes standard mcpServers JSON
 * vendored pi-mcp-adapter reads: global → app agent dir mcp.json,
 * workspace → <workspace>/.mcp.json (shareable with other MCP hosts).
 * Config read at session start — changes apply to new sessions.
 */
export function McpServersSection({
  workspaceId,
  scope = "global",
  embedded = false,
  onServersChanged,
}: {
  workspaceId: string | null;
  /**
   * Which tier this instance manages. Explicit, never inferred: the scope used
   * to come from whichever session happened to be selected, so the global MCP
   * page either disabled the workspace option or silently wrote to an unnamed
   * workspace. Global page passes "global"; WorkspaceSettingsModal passes
   * "workspace" with its own path, where the workspace identity is unambiguous.
   */
  scope?: "global" | "workspace";
  /** v5: rendered inside the "MCP" section card — drop the own heading + top margin. */
  embedded?: boolean;
  /** §13 round 8: fired after this list adds or removes a server, so the curated
      catalog above can re-derive its "installed" badges. Without it, removing a
      server here leaves its catalog card stuck as installed and un-clickable. */
  onServersChanged?: () => void;
}): React.JSX.Element {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Map<string, McpServerStatusLike>>(new Map());
  const [connectResult, setConnectResult] = useState<ConnectResultState | null>(null);
  // Round 11: which servers have their tool list open (keyed by statusKey).
  const [openTools, setOpenTools] = useState<ReadonlySet<string>>(new Set());
  const unsubRef = useRef<(() => void) | null>(null);
  // Bumped on every connect attempt AND on dismiss, so a result that lands
  // after the user walked away can't reopen the modal behind them.
  const connectGen = useRef(0);

  const refresh = async (): Promise<void> => {
    const r = await window.hv.mcpGet(workspaceId ?? undefined);
    setServers(scope === "global" ? flatten(r.global, "global") : flatten(r.workspace, "workspace"));
  };

  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    void window.hv.mcpStatus().then((list) => {
      setStatuses(new Map(list.map((s) => [statusKey(s.scope, s.workspaceId, s.name), s])));
    }).catch(() => { /* non-fatal */ });
    unsubRef.current = window.hv.onMcpStatusChanged((list) => {
      setStatuses(new Map(list.map((s) => [statusKey(s.scope, s.workspaceId, s.name), s])));
    });
    return () => { unsubRef.current?.(); };
  }, [workspaceId, scope]);

  const remove = async (s: McpServer): Promise<void> => {
    await window.hv.mcpSetServer(s.scope, s.scope === "workspace" ? workspaceId : null, s.name, null);
    await refresh();
    onServersChanged?.();
  };

  const reconnect = (s: McpServer): void => {
    void window.hv.mcpCheck(s.scope, s.scope === "workspace" ? workspaceId : null, s.name)
      .catch((e) => setError(String(e)));
  };

  // Kick off mcpAuthenticate and show result modal.
  // ponytail: single function covers add-time + per-row Authenticate flows.
  const authenticate = (scope: "global" | "workspace", name: string): void => {
    const wsId = scope === "workspace" ? workspaceId : null;
    const gen = ++connectGen.current;
    const stale = (): boolean => connectGen.current !== gen;
    setConnectResult({ phase: "connecting", serverName: name });
    void window.hv.mcpAuthenticate(scope, wsId, name).then((res) => {
      if (stale()) return;
      if (res.ok) {
        setConnectResult({ phase: "ok", serverName: name, tools: res.tools });
      } else {
        setConnectResult({
          phase: "error",
          serverName: name,
          error: res.error,
          retry: () => authenticate(scope, name),
        });
      }
    }).catch((e: unknown) => {
      if (stale()) return;
      setConnectResult({
        phase: "error",
        serverName: name,
        error: String(e),
        retry: () => authenticate(scope, name),
      });
    });
  };

  // Called by McpServerEditor after config is written.
  // For HTTP servers: always attempt auth (mcpAuthenticate no-ops fast when tokens are valid).
  // ponytail: skip mcpCheck round-trip — mcpAuthenticate fast-paths on valid tokens already.
  const handleSaved = (savedScope: "global" | "workspace", savedName: string, isHttp: boolean): void => {
    setEditing(null);
    void refresh();
    onServersChanged?.(); // a manual add/rename changes the catalog's installed set too
    if (isHttp) {
      authenticate(savedScope, savedName);
    }
  };

  return (
    <div className={embedded ? "" : "mt-10"}>
      <div className="flex items-center gap-2 mb-1">
        {!embedded && <h2 className="font-bold text-lg">MCP servers</h2>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer"
        >
          Add server
        </button>
      </div>
      <p className="text-xs text-ink-soft mb-3">
        Model Context Protocol servers add external tools. Changes apply to new sessions only —
        every MCP call still goes through your permission rules.
      </p>
      {error && <div className="mb-2 text-sm font-semibold text-berry">{error}</div>}
      {servers === null ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : servers.length === 0 ? (
        <p className="text-sm text-ink-soft">No MCP servers configured.</p>
      ) : (
        <div className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg overflow-hidden">
          {servers.map((s) => {
            const sKey = statusKey(s.scope, s.scope === "workspace" ? workspaceId : null, s.name);
            const status = statuses.get(sKey);
            const isHttp = typeof s.cfg.url === "string";
            const brand = brandIconFor(s.name);
            return (
              <div key={`${s.scope}:${s.name}`} className="border-b border-line last:border-b-0">
              <div className="px-4 py-3 flex items-center gap-3">
                {/* Round 8: real glyph when simple-icons has one, else a tinted
                    monogram — a hand-added server should never render as a blank
                    square just because we don't ship its logo. */}
                <BrandMark name={s.name} brand={brand} size="lg" />
                {/* Identity above, the literal endpoint below — two deliberate
                    lines. One line forced the mono endpoint to compete with the
                    action buttons, which pushed Remove off the card. */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{s.name}</span>
                    <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-paper-deep text-ink-soft border border-line shrink-0">
                      {s.scope}
                    </span>
                    <McpStatusBadge
                      status={status}
                      open={openTools.has(sKey)}
                      onToggleTools={
                        status?.tools?.length
                          ? () =>
                              setOpenTools((prev) => {
                                const next = new Set(prev);
                                if (!next.delete(sKey)) next.add(sKey);
                                return next;
                              })
                          : undefined
                      }
                    />
                    {s.cfg.directTools ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 bg-honey-soft text-tangerine-deep border-honey/60 shrink-0">
                        direct
                      </span>
                    ) : null}
                  </div>
                  <span className="block font-mono text-xs text-ink-soft truncate mt-0.5">
                    {isHttp
                      ? s.cfg.url as string
                      : [s.cfg.command, ...((s.cfg.args as string[]) ?? [])].filter(Boolean).join(" ")}
                  </span>
                </div>
                {/* Authenticate — shown when needs-auth */}
                {status?.state === "needs-auth" && (
                  <button
                    type="button"
                    onClick={() => authenticate(s.scope, s.name)}
                    className="text-xs font-bold rounded-lg border-2 border-honey/60 px-2.5 py-1 bg-honey-soft text-tangerine-deep hover:brightness-105 cursor-pointer shrink-0"
                  >
                    Authenticate
                  </button>
                )}
                {/* Log out — shown when connected on an OAuth server (has url) */}
                {status?.state === "connected" && isHttp && (
                  <button
                    type="button"
                    onClick={() => void window.hv.mcpLogout(s.name).catch((e) => setError(String(e)))}
                    className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 text-ink-soft hover:bg-paper-deep/40 cursor-pointer shrink-0"
                  >
                    Log out
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => reconnect(s)}
                  className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer shrink-0"
                >
                  Reconnect
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 hover:bg-paper-deep/40 cursor-pointer shrink-0"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(s).catch((e) => setError(String(e)))}
                  className="text-xs font-bold rounded-lg border-2 border-line px-2.5 py-1 text-berry hover:bg-berry-soft/40 cursor-pointer shrink-0"
                >
                  Remove
                </button>
              </div>
              {/* Round 11: the tool list the count badge opens. `status.tools`
                  already carries descriptions — it was fetched and discarded. */}
              {openTools.has(sKey) && status?.tools?.length ? (
                <div className="px-4 pb-3">
                  <McpToolList tools={status.tools} />
                </div>
              ) : null}
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <McpServerEditor
          server={editing === "new" ? null : editing}
          scope={scope}
          workspaceId={workspaceId}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {connectResult && (
        <McpConnectResult
          state={connectResult}
          onClose={() => {
            // Always dismissable, including mid-connect: abandoning a browser
            // sign-in used to leave the user stuck behind a spinner until the
            // auth timeout. Bumping the generation makes any late result a
            // no-op instead of reopening the modal.
            connectGen.current++;
            setConnectResult(null);
          }}
        />
      )}
    </div>
  );
}

function McpStatusBadge({
  status,
  open = false,
  onToggleTools,
}: {
  status: McpServerStatusLike | undefined;
  /** Round 11: is the tool list expanded? */
  open?: boolean;
  /** Provided only when there is a tool list to show — absent keeps the plain badge. */
  onToggleTools?: () => void;
}): React.JSX.Element {
  if (!status) {
    return (
      <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-paper-deep text-ink-soft border border-line shrink-0">
        —
      </span>
    );
  }
  const { state, toolCount, error } = status;
  if (state === "connected") {
    const label = `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`;
    const cls =
      "text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-leaf-soft text-leaf border border-leaf/50 shrink-0";
    // A server that reported no tools (or connected before this shipped) keeps
    // the plain badge — never an empty disclosure.
    if (!onToggleTools) return <span className={cls}>{label}</span>;
    return (
      <button
        type="button"
        onClick={onToggleTools}
        aria-expanded={open}
        title={open ? "Hide the tool list" : "Show the tools and what they do"}
        className={`${cls} inline-flex items-center gap-1 cursor-pointer hover:brightness-105`}
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ▸
        </span>
        {label}
      </button>
    );
  }
  if (state === "needs-auth") {
    return (
      <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-honey-soft text-tangerine-deep border border-honey/60 shrink-0">
        needs auth
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span
        title={error ?? "Connection failed"}
        className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-berry-soft text-berry border border-berry/50 shrink-0 cursor-help"
      >
        failed
      </span>
    );
  }
  // checking
  return (
    <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-paper-deep text-ink-soft border border-line shrink-0">
      checking…
    </span>
  );
}

function McpServerEditor({
  server, scope, workspaceId, onClose, onSaved,
}: {
  server: McpServer | null;
  /** Fixed by the surface — this dialog no longer asks. */
  scope: "global" | "workspace";
  workspaceId: string | null;
  onClose: () => void;
  onSaved: (scope: "global" | "workspace", name: string, isHttp: boolean) => void;
}): React.JSX.Element {
  const cfg = server?.cfg ?? {};
  const [name, setName] = useState(server?.name ?? "");
  const [kind, setKind] = useState<"stdio" | "http">(typeof cfg.url === "string" ? "http" : "stdio");
  const [command, setCommand] = useState(
    [cfg.command, ...((cfg.args as string[]) ?? [])].filter(Boolean).join(" "),
  );
  const [url, setUrl] = useState(typeof cfg.url === "string" ? cfg.url : "");
  const [env, setEnv] = useState(
    Object.entries((cfg.env as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"),
  );
  const [direct, setDirect] = useState(Boolean(cfg.directTools));
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    try {
      if (!/^[\w-]+$/.test(name)) throw new Error("Name must match /^[\\w-]+$/");
      const envObj: Record<string, string> = {};
      env.split("\n").forEach((line) => {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) envObj[m[1]] = m[2];
      });
      const [cmd, ...args] = command.trim().split(/\s+/);
      const next: Record<string, unknown> = {
        ...(kind === "stdio"
          ? { command: cmd, args: args.length ? args : undefined, url: undefined, headers: undefined }
          : { url, command: undefined, args: undefined, env: undefined }),
        ...(kind === "stdio" && Object.keys(envObj).length ? { env: envObj } : {}),
        ...(direct ? { directTools: true } : { directTools: undefined }),
      };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      if (kind === "stdio" && !cmd) throw new Error("Command is required");
      if (kind === "http" && !url) throw new Error("URL is required");
      // Scope change on an existing server = write new scope, remove from old.
      await window.hv.mcpSetServer(scope, scope === "workspace" ? workspaceId : null, name, next);
      if (server && (server.scope !== scope || server.name !== name)) {
        await window.hv.mcpSetServer(server.scope, server.scope === "workspace" ? workspaceId : null, server.name, null);
      }
      onSaved(scope, name, kind === "http");
    } catch (e) {
      setError(String(e));
    }
  };

  const inputCls =
    "rounded-lg border-2 border-line bg-card px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:border-tangerine w-full";
  const labelCls = "text-[10px] font-bold uppercase tracking-widest text-ink-soft mb-1 mt-3 block";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl bg-paper border-2 border-line-strong shadow-pop p-6 max-h-[85vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="font-black text-xl leading-tight mb-1">{server ? `Edit ${server.name}` : "Add MCP server"}</h2>
        <p className="text-sm text-ink-soft">Applies to new sessions. Every MCP call goes through your permission rules.</p>
        {error && <div className="mt-2 text-sm font-semibold text-berry">{error}</div>}

        <label className={labelCls}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="github" spellCheck={false} />

        <label className={labelCls}>Type</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "stdio" | "http")}
          className={inputCls + " cursor-pointer"}
        >
          <option value="stdio">Command (stdio)</option>
          <option value="http">Remote URL (HTTP)</option>
        </select>

        {kind === "stdio" ? (
          <>
            <label className={labelCls}>Command</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className={inputCls}
              placeholder="npx -y @modelcontextprotocol/server-github"
              spellCheck={false}
            />
            <label className={labelCls}>Environment (KEY=value per line)</label>
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              className={inputCls}
              rows={3}
              spellCheck={false}
            />
          </>
        ) : (
          <>
            <label className={labelCls}>URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls}
              placeholder="https://example.com/mcp" spellCheck={false} />
          </>
        )}

        <label className="flex items-center gap-2 mt-4 cursor-pointer">
          <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
          <span className="text-sm font-bold">Expose tools directly</span>
          <span className="text-xs text-ink-soft">— each tool becomes first-class (costs context tokens per tool)</span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-xl border-2 border-line px-4 py-2 text-sm font-bold text-ink-soft hover:bg-paper-deep/40 cursor-pointer">
            Cancel
          </button>
          <button type="button" onClick={() => void save()}
            className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker hover:brightness-105 cursor-pointer">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
