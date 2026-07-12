# HappyVibe — Product Requirements (V1 decision log)

Source of truth for product discussion lives in Notion (main PRD + [V1 implementation plan]); this file mirrors every **locked decision** so requirements live next to the code. Keep both in sync when a decision lands.

## What HappyVibe is

A desktop GUI (Electron, macOS first) that ships a **curated distribution of the [Pi coding agent](https://pi.dev)** — Pi runtime + extensions embedded at a pinned version — with first-class permission UX and context-window visibility. Open-source community project, not a startup play.

## Locked decisions

### Architecture (spike-validated, see docs/validation/)
- Pinned `@earendil-works/pi-coding-agent@0.80.3`; RPC mode over NDJSON stdio; every Pi pin bump gates on the contract-test suite.
- The **HappyVibe bridge extension owns all permission UI/enforcement** (pi-permission-system is TUI-only — v6 finding). Prompts never auto-allow, never time out.
- JSONL append-log (frozen envelope `{ts, type, sessionId?, workspaceId?, data?}`) serves audit + analytics; no SQLite (native-module ABI churn); documented ceiling: thousands of sessions/workspace.
- Secrets: Electron `safeStorage` for BYOK keys; Pi's `auth.json` is Pi-owned plaintext (documented honestly).
- Session parallelism: N Pi processes, **cap 4 default / 8 hard**, staggered/lazy spawn (S0.1). Pi session files are opaque blobs; we keep our own minimal index.

### Sessions & workspaces (B1 — locked 2026-07-05)
- Sidebar shows **all workspaces as a collapsible tree**, each with its sessions.
- Session search: **titles only** in V1 (our index; no transcript grep).
- Session titles: **model-generated** after the first exchange (cheap call on the user's provider), fallback = truncated first message; inline rename.
- Session list / resume / archive; archive = flag in our index.

### Providers (B3 — locked 2026-07-05)
- Onboarding ladder: **Sign in with Claude / GitHub Copilot / ChatGPT** (OAuth over RPC via `hv-login` bridge commands — S0.2; honest "extra usage" billing caveat for Claude Pro/Max) → **Ollama** (local, zero keys) → **BYOK keys**.
- BYOK list is **curated**: DeepSeek, Anthropic, OpenAI, Google, OpenRouter. No custom-endpoint field in V1.
- Model hierarchy: global → workspace → (agent tier lands in B6).

### Permissions (B4)
- 3-layer rule engine in the bridge: tool-level / project-path / command-pattern; allow-ask-deny; most-restrictive-wins.
- Visible dangerous mode (permanent warning, one-click off). Audit log: session AND workspace views.
- Cross-session prompts: per-session queues + attention badging.

### Context visibility (B5 — the differentiator)
- Token count/%/color; measured vs estimated always labeled.
- Breakdown from `get_entries`; manual removal is pairing-aware (never orphan a toolCall/toolResult) and **only from completed turns** (S0.3: stripping the in-flight pair causes runaway re-execution).
- Compaction UX (warn → suggest → confirm) + built-in Summarizer agent.

### Agents & tools (B6)
- Two built-ins: Code Explorer + Summarizer. Edit + duplicate; create-from-scratch/import = post-V1. Via `pi-subagents` (RPC-validated, S0.3); spawn env must set `PI_SUBAGENT_PI_BINARY` to the bundled pi.

### Scope fences (V1)
- MCP: **deferred past the V1 feedback round** (amended 2026-07-12; the original "in V1" line contradicted the approved implementation plan). Windows: deferred past V1 launch. Telemetry: local-only dashboard, never remote. File access: open-in-editor / reveal / copy path — no filename search. AGENTS.md: plain markdown editor. Export of audit log: post-V1.

### V1 feedback round (locked 2026-07-12 — full spec in Notion "Feedbacks V1")
Wave 1: **Tools UX** (hybrid `intent` param on every tool + derived fallback label; icon + intent shown, technical call behind a toggle) · **Subagents** (verify-then-fix context isolation — only call + result in main context; floating sticky run-card UX with intent/status, result injected on completion) · **Sessions** (kill the visible 4-cap → invisible auto-hibernation: idle sessions auto-save/stop oldest-first, transparent restore, active sessions never touched, internal cap ~8–12) · **Settings reorg** (LLM Setup grouped sign-in/local/cloud; System Prompt section = full prompt read-only + editable additions layer via APPEND_SYSTEM.md, per-workspace overridable; global-only permissions in Settings; per-workspace settings card on workspace rows: model/permissions/system-prompt overrides — closes the workspace-tier model gap; Audit+Dashboard out of sidebar, bottom of Settings; section icons).
Wave 2: chat-bar polish (icon send/stop, per-session model dropdown workspace→global, "+" attach w/ vision-gated image) · right-pane file tree + center-tab editor with syntax highlighting (editable) · AGENTS.md standard (nested files per agents.md spec, CLAUDE.md copy offer, bundled agents-md-maker subagent) · context panel opens on category summary, drill-in to edit.
Deferred: MCP.

### Release path
`v0.0.x` (CI artifacts, quiet) → `v0.1` (B0–B2 + one zero-friction provider, friendly testers) → `v0.2` (B4+B5, signed mac build — **the loud launch**) → V1 (B6–B8).

## Pointers
- Notion: main PRD `391d33dfffca80a0a383e50792d51c0a` · spike PRD `391d33dfffca81afa86adf1e82360f64` · V1 plan `392d33dfffca8007a5badcbdcf9e79f5`
- Validation evidence: `docs/validation/` (RESULTS, d1 wire contracts, v6, s0.1–s0.3)
