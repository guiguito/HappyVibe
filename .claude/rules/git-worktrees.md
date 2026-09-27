---
paths:
  - "src/main/{git,gitForge,gitMessage,gitParse,gitRules,gitWatch,worktrees,worktreeSlug,watch}.ts"
  - "src/renderer/src/{gitui,diffs}.ts"
  - "src/renderer/src/components/{ChangesPanel,DiffView}.tsx"
  - "tests/{git,worktree}*.test.ts"
---
# Git panel (§29) and worktrees

## Diffs and undo
- The panel renders GIT's hunks. Tool cards keep the js `diff` library (`diffs.ts`) for an edit's own
  before/after, but git and that library split the same change into different hunks — so the panel
  parses git's unified output (`gitParse.ts`), feeds `hunk.raw` back verbatim to `git apply -R`, and
  runs `git apply -R --check` first (that check IS the stale check).
- Parser traps: the trailing `""` from `split("\n")` becomes a phantom context line on the LAST hunk
  (test more than `hunks[0]`); a porcelain-v2 rename line lists the NEW path first, the original after
  a tab. Fixtures in `tests/git-parse.test.ts` are captured from real git, never hand-written.

## Watching and gating
- The `.git` watch fingerprints; it can't filter by filename. Writing one object reports
  `change ".git"`, `rename "objects"` AND a false `rename "HEAD"`. `gitWatch.ts` debounces every event
  into one comparison of HEAD's contents + the index's mtime/size + the parent's `.git/worktrees`
  mtime. It exists because `watch.ts` filters `.git` (`isVisibleEntry`).
- The idle gate covers the WORKING TREE: switch, stash, sync, undo, discard and init are refused while
  any session in the workspace is busy (`activity.isIdle`), returning `{ok:false, busy:[titles]}`.
  Commit, push, fetch and stage are not gated (they never change the files under the agent). Turn end
  pushes `hv:git-changed` with `force`, because the session still reads busy at that instant.
- The probe caches a repo but re-asks a non-repo (the user may `git init` in their own terminal).
  realpath BOTH sides of a root comparison — macOS answers `/private/var` to a `/var` question.

## Open a pull request
- Opens the FORGE's prefilled form in the user's EXTERNAL browser: no token, no auth UI, no API call
  (which is why it clears the PRD's GitHub fence). Not the embedded pane — its cookie jar isn't signed in.
- `hv:git-pr-url(ws, draft)`: `false` is the eligibility probe run on every status push and must never
  read a diff or call the model; `true` is the click. Body capped at 4000 chars (GitHub answers
  `414`); Bitbucket gets no description param (none documented); an unknown host → `null` → no
  button, never a guessed URL. `tests/git-forge.test.ts`.

## Worktrees
- The app creates them in APP DATA (`<agentDir>/worktrees/<memory-key>/<slug>`), never
  `<ws>/.worktrees/` — inside the repo every tool, and the parent's own agent, would walk a second copy
  of every file.
- `worktrees.roots()` is the ONE admission list. A registered path WINS: a worktree the user added as
  its own workspace stays a project row and is deduplicated out of its parent's list. Two directions,
  never mixed: every fs entry point admits `roots()`; every CONFIG read goes through
  `worktrees.projectOf()` (a worktree grows no settings page). `tests/worktrees-roots.test.ts` scans
  ipc.ts for re-spellings, including `hv:get-workspace-model`.
- `roots()` is reached from synchronous code and must be right the FIRST time it's asked: it discovers
  per parent via `execFileSync`, once. A linked worktree's `.git` is a FILE, so `watchGitDir` returns
  early inside one; outside adds/removes reach the sidebar via the parent's `.git/worktrees` mtime.
- Removing one stops its sessions BEFORE the folder goes (`PiClient.send` has no timeout, so
  `endSession` would hang forever on a deleted cwd). Archiving waits until the remove succeeded.
  `docs/validation/wt1.md`.

## Remote test
- `tests/git-remote.test.ts` pushes to a REAL GitHub repo (`guiguito/TestHappyVibeGit`): clones to a
  temp dir, pushes only `hv-test-*` branches, deletes them in `afterAll`, and skips when that folder
  is absent — CI never runs it and the user's checkout is never touched.
