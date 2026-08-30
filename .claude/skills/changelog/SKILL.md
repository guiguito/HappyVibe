---
name: changelog
description: Writes HappyVibe's CHANGELOG.md entries in the project's user-facing voice, turning a release's worth of commits into the handful of bullets a non-technical user actually needs. Use this whenever the changelog or release notes come up in any form — cutting a release, running /release, "update the changelog", "add a changelog entry", "write the release notes", "what do we tell users about this one", or reviewing and fixing an entry someone already drafted. The seven voice rules and the mechanical checks live here and nowhere else, so reach for this even when the ask sounds like a one-line edit.
---

# HappyVibe changelog entries

The changelog is the one surface every user of a release reads. It is written for §1's audience —
*AI-curious tinkerers who want to understand what the agent is doing* — not for the person who
wrote the code. The convention is PRD **§30**; this skill is the procedure.

The whole job is a compression problem. A release here is hundreds of commits and the entry is
**5–15 bullets**. Getting from one to the other is triage, not summarizing — most commits earn
nothing at all, and the ones that do are grouped, not listed. Do the triage before you write a
word, or you will produce a transcription and have to start over.

## Step 1 — see what changed

```
.claude/skills/changelog/scripts/changelog.sh digest
```

That prints the commit range, a **type × scope count table**, every `feat` and `fix` subject
grouped, the renderer files that moved, and the pins line ready to paste. Read the count table
first — the scopes with the most `feat` commits are your bullets, and the table is small enough to
hold in your head while the raw lists are not.

If a scope's intent is genuinely unclear from its subjects, read the code or the PR. You are an
agent with a repo; do not guess and do not paper over it with vague copy.

## Step 2 — triage

Three filters, in this order. They are what turns hundreds into a dozen.

**Filter 1 — types that are invisible by construction.** `docs`, `test`, `chore`, `refactor`,
`style`, `ci` change nothing the user can perceive. They earn nothing. This is not a judgement
call; skip them without reading. (`perf` and `revert` are rare and usually *are* visible — read
those.)

**Filter 2 — most fixes earn nothing, and this is the biggest lever.** A fix only earns a line if
the broken thing **was in a release the user already has**. A bug introduced and fixed inside the
same cycle never reached anyone, so telling them about it is noise that makes the real fixes
harder to find. In practice this turns ~170 fixes into two or three. Before the first release,
almost no fix qualifies at all — you cannot fix something nobody has.

**Filter 3 — one bullet per capability, not per commit.** Scope is the natural grouping key.
Nineteen `feat(subagents)` commits over six weeks are **one** bullet about what sub-agents can now
do. Ask what the user can do at the end of the release that they could not do at the start, and
write that — the sequence of steps that got there is the commit log's job.

Cross-check against the renderer files the digest lists. A scope that moved no surface is usually
plumbing; a scope you skipped that *did* move one deserves a second look.

**Sanity check before writing:** if you are holding more than ~20 bullets, filter 3 is not done.
Go back and group.

## Step 3 — write

Into the `## [Unreleased]` block at the top of `CHANGELOG.md`. Headings from
**Added · Changed · Fixed · Removed**, only the ones you need, plus **Heads up** first when it
applies.

### The seven rules

**1. Say what the user can now do, not what changed in the code.** This is the rule the other six
serve. A commit subject describes an edit; a changelog bullet describes a new ability.

> `feat(agents): per-agent on/off, with what each costs the context every turn`
> → *Turn individual sub-agents on and off, and see what each one costs your context every turn.*

> `feat(local): auto-detect LM Studio and llama.cpp beside Ollama`
> → *HappyVibe now finds Ollama, LM Studio and llama.cpp already running on your machine.*

**2. Name a surface the way the app itself names it.** Copy the `NAV` labels in `Sidebar.tsx` —
**Prompts**, **All Tools**, **On your behalf**, **Audit log**, **Stats**. §20's locked vocabulary
holds: **Prompts** never "prompt templates", **cost** never "budget", **Save a version** never
"commit". *One qualification:* where the app uses a git word as its own **label**, the label wins —
the *On your behalf* tasks are titled **Commit message** and **Pull request description**
(`TASK_COPY` in `OnBehalfView.tsx`). The rule exists so the user can find the thing; renaming a
page's own title hides it. Grep the component before paraphrasing a name.

**3. One line per change a user would notice, and nothing else.** A MINOR release is 5–15 bullets.
Past ~20, go back to filter 3.

**4. Anything touching what they already set up goes in a Heads up block, first.** It is the only
part of the entry a user is obliged to read, so it goes at the top and it names the action they
have to take — not "the permissions model changed" but what they should go and look at.

**5. Technical detail only where the user acts on it.** The `Runtime:` pins line always stays: §3's
promise is that the Pi inside is pinned and tested, so which one they got is the product. File
paths, commit scopes, PR numbers and component names never appear — the user cannot act on any of
them.

**6. No superlatives, no marketing.** Match the app's own copy: plainspoken, second person, honest
about limits. The app says *"All costs are estimates."* and *"Nothing is lost."* — write like that.
"Massively improved" and "blazing fast" are not that voice and they are not checkable.

**7. Honesty outranks polish.** If a feature has a real limit the user will hit, the bullet says so
in the same breath. *"only navigates to hosts you allow"* is better than *"secure browsing"*,
because the first is true and the second invites a complaint.

Close the entry with the pins line the digest printed.

## Step 4 — check

```
.claude/skills/changelog/scripts/changelog.sh check
```

It verifies rules 1, 3 and 5 mechanically, that the pins line is present and current, and the §30
invariant that the top released entry matches `package.json`. Rules 2, 4, 6 and 7 need your own
read — reread the entry once as a user who has never seen the repo, and cut anything you cannot
picture them caring about.

## Notes

- **Do not touch the version number or the heading.** This skill writes into `[Unreleased]`;
  stamping the version, the date and the tag is `/release`'s phase 5. Keeping them separate means
  the entry can be written, read and revised before anything is committed to a number.
- **The first release is the one exception to rule 3.** With nothing shipped, `0.1.0` describes the
  whole product, so ~20 bullets is right rather than a failure of grouping.
- **Never generate the entry from the log mechanically.** The commits here are strict
  conventional-commits and a generator would run today — that was considered and rejected in §30.
  ~100 scoped developer bullets is the wrong altitude for this audience, and it is the same
  two-altitudes call §29 makes when the Changes panel says *Save a version* while the audit log
  says `bypass`. The commit log is already the developer changelog; do not reprint it.
