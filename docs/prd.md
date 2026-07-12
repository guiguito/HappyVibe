# HappyVibe — Product Requirements

*The reference spec. Kept in sync with the Notion main PRD; decision history lives in git and the Notion "Feedbacks V1" page.*

## Vision

A desktop GUI (Electron, macOS first) that ships a **curated distribution of the [Pi coding agent](https://pi.dev)** — runtime + extensions embedded at a pinned version — built around two differentiators: **first-class permission UX** and **honest context-window visibility**. Open-source community project and portfolio piece, not a startup play: community appeal and polish-per-effort weigh heavily in trade-offs.

## Architecture (fixed)

- Pinned `@earendil-works/pi-coding-agent` (currently 0.80.3) driven over **RPC / NDJSON stdio**. Every pin bump gates on the contract-test suite (`docs/validation/d1.md` is the wire-shape record). `pi-subagents` is pinned and gated the same way.
- The **HappyVibe bridge extension owns all permission UI and enforcement** (Pi's own permission package is TUI-only). Permission prompts never auto-allow and never time out.
- Bridge ⇄ app messaging: JSON envelopes (`kind: "hv.*"`) over Pi's `extension_ui_request` wire — blocking kinds ride `select`/`input`, fire-and-forget kinds ride `notify`. Bridge slash-commands (`/hv-*`) ride the RPC prompt channel.
- **JSONL append-log** (frozen envelope `{ts, type, sessionId?, workspaceId?, data?}`) is the single store for audit + analytics. No SQLite (native-module ABI churn); documented ceiling: thousands of sessions per workspace.
- Secrets: Electron `safeStorage` for BYOK keys. Pi's `auth.json` is Pi-owned plaintext in an **app-owned agent dir** (the user's real `~/.pi` is never touched).
- Pi session files are **opaque blobs**; HappyVibe keeps its own minimal session index (id, title, workspace, timestamps, archived, session-file pointer).

## Sessions & workspaces

- Sidebar shows **all workspaces as a collapsible tree** with their sessions; title-only search over our index; archive = index flag.
- Session titles: model-generated after the first exchange (truncated-first-message fallback; inline rename wins permanently).
- **Parallel sessions with invisible auto-hibernation.** The active/inactive distinction is not the user's problem: no visible session limit. An internal live-process cap (~8) protects resources; when room is needed the **oldest idle** session (not mid-call, no pending permission, no subagent running) is hibernated — stats captured, process stopped, index marked — and **restored transparently** when reopened (Pi `--session` resume). Genuinely active sessions are never touched; the session the user is driving is never blocked.
- Crash isolation per session; PID tracking + orphan sweep at startup; spawns staggered (~1s) to avoid cold-start contention.

## Providers & models

- Settings → **LLM Setup**: configured-providers list + "add provider" page grouped as **Sign in with your plan** (Claude — with the honest "uses your plan's extra usage" caveat for Pro/Max — GitHub Copilot, ChatGPT/Codex; OAuth driven over RPC via `hv-login` bridge commands) · **Local** (Ollama, zero keys, auto-detected) · **Cloud API keys** (curated BYOK: DeepSeek, Anthropic, OpenAI, Google, OpenRouter; no custom-endpoint field).
- **Model hierarchy: session → workspace → global.** Global default in Settings; per-workspace override in workspace settings; per-session override from the chat bar. Agents may pin their own model (agent frontmatter). Model list comes live from Pi's registry (auth-configured providers only).

## Chat experience

- Streaming markdown transcript (O(1) per-token render path), steering while the agent runs (Enter = steer between tool calls; explicit queue-for-after; queue chips mirror Pi's real queue and survive Stop), provider errors and crashes as first-class transcript items with retry.
- Composer: **icon** Send/Stop; current-model chip with per-session dropdown (resolution session → workspace → global); a **"+" attach menu** (always visible) — image attach enabled when the model supports vision, disabled otherwise; extensible (file import later).
- **Tool calls never show raw technical calls by default.** Every card leads with a tool-kind icon + a human headline: the model-provided **`intent`** ("why I'm doing this") on registered tools — the `subagent` tool and all future registered tools carry a required `intent` parameter — and a **derived label** built from tool + args for Pi's built-in tools (whose schemas can't be extended). Raw name/args/result sit behind a details toggle. Edit/write cards render real diffs.
- File paths shown on tool/diff cards are **clickable**: open in the built-in editor, reveal in Finder, copy path.

## Subagents

- Built-ins shipped: **Code Explorer** (read-only), **Summarizer**, **agents-md-maker** (generates a draft AGENTS.md for review; never auto-writes). Users can edit prompts, **duplicate** (no create-from-scratch), and set per-agent model. Installed idempotently to the app-owned agent dir; user edits never clobbered.
- **Context isolation is the point of delegation**: only the call (agent + task + intent) and the final result may occupy the main agent's context. The child's working transcript is display-only.
- **The run lives outside the chat flow**: while a subagent works, a floating sticky card at the top of the chat shows agent name, intent, live status and elapsed time (stacking for concurrent runs); it fades on completion and the result lands in the flow. In-flow rendering is just the call line + result; the full child transcript stays available behind a toggle.
- Tools list UI: name, description, source, and the tool's current permission state (evaluated by the same rule engine — logic never forks).

## Permissions

- 3-layer rule engine inside the bridge: tool-level / project-path / command-pattern; allow-ask-deny; **most-restrictive wins** across **global rules + per-workspace overrides**. No match → safe defaults (read-only tools allowed, everything else asks).
- Global rules edit in Settings → Permissions; **workspace rules edit in that workspace's settings**. Live "test a call" preview uses the same engine.
- **Visible dangerous mode**: per-session, never persisted, permanent warning banner, one-click off; every bypassed call is flagged in the audit log.
- Every decision (rule, user, dangerous, safe-default) is audited to the event log; audit view filterable by session and workspace.
- Cross-session prompts: per-session queues, sidebar attention badges, dock badge; switching to a session surfaces its oldest pending prompt.

## Context visibility ⭐

- Per-session token gauge: measured (Pi's `contextUsage`) whenever available, clearly-labeled estimate otherwise, explicit "measuring…" state when Pi can't yet measure (e.g. right after compaction). **Never an unlabeled number.**
- Context panel opens on a **category summary** (system prompt, context files, conversation, tool calls, compaction summaries, subagent call+result — sizes and shares only); clicking a category drills into items.
- **Manual removal**: pairing-aware (a tool call and its result drop atomically), **completed turns only**, reversible; marks persist in the session file and survive compaction, reload and resume.
- Compaction: warn → suggest → confirm, never automatic; visible in-progress state; post-compaction the gauge shows "measuring…" until Pi re-measures.

## Settings

Order: **LLM Setup** → **System Prompt** → **Permissions (global)** → … → **Audit log** and **Dashboard** at the bottom (neither lives in the sidebar). Sections carry icons matching the sidebar style.

- **System Prompt**: the full resolved main-agent prompt shown read-only; users edit an **additions layer** (global `APPEND_SYSTEM.md`; applies to new/restarted sessions). Overridable per workspace.
- **Workspace settings** (small gear on each workspace row): model override, workspace permission rules, workspace system-prompt additions.

## Files & editor

- Right-side collapsible pane (closed by default): workspace file tree (fs access path-confined; node_modules/.git ignored).
- Center area is tabbed: the chat plus open files. Editor = CodeMirror 6, syntax highlighting for common languages, warm-workshop theme, editable with save, dirty indicator, external-change detection.

## AGENTS.md

- Follows the [agents.md standard](https://agents.md/): root `AGENTS.md` plus **nested `AGENTS.md` in subdirectories** — the nearest file for the subtree a tool touches is injected for that turn (bridge-side; Pi only discovers upward) and shown in the context panel.
- Plain-markdown editor in the app. When missing: offer to copy an existing `CLAUDE.md`, or generate a draft with the bundled **agents-md-maker** subagent (reviewed in the editor before saving).

## Analytics & onboarding

- **Local-only** dashboard (reached via Settings): sessions, tokens, estimated cost, durations, per-workspace/per-model breakdowns, permission activity — computed on-device from the JSONL log; nothing is ever sent anywhere.
- First-run onboarding: a dismissible checklist steering the first session toward the wow moments — the live agent trace and the context gauge. Shown once, re-openable from Help.

## Design language

"Warm workshop": cream paper + warm ink, tangerine primary, chunky borders with hard offset shadows, Gabarito + JetBrains Mono bundled locally (strict `self` CSP). Playful microcopy. Never default-template aesthetics.

## Scope fences

- **MCP: deferred** until after the current feedback round lands.
- **Windows: deferred** past V1 (signing cost + unvalidated assumptions). macOS first; Linux with distribution work.
- Telemetry: local-only, forever. Audit-log export: post-V1. No filename search (file access happens via the tree + clickable paths).

## Quality bar & release path

- Every keeper module has unit/contract tests; Pi and pi-subagents pin bumps gate on the contract suite; every new bridge wire shape is documented in `docs/validation/d1.md`.
- Release gate: no tagged release without green unit + E2E + scripted demo on a **packaged** build. Known open items: packaged subagent spawn needs a node-capable child runtime; mac signing/notarization; Linux packaging; CONTRIBUTING + architecture doc + demo GIFs before the loud launch (`v0.2`: context visibility + permission cards are the pitch).
