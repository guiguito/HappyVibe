---
paths:
  - "src/main/plugins/**"
  - "tools/plugin-catalog/*.ts"
  - "src/renderer/src/components/Plugins*.tsx"
  - "tests/{plugin,mcp-plugin}*.test.ts"
---
# Plugin store (§25)

- The store is GENERATED (`npm run catalog:plugins` → `src/main/plugins/catalog.generated.ts`) and
  only plugins that pass are listed. Re-run it after ANY change to `plugins/classify.ts` or
  `plugins/scan.ts`. The generator reuses the app's own `scanPluginDir` on purpose — a second
  classifier would drift and show up as a refusal in front of the user.
- Read the generator's run summary: the reject-reason histogram is where bugs surface, and a benign
  new manifest key appears as `declares "x", which HappyVibe does not recognise`.
  `tests/plugin-catalog.test.ts` guards the committed data but cannot re-verify a plugin.
- A plugin's `.mcp.json` comes in two shapes: wrapped `{mcpServers:{…}}` and bare `name → config`
  (github, linear, context7, playwright, asana, firebase, gitlab, terraform). Read it with
  `readPluginMcpServers` (scan.ts), never `readMcpFile` — that one parses OUR config and is right to
  require the wrapper. Unit fixtures only used the wrapped shape; run over the real marketplace.
- **"Signs in and lists tools on the MCP page, but unusable in a session"** = the adapter skipped
  OAuth because of a non-auth header. Its `supportsOAuth` returns false when a remote server has ANY
  custom header (right for `Authorization`, wrong for a telemetry tag). `normalizePluginMcpServer`
  (mcpImport.ts) sets `auth:"oauth"` when no header looks credential-shaped. Main does OAuth
  explicitly while the adapter auto-detects, which is why the page looks healthy.
  `tests/mcp-plugin-import-auth.test.ts` pins the upstream heuristic — delete the workaround when the
  adapter learns to tell headers apart. Debug by running the vendored `supportsOAuth` on the real
  `mcp.json`.
