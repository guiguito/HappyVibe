---
title: Built-in tools
description: See the abilities HappyVibe gives the agent, what each one costs, and switch off any you don't want.
---

These are the abilities HappyVibe gives the agent out of the box. Every one is on when you start, and you can take any of them away: "Abilities HappyVibe gives the agent itself, on by default. Turning one off takes its tools away from every session. To see every tool the agent can call and whether it is allowed, open Agent tools."

Nothing here is a one-way door. Switch a row back on and its tools come back.

## Where to find it

**Abilities** → **Built-in tools** in the sidebar.

## What's on the screen

The screen is one list, under the heading **Built-in Custom Tools**. Each row has an **On** / **Off** switch on the right.

<!-- TODO(media): built-in-tools/builtin-tools.png — The Built-in tools list with its toggles, and Plan mode expanded to show its read-only prompt -->

Most rows carry the same note: "Live sessions respawn to apply this — permission grants and dangerous mode reset to safe defaults for those sessions." In plain words: a session that's open restarts so it picks up the change. It waits until the session is idle, and it keeps the conversation. Anything you allowed only for that session asks again afterwards, and a session running with every permission bypassed goes back to asking. See [Permissions](/docs/permissions/) for both.

Some rows mention the context cost of tool schemas. The **context** is everything the model reads on each turn: your conversation, its instructions, and a short description (a schema) of every tool it can call. Context is measured in **tokens**, small pieces of text of roughly four characters each, and all of it is sent again on every turn. A tool you switch off takes its schema out of the context.

### Plan mode

"Lets the agent draft and track a step-by-step plan before acting."

While the session is in plan mode, it's read-only: the agent can read, search and explore, and anything that would change your project is blocked. The plan is a real Markdown file in your project, under `.agents/plans/`. Only you can implement the plan or leave plan mode. **How plan mode works**, at the bottom of the row, says the rest.

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

**Clear browsing data** empties the agent browser's saved data, including the logins it keeps between restarts. The row says "Cleared." when it's done.

### Web tools — 4 tools

"Lets the agent search the web and read any public page as clean text, list a site's pages, or read a whole section of one. Reading a new site asks you first, under the same rules as the agent's browser."

Open **Web service** under the row to choose who fetches those pages. See [Choose the web service](#choose-the-web-service) below. **How web tools work** explains what the service can see.

### Memory — 3 tools

Lets the agent remember durable facts about you and about each project, across sessions. "Saving and forgetting ask you first; you can read, edit and delete every memory on the Memory page." This is [Memory](/docs/memory/)'s switch for the whole app. Each project's own settings can also turn memory off for that project.

Click its name to read the memory policy the agent follows, and add your own lines to it, the same way as Plan mode.

### Schedules — 4 tools

"Lets the agent list this workspace's schedules and propose new ones. Creating, changing and deleting always open the drawer or a permission prompt for you first — the agent never writes a schedule on its own. Turning this off takes the four tools away from the agent; your schedules keep running."

### Documents — 1 tool

Lets the agent read Word, PowerPoint, Excel, PDF, OpenDocument, RTF and EPUB files as Markdown. They're converted on this computer: "nothing is sent anywhere." This row also turns on **Attach document** in the chat bar. Scanned PDF pages can't be read, and the agent is told which ones they are.

### Tool intent

"The one-line “why” the model writes for each tool card." Turning it off saves the tokens that sentence costs. Cards then show a label built from the call itself. Approval dialogs don't change either way: "they always show the factual action, never this sentence."

## Turn a tool off

1. Find its row.
2. Click **On**. It turns to **Off**.
3. For Plan mode only, a dialog asks first: "Turn off Plan mode?" It explains that this "removes the plan controls from chat (the top-bar indicator and composer chip) and unregisters the plan_start / plan_complete / plan_status_update tools." Click **Turn off** to go ahead, or **Cancel** to keep it.

Open sessions restart to apply it, as the row's note says. Click **Off** to switch it back on.

## Add your own instructions to a built-in prompt

1. Click **Plan mode** or **Memory — 3 tools** to open the row.
2. Read the built-in prompt, so you know what the agent is already told.
3. Type your preferences in the box underneath.
4. Click **Save**. The row says "Saved."

Your lines go after the built-in prompt, never instead of it.

## Choose the web service

The web tools don't fetch pages from your computer. A web service does, so sites see the service's address rather than yours. By default that's a server HappyVibe runs, which can see the addresses and searches the agent sends. If that matters to you, point the app at a service of your own.

1. Under **Web tools — 4 tools**, open **Web service**.
2. Pick **HappyVibe's service** or **Your own**.
3. For **Your own**, type its address in **API URL**, and its key in **API key (optional)** if it needs one. The note underneath says what fits: "Firecrawl-compatible API, v2 — e.g. https://firecrawl.example.com. Applies to the next call, so nothing restarts."
4. Click **Test**. "Connected." means it answered. You can test before you save.
5. Click **Save**.

If you pick **Your own** and leave the address empty, **Save** and **Test** both answer "Enter the address of your service first." While the address is empty, the agent keeps using HappyVibe's service, so the web tools never break halfway through a change.

This is the one control on the screen that doesn't restart your sessions.

## During a session

- **Plan mode** adds a plan indicator to the session's top bar and a chip in the composer.
- **Ask user** shows up as a question from the agent, waiting for your answer.
- The terminal, browser and web tools show up as tool cards, and anything that needs your OK waits in an approval dialog. See [Approve a tool call](/docs/approve-a-tool-call/).
- **Tool intent** is the one-line "why" at the top of each tool card.

## Related

- [Agent tools](/docs/agent-tools/): every tool the agent can call, and whether it's allowed.
- [Permissions](/docs/permissions/): what the agent may do without asking.
- [Memory](/docs/memory/): read and manage what the agent remembers.
- [Terminal](/docs/terminal/): your own terminal, beside the agent's.
- [AI autofill](/docs/ai-autofill/): the app's other built-in prompts, shown the same way.
