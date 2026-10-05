---
title: Connect a model
description: Give the agent a model to think with, by signing in with a plan, running one on your computer, or pasting an API key.
---

Every agent needs a brain, and this is where it gets one. It's step 3 of 5: the model does the thinking; HappyVibe gives it hands, and you decide what it may touch. Connect it in the setup window on [first launch](/docs/first-launch/), or any time on the [Models](/docs/models/) page.

Already connected one in the setup window? You're set. Skip to [Your first session](/docs/first-session/).

Otherwise, choose one of the three ways below. One is enough to start, and you can add the others later.

## Open the provider list on the Models page

In the setup window, the three choices are right there. On the Models page, they're there too until you've connected something. After that, the page lists what you've connected, and the choices hide behind a button:

1. Open **Models** in the sidebar.
2. If you see **+ Add provider**, click it.

## Sign in with a plan

Use a subscription you already have, such as **Claude** or **ChatGPT**.

:::caution
The app says it plainly beside Claude: "Heads up: on Claude Pro/Max this uses your plan's extra usage."
:::

1. In the setup window, click **Sign in with a plan**, then the provider's button. On the Models page, click **Sign in** on the provider's row.
2. A dialog opens, titled "Sign in with" and the provider's name. It tells you: "HappyVibe never sees your password — the provider does the sign-in."
3. Usually your browser opens on the provider's sign-in page, and the dialog reads "Your browser should have opened. Finish signing in there — this window updates automatically." Some providers show their own instructions there instead. If the browser didn't open, or you closed the tab, click **Open browser**, or **Copy** the address shown under it.
4. Some providers ask for one more thing in the dialog:
   - a code to type on their site: "Enter this code at the provider:", with **Copy** beside it and a button that opens their site;
   - a code to paste back from their site, into the box, then **OK**;
   - a choice between options, as buttons.
5. When it works, the dialog says "You're signed in." Click **Done**.

You can click **Cancel** at any point before the end. If something goes wrong, the dialog says "Sign-in didn't finish." and shows the reason. Click **Done** and try again.

## Use a model on your computer

HappyVibe looks for Ollama, LM Studio and llama.cpp, free apps that run AI models on your own computer. It's free, and there's no key and no account.

1. Start your local app and make sure it has at least one model.
2. In the setup window, click **Free, on this computer**, then the button that names it, like **Use Ollama — found on this computer**.

The **Free, on this computer** choice only appears when HappyVibe finds one of these apps holding at least one model, because an app with no models has nothing to answer with.

On the Models page, an app it finds shows as "running". If Ollama isn't found, the page says "Install from ollama.com and pull a model — HappyVibe picks it up automatically." Click **Check again** once it's running.

## Paste an API key

An API key is a private code from a provider's website. It lets HappyVibe use your account there, and the provider bills that account for what the agent uses. Treat it like a password.

In the setup window:

1. Click **Paste an API key**.
2. The provider button next to the key box starts on a popular provider. Click it to pick another, from a list you can search.
3. Paste your key into the field.
4. Click **Save key**.

On the Models page:

1. Find the provider's card under **Cloud API keys**, or search for it in the box under those cards.
2. Paste your key into the field.
3. Click **Save**.

Your key is stored encrypted, using your computer's own keychain. Under each key box on the Models page, the app says so: "Keys are encrypted with your OS keychain."

### If the provider rejects the key

When you save, HappyVibe asks the provider whether it accepts the key. The key is saved either way, and the app tells you what the provider said.

If the provider rejects it:

- On the Models page, a red line starts "Saved, but" and gives the provider's name and its reason.
- In the setup window, the same red line appears under **Connect a model**, and the step stays open until a key is accepted.
- What to do: check the key for a typo, then paste it again. The new one replaces the old.

If the app couldn't check:

- On the Models page you see "Saved. We couldn't verify this key here."; in the setup window, "Saved — couldn't verify this key."
- Some providers simply can't be asked. It doesn't mean the key is wrong.

A key the provider accepts proves the key is right, not that the account has credit. If your first message fails, check your balance with the provider.

## Check what's connected

The top of the Models page lists everything you've connected, each with a tag: "signed in", "running" or "key saved". Below it, under **Default model**, you pick the model new sessions use, unless a workspace or session picks its own.

<!-- TODO(media): models/models-populated.png — Providers with rows tagged "signed in", "running" and "key saved"; Default model with the Thinking effort pills -->

## Next

The brain is in. Time to give it something to do: [Your first session](/docs/first-session/).
