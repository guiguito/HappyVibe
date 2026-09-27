---
title: Models
description: Connect the providers the agent talks to, pick the default model, and set how hard it thinks.
---

Pick who the agent talks to. A plan you already pay for, a model running on your own computer, or an API key all work, and you can connect more than one. The screen puts it simply: "Providers the agent can talk to, and the default model."

## Where to find it

**Models**, pinned at the top of the sidebar, above the groups. **⌘,** on macOS or **Ctrl+,** on Windows and Linux opens it too (that's the default **Open Settings** shortcut, and you can change it in [Keyboard shortcuts](/docs/keyboard-shortcuts/)).

## What's on the screen

### The first-run page

Until a provider is connected, the agent has no one to talk to, so this screen greets you instead: "Welcome to HappyVibe", with "Hook up a model provider to wake the agent up. Everything stays on this machine."

On this version of the page the list of providers is already open, and the **Default model** section is hidden until you've connected something. As soon as you sign in, save a key, or click **Use Ollama**, the app takes you to your chat. The [First launch](/docs/first-launch/) and [Connect a model](/docs/connect-a-model/) pages walk through it step by step.

<!-- TODO(media): models/models-populated.png — Providers with rows tagged "signed in", "running" and "key saved"; Default model with the Thinking effort pills -->

### Providers

"Sign in with a plan, add an API key, or point at a local server."

At the top is a list of what you've already connected, one row each. The tag on the right of a row says what kind of connection it is:

- **signed in**: you signed in with a plan. The row has a **Sign out** button.
- **running**: a local server the app found on this computer (Ollama, LM Studio or llama.cpp), with the number of local models it has.
- **key saved**: an API key you saved here. The row has a **Remove** button.
- **.env**: the key comes from an environment variable on your computer, not from this screen.
- **no key**: a custom endpoint you added without a key.

With nothing connected yet, it reads "No providers configured yet — add one below."

Click **+ Add provider** to open the ways to connect, and **Hide providers** to fold them away again. They come in four groups.

### Sign in with your plan

One card per plan you can sign in with. Click **Sign in** and a window opens: "HappyVibe never sees your password — the provider does the sign-in." Your browser opens to the provider's page. Finish there, and the window updates by itself. If your browser didn't open, use **Open browser** or copy the address.

The Claude card carries a note worth reading before you click: "Heads up: on Claude Pro/Max this uses your plan's extra usage."

### Local

The app looks for Ollama on this computer by itself, with no key and nothing sent to the cloud.

- If it finds Ollama, the card shows **running** and how many models you've pulled.
- If not, it shows **not found** and "Install from ollama.com and pull a model — HappyVibe picks it up automatically." Click **Check again** once it's installed.

LM Studio and llama.cpp are found the same way: when one is running with a model loaded, it appears in your list tagged **running**.

### Cloud API keys

A card for each of the main providers, plus any provider you've already saved a key for. Each card shows how many models that provider has.

1. Paste your key into the box.
2. Click **Save**.

"Keys are encrypted with your OS keychain." After saving, the app asks the provider whether the key works. The key is saved either way, and the card tells you if something looked off:

- "Saved, but … rejected this key", with the provider's reason, means the provider refused it. Paste a fresh key to replace it.
- "Saved. We couldn't verify this key here." means the app couldn't check. The key may be fine.

To replace a key, paste the new one into the same box. To delete it, click **Remove** on its row in the list at the top.

Looking for a provider without a card? Type its name in the **More providers…** search box under the cards. The box shows nothing until you type, then one card per match, and each works exactly like the cards above.

### Custom endpoint

For a server that speaks the OpenAI API, such as one you run yourself.

1. Click **+ OpenAI-compatible endpoint**.
2. Give it a name, and paste its base URL (for example `http://localhost:8000/v1`).
3. Pick what it is: **vLLM**, **LM Studio**, **llama.cpp** or **Other**.
4. Add an API key if the server needs one. Leave it blank if it doesn't.
5. Click **Fetch models**. The app asks the server what it offers.
6. Tick the models you want. For each one, check the context window, which is how much text the model can hold at once. It starts at 128000 tokens, and the token gauge in your sessions reads it.
7. Optionally, add each model's prices in dollars per million tokens, in and out. Without them, the session cost panel shows this endpoint's calls as "unpriced" "instead of a misleading $0.00."
8. Click **Save endpoint**.

If the server can't be reached, you'll see "Could not reach it:" and the reason. Your saved endpoints are listed in this group, each with its URL and a **Remove** button.

### Default model

"Used for new sessions unless a workspace or session overrides it." Pick one from the menu. "Only models from configured providers show up."

**Thinking effort** sets how much the agent reasons before it answers: **off**, **minimal**, **low**, **medium**, **high**, **xhigh** or **max**. "More thinking costs more tokens and takes longer. A session can override this from its top bar."

**Extended prompt cache** is off by default. A prompt cache lets the provider reuse the start of your conversation at a lower price instead of reading it in full again. Normally that cache lasts five minutes. Turn this **On** and it lasts an hour on Anthropic (24 hours on OpenAI), so a session you come back to later is still cheaper. It's a trade-off: "Anthropic bills a long-lived cache write at 2× the input rate, so this wins when your turns are minutes apart and loses when you type continuously." Other providers ignore it, and it applies to new sessions.

## Switch the default model

1. Open **Models**.
2. Under **Default model**, open the menu and pick a model.
3. New sessions start with it.

## During a session

A session uses the model and thinking effort chosen here unless you change them for that session. The thinking effort can be changed from the session's top bar.

If nothing resolves to a model, the app won't start the agent. It never picks one for you.

## Related

- [Connect a model](/docs/connect-a-model/): your first provider, step by step.
- [First session](/docs/first-session/): what happens once a model is connected.
- [System prompt](/docs/system-prompt/): what the model is told before every conversation.
