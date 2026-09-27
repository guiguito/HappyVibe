---
title: Models
description: Connect the providers the agent talks to, pick the default model, and set how hard it thinks.
---

Every model the agent can use starts here: the plans you've signed in with, the models on your computer and the keys you've saved. Pick a default, and you're set. In the screen's own words: "Providers the agent can talk to, and the default model."

## Where to find it

**Models**, pinned at the top of the sidebar, above the groups. The **Open Settings** shortcut lands here too: **⌘,** on macOS, **Ctrl+,** on Windows and Linux by default. You can change it in [Keyboard shortcuts](/docs/keyboard-shortcuts/).

## What's on the screen

### The first-run page

Until a provider is connected, the agent has no one to talk to, so this screen greets you instead: "Welcome to HappyVibe", with "Hook up a model provider to wake the agent up. Everything stays on this machine."

On this version of the page the list of providers is already open, and the **Default model** section is hidden until you've connected something. The app takes you on to your sessions as soon as you save a key, click **Use Ollama**, or finish a sign-in and click **Done**. The [First launch](/docs/first-launch/) and [Connect a model](/docs/connect-a-model/) pages walk through it step by step.

<!-- TODO(media): models/models-populated.png — Providers with rows tagged "signed in", "running" and "key saved"; Default model with the Thinking effort pills -->

### Providers

"Sign in with a plan, add an API key, or point at a local server."

At the top is a list of what you've already connected, one row each. The tag on the right of a row says what kind of connection it is:

- **signed in**: you signed in with a plan. The row has a **Sign out** button.
- **running**: a local server the app found on this computer (Ollama, LM Studio or llama.cpp), with the number of local models it has.
- **key saved**: an API key you saved here (the row has a **Remove** button), or a custom endpoint you added with a key.
- **.env**: the key comes from an environment variable on your computer, not from this screen.
- **no key**: a custom endpoint you added without a key.

With nothing connected yet, it reads "No providers configured yet — add one below."

Click **+ Add provider** to open the ways to connect, and **Hide providers** to fold them away again. They come in four groups.

### Sign in with your plan

One card per plan you can sign in with. Click **Sign in** and a window opens: "HappyVibe never sees your password — the provider does the sign-in." Your browser opens to the provider's page. Finish there, and the window updates by itself. If your browser didn't open, use **Open browser** or copy the address. Some providers show a code instead: "Enter this code at the provider:". Copy it and type it on the provider's page.

The Claude card carries a note worth reading before you click: "Heads up: on Claude Pro/Max this uses your plan's extra usage."

### Local

The app looks for Ollama on this computer by itself, with no key and nothing sent to the cloud.

- If it finds Ollama, the card shows **running** and how many models you've pulled.
- If not, it shows **not found** and "Install from ollama.com and pull a model — HappyVibe picks it up automatically." Click **Check again** once it's installed.

LM Studio and llama.cpp are found the same way: when one is running with a model loaded, it appears in your list tagged **running**.

### Cloud API keys

A card for each of the main providers, plus any provider that already has a key, saved here or from `.env`. Each card shows how many models that provider has, and a box to paste a key into. "Keys are encrypted with your OS keychain."

Looking for a provider without a card? Type its name in the **More providers…** search box under the cards. The box shows nothing until you type, then one card per match, and each works exactly like the cards above.

### Custom endpoint

For a server that speaks the OpenAI API, such as one you run yourself. Click **+ OpenAI-compatible endpoint** to add one. Your saved endpoints are listed here, each with its URL and a **Remove** button.

### Default model

"Used for new sessions unless a workspace or session overrides it." Pick one from the menu. "Only models from configured providers show up."

**Thinking effort** sets how much the agent reasons before it answers: **off**, **minimal**, **low**, **medium**, **high**, **xhigh** or **max**. "More thinking costs more tokens and takes longer. A session can override this from its top bar." A token is the unit a model reads and bills text in, a few characters at a time ([more on tokens and context](/docs/first-session/#context-what-the-agent-can-see)).

**Extended prompt cache** is off, and most people can leave it that way. It helps when you often leave a session and come back to it later. Normally the provider keeps the start of your conversation cached for five minutes and charges less to read it again. With this on, it keeps it for an hour on Anthropic (24 hours on OpenAI). The catch, in the screen's words: "Anthropic bills a long-lived cache write at 2× the input rate, so this wins when your turns are minutes apart and loses when you type continuously." It applies to new sessions. The switch reads **Off** while it's off. Click it to turn it on.

## Add an API key

1. Click **+ Add provider** if the provider cards are hidden.
2. Find the provider under **Cloud API keys**, or search for it in **More providers…**.
3. Paste your key into its box.
4. Click **Save**.

After saving, the app asks the provider whether the key works. The key is saved either way, and the card tells you if something looked off:

- "Saved, but … rejected this key", with the provider's reason, means the provider refused it. Paste a fresh key to replace it.
- "Saved. We couldn't verify this key here." means the app couldn't check. The key may be fine.

On the first-run page, saving a key takes you straight on, so you won't see that note. If the agent then can't answer, come back to **Models** and save the key again to see what the provider says.

To replace a key, paste the new one into the same box. To delete it, click **Remove** on its row in the list at the top.

## Add a custom endpoint

1. Click **+ OpenAI-compatible endpoint**.
2. Give it a name, and paste its base URL (for example `http://localhost:8000/v1`).
3. Pick what it is: **vLLM**, **LM Studio**, **llama.cpp** or **Other**.
4. Add an API key if the server needs one. Leave it blank if it doesn't.
5. Click **Fetch models**. The app asks the server what it offers.
6. Tick the models you want. For each one, check its context window: how much the model can hold at once, in tokens. It starts at 128000, and the context gauge in your sessions reads it.
7. Optionally, add both prices, in and out, in dollars per million tokens. One without the other won't save. Without them, the session cost panel shows this endpoint's calls as "unpriced" rather than pretending they cost $0.00.
8. Click **Save endpoint**.

If the server can't be reached, you'll see "Could not reach it:" and the reason.

## Switch the default model

1. Open **Models**.
2. Under **Default model**, open the menu and pick a model.
3. New sessions start with it.

## During a session

A session uses the model chosen here unless its workspace or the session itself picks another. Thinking effort has no workspace setting: only the session's top bar overrides it.

If no model is chosen anywhere, the app won't start the agent. It never picks one for you.

## Related

- [Connect a model](/docs/connect-a-model/): your first provider, step by step.
- [Your first session](/docs/first-session/): what happens once a model is connected.
- [System prompt](/docs/system-prompt/): what the model is told before every conversation.
