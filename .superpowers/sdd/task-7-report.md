# Task 7 Report — IPC + preload for authenticate / logout

## Handler bodies

### `hv:mcp-authenticate` (src/main/ipc.ts)

Guarded cfg resolution: global → `path.join(agentDir(), "mcp.json")`; workspace →
`workspaceMcpFile(workspaceId ?? "")` which validates against `workspaces.list()` and throws
`"Unknown workspace"` on unregistered paths — same guard as `checkServer` and `hv:mcp-check`.

```ts
ipcMain.handle(
  "hv:mcp-authenticate",
  async (_e, scope: "global" | "workspace", workspaceId: string | null, name: string) => {
    const file =
      scope === "global"
        ? path.join(agentDir(), "mcp.json")
        : workspaceMcpFile(workspaceId ?? "");
    const cfg = readMcpFile(file).mcpServers[name];
    if (!cfg) return { ok: false, error: "server not found" };

    const result = await authenticate(name, cfg, agentDir(), {
      openExternal: (url) => shell.openExternal(url),
    });

    mcpStatusMap.set(statusKey(scope, workspaceId, name), {
      name, scope, workspaceId,
      state: result.ok ? "connected" : "needs-auth",
      toolCount: result.ok ? result.tools.length : 0,
      tools: result.ok ? result.tools : undefined,
      error: result.ok ? undefined : result.error,
      lastChecked: Date.now(),
    });
    mcpStatusChanged();
    return result;
  },
);
```

### `hv:mcp-logout` (src/main/ipc.ts)

Utility-client send mirrors the `hv:auth-login` pattern: `ensureUtility()` then fire-and-forget
`c.send({ type: "prompt", ... }).catch(() => {})` wrapped in try/catch (non-fatal). Iterates
`mcpStatusMap` to update every entry with that server name (covers global + all workspaces).

```ts
ipcMain.handle("hv:mcp-logout", async (_e, name: string) => {
  logout(name, agentDir());
  try {
    const c = await ensureUtility();
    void c.send({ type: "prompt", message: `/mcp logout ${name}` }).catch(() => {});
  } catch { /* non-fatal */ }
  for (const [key, entry] of mcpStatusMap) {
    if (entry.name === name) {
      mcpStatusMap.set(key, {
        ...entry, state: "needs-auth", toolCount: 0,
        tools: undefined, error: undefined, lastChecked: Date.now(),
      });
    }
  }
  mcpStatusChanged();
});
```

## shell.openExternal reuse

`shell` is already destructured at line 1:
`import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";`
Authenticate handler passes `(url) => shell.openExternal(url)` — identical to `hv:open-external`.

## Preload additions (src/preload/index.ts)

```ts
mcpAuthenticate: (scope: "global" | "workspace", workspaceId: string | null, name: string) =>
  ipcRenderer.invoke("hv:mcp-authenticate", scope, workspaceId, name),
mcpLogout: (name: string) => ipcRenderer.invoke("hv:mcp-logout", name),
```

## hv.d.ts additions (src/renderer/src/hv.d.ts)

```ts
mcpAuthenticate(
  scope: "global" | "workspace",
  workspaceId: string | null,
  name: string,
): Promise<{ ok: true; tools: { name: string; description?: string }[] } | { ok: false; error: string }>;
mcpLogout(name: string): Promise<void>;
```

## Typecheck outputs

```
npx tsc --noEmit -p tsconfig.node.json  →  exit 0 (clean)
npx tsc --noEmit -p tsconfig.web.json   →  exit 0 (clean)
```

## Regression-test result

```
npx vitest run tests/mcp-oauth.test.ts tests/mcp-authstore.test.ts tests/mcp-status.test.ts

Test Files  3 passed (3)
      Tests  15 passed (15)
   Duration  724ms
```

All 15 pass, no regressions.
