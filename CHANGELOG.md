# Changelog

## [0.1.0] — 2026-09-30

The first release of HappyVibe: vibe coding you can actually watch.

### Heads up

- **HappyVibe sends anonymous usage statistics and crash reports, both on by default.** Neither
  carries what you type, your files or your projects, and no cost figure is ever sent. Switch either
  off under **Privacy**; every crash report it sends is in the **Audit log**.

### Added

- **Chat with a coding agent inside a folder you choose.** First run is one dialog that connects a
  model, picks a project and opens your first session. Then work in plain language. Sessions are
  searchable, restorable, and stay on your machine.
- **Every action the agent takes is a readable card** — what it wants, what happened, and how long
  it took, with the raw call one click away. File edits show a real diff before and after, and you
  can open any changed file in the built-in editor. The agent's thinking streams live in the chat
  and stays closed until you open it.
- **A context gauge that tells the truth.** Exact token counts, a percentage, a colour-coded
  warning, and a breakdown of what is taking up room. You can remove finished turns yourself, and
  nothing is ever summarised without you saying yes. Where a number is estimated rather than
  measured, it says so.
- **You decide what the agent is allowed to do.** Rules per tool, per workspace or everywhere, with
  allow, ask, or deny. Prompts describe the actual action — never the agent's description of it —
  and they wait for you indefinitely. Your `mcp:` rules cover every MCP tool call, the agent asks
  before it adds an MCP server or signs in to one, and sub-agents can only write inside your project
  folder. A dangerous mode you cannot forget you turned on gets a permanent red banner and one click
  to turn it off, and the **Audit log** records every request and every decision, per session or per
  workspace.
- **Rewind** to any earlier point: the conversation, the files, or both. The agent forgets what came
  after, too, so asking the same question again does not get "I already told you". Every file is
  checked for changes before it is touched.
- **Plan mode.** The agent explores and writes an implementation plan without being able to change
  anything. The plan is a real file in your project, and you approve the work with one click.
- **Sub-agents that do their own reading in their own context**, so your main conversation stays
  clean. They run inside the session and you can steer them: message a running one from its card or
  by picking it in @. Workflows are approved as code and shown as runs you can stop whole, a
  sub-agent's questions reach you as prompts on the parent's pane, and a run that waits on the model
  for ten minutes turns amber. See what each one cost, turn individual agents on and off, and read or
  edit what any of them is told. Agents come bundled, including a read-only reviewer, and every agent
  reads AGENTS.md. Running sub-agents and terminals rest as small circles in a row: click one for its
  card.
- **Bring your own key for any provider Pi supports**, sign in to several of them directly, or let
  HappyVibe find Ollama, LM Studio and llama.cpp already running on your machine. **Meta** works with
  a Muse subscription or a key, and **Radius** adds 27 models on a key or a sign-in. Set a model
  globally, per project, or per agent. Every model row shows what it costs, or says it can't know,
  and **thinking effort** is a setting you own, for everything or per session.
- **Skills, Prompts, Plugins and MCP servers never load on their own**, including anything a project
  you cloned brought with it. The bundled skills, prompts and sub-agents are switched on and together
  cost about 1,100 tokens of context every turn, which the context panel shows; each one switches off
  on its own page. A plugin's MCP servers stay off until you click **Connect**. Every page shows what
  a thing costs your context before you switch it on.
- **A terminal you drive, terminals the agent drives, and an embedded browser the agent can read and
  click.** Terminals survive a window reload; the agent's are capped, every command it runs is gated
  and logged like any other tool, and a paste of several lines into a terminal asks before it runs.
  The browser only navigates to hosts you allow — enforced on the network, not on the agent's good
  behaviour.
- **Two ways to give the agent material.** **Attach document** in the **+** menu turns a Word,
  PowerPoint, Excel, OpenDocument, RTF, EPUB or text-based PDF file into Markdown when you pick it,
  and shows its size in tokens before you send. And the agent can search and read the web with four
  tools under **Built-in tools**, gated by the same host rule as the browser. By default they go
  through a web service HappyVibe runs, free for now, which sees the addresses and searches; you can
  point them at your own instead.
- **Voice input.** Speak into the composer; your audio is transcribed on your machine and never
  leaves it.
- **Version control without the vocabulary.** See what changed, save a version, sync, undo a single
  chunk, and open a pull request in your browser. Every action shows the git command it runs.
  **New worktree…** under a project's **+** (⌘⇧T) or from the branch menu makes one in HappyVibe's
  own data folder. Worktrees show in the sidebar under their project, and you can merge one back,
  remove it or clean up stale ones from the **Changes** panel.
- **Schedules.** Run a prompt at a set time or every N minutes, with an optional end date, from the
  **Schedules** page. A run is a normal session (transcript, permission prompts, audit rows and
  cost) that appears in the sidebar; it only fires while HappyVibe is open, and a run you missed asks
  before it catches up. The page states what a run will cost before you press Create, and the agent
  can propose a schedule for you to confirm.
- **Memory.** The agent can save what's worth keeping, recall it in later sessions and forget it,
  through three tools you can switch off under **Built-in tools** or on the **Memory** page. Saving
  asks first, memories show in the context panel, and you can import them from Claude Code.
- **HappyVibe runs on macOS, Windows and Linux, and updates itself.** The Mac build is for Apple
  silicon and is signed and notarized. Windows x64 has an installer that isn't signed yet, so
  SmartScreen asks you to pick **More info → Run anyway**. Linux x64 comes as an AppImage or a `.deb`
  (the AppImage needs `libfuse2` on Ubuntu 22.04 and later). On Windows the agent uses Git Bash when
  it's installed and PowerShell otherwise, and the bundled sub-agents need Git for Windows.
  HappyVibe checks for a new version, downloads it, and installs it when your sessions are idle;
  **Check now** is on the **Changelog** page, which shows a dot when there's something you haven't
  read. A `.deb` can't replace itself, so its update row links to the download page.
- **Open more than one window.** **Window ▸ New Window**, drag a tab onto another window or out to
  tear it off, or use **Move to new window** in a tab's menu. A tab lives in one window at a time,
  closing a window closes its tabs, and every window open when you quit comes back with its tabs.
- **The user guide is inside the app.** Open **User guide** below the last group in **Settings**, or
  **Help ▸ HappyVibe Guide** in the menu bar (F1 on Windows and Linux), and the ✕ at the top right
  takes you back. A rejected key, an unknown model or a conversation past the model's limit link
  straight to the page that fixes it, and so does the setup window.
- **Smaller things.** A local-only **Stats** page — sessions, models, cost and permission activity,
  computed on your machine. **On your behalf** covers the three model calls HappyVibe makes for you
  (Session title, Commit message, Pull request description), each with its own switch, its own model,
  and a plain statement of what turning it off costs you. AGENTS.md is read, editable in the app,
  and offered if the project does not have one yet. Keyboard shortcuts you can edit. **Send
  feedback** from the top of the sidebar, only when you press Send, with no content, and each send is
  audited. Export a session as a self-contained HTML file from its tab menu. Double-click a tab to
  rename it. **Jump to latest** when you've scrolled away from the agent. Menus, dialogs and panels
  open and close with a short animation, and stay still if your system asks for reduced motion. A
  card asks for a GitHub star once you've used it for ten minutes, then at most every few days.

Runtime: Pi 0.86.1 · sub-agents 0.19.0 · MCP adapter 2.35.0
