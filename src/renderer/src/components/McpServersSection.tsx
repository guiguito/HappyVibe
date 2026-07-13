import { useEffect, useState } from "react";

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

/**
 * MCP servers CRUD (Agents & Tools page). Writes standard mcpServers JSON
 * vendored pi-mcp-adapter reads: global → app agent dir mcp.json,
 * workspace → <workspace>/.mcp.json (shareable with other MCP hosts).
 * Config read at session start — changes apply to NEW sessions.
 */
export function McpServersSection({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    const r = await window.hv.mcpGet(workspaceId ?? undefined);
    setServers([...flatten(r.global, "global"), ...flatten(r.workspace, "workspace")]);
  };
  useEffect(() => { void refresh().catch((e) => setError(String(e))); }, [workspaceId]);

  const remove = async (s: McpServer): Promise<void> => {
    await window.hv.mcpSetServer(s.scope, s.scope === "workspace" ? workspaceId : null, s.name, null);
    await refresh();
  };

  return (
    <div className="mt-10">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-bold text-lg">MCP servers</h2>
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
          {servers.map((s) => (
            <div
              key={`${s.scope}:${s.name}`}
              className="px-4 py-2.5 border-b border-line last:border-b-0 flex items-center gap-2"
            >
              <span className="font-bold shrink-0">{s.name}</span>
              <span className="text-[10px] font-bold tracking-wider rounded-full px-2 py-0.5 bg-paper-deep text-ink-soft border border-line shrink-0">
                {s.scope}
              </span>
              <span className="font-mono text-xs text-ink-soft flex-1 min-w-0 truncate">
                {typeof s.cfg.url === "string"
                  ? s.cfg.url
                  : [s.cfg.command, ...((s.cfg.args as string[]) ?? [])].filter(Boolean).join(" ")}
              </span>
              {s.cfg.directTools ? (
                <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 bg-honey-soft text-tangerine-deep border-honey/60 shrink-0">
                  direct
                </span>
              ) : null}
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
          ))}
        </div>
      )}
      {editing && (
        <McpServerEditor
          server={editing === "new" ? null : editing}
          workspaceId={workspaceId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      )}
    </div>
  );
}

function McpServerEditor({
  server, workspaceId, onClose, onSaved,
}: {
  server: McpServer | null;
  workspaceId: string | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const cfg = server?.cfg ?? {};
  const [name, setName] = useState(server?.name ?? "");
  const [scope, setScope] = useState<"global" | "workspace">(server?.scope ?? "global");
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
      onSaved();
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

        <label className={labelCls}>Scope</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "global" | "workspace")}
          className={inputCls + " cursor-pointer"}
        >
          <option value="global">Global (all workspaces)</option>
          <option value="workspace" disabled={!workspaceId}>Workspace (.mcp.json shareable)</option>
        </select>

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
