---
title: Agents
description: See the subagents your agent can hand work to and what each one costs, then turn off or edit the ones you want.
---

Your agent doesn't have to do everything itself. It can hand part of a job to a subagent: another agent with its own instructions and tools, which takes one task, does it, and reports back. This screen lists every subagent this workspace can delegate to.

## Where to find it

**Abilities** → **Agents** in the sidebar.

## What's on the screen

### The context line

Under the **Agents** heading, one line tells you what your roster costs, for example "4 on · about 180 tokens of context every turn. Switch off the ones you do not use."

Here's why. So the agent knows who it can delegate to, a short line about each subagent that's on goes into its instructions on every turn. That takes up a few tokens of its [context](/docs/first-session/#context-what-the-agent-can-see), the text the model can see. A subagent you turn off costs nothing.

### The list

Each row shows:

- **on** or **off**. A row that's off is dimmed.
- The agent's name.
- Where it comes from, in this order on the list:
  - **project**: this project's own agents, kept in its `.pi/agents` (or `.agents/agents`) folder.
  - **bundled**: agents that ship with HappyVibe.
- The model it uses, if it has one of its own.
- What its line costs, for example **~40 tok**: "What this agent's line costs in the system prompt, every turn".
- What it's for, and the tools it may use.

Click a row to open it. You see its **Tools it may use**, its full **System prompt** (the instructions it works from), and the buttons **Duplicate**, **Edit**, **Enable** or **Disable**, and **Close**.

### Before your first session

The list comes from a running agent, so on a fresh install it's empty: "No agents yet" and "The bundled ones appear after your first session runs." Start a session and come back.

## Turn an agent off

1. Click the agent's row.
2. Click **Disable**. Hover it first to see how much you save: "frees about" so many "tokens every turn".

It takes effect from your next message. No restart needed. The agent stays on the list, marked **off**, and **Enable** brings it back whenever you like.

## Edit an agent

**Edit** appears for **bundled** and **project** agents, the ones HappyVibe can write to.

:::caution
For a project agent kept in `.agents/agents`, **Edit** and **Duplicate** don't work yet: **Edit** opens with an error, and **Duplicate** does nothing. Edit that agent's file in your project instead. Agents in `.pi/agents` work as described here.
:::

1. Click the agent's row, then **Edit**.
2. Pick a **Model (agent tier)**, or leave it on **Inherit (global / workspace default)** to use your default model.
3. Change the **System prompt** if you want the agent to work differently.
4. Click **Save**. The change "applies to the next delegation".

## Duplicate an agent

To try a variation without touching the original:

1. Click the agent's row.
2. Click **Duplicate**.

A copy named *name*-copy appears on the list, next to the original. Edit the copy, and turn the original off if you only want the new one.

## During a session

In a session's top bar, a chip counts the subagents you can delegate to, for example **4 agents**. Agents you've turned off aren't counted. Click it to see each one with what it's for. Picking one writes "Ask *name* to" into your message, so you only have to finish the sentence.

You can also type `@` in the message box. Matching agents appear above your files, each as `@name`. Click one, then write the task, and the agent takes it as a request to hand that task over.

While a subagent is running, `@` also offers it. A message sent that way "sends your message to this running sub-agent, not to the main agent".

## Related

- [Agent tools](/docs/agent-tools/): everything the agent can call, and whether it's allowed to.
- [Models](/docs/models/): the default model an agent inherits.
- [Skills](/docs/skills/): extra know-how the agent loads for a task, without handing it off.
- [Prompts](/docs/prompts/): reusable messages you send with `/name`.
