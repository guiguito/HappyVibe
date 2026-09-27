---
title: Connect a model
description: Give the agent a model to think with, by signing in with a plan, running one on your computer, or pasting an API key.
---

The model is the agent's brain, and you pick who it talks to. A plan you already pay for, a model on your own computer, or an API key all work. You can do this in the setup window on [first launch](/docs/first-launch/), or any time on the [Models](/docs/models/) page.

Choose one of the three ways below. One is enough to start, and you can add the others later.

## Sign in with a plan

Use a subscription you already have, such as **Claude** or **ChatGPT (Codex)**. The list comes from what the app can actually sign in to.

:::caution
The app says it plainly beside Claude: "Heads up: on Claude Pro/Max this uses your plan's extra usage."
:::

1. In the setup window, click **Sign in with a plan**, then the provider's button. On the Models page, click **Sign in** on the provider's row.
2. A dialog opens, titled "Sign in with" and the provider's name. It tells you: "HappyVibe never sees your password — the provider does the sign-in."
3. Your browser opens on the provider's sign-in page. The dialog reads "Your browser should have opened. Finish signing in there — this window updates automatically." If the browser didn't open, or you closed the tab, click **Open browser**, or **Copy** the address shown under it.
4. Some providers ask for one more thing in the dialog:
   - a code to type on their site: "Enter this code at the provider:", with **Copy** beside it;
   - a code to paste back from their site, into the box, then **OK**;
   - a choice between options, as buttons.
5. When it works, the dialog says "You're signed in." Click **Done**.

You can click **Cancel** at any point before the end. If something goes wrong, the dialog says "Sign-in didn't finish." and shows the reason. Click **Done** and try again.

## Use a model on your computer

HappyVibe looks for Ollama, LM Studio and llama.cpp running on your computer. No key, no account.

1. Start your local runner and make sure it has at least one model.
2. In the setup window, click **Free, on this computer**, then the button that names it, like **Use Ollama — found on this computer**.

The **Free, on this computer** choice only appears when HappyVibe finds a runner holding at least one model, because a runner with no models has nothing to answer with.

On the Models page, a runner it finds shows as "running". If Ollama isn't found, the page says "Install from ollama.com and pull a model — HappyVibe picks it up automatically." Click **Check again** once it's running.

## Paste an API key

1. In the setup window, click **Paste an API key**. On the Models page, find the provider's card under **Cloud API keys**, or search for it in the box under those cards.
2. In the setup window, pick the provider from **Choose a provider**. Popular ones come first, and you can search.
3. Paste your key into the field.
4. Click **Save key** in the setup window, or **Save** on the Models page.

"Keys are encrypted with your OS keychain."

### If the provider rejects the key

When you save, HappyVibe asks the provider whether it accepts the key. The key is saved either way, and the app tells you what the provider said:

- **Rejected:** on the Models page, a red line reads "Saved, but" the provider's name, "rejected this key", and the provider's reason in brackets. In the setup window, the provider's reason appears in red under **Connect a model**. Check the key for a typo, then paste it again to replace it.
- **Couldn't check:** some providers can't be asked. You see "Saved. We couldn't verify this key here." on the Models page, or "Saved — couldn't verify this key." in the setup window. That doesn't mean the key is wrong.

A key the provider accepts proves the key is right, not that the account has credit. If your first message fails, check your balance with the provider.

## Check what's connected

The top of the Models page lists everything you've connected, each with a tag: "signed in", "running" or "key saved". Below it, under **Default model**, you pick the model new sessions use, unless a workspace or session picks its own.

<!-- TODO(media): models/models-populated.png — Providers with rows tagged "signed in", "running" and "key saved"; Default model with the Thinking effort pills -->

## Next

The brain is in. Time to give it something to do: [Your first session](/docs/first-session/).
