# Changelog

## [Unreleased]

### Changed

- **The bundled coding agent moved up a version**, and with it more models to choose from on
  most providers. Sub-agents pick up watchdog reviews, per-agent tool deny-lists and quieter
  progress reporting.
- **Two more providers to connect: Meta and Radius.** Meta works with a Muse subscription or a
  key; Radius adds 27 models on a key or a sign-in. Both sit with the rest under Providers.
- **MCP servers reconnect more reliably after a sign-in expires**, and a server that asks a long
  question can now finish the work instead of timing out.

Runtime: Pi 0.86.1 · sub-agents 0.64.0 · MCP adapter 2.35.0

## [0.1.0] — 2026-08-30

The first build of HappyVibe: vibe coding you can actually watch.

### Added

- **Chat with a coding agent inside a folder you choose.** Pick a project, start a session, and
  work in plain language. Sessions are searchable, restorable, and stay on your machine.
- **Every action the agent takes is a readable card** — what it wants, what happened, and how long
  it took. The raw call is always one click away when you want it.
- **File edits show a real diff** before and after, and you can open any changed file in the
  built-in editor.
- **A context gauge that tells the truth.** Exact token counts, a percentage, a colour-coded
  warning, and a breakdown of what is taking up room. You can remove finished turns yourself, and
  nothing is ever summarised without you saying yes. Where a number is estimated rather than
  measured, it says so.
- **You decide what the agent is allowed to do.** Rules per tool, per workspace or everywhere, with
  allow, ask, or deny. Prompts describe the actual action — never the agent's description of it —
  and they wait for you indefinitely.
- **A dangerous mode you cannot forget you turned on** — a permanent red banner, and one click to
  turn it back off.
- **An audit log** of every request and every decision, per session or per workspace.
- **Rewind** to any earlier point: the conversation, the files, or both. Every file is checked for
  changes before it is touched.
- **Plan mode.** The agent explores and writes an implementation plan without being able to change
  anything. The plan is a real file in your project, and you approve the work with one click.
- **Sub-agents that do their own reading in their own context**, so your main conversation stays
  clean. You can watch a sub-agent work while it runs, see what it cost, turn individual agents on
  and off, and read or edit what any of them is told.
- **Bring your own key for any provider Pi supports**, sign in to several of them directly, or let
  HappyVibe find Ollama, LM Studio and llama.cpp already running on your machine. Set a model
  globally, per project, or per agent.
- **Skills, Prompts, Plugins and MCP servers are all off until you approve them.** Nothing loads
  from disk on its own, including anything a project you cloned brought with it. Every page shows
  what a thing costs your context before you switch it on.
- **A terminal you drive, and terminals the agent drives.** Both survive a window reload; the
  agent's are capped, and every command it runs is gated and logged like any other tool.
- **An embedded browser the agent can read and click**, which only navigates to hosts you allow —
  enforced on the network, not on the agent's good behaviour.
- **Voice input.** Speak into the composer; your audio is transcribed on your machine and never
  leaves it.
- **Version control without the vocabulary.** See what changed, save a version, sync, undo a single
  chunk, and open a pull request in your browser. Every action shows the git command it runs.
- **AGENTS.md** is read, editable in the app, and offered if the project does not have one yet.
- **A local-only Stats page** — sessions, models, cost and permission activity, computed on your
  machine.
- **On your behalf** — the three model calls HappyVibe makes for you (Session title, Commit
  message, Pull request description), each with its own switch, its own model, and a plain
  statement of what turning it off costs you.
- **Keyboard shortcuts you can edit.**

Runtime: Pi 0.84.2 · sub-agents 0.58.0 · MCP adapter 2.26.1
