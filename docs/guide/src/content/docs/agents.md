---
title: Agents
description: See the subagents your agent can hand work to, what each one costs, and switch off or edit the ones you want.
---

Sometimes the agent hands part of a job to a helper. That helper is a subagent: another agent with its own instructions and tools, which takes one task, does it, and reports back. This screen shows "Every subagent this workspace can delegate to — yours, this project's, and the ones your Pi runtime and installed packages provide."

## Where to find it

**Abilities** → **Agents** in the sidebar.

## What's on the screen

### The context line

Under the **Agents** heading, one line tells you what your roster costs, for example "4 on · about 180 tokens of context every turn. Switch off the ones you do not use."

Here's why. So the agent knows who it can delegate to, a short line about each switched-on subagent goes into its instructions on every turn. That takes up a little room in the context window, the amount of text the model can hold in mind at once. A subagent you switch off costs nothing.

### The list

Each row shows:

- **on** or **off**. A row that's off is dimmed.
- The agent's name.
- Where it comes from, in this order on the list:
  - **user**: your own agents.
  - **project**: this project's own agents, kept in its `.pi/agents` folder.
  - **builtin**: agents that come with the Pi runtime.
  - **package**: agents from a package you've installed.
  - **bundled**: agents that ship with HappyVibe.
- The model it uses, if it has one of its own.
- What its line costs, for example **~40 tok**: "What this agent's line costs in the system prompt, every turn".
- What it's for, and the tools it may use.

Click a row to open it. You see its **Tools it may use**, its full **System prompt** (the instructions it works from), and the buttons **Duplicate**, **Edit** (for agents HappyVibe can write to), **Enable** or **Disable**, and **Close**.

### Before your first session

The list comes from a running agent, so on a fresh install it's empty: "No agents yet" and "The bundled ones appear after your first session runs." Start a session and come back.

## Switch an agent off

1. Click the agent's row.
2. Click **Disable**. Hover it first to see how much you save: "frees about" so many "tokens every turn".

It takes effect from your next message. No restart needed. The agent stays on the list, marked **off**, and **Enable** brings it back whenever you like.

## Edit an agent

**Edit** appears for **bundled** and **project** agents, the ones HappyVibe can write to.

1. Click the agent's row, then **Edit**.
2. Pick a **Model (agent tier)**, or leave it on **Inherit (global / workspace default)** to use your default model.
3. Change the **System prompt** if you want the agent to work differently.
4. Click **Save**. The change "applies to the next delegation".

## Duplicate an agent

To try a variation without touching the original:

1. Click the agent's row.
2. Click **Duplicate**.

A copy appears on the list under a new name, next to the original. Edit the copy, and switch the original off if you only want the new one.

## During a session

In a session's top bar, a chip counts the subagents you can delegate to, for example **4 agents**. Agents you've switched off aren't counted. Click it to see each one with what it's for. Picking one writes "Ask *name* to" into your message, so you only have to finish the sentence.

You can also type `@` in the message box. Your agents appear above your files, each as `@name`. Pick one, then write the task, and the agent takes it as a request to hand that task over.

While a subagent is running, `@` also offers it. A message sent that way "sends your message to this running sub-agent, not to the main agent".

## Related

- [Agent tools](/docs/agent-tools/): everything the agent can call, and whether it's allowed to.
- [Models](/docs/models/): the default model an agent inherits.
- [Skills](/docs/skills/): extra know-how the agent loads for a task, without handing it off.
- [Prompts](/docs/prompts/): reusable messages you send with `/name`.
