# WT1 — git worktrees, as measured (§29 worktrees)

Round run 2026-09-20/21 on `guiguito/worktrees`, git 2.50.1 (Apple Git-155), macOS 25.5.
Spec: Notion "Git Worktrees" `3bbd33dfffca80d5b83cdc4ab3497efc`; decisions in `docs/prd.md` §5 and §29.

Everything below was run, not reasoned about. Where a claim is a DECISION rather than a
measurement it says so.

---

## 1. What `git worktree list --porcelain` actually prints

Captured against a throwaway repo with one linked worktree (locked), one detached worktree whose
folder was then deleted, and the main checkout:

```
worktree /tmp/x/m
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
branch refs/heads/main

worktree /tmp/x/det
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
detached
prunable gitdir file points to non-existent location

worktree /tmp/x/wt
HEAD 9d40ce9b2216ab451bfab39e89ec843f48049c4e
branch refs/heads/side
locked
```

**Four of the seven keys are BARE** — `detached`, `bare`, and `locked`/`prunable` when git has no
reason to give. So splitting on a space and reading the tail turns a flag into an empty value;
`indexOf(" ") === -1` IS the flag. `locked` and `prunable` also arrive WITH a reason attached,
which we drop: the row says what it can do, and git's own message is shown when a verb refuses.

`tests/worktrees-parse.test.ts` holds the fixture and a CONTRACT arm that asserts the installed
git still speaks only keys we parse — a future git that renames `prunable` fails there rather
than as a sidebar row that silently stays clickable.

## 2. Which worktree is "the main one"

`listWorktrees` drops two entries, and the second is the non-obvious half:

- **the main checkout**, identified as the parent of `--git-common-dir` (§33's memory-key basis,
  already resolved for git's relative answer) rather than by list order;
- **the caller's own root**, so a row never lists itself.

The main drop matters because it is REACHABLE: a user can register a linked worktree as a
workspace of its own — the Orca / Claude Code shape — and discovery then runs from there. Without
it the project itself renders as a child of its own worktree.

Both drops compare realpaths: macOS answers `/private/var` to a `/var` question, so a string
compare drops nothing.

## 3. Where the app puts the ones it creates — and why not in the repo

`<agentDir>/worktrees/<workspaceMemoryKey>/<slug>`, e.g.

```
~/Library/Application Support/HappyVibe/pi-agent/worktrees/157fcbb228dbda32/feat-gui-demo
```

Measured after creating one through the dialog: the parent's `git status --porcelain` is **empty**,
and nothing named `worktree` exists inside the repo.

**The draft put them in `<workspace>/.worktrees/` and that was reversed in the round.** The
argument for inside was "§21 path confinement for free", but P1 needs `roots()` to admit the
worktrees other tools make regardless, so inside bought nothing there. What it cost: a full second
checkout nested in the project, walked by every tool that walks the tree AND by the parent's own
agent — `grep -r` from the parent session finds `.worktrees/feat/src/foo.ts` beside `src/foo.ts`
and edits the wrong one. It also needed a `.git/info/exclude` line to stay out of `git status`;
app-data placement needs none, so that mechanism is gone with it.

Consequence recorded, not fixed: a worktree in app data is somewhere a user does not browse. Reveal
in Finder works on any root, and a user who deletes app data leaves entries git still lists, which
show as `prunable` and offer *Clean up*.

## 4. Verb availability, measured rather than assumed

**Unborn HEAD: `git worktree add -b x` SUCCEEDS.** git ≥2.42 silently creates an `--orphan` branch
sharing no history, so merging it back would be meaningless:

```
$ git init -q u && git -C u worktree add -q ../u-wt -b x
$ git -C u worktree list
…/u     0000000 [main]
…/u-wt  0000000 [x]
```

That is why *New worktree…* is a refusal there rather than a pass-through. Subdir workspaces (§5c)
are deferred, with the reason on the disabled item. `worktreeVerbs` is pure over the probe so the
tooltip and the handler's refusal are the same sentence (§20's derive-don't-retype rule).

## 5. git's refusals, verbatim

| Situation | git says |
|---|---|
| branch already checked out | `fatal: '…' is already used by worktree at '…'` |
| invalid branch name | `fatal: 'feat/new demo!' is not a valid branch name` (on line **2**) |
| dirty worktree remove | `fatal: '…' contains modified or untracked files, use --force to delete it` |
| locked worktree remove | `fatal: cannot remove a locked working tree; use 'remove -f -f' to override or unlock first` |
| merge conflict | `CONFLICT (add/add): Merge conflict in clash.txt` (on line **2**; line 1 is `Auto-merging clash.txt`) |

**Two of those put the reason on line two**, which is why `gitReason` (gitui.ts) exists and why
`split("\n")[0]` is wrong: a refused `worktree add` and a failed merge both NARRATE first. The
conflict case has no `fatal:` at all, so `CONFLICT` counts as a statement too.

A **locked** worktree is refused in git's words and gets no force path from the app: the lock was
somebody's decision, and `remove -f -f` is a thing to type deliberately.

## 6. The merge abort rule, verified in the running app

Conflicting change on the same file in both the worktree and its project, merged through the panel:

```
tree   before dd2b28cb8bb25ff6cd3318761b16a06dee6d53fc   after dd2b28cb8bb25ff6cd3318761b16a06dee6d53fc
HEAD   before 67b0793893c589b52e92f714582486d36e71a195   after 67b0793893c589b52e92f714582486d36e71a195
status after: (empty)        MERGE_HEAD after: absent        clash.txt: main's version, no markers
```

The dialog read *"Couldn't merge cleanly — nothing changed"* and named `clash.txt`. This is the
assertion that would catch a future "just leave it for them to resolve"; `tests/worktree-verbs.test.ts`
pins the same pair.

## 7. `.git/worktrees` and the watch

`git worktree add` and `git worktree remove` touch **neither HEAD nor the index**, so the existing
two-component fingerprint was blind to them and a worktree made in an outside terminal never
reached the sidebar until a restart. The fingerprint gained the mtime of `.git/worktrees`; the test
asserts HEAD is unchanged across the add, so it fails if the third component is ever "simplified"
away.

## 8. Cost of discovery

`git worktree list --porcelain`, timed from each of the eight registered workspaces on this machine:
**0.00–0.01 s each**. That is the same cost class as the branch name §29 1b already fetches per row,
which is why discovery is not gated to the active workspace the way `git status` is.

---

## Two bugs only the GUI pass could find, and one it caused

Both were invisible to 4,000+ passing tests and to three typecheck passes.

**1. A cold cache refuses real roots.** `roots()` — the admission list every fs entry point
consults — answered out of a cache that only `hv:git-status` ever filled. At boot the renderer
builds the layout's alive set from `worktree-list` BEFORE any git-status has run, so it answered
`{}`, every tab open in a worktree was pruned, and the pruned layout was then saved back over the
record. Opening the Files drawer on a worktree in that same window was refused as "Unknown
workspace". `roots()` is reached from synchronous code, so the fix is a synchronous discovery per
parent, once, on first question — the shape `gitCommonDir` already set.

**2. A conditional hook renders a blank window.** `newWorktreeRef` was declared beside the function
that uses it, which is below `ChangesPanel`'s four early returns. It typechecks, the DOM-less suite
cannot see it, and the app rendered nothing with *"Rendered more hooks than during the previous
render"*. `tests/sidebar-worktrees.test.ts` now scans the panel for hooks after the first early
return — **verified to fail on the real bug and pass once fixed** — because typescript-eslint
refuses TS 7 outright (CLAUDE.md), so `react-hooks` cannot run in this repo at all.

**3. The remove order wedged the whole app, and the fix was ordering.** `PiClient.send` has no
timeout: its promise settles only when the child answers. Removing the worktree FIRST left Pi
running with its cwd deleted, and `endSession` then asked that child for stats it could never
give — hanging the ipc handler, and behind it the renderer's `sendSync` at preload, so the app
wedged at 0% CPU behind an `-[NSAlert runModal]`. Sessions are now stopped BEFORE the folder goes
and archived only after; the stats call is bounded, which is what the "dying process" catch beside
it already intended. Same sequence after the fix: **627 ms**, session archived, app responsive.

## Amended by the first real use (2026-09-21)

Guilhem opened the app, clicked `+` on a project and looked for worktrees there. Nothing.

That is the design working as decided and the decision being wrong: until a project HAS a worktree
the sidebar says nothing about them (§20, nothing empty is drawn), so the only entry point was
Changes → the branch button → the last row of that menu. The feature was two clicks deep behind a
label that says `main`.

The project row's `+` is now a split control on a repository: click still makes a session, a caret
opens *New session / New worktree…*. Measured in the app afterwards — the caret appears on the
three registered repos and on none of the three non-repo folders, and on an unborn repo the item
opens the panel and flashes *"Save a first version before branching."* rather than doing nothing.

Two things that look like detail and are not. The request travels as the workspace PATH and is
CONSUMED by the panel, not as a nonce: the panel's `key` is the workspace, so it remounts on every
return and a nonce would re-raise the dialog each time (verified: leave the panel, come back, no
dialog). And the effect waits for `payload`, because the panel mounts INTO the request — the
sidebar sets the active root and the drawer in the same tick, so on the first render there is
nothing to branch from yet.

The general lesson, which cost nothing this time because it was caught in minutes: an altitude rule
about where words belong lost to where a person actually looks, and the person looking was the one
who locked the rule.

## Fixed in passing, adjacent to the round

The sidebar's branch line called `setDrawerPanel`, which reads `activeWs` from its closure — so
clicking the branch line of a workspace you were NOT on moved the active root and opened the drawer
on the one you just left, i.e. the panel did not appear. Predates this round; found because the
worktree clean-up path routes the same way. Both are keyed now.

## Not covered

- **Windows.** `worktree remove` with a shell holding the directory is expected to fail, which is
  why the terminal gate exists; verify on the next Windows pass. `taskkill /T` and the ConPTY rules
  are untouched by this round.
- **Merge gated by a busy parent** was exercised through the handler's refusal shape, not by
  driving a real mid-turn session in the GUI.
- **A worktree of a subdirectory workspace** (§5c) is refused, not implemented.

## The seed-once caveat, recorded rather than fixed

`git worktree remove --force*` joins the shipped ask rules beside `git clean*`, but
`seedDefaultGitRules` returns early when already seeded — so **existing installs do not receive
it**. Re-seeding would resurrect rules the user deleted, which is the "policy wearing a hat" the
file's own comment forbids. New installs get it; `bash` is not safe-default, so every git command
still asks until someone adds `git *` as an allow.
