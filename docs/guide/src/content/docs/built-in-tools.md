---
title: Built-in tools
description: See the abilities HappyVibe gives the agent and switch off any you don't want.
---

Out of the box, the agent can plan, ask you questions, run terminals, drive a browser, read the web, remember, suggest schedules, read documents and make images. It can also use your MCP servers, hand work to subagents, load skills, and use Pi's own tools for files and commands. Each one starts on except Workflows, and each one has a switch. Turn one off and back on, and its tools come back.

The one thing here you can't take back is **Clear browsing data**, which signs the agent's browser out of everything.

## Where to find it

**Abilities** → **Built-in tools** in the sidebar.

## What's on the screen

The screen's own intro sums it up: "Abilities HappyVibe gives the agent itself, on by default except Workflows. Turning one off takes its tools away from every session. To see every tool the agent can call and whether it is allowed, open Agent tools."

Below it is one list, under the heading **Built-in Custom Tools**. Each row has a switch on the right. **Core tools** has one switch beside each tool name instead. The switch reads **On** while it's on. Click it to turn it off.

<!-- TODO(media): built-in-tools/builtin-tools.png — The Built-in tools list with its toggles, and Plan mode expanded to show its read-only prompt -->

Change a row, and your conversation stays. Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)).

Some rows mention the context cost of tool schemas. Every tool the agent can call comes with a short description (a schema) that sits in its context, what it can see on every turn. A tool you switch off takes its schema out ([more on context](/docs/first-session/#context-what-the-agent-can-see)).

### Plan mode

"Lets the agent draft and track a step-by-step plan before acting."

While a session is in plan mode, it's read-only: the agent can read, search and explore, and anything that would change your project is blocked. The plan is a real Markdown file in your project, under `.agents/plans/`. Only you can say "go" on the plan, or take the session out of plan mode. **How plan mode works**, at the bottom of the row, says the rest. To use it, see [Start plan mode](#start-plan-mode).

Click the row's name to open it. You see:

- The built-in prompt, the exact text the agent is told about plan mode. It's read-only.
- A box for your additions, with the placeholder "Extra preferences appended after the built-in prompt above…", and a **Save** button.

The note beside the box says why the prompt stays fixed: "The built-in prompt above can't be edited — it's shown so you can see exactly what the agent is told. Your additions are appended after it. Add preferences (e.g. 'always list affected files'), not contradictions."

### Ask user

"Lets the agent pause mid-turn to ask you a clarifying question."

While Plan mode is on, this switch is greyed out and reads: "Locked on — Plan mode depends on it. Turn off Plan mode first if you want to disable this." Plan mode relies on it, so the two go together.

### Agent terminal — 3 tools

Lets the agent run long-running commands, like a dev server, in terminals you can watch, type into and stop. The row is honest about the trade: "Turning this off doesn't stop it wanting to — it goes back to backgrounding commands in bash, where you can neither see nor stop them."

Click its name to read its built-in prompt. This row has no additions box. It's the agent's terminal; your own lives on [Terminal](/docs/terminal/).

### Agent browser — 10 tools

Lets the agent open a page in a browser tab, read it, take a screenshot, click and type in it, and watch its console and network traffic. It can reach localhost freely; "every other site asks you first, and that gate is enforced on the network itself, not on the agent's good behaviour."

**Clear browsing data** empties the agent browser's saved data and cache, including the logins it keeps between restarts. It can't be undone, and it doesn't restart anything. The row says "Cleared." when it's done.

### Web tools — 4 tools

"Lets the agent search the web and read any public page as clean text, list a site's pages, or read a whole section of one. Reading a new site asks you first, under the same rules as the agent's browser."

Open **Web service** under the row to choose who fetches those pages. See [Choose the web service](#choose-the-web-service) below. **How web tools work** explains what the service can see.

### Memory — 3 tools

Lets the agent remember durable facts about you and about each project, across sessions. "Saving and forgetting ask you first; you can read, edit and delete every memory on the Memory page." This is [Memory](/docs/memory/)'s switch for the whole app. Each workspace's [workspace settings](/docs/first-session/#workspace-settings) can also turn memory off for that workspace.

Click its name to read the memory policy the agent follows, and add your own lines to it, the same way as Plan mode.

### Schedules — 4 tools

"Lets the agent list this workspace's schedules and propose new ones. Creating, changing and deleting always open the drawer or a permission prompt for you first — the agent never writes a schedule on its own. Turning this off takes the four tools away from the agent; your schedules keep running."

### Documents — 1 tool

Lets the agent read Word, PowerPoint, Excel, PDF, OpenDocument, RTF and EPUB files as Markdown. They're converted on this computer: "nothing is sent anywhere." This row also turns on **Attach document** in the message box. Scanned PDF pages can't be read, and the agent is told which ones they are.

### Images — 1 tool

"Lets the agent make an image and save it as a new file in your project. Each image costs money on your OpenRouter account. The prices below were measured once and are approximate; Session cost shows what OpenRouter actually charged."

Images need an OpenRouter key or sign-in. Without one, the row reads "Needs an OpenRouter key or sign-in. Add one on Models." and the agent doesn't get the tool. Click **Models** in that line to add one.

**Image model** picks the model the agent uses. It lists only the image models HappyVibe has checked work, cheapest first, each with what one test image cost, such as "about $0.007 an image". Your images can cost more or less. The agent can't choose another model. After each image, **Session cost** shows exactly what OpenRouter charged.

Before each image, the approval dialog reads "This makes an image with" the model's name "on your OpenRouter account. It costs money", with the same approximate price, and "It saves a new file:" followed by the file's path in your project. The agent never replaces an existing file. If the name is taken, the agent is asked to pick a new one before any image is made, so nothing is charged. Plan mode and read-only scheduled runs block this tool.

### Tool intent

"The one-line “why” the model writes for each tool card." Turning it off saves the tokens (the unit models read and bill text in, roughly four characters) that sentence costs. Cards then show a label built from the call itself. Approval dialogs don't change either way: "they always show the factual action, never this sentence."

### MCP

"Lets the agent use the tools of your MCP servers." Turn it off and no server starts in any session. Your servers stay on the [MCP](/docs/mcp/) screen, which has the same switch at the top.

### Sub-agents — 4 tools

"Lets the agent delegate work to the agents on the Agents page." Turn it off and the agent can't delegate, and it stops being told which agents exist. Your agents stay on [Agents](/docs/agents/), which has the same switch at the top.

### Workflows — 1 tool

This row sits under **Sub-agents** and switches one of its tools: the one that runs a scripted workflow of several subagents. "It is the heaviest tool the agent carries (about 5.5k tokens on every request), so turning it off keeps delegation and drops the cost. It is off until you turn it on." While **Sub-agents** is off, this switch is greyed out and reads: "Sub-agents are off, so this is off too."

### Skills

"Lets the agent load the skills you turned on." Turn it off and no skill loads in any session, whatever each skill's own switch says. [Skills](/docs/skills/) has the same switch at the top.

### Core tools — 7 tools

"Pi's own tools for reading, searching and changing files and running commands." They are `read`, `bash`, `edit`, `write`, `grep`, `find` and `ls`. On Windows without Git Bash, `powershell` takes the place of `bash`. Each one has its own switch. "A tool you turn off is gone from the agent and from every sub-agent it starts." A subagent that tries one is refused, even with **Bypass ALL permissions** on.

### With everything off

Turn every tool off (Tool intent doesn't count: it's a label, not a tool), and the screen says "The agent can only chat — it has no tools." That's fine: it can still talk a problem through with you. Turn any tool back on to give the agent something to work with.

## Turn a tool off

1. Find its row (for a core tool, its name inside **Core tools — 7 tools**). The switch reads **On** while it's on.
2. Click it to turn it off.
3. For Plan mode only, a dialog asks first: "Turn off Plan mode?" It explains that this "removes the plan controls from chat (the top-bar indicator and composer chip) and unregisters the plan_start / plan_complete / plan_status_update tools." In plain words: the agent can no longer make plans. Click **Turn off** to go ahead, or **Cancel** to keep it.

Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)). To turn it back on, click the switch again.

## Start plan mode

Plan mode is a switch for one session. The agent explores and writes a plan, and nothing in your project changes until you say so. It needs the **Plan mode** row on this screen to be on.

1. In the session, click **🧭 Plan** in the message box. It lights up, and the session's top bar shows **🧭 Plan mode**.
2. Ask for what you want planned, as usual. The agent reads, asks you questions if it needs to, and drafts the plan.
3. When it's ready, a plan card appears in the session. Read it, then pick one:
   - **Implement this plan**: the session leaves plan mode and the agent starts the work. **Implement with** lets you pick a different model first. The session keeps that model afterwards.
   - **Keep planning**: hides these buttons so you can keep talking. When the agent sends a revised plan, the card shows the new plan and its buttons again.
   - **Discard**: leave plan mode without building it. The session can change files again, and the plan file stays in `.agents/plans/`.
4. Want it to finish sooner? Click **Wrap up** beside **🧭 Plan mode** in the top bar, to ask the agent to finish the plan now. It may ask you one last question first.

To leave plan mode without implementing, click **🧭 Plan** again, or the **✕** beside **🧭 Plan mode** in the top bar.

:::note
Turning plan mode on or off stops a turn that's in progress. Wait for the agent to finish, or click it when you're happy to interrupt.
:::

## Add your own instructions to a built-in prompt

1. Click **Plan mode** or **Memory — 3 tools** to open the row.
2. Read the built-in prompt, so you know what the agent is already told.
3. Type your preferences in the box underneath.
4. Click **Save**. The row says "Saved."

Your lines go after the built-in prompt, never instead of it. Open sessions restart once they're idle to pick it up ([what that resets](/docs/approve-a-tool-call/#the-five-buttons)).

## Choose the web service

The web tools don't fetch pages from your computer. A web service does, so sites see the service's address rather than yours. By default that's a server HappyVibe runs, which can see the addresses and searches the agent sends. If that matters to you, point the app at a service of your own.

1. Under **Web tools — 4 tools**, open **Web service**.
2. Pick **HappyVibe's service**, and you're done. It's saved as soon as you pick it. For your own service, pick **Your own** and carry on.
3. Type its address in **API URL**, and its key in **API key (optional)** if it needs one. The note underneath says what fits: "Firecrawl-compatible API, v2 — e.g. https://firecrawl.example.com. Applies to the next call, so nothing restarts."
4. Click **Test**. "Connected." means it answered. You can test before you save.
5. Click **Save**.

If you pick **Your own** and leave the address empty, **Save** and **Test** both answer "Enter the address of your service first." While the address is empty, the agent keeps using HappyVibe's service, so the web tools never break halfway through a change.

Your web service choice applies from the next call, so nothing restarts.

On a computer where an administrator turned HappyVibe's service off, **HappyVibe's service** can't be picked and says "Turned off on this computer by an environment setting.", with a **Learn more** link. If it was your choice, the web tools stop until you pick **Your own**. Your own service still works. [Privacy](/docs/privacy/#on-a-managed-computer) explains how that's set.

## During a session

- **Plan mode** adds the **🧭 Plan** button to the message box, and **🧭 Plan mode** to the top bar while it's on. See [Start plan mode](#start-plan-mode).
- **Ask user** shows up as a question from the agent, waiting for your answer.
- The terminal, browser and web tools show up as tool cards, and anything that needs your OK waits in an approval dialog. See [Approve a tool call](/docs/approve-a-tool-call/).
- **Tool intent** is the one-line "why" at the top of each tool card.

## Related

- [Agent tools](/docs/agent-tools/): every tool the agent can call, and whether it's allowed.
- [Permissions](/docs/permissions/): what the agent may do without asking.
- [Memory](/docs/memory/): read and manage what the agent remembers.
- [Terminal](/docs/terminal/): your own terminal, beside the agent's.
- [AI autofill](/docs/ai-autofill/): the app's other built-in prompts, shown the same way.
