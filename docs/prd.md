# HappyVibe PRD — Direction v1

*Mirror of the Notion main PRD (source of truth for product discussion). Decisions are folded in place using the document's "Decision (…)" convention.*

## 1. Product Positioning

**HappyVibe is a local-first desktop app for beginner-friendly vibe coding — macOS first, with Windows and Linux support wherever possible.**

Its promise:

> **HappyVibe = vibe coding that allows you to actually understand what you and the agent are doing.**

The wedge audience (V1 target) is:

> **AI-curious tinkerers — junior developers, technical-adjacent people (PMs, designers, data analysts), and self-taught builders who want to *understand* what the agent is doing, not just get results.**

The original persona — *an AI-curious person who is scared to vibe code* — remains the aspirational north star. But true beginners mostly want results, not understanding; the people who crave seeing the context window are one notch above. Product decisions target the tinkerer wedge first, while the UX must stay simple enough that the scared beginner can grow into it. Think: **a GUI-native Pi — radically simple surface, deep personalization underneath** (prompts, agents, permissions, models).

HappyVibe should feel like a **friendly learning tool for vibe coding**, but one that can become a serious coding tool when used carefully.

The product should be accessible to beginners, while still giving experienced developers deep customization options:
- system prompt editing;
- agent prompt editing;
- tool visibility;
- permission configuration;
- model/provider control;
- context inspection;
- eventually skills and custom agents.

The tone should be **playful**, because working with AI should feel fun, but the product must remain trustworthy enough for real coding work.

## 2. Core Product Promise

Most agentic coding tools are powerful but opaque. Users often do not understand:
- what the agent is doing;
- what tools it is calling;
- what permissions it has;
- what context it sees;
- why it edits a file;
- what sub-agents are doing;
- how much they are spending in tokens.

HappyVibe turns agentic coding into a visible, understandable, and editable workflow.

The user should not feel like a mysterious terminal agent is running "Chinese bash commands in the background." Instead, they should see a clean, readable, human-friendly representation of the agent's work.

## 3. Technical Foundation

HappyVibe is a **tightly coupled wrapper above Pi Agent**.

**Decision (Round 2):** HappyVibe ships as a **curated Pi distribution**: the Pi runtime and all required extensions are embedded with the app at a pinned, tested version. HappyVibe does not depend on a user-installed Pi, because the UI can only guarantee support for the exact Pi version it embeds.

**Decision (2026-07-16):** the packaged app is **fully standalone** — it must run on a machine with no developer tooling installed (no Node, no npm, no Pi). Everything the runtime needs ships inside the bundle; child processes (Pi, sub-agents) run through the bundled Electron helper as Node (`pi-runtime/bin/pi-node.sh`). The only accepted exception: MCP stdio servers the *user* configures with `node`/`npx` commands require those on their machine — that is user config, not part of the distribution.

Pi Agent is the underlying coding-agent harness. HappyVibe should not attempt to become a generic multi-runtime product in V1.

However, because Pi appears intentionally minimal, the V1 architecture should probably include:
1. **Pi Agent core**
2. **A HappyVibe runtime layer**
3. **A curated set of Pi extensions/packages**
4. **A visual UI layer**
5. **Local persistence for workspaces, sessions, permissions, settings, and audit logs**

Pi's philosophy is extensibility rather than built-in product completeness. This means HappyVibe's V1 value is not only the interface. It is also the **curated agentic setup** that makes Pi feel usable to beginners out of the box.

## 4. Platform

V1 is:
- local-only;
- desktop-only (macOS first; Windows and Linux builds where possible);
- desktop-first;
- no account system;
- no cloud workspace;
- BYOK only.

Possible implementation frameworks: Electron; Tauri; React Native Desktop if the tech lead prefers; final choice left to technical leadership, but the framework must support cross-platform builds (macOS, Windows, Linux). The PRD should not over-specify the framework for now.

## 5. Workspace Model

In HappyVibe, a **workspace is a local project folder on disk**. The user can have multiple workspaces. Each workspace can contain multiple coding sessions, including sessions running in parallel.

A workspace contains: local path; session history; active sessions; archived sessions; permission configuration; AGENTS.md files; model overrides; agent configuration; tool permissions; audit logs; context state/history.

Workspaces are added manually. No automatic GitHub import in V1. GitHub support is out of scope for V1.

## 6. V1 Scope

### Must be in V1

HappyVibe V1 should include:
- local desktop app;
- manual workspace/project folder selection;
- chat-first coding interface;
- Pi Agent integration;
- model provider setup using providers supported by Pi Agent;
- BYOK setup;
- global default model;
- project-level model override;
- agent-level model override;
- readable agent activity display;
- readable tool call display;
- tool request/status/progress/result display;
- expandable technical details where useful;
- expandable diffs for file edits;
- context usage indicator;
- exact token counts;
- context usage percentage;
- color-coded context warning;
- context breakdown;
- manual context editing/removal;
- compaction suggestion;
- user confirmation before summarization/compaction;
- permissions UI;
- visible dangerous mode toggle;
- permanent warning when dangerous mode is enabled;
- one-click way to disable dangerous mode;
- audit log of agent actions;
- default Code Explorer Agent;
- agent list visible to the user;
- tool list visible to the user;
- agent list and tool list shared with the model so it can call them when appropriate;
- automatic or user-triggered sub-agent calls;
- user ability to manually call the Code Explorer Agent;
- editable sub-agent system prompt;
- separate sub-agent context window;
- AGENTS.md reading;
- AGENTS.md editing;
- proposal to create AGENTS.md if missing;
- explanation of instruction priority/order if multiple instruction files exist;
- session search;
- archived session restore;
- local-only session history;
- embedded, pinned Pi runtime with curated extensions;
- AskUserQuestion tool — the agent can surface a decision to the user in an interactive picker (1–4 questions, options with descriptions and optional previews, automatic free-text "Other");
- a collapsible workspace file explorer with a built-in tabbed code editor (syntax highlighting, edit and save);
- invisible session auto-hibernation — no visible session limit; idle sessions save and restore transparently;
- session deletion (confirmed, permanent);
- nested AGENTS.md files per subdirectory (following the [agents.md](https://agents.md/) standard);
- Summarizer Agent for context compaction;
- agent editing and duplication (built-in agents);
- session-level and workspace-level audit log;
- open a changed file from a diff in the built-in editor (reveal in Finder and copy path also available);
- open the workspace folder in Finder / the OS file manager;
- copy file paths;
- local-only analytics dashboard;
- a read-only **Plan Mode** — the agent explores and drafts an implementation plan (saved as a workspace file) without being able to modify anything, and the user approves implementation with one click (see §23);
- macOS build (Windows and Linux where possible);
- open-source distribution first.

### Explicitly not in V1

The following should be shown as "coming soon" or omitted from V1:
- skills support / import / creation;
- custom agent creation from scratch and agent config import (editing/duplicating built-in agents **is** in V1);
- CLI tool import; API tool import;
- GitHub support;
- cloud accounts; integrated billing; paid plan; team collaboration; marketplace;
- file name search from the chat UI;
- MCP support (deferred by the post-V1 feedback rounds — will ship via a bundled Pi extension once the current feature set is polished);
- audit log export (JSON/Markdown);
- opt-in remote telemetry.

## 7. Chat Experience

The product is chat-first. The user sees: their own messages; agent messages; high-level agent work state; readable tool requests; tool status/progress/results; expandable diffs; sub-agent activity; final answers.

The user should **not** see raw chain-of-thought. They should see high-level working state — e.g. "Inspecting the project structure", "Reading authentication-related files", "Preparing an edit", "Running tests", "Asking Code Explorer to investigate the routing layer", "Summarizing previous context before continuing".

Tool calls should be represented in readable product language:

```
Tool: Read file
Purpose: Inspect the authentication middleware
Status: Completed
Result: Found the middleware in src/server/auth.ts
```

Expandable details may show raw command, path, output, or diff when useful.

**Decision (Feedback round 1):** tool cards lead with a tool-kind icon and a human headline, never the raw call. Registered tools (sub-agent calls, AskUserQuestion, and every future registered tool) carry a required `intent` parameter — a customer-facing sentence saying what the model is doing and why. Pi's built-in tools cannot take extra parameters (their schemas are fixed), so their headlines are derived from the tool and its arguments — including parsed shell explanations ("Installing dependencies (npm install)", "Running tests (vitest)") with destructive commands flagged. The raw technical call always remains available behind a details toggle.

**Decision (Feedback round 2):** the chat bar uses icon Send/Stop buttons; a model chip shows the session's current model with its tier source ("workspace default", "session override") and a dropdown to override per session; the model list refreshes live when providers change; a "+" attach menu offers image attachment when the model supports vision (disabled otherwise, extensible later). Sending while the agent runs steers — the message is delivered between tool calls; queued messages appear as chips. There is no separate queue button, and queued chips cannot be individually removed yet: Pi's RPC surface has no dequeue command (an upstream feature request is filed).

**Decision (Feedback round 2) — AskUserQuestion:** the model can ask the user questions through a dedicated tool: 1–4 questions per call, each with a short header chip, single or multi select, and 2–4 options (label, description, optional monospace preview shown side-by-side). The UI always adds a free-text "Other" option; the recommended option comes first, labeled "(Recommended)". The picker blocks the agent until answered and never times out; questions from background sessions badge the sidebar like permission prompts, and the answer is echoed into the transcript.

**Decision (Feedback round 3, 2026-07-14):** several chat-readability refinements. (1) **Large-paste guard** — pasting more than 100k characters into the composer prompts a confirm before inserting. (2) **Long-message collapse** — a user message longer than ~10 "pages" renders collapsed with a "Show more" toggle. (3) **In-conversation search** — a message-text search with an icon and a keyboard shortcut (distinct from session-title search in §17 and the post-V1 file-name search in §21). (4) **Per-message copy** — a copy button at the bottom-right of every user question and every assistant answer. (5) **Code-block copy** — fenced code blocks in answers carry a copy-content button. (6) **Intent readability** — the tool-card intent headline may wrap (no longer clipped to one truncated line) so a long customer-facing sentence stays legible. (7) **Rewind a user message** — see §9.

**Decision (Feedback round 4, 2026-07-15):** two chat refinements. (1) **Search highlights, it does not filter** — the in-conversation search keeps every message visible and **highlights** matching substrings, with **next / previous** navigation (Enter / Shift-Enter and on-screen arrows, wrapping) and an `n / total` match counter; the active match scrolls into view. This supersedes the round-3 phrasing where search filtered non-matching messages out. (2) **Icon buttons** — the per-message copy, code-block copy, and rewind controls are **icon** buttons with tooltips (not text labels), for a quieter chat surface. (3) **Links open in the OS browser** — clicking a link in a chat answer opens it in the user's default browser via the system, never inside the app window (which would navigate the SPA away).

**Decision (Feedback round 5, 2026-07-16) — chat-surface restructure:** (1) **Split view** — the center area supports one 2-way split, horizontal or vertical; each pane has its own tab strip and tabs (the chat included) can be dragged between panes. (2) The in-conversation **search icon and the context bubble move into the tab-strip row**, next to the files icon; the chat header (the AGENTS.md chip and the whole section above the chat) is removed. (3) The composer "+" menu gains an **MCP submenu** — connected servers with status (read-only) plus a "Manage…" shortcut to the MCP, Tools & Agents page (§13). (4) **Intent wrapping** extends to the delegation call line — it wraps rather than truncating with an ellipsis.

**Decision (Feedback round 5.1, 2026-07-17) — chat-UI corrections (after GUI testing):** (1) The **search icon and context bubble leave the tab strip** for a small **right-aligned bar inside the chat pane** (a thin in-flow row at the top of the chat content — NOT a floating overlay, which could bleed over an adjacent split pane); the code editor's own ⌘F search is styled to the warm-workshop look. (2) The **code editor gains ⌘F search** (CodeMirror's built-in find/next/prev/highlight), the same keyboard trigger as chat search; editor focus routes ⌘F to the editor, chat focus to the chat. (3) The **split-view buttons (vertical/horizontal), unsplit, and the file-panel toggle live in a persistent toolbar pinned to the top-right of the center area** at the same height as the tab bar — always visible regardless of split; the tab strips become tabs-only. (4) The **file panel is a right-side overlay drawer** (top aligned below the tab bar) that overlays the content instead of a grid column, so it no longer shrinks the split panes (refines §21).

**Decision (Feedback round 6, 2026-07-18) — composer, mentions, shortcuts, sidebar (after GUI testing):** (1) **Multiline composer** — the chat input becomes an auto-growing textarea: **Enter sends, Shift+Enter inserts a newline** (the old single-line input had no way to enter a newline). (2) **`@file` references with autocomplete** — typing `@` opens a dropdown of workspace files AND directories (recursive, respecting the existing ignore filter — node_modules/.git/dotfiles) whose name contains the typed text; Tab picks the first, Arrow keys + Enter or the mouse pick, and the token completes to `@<basename>` (full relative path shown as a disambiguating subtitle, and used as the label when two basenames collide). On send, each reference's content is appended to the prompt as hidden `<file path="…">…</file>` blocks the model sees; a **directory** injects all its text files recursively **capped at ~200k chars total** — over the cap it warns the user and injects a recursive **file listing** instead. Binaries (NUL-sniffed) and ignored dirs are skipped. The transcript renders `@toto.md` as a **highlighted chip**, never the injected content (stripped at render time so live sends, queued steers, and reopened sessions all read the same). (3) **Keyboard shortcuts + help dialog** — a standard set (⌘N new session · ⌘W close tab · ⌘S save · ⌘F search chat/editor · ⌘B toggle left panel · ⌘⇧E toggle file drawer · ⌘, settings · ⌘/ shortcuts dialog · Esc closes dialogs) driven by a single shortcut registry, surfaced in a new **"Keyboard shortcuts" dialog** (⌘/ or the Help footer). (4) **Collapsible left panel** — the sidebar collapses to a slim ~48px **icon rail** (workspace initials; MCP/Settings/Help icons at the bottom); a chevron or ⌘B toggles it and the collapsed state is persisted.

## 8. File Edits and Diffs

When the agent edits files, the UI should show: which file changed; a short summary of the change; status; an expandable diff; whether the edit succeeded or failed. This is important because HappyVibe's educational value depends on users understanding what the agent changed.

## 9. Context Management

Context visibility is one of HappyVibe's core differentiators. The app should show: exact token count; percentage of context used; color-coded context state (green healthy / orange heavy / red needs attention); context composition; beginner-friendly explanation; technical details for advanced users.

When context gets high, HappyVibe should: warn visually → suggest compaction → ask the user before summarizing → let the user manually remove context items.

**Decision (Round 2):** Compaction is performed by a **dedicated Summarizer Agent**, not by ad-hoc prompting of the main session.

**Decision (Round 2):** Users can remove **everything except mandatory system/runtime context** — previous chat messages, loaded files, tool results, and sub-agent outputs are all individually removable.

Context breakdown should include, where possible: system prompt; AGENTS.md; current conversation; loaded files; tool definitions; available agents; sub-agent outputs; active task state; prior summaries. This feature is a core learning mechanism: users learn how agents work by seeing what the agent actually sees.

**Decision (Feedback round 2):** the context panel opens on a **summary of the categories** (name, item count, size, share of the window) and the user clicks a category to drill into its items — the full detail was too visually complex as a landing view.

**Decisions (Feedback round 1, implementation-verified):** the token gauge is always labeled — **measured** when Pi reports live context usage, **estimated** when derived, and an explicit "measuring…" state right after compaction (Pi cannot measure until the next response; showing cumulative totals there was misleading). Manual removal is pairing-aware (a tool call and its result are removed atomically — orphaning one causes provider errors) and only items from **completed turns** can be removed (removing the in-flight turn's items sends the model into a re-execution loop). Removal marks persist in the session file and survive compaction, reload, and resume.

**Decision (Feedback round 3, 2026-07-14) — rewind:** a user question carries a **rewind** (refresh) affordance. Rewinding shows a confirm dialog stating **files on disk are NOT rolled back**, then removes every message after that point from the transcript and from Pi's context, and returns that message to the composer for edit + resend. It builds on the existing completed-turn context-removal mechanism (above); the in-flight turn is never rewound (the session must be idle). **V1 scope is chat-only** — reverting file/shell side-effects is explicitly deferred to **V2**.

**Decision (Feedback round 4, 2026-07-15) — complete, itemized breakdown:** the context panel must make every consumer of the window individually visible, not lumped into one "system prompt" figure. It enumerates, each with its size: the **base system prompt**, **custom instructions** (root + nested AGENTS.md and the user's system-prompt additions), **tool definitions** (count and, where derivable, their token weight), context files, conversation, tool results, and prior summaries. Anything Pi does not expose a measurement for is **labeled "not measured"** rather than silently omitted — the panel's job is an honest, teachable account of what the agent sees.

**Decision (Feedback round 5, 2026-07-16) — context UX overhaul:** the chat chip becomes a small clickable **% bubble** — green <35%, orange 35–80%, red >80% (supersedes the earlier 70/90 thresholds) — that opens the context panel. The panel gains a **visual composition surface** (color-coded proportional segments, inspired by Claude Code's `/context` view); **tool definitions become a drill-in** listing every tool with an *estimated* token size and a total (estimates from schemas, labeled "estimated" per the honesty rule); the **"Other" category is eliminated** by categorizing items properly bridge-side — it appears only when genuinely needed, clearly labeled, and is hidden when empty. **Compaction is Pi-native:** the implementation always used Pi's `compact` RPC — this supersedes the Round-2 "dedicated Summarizer Agent" decision (the agent was never wired to compaction and is removed, §12) — and a manual **"Compact now"** is always visible in the context panel, not only in the red zone.

## 10. Permissions

Permissions are central to the product. The app supports a layered permission model:
- **Layer 1 — Tool permission** (e.g. allow file reading in this workspace);
- **Layer 2 — Project permission** (e.g. allow file editing only inside this workspace folder);
- **Layer 3 — Command pattern permission** (e.g. always allow `npm test`, ask before `rm`, deny dangerous shell commands).

**Decision (Round 2):** HappyVibe is a **wrapper over Pi's permission capabilities**: enforcement delegated to Pi's extension ecosystem, HappyVibe providing the UI. **Superseded by the feasibility spike (V6) and shipped accordingly:** the candidate permission extension turned out to be TUI-only in RPC mode, so the **HappyVibe bridge extension owns the 3-layer rule engine itself** (tool / project-path / command-pattern; allow-ask-deny; most-restrictive-wins). Rules exist at two scopes — a **global ruleset plus per-workspace overrides** — with global rules edited in Settings and workspace rules edited in each workspace's own settings, and a live "test a call" preview using the same engine.

Dangerous mode should be visible, not hidden. When enabled: it must remain visibly active; the UI should warn the user; there should be an obvious way to disable it; it does not need to expire automatically. HappyVibe maintains an audit log of agent actions.

**Decision (Feedback round 3, 2026-07-14) — workspace-scoped grant:** the permission prompt offers five choices — **Allow · Allow for session · Allow for Workspace · Always allow · Deny**. "Allow for session" stays ephemeral (in-memory, reset on respawn); "Allow for Workspace" persists an allow rule at the workspace scope and "Always allow" at the global scope, both written through the same rule engine as Settings (so they show up as editable rules). V1 persists these at the **tool layer** (allow this tool in this workspace / everywhere); command-pattern granularity for one-click grants can follow.

**Decision (Feedback round 3, 2026-07-14) — persistent full bypass (reverses the "never auto-allow" invariant):** in addition to the session-only dangerous mode, a persistent **"Bypass ALL permissions"** toggle is available in **global and workspace settings**. This deliberately **supersedes the earlier invariant that permission prompts never auto-allow** — the user asked for a persistent YOLO mode. Guardrails: enabling requires a scary confirm dialog; while active a **red banner** shows in every affected session (reusing the dangerous-mode banner); every auto-allowed call is still audit-flagged. Precedence mirrors model resolution — **workspace overrides global** (`workspace ?? global ?? off`, per-workspace tri-state so a workspace can turn a global bypass off). The setting is resolved at spawn and re-applied on respawn (unlike session dangerous mode, which resets to safe on respawn). Changing it applies live to affected sessions (global → all; workspace → that workspace's), reusing the MCP live-reload scoping.

**Decision (Feedback round 5, 2026-07-16) — workspace confinement:** by default, file tools (read/write/edit/grep/glob/ls/…) targeting a path **outside the workspace root** trigger an **ask** prompt — including reads that are normally auto-allowed inside the workspace. Bash is deliberately not path-inspected (it stays under command-pattern rules — honest about what is enforceable). Explicit rules and one-click grants take precedence through the normal rule engine, and the full-bypass setting bypasses this check like everything else.

## 11. Audit Log

The audit log records important agent actions: tool calls; command executions; file reads/edits; created/deleted files; permission approvals/denials; dangerous mode activation/deactivation; model/provider changes; context compactions; AGENTS.md edits; sub-agent invocations.

**Decision (Round 2):** the audit log is available at **both session level and workspace level**. Export as JSON/Markdown is post-V1.

## 12. Agents and Sub-Agents

V1 includes three built-in agents:
1. the **Code Explorer Agent** (sub-agent for codebase exploration);
2. the **Summarizer Agent** (used for context compaction);
3. the **agents-md-maker Agent** (explores a project and drafts an AGENTS.md for the user to review — it never writes the file itself; see §15).

**Decision (Feedback round 5, 2026-07-16):** the **Summarizer Agent is removed** — compaction always ran on Pi's native `compact` and the agent was never wired to it (§9). V1 ships **two** built-in agents: Code Explorer and agents-md-maker. The agents-md-maker's write behavior is also revised (structured output written by the app — see §15).

**Decision (2026-07-17) — async delegations (supersedes the "single blocking tool call" model):** sub-agent delegations are **asynchronous by default** (`asyncByDefault` in the bundled pi-subagents config; the model may still pass `async:false` for a quick inline lookup it wants to block on). The main agent's turn **ends when the delegation is dispatched**, so **the user keeps chatting while sub-agents run** — this reverses the earlier "messages queue because a delegation is a single blocking tool call" behavior, which now applies only to explicit synchronous (`async:false`) delegations. The sticky run cards track a **detached** run for its whole life (spawn → live status → completion), decoupled from the tool-call lifecycle, each with an **interrupt (stop)** control; a card turns amber when its run needs attention. Results are **auto-delivered**: pi-subagents injects a `subagent-notify` message and triggers an assistant turn to fold the result in — only the final output enters the main context (the isolation contract is unchanged). An **active async run protects its session from hibernation and MCP live-reload** (it counts as busy) so a respawn can never orphan a running delegation. Wire shapes: `docs/validation/d1.md` §hv.subagent.

**Decision (2026-07-17, refinement) — never block on the result:** to actually deliver "keep chatting", the main agent must NOT sit and wait after delegating. pi-subagents otherwise steers the model to call its `wait` tool (which re-blocks the turn); HappyVibe intercepts `wait` and returns guidance to end the turn instead — the result folds in on its own turn when ready. The model is told which sub-agents exist and to delegate directly (skip the discovery `list` step). Behavior varies by model: instruction-following models do this cleanly, looser ones occasionally still list first — acceptable, not a correctness issue.

**Decision (2026-07-17) — sub-agent `intent` is optional (carve-out from §7):** the delegation `task` is already a good customer-facing headline, so `subagent` **advertises but does not require** the model-authored `intent` (the UI uses `intent ?? task`). This reverses §7's "every registered tool requires intent" for `subagent` only — a hard requirement made looser models fail their first delegation on a missing `intent`. `mcp`/AskUserQuestion keep required intent (they have their own factual fallbacks).

**Decision (2026-07-19, locked) — sub-agents are blocked in Plan Mode (V1):** while a session is in Plan Mode (§23) the `subagent` tool is blocked — a child Pi process carries its own tool set, so guaranteeing read-only across the child needs its own validation pass, deferred past V1. An in-flight async delegation started *before* Plan Mode is entered is **not** cancelled (the plan gate applies to new calls only); its completion lands normally.

### Code Explorer Agent

Purpose: explore the codebase and return structured findings to the main agent. Callable automatically by the main agent or manually by the user. The app maintains a visible list of available agents; the model receives a representation of available agents and tools so it can invoke them, subject to permissions. It has: name; description; editable system prompt; available tools; separate context window; result format; running status; readable output.

**Decisions (Feedback rounds, implementation-verified):** a sub-agent's work stays in its **own context** — measured empirically, only the call (agent + task + intent) and the final result enter the main agent's context; the child transcript is display-only. While a sub-agent runs, a **sticky section at the top of the chat** shows the agent, its intent, live status and elapsed time — clicking it expands the live child transcript (foreground runs) or the live status snapshot (async runs) — and it slides away on completion, leaving the call line and result in the flow. Because delegations are async by default (see the 2026-07-17 decision above), the user keeps chatting normally while sub-agents run and the result folds in when it finishes; a foreground (`async:false`) delegation still blocks its one turn ("answered when \<agent\> finishes").

**Decision (2026-07-17) — discoverability:** the model is told which sub-agents exist so it delegates spontaneously (previously it had to call `subagent {action:"list"}`, which it rarely did). The bridge injects an **"Available subagents"** section — each agent's name + description, built-in and project, plus a one-line nudge to delegate exploration/long searches — into the system prompt each turn (the same per-turn injection as nested AGENTS.md). It appears in the **context breakdown**'s system block with its estimated token cost.

### Summarizer Agent

Purpose: summarize and compact session context when the user accepts a compaction suggestion. Own context window; can use a different model (agent-level override). *(Removed in Feedback round 5 — see the decision above; compaction is Pi-native.)*

### Agent creation and editing

**Decision (Round 2):** In V1: editing built-in agents (including system prompts) and **duplicating** them. Coming soon (not V1): creating agents from scratch and importing agent configs. V1 has the conceptual UI area for agents even where creation is disabled.

## 13. Tools

The tools list includes: tool name; human-readable description; source; permission status; enabled/disabled state; whether built-in, extension-provided, or coming soon. Future tool categories: MCP tools; CLI tools; API tools; skills; custom workflow tools. For V1, API import and CLI import are not supported.

**Decision (Round 2, revised in the feedback rounds):** MCP support is **deferred until after the post-V1 feedback improvements land**. When it ships, it will be provided through a Pi extension/package bundled in HappyVibe's curated runtime (candidate already identified: `pi-mcp-adapter`).

**Decision (2026-07-13):** MCP ships via the vendored **`pi-mcp-adapter`** (exact-pinned), not a native client — it embeds the official MCP SDK and registers through `pi.registerTool()`, so every MCP call flows through the existing bridge permission gate as `mcp:<tool>`. **Proxy mode by default** (one low-token `mcp` tool; the UI unwraps to the real server/tool everywhere — transparency lives in the rendering layer, not burned context), with a per-server "expose tools directly" toggle. Config is standard `mcpServers` JSON: global tier in the app agent dir, workspace tier in `.mcp.json` (shareable with other MCP hosts). Managed from the Agents & Tools page. Out of scope for v1: roots, MCP prompts, live `tools/list_changed`, session-tier config. Spec: `docs/superpowers/specs/2026-07-13-mcp-support-design.md`; plan: `docs/superpowers/plans/2026-07-13-mcp-support.md`.

**Decision (2026-07-13, Phase 2):** MCP OAuth is **host-driven in HappyVibe main** — the pi-mcp-adapter's interactive OAuth path is gated on `ctx.hasUI` and is a no-op in RPC mode. `src/main/mcpOAuth.ts` implements `OAuthClientProvider` from `@modelcontextprotocol/sdk`, opens the authorization URL in the system browser via `shell.openExternal`, listens on a `127.0.0.1` loopback callback server, validates the `state` parameter (CSRF), and calls `transport.finishAuth` to complete the code exchange. After successful auth, the transport is replaced with a fresh instance (SDK transports can't restart) and the server reconnects. Tokens are persisted as `AuthEntry` (stamped with `serverUrl`) in `<agentDir>/mcp-oauth/sha256-<sha256hex(serverName)>/tokens.json` so the adapter reads them at runtime with no re-auth. UX: servers requiring OAuth show a confirm-with-tools modal at add-time; per-server Authenticate / Log out actions are available in the Agents & Tools page; a non-blocking startup status sweep surfaces `needs-auth` servers. The contract test `tests/mcp-adapter-authformat.test.ts` gates any pi-mcp-adapter pin bump. Plan: `docs/superpowers/plans/2026-07-13-mcp-support.md`; validation: `docs/validation/m1.md`.

**Decision (2026-07-14):** MCP tool calls carry a **model-authored `intent`** like other registered tools (§7), so the agent's behavior reads as "Fetching this page to look for opinions…" rather than "MCP → notion_fetch". The bridge injects a required `intent` into the adapter's proxy tool schema (`requireIntent`, same mechanism as sub-agents/AskUserQuestion); the tool card shows the intent, falling back to a factual label enriched with a key argument (url/query/…). The **permission prompt always shows the factual action** (server/tool + key arg), never the model's self-authored intent, so a benign-sounding intent can't mask a risky call at approval time. Validation: `docs/validation/m1.md`.

**Decision (2026-07-14, direct-mode intent):** intent also covers **"expose tools directly" mode**. The adapter's direct executor forwards params verbatim to the MCP server (a strict server would reject an unknown `intent`), so the bridge injects the required `intent` into each direct tool's schema (identified via `sourceInfo.path` = pi-mcp-adapter) and then **strips it in its `tool_call` handler before execution** — Pi's documented mutable-input hook. The UI still sees the intent because `tool_execution_start` is emitted with the original model args before the strip; the server never sees it. Server tools that declare their own `intent` param are left untouched (no injection, no strip). The factual-permission-prompt rule above applies unchanged. Unit contract: `tests/intent-direct-tools.test.ts`.

**Decision (2026-07-14, live-reload):** MCP config/auth changes apply **live** to running sessions. Since Pi/the adapter read MCP config only at spawn (no live tool-reload API), adding/removing/authenticating/logging-out a server respawns the affected live sessions **resumed** (conversation preserved via the session file — the hibernation-restore path). Scope: a global change reloads all live sessions; a workspace change reloads that workspace's. Idle sessions reload immediately; sessions mid-turn or awaiting a permission prompt defer until they finish (never disrupted). Accepted trade-off, disclosed to the user via a transcript notice: a respawn resets that session's "allow-for-session" permission grants and dangerous-mode toggle to safe defaults. Validation: `docs/validation/m1.md`.

**Decision (Feedback round 1):** the tools list shows each tool's live permission state (allow / ask / deny), evaluated by the same rule engine that enforces it — the logic never forks.

**Decision (Feedback round 4, 2026-07-15):** two readability improvements. (1) **MCP brand icons** — when an MCP tool call comes from a recognizable product (GitHub, Notion, Slack, Linear, …), its tool card shows that **brand's icon** instead of the generic MCP glyph, keyed by the (normalized) server name. Icons come from a **bundled brand icon font** (no network fetch — local-first); unknown servers keep the generic glyph. (2) **Tools list rows expand** — each row in the tools list is clickable to reveal the full tool description (previously truncated), its source, and permission state.

**Decision (Feedback round 5, 2026-07-16):** the Agents & Tools page is renamed **"MCP, Tools & Agents"** and restructured into three icon-titled sections (same style as Settings): **MCP** (connected servers + add more), **Tools** (max 10 rows shown, "Show more" reveals all), and **Agents** (unchanged). The composer "+" menu's MCP submenu (§7) links here.

## 14. Skills

Skills (the Agent Skills standard — `SKILL.md` folders, natively supported by the pinned Pi) are a first-class HappyVibe surface: **visible, reviewable, and gated**. Pi loads skills silently; HappyVibe turns that into a differentiator consistent with the permission story. Pi facts the design builds on: discovery from `<agentDir>/skills/`, `~/.agents/skills/`, project `.agents/skills/`, settings, and repeatable `--skill <path>`; `--no-skills` disables discovery but explicit `--skill` paths still load; skills register as `/skill:name` commands; descriptions enter the system prompt at startup with no runtime add/remove API.

**Decision (2026-07-22, scope):** V1 = visibility + trust + import + agent-assisted creation. Marketplace/library is V2. Spec: `docs/superpowers/specs/2026-07-22-skills-integration-design.md`; plan: `docs/superpowers/plans/2026-07-23-skills-integration.md`.

**Decision (2026-07-22, trust — review-before-active):** main (not Pi) scans skill locations and keeps an approval record per skill keyed by **path + content hash** (SKILL.md + referenced files). New skill → "needs review" with a SKILL.md preview; content change → hash mismatch → back to needs-review. The registry is a JSONL-backed store (no SQLite), scoped global vs workspace. **Approval and activation are separate**: approval lives at the skill's scope; activation is a **per-workspace checklist** over all approved skills (global and workspace), so a global skill can be on in one workspace and off in another. A session loads approved ∩ active-for-its-workspace. Skills imported or created through the app are approved at import time.

**Decision (2026-07-22, enforcement):** Pi is spawned with `--no-skills` plus one `--skill <path>` per approved+active skill — Pi never sees unapproved content; no bridge involvement in gating. Enable/disable/import/approve apply live via **respawn-resume** (the MCP live-reload machinery generalized to a runtime-config reload: debounced, idle-only, deferred while busy, session resumed from the session file). A file watcher on skill dirs flags on-disk changes live. **Bypass is orthogonal**: dangerous mode / `HV_BYPASS` affect tool-call gating only — the skill gate is spawn-time config with no bypass path.

**Decision (2026-07-22, import sources; bundled set fixed 2026-07-23):** five sources, all flowing into the same review gate: (1) **bundled skills** shipped in the runtime — **skill-creator plus 2–3 curated skills vendored from `anthropics/skills`** (pinned commit, provenance recorded), pre-approved (we vetted them) but **off by default**; (2) **local folder** copy-in; (3) **linked Claude Code dirs** (e.g. `~/.claude/skills`) referenced in place via a `linkedDirs` setting — still review-before-active; (4) **git URL, tarball-based** (forge archive over HTTPS, no git binary; provenance `{sourceUrl, ref, commitSha-or-archiveHash, importedAt}`; "update" = re-fetch → hash change → needs-review; no auto-update; SSH/private repos are V2); (5) a **curated shortlist** — a static in-app list, not a marketplace. All imports are path-confined writes.

**Decision (2026-07-23, creation):** a **"New skill" button** in the workspace view fires `/skill:skill-creator` in the current session; the skill interviews the user and writes into the workspace's `.agents/skills/` through normal gated tools (path-confinement holds; no agent ever writes to `<agentDir>`). The result is already-approved (user authored it interactively). **"Promote to global"** copies it main-side into the managed global dir; approval carries over (same hash). No form editor in V1 — "edit" opens SKILL.md via the file tree.

**Decision (2026-07-22, UI, amended ×2):** the "MCP, Tools & Agents" view is renamed **"Skills, MCP, Agents & Tools"** and gains a **"Global skills"** section (managed + linked + bundled only — multiple workspaces can be live at once, so workspace skills don't belong there; a persistent hint points to workspace settings). Rows: name, description, source badge, status; executable files are flagged ("includes N scripts"); the inspector shows rendered SKILL.md, file list, provenance, per-skill token estimate, and a **before/after diff on re-review**. `WorkspaceSettingsModal` is the ONLY surface for workspace skills: review + the per-workspace activation checklist. The per-session tools list shows loaded skills under a "skill" category with scope badges (the §13 future-categories slot, now real). The composer autocompletes `/skill:name` from the session's active set. Unreviewed project skills surface as a non-blocking badge — never a modal wall.

**Decision (2026-07-22, context visibility):** skills' system-prompt overhead appears in the context panel as two lines — global skills and workspace skills — with estimated token weights; the inspector shows the per-skill estimate (name + description are paid every turn; the SKILL.md body only when loaded).

**Decision (2026-07-23, invocation transparency):** loading a skill surfaces as a transcript card with a **model-authored intent** via a bridge-registered `use_skill(name)` tool (goes through `requireIntent` like MCP; returns the SKILL.md content). A raw `read` of an active SKILL.md is detected as a fallback and cards with a derived label. `hv.skill` events land in the EventLog: discovered, approved, revoked, imported (with source), created, invoked; raw-read detections are logged as heuristic (`detected: true`).

**Decision (2026-07-23, delivery):** all of the above is V1, phased **trust core → imports → creation**, each phase validated (full gate + live tests) before the next; implemented straight through in a single run. Testing: unit (discovery/hash/registry), a `--no-skills`+`--skill` contract test added to the pin-bump gate (`docs/validation/sk1.md`), and a live bridge test (approved skill loads, unapproved absent, `use_skill` carries intent).

Out of scope (V2+): marketplace/library, SSH/private-repo git import + system-git fallback, upstream update notifications, a skill-editing UI, honoring the experimental `allowed-tools` frontmatter, per-skill tool-permission narrowing.

## 15. AGENTS.md

HappyVibe supports AGENTS.md in V1: read it; show it in the context breakdown with its token cost; edit it (plain markdown editor); propose creating it if missing; explain which instruction files are active and their priority/order.

**Decisions (Feedback round 2):** HappyVibe follows the [agents.md standard](https://agents.md/) — a root file plus **nested AGENTS.md files in subdirectories**: the nearest file for the subtree a tool touches is injected for that turn (Pi only discovers upward from the project root, so HappyVibe's bridge provides the nested behavior) and nested files appear in the context breakdown. When no AGENTS.md exists, the app offers to copy an existing CLAUDE.md, or to draft one with the built-in **agents-md-maker** agent — the draft lands in the editor for review and is only saved explicitly.

**Decision (Feedback round 3, 2026-07-14):** the "propose creating it if missing" promise becomes **proactive**. Opening a workspace that has no AGENTS.md surfaces a one-time, dismissible banner offering "Generate one" (runs the agents-md-maker draft flow above) or "Dismiss". The dismissal is remembered per workspace so it never nags; the draft is still review-then-save (never auto-written).

**Decision (Feedback round 4, 2026-07-15) — auto-save the generated draft (reverses the round-2 "never auto-written"):** when the agents-md-maker draft completes it is **written to `AGENTS.md` immediately** — the file is fully editable afterwards, so a review-gate before the first save added friction without safety. The editor opens on the saved file with an "AGENTS.md created" notice; subsequent edits still save explicitly. This supersedes the earlier "the draft lands in the editor for review and is only saved explicitly" rule for the initial generation.

**Decision (Feedback round 5, 2026-07-16) — structured, nested, app-written:** the agents-md-maker stays **read-only** and returns **structured output** covering the root AND any nested AGENTS.md it drafts (`{path → content}`); the **app (main process)** writes the files — path-confined and audited — extending round-4's root-only auto-save. The editor opens on the saved root file with a notice; unparseable output falls back to the draft-in-editor flow. Also: opening any AGENTS.md from the file tree opens the **AGENTS.md edition dialog** for that file rather than a plain editor tab (the chat-header AGENTS.md chip is removed, §7).

## 16. Model Providers

HappyVibe supports the model providers supported by Pi Agent.

**Onboarding decision (updated after spike research):** first-run offers, in order: (1) **"Sign in with GitHub Copilot / ChatGPT / Claude"** (subscription OAuth); (2) **a free local option (Ollama)** — zero keys, zero billing; (3) raw API key entry (BYOK) as the pro fallback. The Claude Pro/Max "extra usage" billing caveat is communicated honestly in the UI.

The model configuration hierarchy:
1. global default model;
2. workspace/project override;
3. session-level override (from the chat bar, added in Feedback round 2);
4. agent-level override.

The chat bar's model chip labels which tier is in effect, and the available-model list refreshes live when providers change.

**Decision (Feedback round 3, 2026-07-14):** every model-selection dropdown (chat-bar chip, workspace override, global default) shows a mini search/filter box when more than 5 models are available, so long provider lists stay navigable.

**Decision (Feedback round 5, 2026-07-16):** the round-3 search box actually ships in **all** model dropdowns — the Settings global default and workspace override had remained plain native selects — via one shared searchable component extracted from the chat chip.

**Decision (Feedback round 4, 2026-07-15) — system prompt visible at launch:** the read-only resolved system prompt in Settings is shown **at launch**, without first requiring a live session. The last-resolved prompt is cached so it's always available, refreshing live whenever a session reports a newer one. The UI labels the layers: the **base prompt is global** (identical for every session); **per-workspace additions** are a separate, labeled layer. (Implementation note: the prompt is only produced by a running turn, so the cache — not on-the-fly resolution — is what guarantees launch-time visibility.)

**Decision (Feedback round 1) — provider setup organization:** Settings opens with an **LLM Setup** section — the configured providers plus an "add provider" page grouped as **Sign in with your plan** (ChatGPT / Claude / GitHub Copilot), **Local** (Ollama), and **Cloud API keys** (a curated list: DeepSeek, Anthropic, OpenAI, Google, OpenRouter) — no numbered setup steps. Below it, a **System Prompt** section shows the full resolved main-agent prompt read-only with an editable additions layer, overridable per workspace; global permission rules follow; the audit log and analytics dashboard sit at the bottom of Settings rather than in the sidebar. Each workspace row in the left panel opens its own settings (model override, workspace permission rules, workspace system-prompt additions).

**Validation resolved (spike + implementation):** the OAuth sign-in flows ARE drivable from the embedded RPC-mode Pi via bridge commands.

Sub-agents can use different models from the main agent. For V1, the must-have is provider setup, model selection, token count, and context size visibility.

## 17. Sessions

Each workspace can have multiple coding sessions; sessions can run in parallel.

**Decision (Round 2):** parallelism means **multiple sessions can actively run agents at the same time**. Detached background jobs are out of scope for V1.

The user can: create, resume, archive, restore, **delete permanently** (confirmed — removes the conversation and its session file), search (by title), and view session history.

**Decision (Feedback rounds):** session lifecycle is **fully transparent** — no session limit visible to the user and no stop/end-session control anywhere (the in-chat abort of a running response is the only stop). An internal cap protects resources: when room is needed, the oldest **idle** session hibernates (never one that is mid-call, awaiting a permission answer, or running a sub-agent) and restores transparently when reopened. Sessions are titled automatically by the model after the first exchange (renameable).

**Decision (Feedback round 4, 2026-07-15) — full transcript on reopen:** reopening a session reconstructs the **whole** visible transcript from the persisted history — user and assistant messages AND the tool cards (tool name, the model-authored intent headline, arguments, and result), not just the text. The intent and results are already persisted in the session file, so a reopened session reads the same as it did live. Reconstructed tool cards are shown **collapsed by default** to keep a long reopened conversation lean. (Live-only extras that aren't in the history — the approval badge and the expandable sub-agent trace — are not reconstructed.)

Session data is stored locally only. No account system, no cloud sync in V1.

## 18. Distribution and Business Model

Open source first. No monetization, no HappyVibe billing, no account system. Users bring their own provider keys. This reinforces the local-first, beginner-friendly trust model.

## 19. Success Metrics

MVP success: users complete coding tasks; users understand agent actions better than in CLI tools; users prefer HappyVibe to Claude Code for simple tasks.

**Decision (Round 2):** no remote telemetry in V1 — metrics live in a **local-only analytics dashboard** (tokens consumed, retention, session duration, session count; more candidates later: completed edits, permission approval rate, dangerous mode usage, context warnings, compaction usage, sub-agent calls, restored sessions, satisfaction).

## 20. Product Taste

Inspired by Codex in layout, chat style, and workspace management — but not cold or enterprise. Playful, visually pleasant, easy to understand. Principles: simple; warm; clear; modern; friendly; not childish; transparent; low intimidation.

**Shipped direction:** "warm workshop" — cream paper and warm ink, tangerine primary, chunky borders with hard offset shadows, playful microcopy, bundled friendly typefaces. It satisfies the principles above and is the house style unless revisited.

## 21. File Access (V1)

**Decision (Feedback round 1, superseding the original "no file explorer" stance):** V1 includes a collapsible **workspace file tree** (right-hand pane, closed by default, refresh top-left / close top-right, distinct folder and per-type file icons) and a **built-in tabbed code editor** (syntax highlighting, editing with save, external-change detection) — the chat and open files share the center area as tabs.

File paths shown on tool and diff cards are clickable: open the file in the built-in editor, reveal it in Finder / the OS file manager, or copy its path. Searching file names from the chat UI is post-V1.

**Decision (Feedback round 3, 2026-07-14):** the file-tree reduce icon **closes the pane completely** (unmounts it) rather than minimizing to a slim rail — matching the "close top-right" intent above. Related polish: opening/resuming a session shows a loader instead of a blank/instant swap (§17), and image attachments open a zoom lightbox on click (§7).

**Decision (Feedback round 4, 2026-07-15) — file-tree context menu:** right-clicking an entry in the workspace file tree opens a menu with **Open**, **Delete**, and **Details**. Delete always shows a confirm dialog and moves the item to the **OS Trash** (`shell.trashItem`) — never a hard delete, so it's recoverable, matching standard OS behavior; it works on files and folders and is path-confined to the workspace like every other fs operation. Details opens a popup with the item's kind, size, modified time, and workspace-relative path.

**Decision (Feedback round 5, 2026-07-16) — files panel upgrade:** the panel's top edge aligns with the tab strip (same level as the chat); the tree **auto-refreshes via native filesystem watching** — catching agent, user, and external changes — and the refresh button is removed; **drag & drop** works in all three directions (OS → tree copy-in, within-tree move, tree → center open / composer attach); header icons offer **new file**, **new folder**, and **collapse all**.

**Decision (Feedback round 5.1, 2026-07-17):** the files panel is a **right-side overlay drawer** (opened from the persistent top-right toolbar, §7) — its top aligns below the tab bar and it **overlays** the content rather than occupying a grid column, so opening it no longer shrinks the chat or split panes.

*(Context, §9 addendum — Feedback round 5.1)* the composition surface is **scaled to the whole context window** and shows a **"Free space" segment** for the unused portion, so the empty context is visible alongside the used categories.

**Decision (Feedback round 6, 2026-07-18) — open-file auto-refresh:** an open editor tab **auto-refreshes when its file changes on disk** (agent edit, external tool, or the user's own tree actions), driven by the existing filesystem watch (push) rather than only the on-focus mtime poll. A **clean** buffer reloads silently; a **dirty** buffer surfaces the existing conflict banner ("Reload from disk / Keep mine") so unsaved edits are never discarded. (The on-focus poll stays as the fallback where `fs.watch` recursion is unavailable, e.g. Linux.)

**Decision (Feedback round 6, 2026-07-18) — rendered md/html preview:** `.md`/`.markdown`/`.html`/`.htm` tabs open in a **rendered view by default**, with a toggle icon to switch to raw, editable source (and back). Markdown renders with the **same renderer as the chat** (react-markdown + remark-gfm); HTML renders in a **sandboxed iframe** with no script execution (relative asset/style paths won't resolve — accepted). Editing and saving happen in raw mode; the rendered view reflects the current buffer, so it updates after an auto-refresh.

## 22. Onboarding: First Wow Moment

The first magical moment combines: (1) **visible agent work** — the user watches a clean, readable trace of the agent working (tool calls, statuses, diffs); (2) **context understanding** — the user sees the context window and understands exactly what the agent knows. Onboarding steers the first session toward experiencing both.

## 23. Plan Mode

**Decision (2026-07-19, locked)** — full proposal in Notion ("Plan mode proposal", page `3a0d33dfffca80848f85c0ff0b6df04f`).

Plan Mode is a **per-session, read-only "think before you touch" mode**: the agent explores the codebase, asks clarifying questions, and delivers a structured implementation plan — **without being able to modify anything** — and the user approves implementation with one click. It is the permission story told forward (safety *before* the action, not only a gate *at* it) and the calm inverse of dangerous mode. Built natively in the HappyVibe bridge (not a vendored extension); the read-only bash allowlist and the 3-phase planning prompt are adapted from `@narumitw/pi-plan-mode` (MIT), the durable-plan-file and file-referencing implement handoff from `@bacnh85/pi-plan`.

**Entering / leaving.** A composer **toggle** turns Plan Mode on for the session; the model can also enter it from chat by calling a `plan_start` tool ("let's plan this first"). A persistent **calm banner** (dangerous-mode banner's twin, in a calm color) shows while active, with a one-click **Exit** and a **"Wrap up the plan"** nudge. Leaving Plan Mode — and starting implementation — is **human-only** (see the security invariant).

**Read-only gate.** While Plan Mode is active, the bridge's `tool_call` gate runs a plan clamp **before** the normal permission engine and **before** the dangerous/bypass check (Plan Mode wins over bypass — "read-only" must mean read-only or the banner lies): mutating built-ins (`edit`, `write`) and `subagent` are **blocked**; `bash` is limited to a **fail-closed read-only allowlist** (inspection commands + safe `git`/`gh`/`npm` queries; redirects, substitutions, background jobs, and chains with any unsafe segment are rejected); read-only built-ins (`read`/`grep`/`glob`/`list`/`ls`) auto-run; **everything else** (MCP, unknown extension tools) falls through to the normal rule engine with a **floor of ask** (never auto-allowed in Plan Mode; explicit deny still denies). A blocked call renders as a quiet "Skipped — not allowed in plan mode" card, audit-logged like any gate decision.

**The plan is a workspace file.** On completion the model calls `plan_complete({plan})`; the **app (main process)** writes the plan to `.agents/plans/NNN-<slug>.md` (path-confined + audited, the agents-md-maker write pattern). The plan markdown must contain a **Tasks checklist** (`- [ ]` items) and a **Verification** section. The plan then lives on disk — visible in the file tree, openable in the built-in editor, hand-editable — so compaction can never eat it (the agent re-reads the file), and drift is handled by the plan being a **living document** the agent updates as reality differs. The implement handoff **references the file** ("Execute the approved plan in `<path>`: read it if needed, keep it scoped, update it if reality differs, run its verification") rather than pasting the plan into context.

**Status lifecycle.** The plan file carries **front-matter status** `draft → implementing → implemented | cancelled` (timestamped). "Implemented" comes from an **explicit signal, never inference**: the implementing agent calls `plan_status_update` when the Verification passes — the same structured-tool-call philosophy as `plan_complete`. If it forgets, status stays `implementing` (no worse than a latch) and the checklist `n/m` progress still tells the story. The **PlanCard** in the transcript shows the plan, live checklist progress, and status-dependent actions (draft → Implement / Keep planning / Discard · implementing → progress + Stop · implemented → ✓ · cancelled → Reopen). The user can always override the status from the card, including **Reopen** (human-only).

**Security invariant.** The model may only **restrict itself** (`plan_start`) or **record terminal facts** (`plan_status_update` → implemented/cancelled). Every transition that **grants power** — Implement (restores full tools), exiting Plan Mode, Reopen — is **human-only** (button/confirm). There is no `plan_off` tool. Model-side transitions are auto-allowed (they never touch permissions) but audited with **who** set them (model | human).

**Model nudges (Decision, 2026-07-20).** Because planning rewards reasoning and implementation rewards throughput, the UI **nudges both ways**: entering Plan Mode suggests using your **smartest model** for planning; the Implement action lets the user **pick a reasonable model** for the implementation turn (pre-filled with the session model, reusing the session model override).

**Lifecycle & interplay.** Exiting mid-turn **aborts the running turn first**, then restores tools (the "must be idle" rule, like rewind). Each fresh entry into Plan Mode starts a **new** numbered plan file; a revision within one planning phase updates the **same** file. Discard clears the session's plan state but **leaves the file on disk** (the user's artifact). Plan state is **persisted in the session file** (`pi.appendEntry`) and restored on respawn — unlike dangerous mode, it survives hibernation and MCP live-reload. Parallel sessions in one workspace never collide because the main process serializes plan-file numbering. Sub-agents in Plan Mode: see §12.

**Out of scope for V1 (post-V1 pointers):** a per-tool selector for opting extra tools into planning; a git-baseline capture at Implement with one-click file-rollback (concrete prior art in `@bacnh85/pi-plan`'s `/rewind`; the natural anchor for the file-rollback rewind §9/§13 defer to V2). Wire shapes: `docs/validation/d1.md` §Plan Mode.

---

# Critical PRD Update: Pi Agent Reality Check

Pi intentionally keeps its core small and pushes workflow-specific behavior into extensions, skills, prompt templates, and packages. HappyVibe V1 therefore defines a curated Pi-based runtime bundle that includes or implements the required capabilities.

Validation research (July 2026) resolved the open questions: 15+ native providers with mid-session switching; `pi-subagents` for delegation (separate context per agent); extensions get full session access (`get_entries`, the `context` filtering event — the mechanism behind §9's manual removal); the `tool_call` extension event supports `{block: true}` (the RPC protocol alone cannot approve/deny — hence the bridge); RPC streams structured JSON events for the whole UI surface.

**Key architecture note — the HappyVibe bridge extension:** a small bundled extension that listens to `tool_call` events inside Pi, forwards permission requests to the UI, and returns allow or `{block: true}` from the user's decision and stored rules. This grew into HappyVibe's core Pi-side component (permissions engine, context marks, auth commands, registered tools).

**V1 runtime bundle (as shipped):** Pi core (`@earendil-works/pi-coding-agent`, pinned) · `pi-subagents` (pinned) · the HappyVibe bridge extension (in-house). `pi-mcp-adapter` joins when MCP ships (§13). `@gotgenes/pi-permission-system` was dropped after the spike's V6 finding (TUI-only in RPC mode) — it remains vendored solely for the regression test documenting that finding.

**Remaining open items for the tech lead:** the Pi upgrade/release process is contract-test-gated (every pin bump re-validates the wire shapes); Windows validation (tmux dependency, extension portability) still precedes any Windows commitment. *(Resolved 2026-07-16: the packaged sub-agent child process now runs through the bundled Electron helper as Node — `pi-runtime/bin/pi-node.sh` — no system Node required; see §3 standalone decision.)*

**Round-2 decisions already locked:** curated, embedded Pi runtime at a pinned version; MCP in V1 via a bundled extension; permission enforcement delegated to Pi extensions with HappyVibe providing the UI layer; compaction via a dedicated Summarizer Agent. *(Two of these were later revised: MCP was deferred past the feedback rounds — §13 — and the spike's V6 finding moved permission enforcement into HappyVibe's own bridge — §10.)*

**→ Feasibility spike COMPLETE (2026-07-03):** Electron drives embedded pinned Pi over RPC (V1 PASS); `ctx.ui` requests surface over RPC natively (V4 PASS); the bridge blocks a real model's bash call and the agent continues (V5 PASS); a packaged `.app` runs its bundled runtime (V7 PASS); the third-party permission system is TUI-only in RPC mode (V6 FAIL — valuable finding). Full evidence: `docs/validation/`.
