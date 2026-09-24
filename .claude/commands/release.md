---
description: Cut a release — gate, write the user-facing changelog entry, bump, tag. Stops before pushing.
argument-hint: <patch|minor|major> (empty = read the log and propose one)
---

Cut a HappyVibe release: **$ARGUMENTS**

The convention this implements is PRD **§30** and the `## Releasing` block in `CLAUDE.md`. Read
neither — everything you need is below, on purpose, so the rules cannot drift from the command that
applies them.

**Six phases, in order. Do not skip ahead, and do not push anything.**

---

### 1. Gate — refuse to release red

```
npm run gate          # build (both typechecks) + the non-live suite
npm run live:why      # prints the Pi-facing files changed since main
```

If `live:why` prints anything, `npm run test:live` too (~6 min — background it and wait; do not
edit the tree while it runs). **Any red stops the release.** Report the failure and stop; do not
work around it, and do not release "with one known failure".

Also confirm the tree is clean and you are on `main` with `main` up to date.

### 2. Read what actually changed

```
git log --no-merges --format='- %s' $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD
git diff --stat $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD -- src/renderer
```

The first is the raw material. The second tells you which **surfaces** moved, which is what the
entry is actually about — a 400-line change under `src/main` that no user can see gets no line, and
a 6-line change to `Sidebar.tsx` might get two.

Check `pi-runtime/package.json` for the current pins while you are here.

### 3. Write the entry — this is the whole job

**Use the `changelog` skill** (`.claude/skills/changelog/SKILL.md`). It owns the triage procedure,
the seven voice rules and the mechanical checks, and it is the only place they live — so they
cannot drift from the command that applies them. It writes into `## [Unreleased]` and deliberately
does not touch the version, the heading or the date; those are phase 5.

Come back here when it reports its `check` pass.

### 4. Pick the bump, and say why in one line

- **PATCH** — fixes and polish only. Nothing new to learn, nothing already set up changes.
- **MINOR** — anything new the user can see or do: a page, a tool, a provider, a setting. The
  normal release. **Pre-1.0 this also absorbs the MAJOR class**, which is what the **Heads up**
  block is for.
- **MAJOR** — post-1.0 only: the user has to do something.

A runtime pin bump is **not** its own axis: MINOR if the user sees it (new builtin agents, a new
provider, a new tool), PATCH if not.

If `$ARGUMENTS` named a bump, sanity-check it against what you just read and **say so if you
disagree** — then follow the user's call.

### 5. Stamp

- Rename `## [Unreleased]` → `## [x.y.z] — YYYY-MM-DD` (today's real date). Do **not** leave an
  empty `## [Unreleased]` behind — an empty heading is the first thing a reader hits on the page,
  and the next entry creates its own.
- `npm version <bump> --no-git-tag-version` — this is the only thing that writes a version number.
- Verify the invariant by eye: the top released heading equals `package.json`'s `version`.
- Commit `chore(release): x.y.z` (CHANGELOG.md + package.json + package-lock.json only).
- `git tag vx.y.z` — **do not skip this even though nothing enforces it.** `changelog.sh digest`
  finds the previous release by tag; without one the next release replays the whole history.

### 6. Stop

**Hand the entry back as written** and stop. Do not `git push`, do not push the tag, do not create
a GitHub Release, do not build a `.dmg`. The user reads the notes first — they are the one surface
of this release that every user will see, and they are the point of the whole exercise.

Then tell the user the three steps that follow (PRD §38), and do none of them yourself:

1. `git push --follow-tags` — CI builds Windows and Linux into a **draft** release, notes = this entry.
2. `GH_TOKEN=$(gh auth token) npm run release:mac` — on their Mac: signs, notarizes and uploads
   the macOS build into the same draft (the Developer ID never leaves that keychain, PRD §4).
3. Read the draft on GitHub and press **Publish** — the only step that makes it live for every
   running app.

---

### Notes

- **Nothing here is automated on purpose** — the reasoning lives in the `changelog` skill and in
  PRD §30. Do not add a generator to this command.
- If `package.json` still says `"name": "hv-scaffold"` or `"author": "example.com"`, stop and raise
  it — those are electron-vite placeholders and they ship in the built artifact.
