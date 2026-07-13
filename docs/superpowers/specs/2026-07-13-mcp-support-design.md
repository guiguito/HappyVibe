# MCP server support — design

Date: 2026-07-13
Status: approved direction (adapter + proxy-default); spec pending user review

## Decision

Use **pi-mcp-adapter** (vendored, exact-pinned like pi-subagents) rather than building a
native MCP client on `@modelcontextprotocol/sdk`.

Rationale:
- The adapter already embeds the official SDK (v1.25.x) and covers stdio, Streamable HTTP
  (+ SSE fallback), OAuth (incl. headless), sampling (approval-gated), form/URL elicitation,
  and resources. A native build re-implements all of this plus a Pi extension to register
  tools — ~4–6 weeks vs days, and a permanent MCP spec-churn tax (~2 revisions/year, ≥1
  breaking change each).
- The adapter registers everything via `pi.registerTool()`, so every MCP call flows through
  the bridge's existing `tool_call` permission gate (`happyvibe-bridge.ts:250-309`) with no
  adapter changes. Our core differentiator (permission UX) is preserved for free.
- Mature enough to depend on: 984 stars, ~124K downloads/mo, v2.11.0 (2026-07-03), real
  test suite, MIT, ~3k lines (forkable if abandoned).
- Known gaps accepted for v1: no roots, no MCP prompts, no live `tools/list_changed`
  (metadata refreshes on connect).

## Tool-registration mode (philosophy decision)

**Proxy mode by default, unwrapped in our UI, per-server `directTools` toggle.**

- *Transparency / context visibility*: proxy = one ~200-token `mcp` tool with on-demand
  discovery, vs 150–300 tokens per tool silently burned in every context with direct mode.
  The proxy's opacity is solved in OUR rendering layer: tool cards and permission prompts
  always unwrap `params.server` / `params.tool` and display "GitHub MCP → create_issue",
  never a bare "mcp".
- *Clear and easy*: proxy is zero-config — add a server, it works.
- *Control*: per-server "expose as direct tools" advanced toggle (adapter's `directTools`
  option); rules engine special-cases proxy calls so per-MCP-tool allow/deny works in proxy
  mode too — granular control must not require paying the token tax.

## Architecture

1. **Vendoring**: add `pi-mcp-adapter` (exact pin) to `pi-runtime/package.json`; add one
   `-e` flag in `src/main/pi/spawn.ts` pointing at its extension entry. Contract tests gate
   pin bumps, same as pi/pi-subagents.
2. **Config**: adapter reads standard `mcpServers` JSON. Agents & Tools page writes:
   - global tier → agent-dir `mcp.json`
   - workspace tier → project `.mcp.json` (community-shareable; adapter also imports
     Cursor/Claude Code/etc. configs)
   This matches the existing session→workspace→global settings hierarchy (no session tier
   for v1).
3. **Permission layer**: bridge rules evaluation special-cases tool `mcp` — extract
   `params.server`/`params.tool` so rules can target individual MCP tools; discovery calls
   (`search`/`describe`/`connect`) are read-only and safe-defaulted. Direct-mode tools are
   ordinary named registered tools (no `intent` param possible — schemas come from the MCP
   server — so they get derived labels like built-ins).
4. **UI (Agents & Tools page)**: new MCP Servers section — add/edit/remove servers
   (stdio command/env or HTTP URL/auth), enable/disable, per-server directTools toggle,
   connection status. Tool cards + permission prompts render unwrapped server/tool names.

## Risks / spike first

- **RPC-mode behavior** (S-spike, documented in `docs/validation/`): the adapter's `/mcp`
  setup panel and elicitation/sampling dialogs are TUI-oriented (`ctx.hasUI` guards).
  Verify under `--mode rpc`: tool calls hit our gate; what elicitation/sampling do when
  `hasUI` is false. Fallback plan: route elicitation/sampling approval through our own
  `hv.*` envelope UI.
- **Per-session server processes**: each Pi session spawns its own MCP servers (N sessions
  × M servers). Acceptable for v1 given lazy lifecycle + 10-min idle disconnect; revisit if
  it bites.
- **Version skew**: adapter dev-deps `pi-coding-agent ^0.79.1`, we pin 0.80.3 — compatible
  today; contract tests are the gate.

## Build order

1. Validation spike (vendored adapter under RPC; permission-gate + hasUI findings →
   `docs/validation/`)
2. Config plumbing (write/read `mcp.json` global + workspace, IPC handlers)
3. Agents & Tools page MCP section
4. Permission unwrapping (rules special-case + prompt/tool-card rendering)
5. (If spike demands) hv-envelope elicitation/sampling approval UI
