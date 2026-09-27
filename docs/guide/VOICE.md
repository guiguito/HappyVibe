# Docs voice guide

> Mirror of the Notion page "Docs voice guide" (under Documentation). Edit Notion first, then this
> file, in the same change. `.claude/agents/docs-reviewer.md` checks every page against this file.

## Who reads
People using HappyVibe or trying it out. Not contributors: `CONTRIBUTING.md` covers them.

## Personality
HappyVibe is a friendly workshop, and the guide is the mentor at your elbow, not the manual in the
drawer. It's warm, playful and clear, and never childish (PRD §20: "simple; warm; clear; modern;
friendly; not childish; transparent; low intimidation"). The reader is often a little nervous about
letting an AI touch their code. Every page leaves them calmer and more in charge than it found them.

- **Playful where it's safe:** page intros, empty moments and **Next** links may smile ("Ready when
  you are." is the app's own register). Numbered steps, warnings and anything about permissions,
  keys or cost stay plain: that's where trust is earned.
- **Reassure where a beginner would worry:** say what's safe, what waits for you, and what can be
  undone. "Nothing runs until you click **Allow**." "You can switch it off later."
- **Explain, don't hide:** the promise is that you understand what you and the agent are doing. Keep
  jargon out, but when how it works IS the point (the context window, what a token costs, why a
  call asks first), explain it in one plain sentence. Define a term the first time a page uses it.
- **No hype, no jokes about risk:** at most one exclamation mark per page, and no emoji the app
  doesn't show itself.

| Flat | HappyVibe |
|---|---|
| The Permissions screen configures tool-call rules. | You decide what the agent may do on its own. Everything else waits for your click. |
| Memory persists user preferences across sessions. | Tell the agent something once, and it remembers next time. It asks before it saves anything. |
| Configure a provider to enable sessions. | Pick who the agent talks to. A plan you already pay for, a model on your own computer, or an API key all work. |

## Voice
- Talk to the reader as "you", in the present tense, in short sentences.
- Say what the reader sees and what to do next. Explain; don't pitch.
- Name on-screen controls exactly as the app shows them, in bold: **Add rule**. Quote the app's own
  sentences in quotation marks, character for character.
- Steps are numbered lists. Options are bulleted lists. One idea per paragraph.
- Describe behaviour before mechanism: "nothing loads until you say yes", not "deny-by-default".
  When the mechanism matters to understanding, add it after, in plain words.

## Words
| Say | Not | Why |
|---|---|---|
| you can see what it does | transparency, observability | Mechanism words. Users buy outcomes. |
| nothing loads until you say yes | per-resource consent, deny-by-default | Same fact, no jargon. |
| already set up | batteries included, all-in-one | Everyone claims it; the plain version sounds true. |
| experience | XP | Reads as gamer shorthand. |
| *(nothing)* | the most complete / most open / most balanced | Superlatives are checkable losses. |

Never write: scrape, crawl, notarized, signed, "unlike other tools", any superlative, or "secure".
The narrow true claim is "the app writes the approval dialog, never the model". "Sandbox" appears
only as "It is not a sandbox", when answering whether HappyVibe is secure.

- **Install:** describe what the reader sees (the SmartScreen warning, **More info** → **Run
  anyway**), never the certificate behind it.
- **Counts:** never as a selling point. "Three choices" on a screen is description; totals of
  plugins, servers, providers or models are not.
- **Pi:** only where the app's own UI names it.
- **Open source:** not until the pitch page says it.
- **Pitch copy:** may be quoted, never rewritten.

## Page template
Reference pages, in this order:
1. What the screen is for, in one sentence. The screen's own intro may be quoted.
2. **Where to find it:** the sidebar group, then the screen.
3. **What's on the screen:** section by section, in screen order.
4. How to do the two to four things people come for, each as numbered steps.
5. **During a session:** where the feature shows up while the agent works.
6. **Related:** links to neighbouring pages.

Get started pages: one numbered path from start to done, then a **Next** link.

## Frontmatter
- `title`: a reference page's title is its screen's sidebar label, exactly.
- `description`: one sentence, under 160 characters, saying what the page helps you do.

## Media
Only the v1 shots listed in `.claude/rules/docs.md`. Alt text is the shot's "Shows" line from the
spec, written as a sentence. Until a shot's file exists, the page holds a placeholder where the shot
will go, on its own line: `<!-- TODO(media): <slug>/<shot-id> — <the Shows line> -->`. It renders
nothing and is stripped from the Markdown copies.
