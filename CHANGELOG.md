# Changelog

## [Unreleased]

### Heads up

- **HappyVibe now sends anonymous usage statistics and crash reports, both on by default**, including on
  installs that already existed. Neither carries what you type, your files or your projects, and no
  cost figure is ever sent. Switch either off under **Privacy**; every crash report it sends is in
  the **Audit log**.
- **The bundled skills, prompts and sub-agents are now switched on.** Only items new to the bundle
  arrive on; anything you already had keeps the state you gave it. Together they cost about 1,100
  tokens of context every turn, which the context panel shows, and each one switches off on its own
  page. The bundled **brand-guidelines** skill is gone: it carried Anthropic's own brand.
- **Sub-agents can no longer write outside your project folder.** Before, an allow rule for `write`
  reached your whole filesystem for them, and the **Audit log** only said "allow".
- **The agent now asks before it adds an MCP server or signs in to one, and your `mcp:` rules cover
  every MCP tool call.** Before, a rule could be sidestepped by calling a server's tools directly. A
  plugin's MCP servers also stay off until you click **Connect**.

### Added

- **HappyVibe runs on Windows and Linux, and updates itself.** Windows x64 has an installer; Linux
  x64 comes as an AppImage or a `.deb` (the AppImage needs `libfuse2` on Ubuntu 22.04 and later).
  The Mac build is now signed and notarized; the Windows one isn't signed yet, so SmartScreen asks
  you to pick **More info → Run anyway**. On Windows the agent uses Git Bash when it's installed and
  PowerShell otherwise, and the bundled sub-agents need Git for Windows. HappyVibe checks for a new
  version, downloads it, and installs it when your sessions are idle; **Check now** is on the
  **Changelog** page, which is new and shows a dot when there's something you haven't read.
- **The user guide is inside the app.** Open **User guide** below the last group in **Settings**, or
  **Help ▸ HappyVibe Guide** in the menu bar (F1 on Windows and Linux), and the ✕ at the top right
  takes you back. A rejected key, an unknown model or a conversation past the model's limit link
  straight to the page that fixes it, and so does the setup window.
- **Open more than one window.** **Window ▸ New Window**, drag a tab onto another window or out to
  tear it off, or use **Move to new window** in a tab's menu. A tab lives in one window at a time,
  closing a window closes its tabs, and every window open when you quit comes back with its tabs.
- **Worktrees.** **New worktree…** under a project's **+** (⌘⇧T) or from the branch menu makes one in
  HappyVibe's own data folder. Worktrees show in the sidebar under their project, and you can merge
  one back, remove it or clean up stale ones from the **Changes** panel.
- **Schedules.** Run a prompt at a set time or every N minutes, with an optional end date, from the
  new **Schedules** page. A run is a normal session (transcript, permission prompts, audit rows and
  cost) that appears in the sidebar; it only fires while HappyVibe is open, and a run you missed asks
  before it catches up. The page states what a run will cost before you press Create, and the agent
  can propose a schedule for you to confirm.
- **Memory.** The agent can save what's worth keeping, recall it in later sessions and forget it,
  through three tools you can switch off under **Built-in tools** or on the new **Memory** page.
  Saving asks first, memories show in the context panel, and you can import them from Claude Code.
- **Two new ways to give the agent material.** **Attach document** in the **+** menu turns a Word,
  PowerPoint, Excel, OpenDocument, RTF, EPUB or text-based PDF file into Markdown when you pick it,
  and shows its size in tokens before you send. And the agent can search and read the web with four
  tools under **Built-in tools**, gated by the same host rule as the browser. By default they go
  through a web service HappyVibe runs, free for now, which sees the addresses and searches; you can
  point them at your own instead.
- **Sub-agents run inside the session and can be steered.** Message a running one from its card or by
  picking it in @; workflows are approved as code and shown as runs you can stop whole; a sub-agent's
  questions reach you as prompts on the parent's pane; and a run that waits on the model for ten
  minutes turns amber. More agents are bundled, including a read-only reviewer, and every agent reads
  AGENTS.md. Running sub-agents and terminals rest as small circles in a row: click one for its card.
- **Smaller things.** **Send feedback** from the top of the sidebar (only when you press Send, with
  no content, and each send is audited). Export a session as a self-contained HTML file from its tab
  menu. Double-click a tab to rename it. **Jump to latest** when you've scrolled away from the agent.
  A card asks for a GitHub star once you've used it for ten minutes, then at most every few days.

### Changed

- **Where things are.** The **Settings** list is four groups (**Abilities**, **Control**, **App
  features**, **The record**), collapsed by default, and **All Tools** is now two pages, **Built-in
  tools** and **Agent tools**. The session filter sits behind an icon (⌘K), sessions are ordered by
  last use, and a spinning dot means the agent is working while a plain dot means the session is
  alive. The top bar shows skills, agents and MCP as three coloured chips (MCP moved there
  from the **+** menu) and takes a second line instead of squeezing them, and a session's approval
  and question dialogs open over its own pane.
- **How it feels.** First run is one dialog that connects a model, picks a project and opens your first
  session. Every page says what it is and every empty screen names the next step. Menus, dialogs,
  cards, tabs and panels now open and close with a short animation, and stay still if your system asks
  for reduced motion. The agent's thinking streams live in the chat and stays closed until you open it,
  and **thinking effort** is a setting you own, for everything or per session, instead of whatever Pi
  last saved.
- **Providers and runtime.** The bundled coding agent moved up a version, with more models on most
  providers. **Meta** works with a Muse subscription or a key, and **Radius** adds 27 models on a key
  or a sign-in. Every model row shows what it costs, or says it can't know. MCP servers also reconnect
  more reliably after a sign-in expires, and a server that asks a long question can now finish the
  work instead of timing out.

### Fixed

- **Rewind now makes the agent forget too.** Before, the chat went back but the agent still
  remembered everything after that point, so asking the same question again got "I already told you".
- **Every session with the dangerous mode on shows the red banner**, including new and restarted ones.
- **A permission prompt can no longer end up behind another dialog**, where an unsent draft could
  leave you stuck.
- **Smaller fixes.** A relative link in a chat answer or a Markdown file no longer replaces the whole
  app with a dead page. A provider set up by an environment variable no longer shows a **Sign out**
  that did nothing. LM Studio, llama.cpp or a custom endpoint alone no longer keeps you on the setup
  page. Cost figures no longer look exact when part of a call couldn't be priced. A paste of several
  lines into a terminal asks before it runs. A recorded shortcut now needs ⌘ or Ctrl, so it can't
  swallow your typing.

Runtime: Pi 0.86.1 · sub-agents 0.19.0 · MCP adapter 2.35.0

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
