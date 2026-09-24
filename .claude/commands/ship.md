---
description: Ship a release /release already cut — push the tag, wait for CI, sign + upload the Mac build, stop at the draft
argument-hint: (none — ships the version in package.json)
---

Ship the release `/release` just cut. PRD **§38**. Five phases, in order. **Stop at the first
failure and report it verbatim — never work around it, never retry blindly.**

You do everything up to a complete **draft**. You never publish: **Publish** is the one action that
makes a version live for every running app, and the human presses it after reading the notes.

---

### 1. Preflight — refuse before anything leaves the machine

```
V=$(node -p "require('./package.json').version")
git status --short                                  # must be empty
git branch --show-current                           # must be main
git tag --points-at HEAD                            # must include v$V
node scripts/changelog-entry.mjs $V                 # must print the entry /release wrote
git ls-remote --tags origin "v$V"                   # must be EMPTY — a pushed tag already shipped
gh release view "v$V" 2>&1                          # must say "release not found"
```

Any of these wrong: stop, say which, and say what fixes it (usually "run `/release` first"). Also
check `git ls-remote --tags origin v0.1.0` — if it is empty and `v0.1.0` exists locally, push it in
phase 2 too: the changelog digest finds the previous release by tag.

### 2. Push — ask first, then push the tags BY NAME

This publishes to a public repository, so **ask the user to confirm** (AskUserQuestion: "Push
main and v$V to GitHub? CI will build Windows and Linux into a draft release." — Push / Not yet).

```
git push origin main
git push origin "v$V"            # plus v0.1.0 if phase 1 found it missing
```

**Never `--follow-tags`.** `/release` makes a LIGHTWEIGHT tag and `--follow-tags` pushes only
annotated ones — `main` would go up and the tag would not, so the release workflow never starts
and nothing says why.

### 3. Wait for the Windows + Linux legs

```
sleep 15
RUN=$(gh run list --workflow Release --branch "v$V" --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status --interval 30      # ~6-8 min; Windows is the slow one
```

Red ⇒ stop. Get the real failure with `gh run view "$RUN" --log-failed` (and, if a job has no
steps, `gh api repos/guiguito/HappyVibe/check-runs/<job-id>/annotations` — that is where a
billing or runner refusal hides). One exception, stated so it is not over-used: a single Windows
**timeout** in a test that spawns Pi (`builtins-contract` has done it) may be re-run ONCE with
`gh run rerun "$RUN" --failed`; a second failure is real.

Then confirm the draft holds the two legs:

```
gh release view "v$V" --json isDraft,assets -q '.isDraft, [.assets[].name]'
```

Must be `true` and include `latest.yml`, a `*Setup.exe`, `latest-linux.yml`, an `*.AppImage` and a
`*.deb`.

### 4. The Mac leg — on this Mac

```
GH_TOKEN=$(gh auth token) npm run release:mac > /tmp/release-mac.log 2>&1; echo "EXIT=$?"
```

Run it with Bash `run_in_background: true` — build + notarization is 10-20 min — and **do not touch
the working tree while it runs** (it builds exactly what is on disk). Never pipe it to `tail`: its
exit code is the verdict. It refuses on its own if the Developer ID or the `happyvibe` notary
profile is missing and names the fix; relay that verbatim.

Then confirm the draft is complete:

```
gh release view "v$V" --json isDraft,assets -q '.isDraft, [.assets[].name]'
```

Still `true`, and now also `HappyVibe-$V-arm64.dmg`, `HappyVibe-$V-arm64-mac.zip`, its
`.blockmap`, and `latest-mac.yml`.

### 5. Stop at the draft

Report: the draft URL (`gh release view "v$V" --json url -q .url`), the asset list, and the three
CI legs' conclusions. Then hand over, in these words or close to them:

> Read the notes on the draft. When they are right, press **Publish** — that is the moment every
> running HappyVibe starts offering the update (within 4 hours, or at once from Check now).

**Do not** run `gh release edit --draft=false`, and do not publish on the user's behalf even if
asked in passing — tell them it is one button on the release page.
