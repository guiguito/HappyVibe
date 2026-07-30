---
description: Bootstrap a fresh worktree (both installs) and print the debug-bridge launch line
---

Make this worktree runnable. Report a short checklist, one line per item.

### 1. Both installs — this is the #1 fresh-worktree failure
`pi-runtime/` is a separate vendored tree with its own lockfile. Missing either install
produces `Error: Electron uninstall` at `getElectronPath (…electron-vite…)`, or live tests
that fail for no visible reason.

- `node_modules/` missing or `electron` absent from it → `npm install`
- `pi-runtime/node_modules/` missing → `(cd pi-runtime && npm ci)`

Run only what's actually missing. Don't reinstall a healthy tree.

### 2. Live-test capability
Does `.env` exist and contain `DEEPSEEK_API_KEY`? Say yes/no plainly. If no, list the live-Pi
test files that will silently skip (they are `skipIf`-gated — a skip is not a pass), and note
that `.env` is gitignored so it does not travel between worktrees.

### 3. Orphan processes
`pgrep -fl "pi --mode rpc"` and any stray `Electron`/`electron-vite` from a previous run.
Report PIDs; do not kill anything without asking.

### 4. Print the launch lines
Always end with these, verbatim, for me to run myself:

```
npm run dev                          # normal
HV_DEBUG_PORT=9222 npm run dev       # with the CDP debug bridge (then: /uicheck)
```

`HV_DEBUG_PORT` is read in `src/main/index.ts` and is inert when unset.

Do not launch the app yourself — `electron-debug`'s `start_app` has hung for 30 minutes here.
I launch it; you attach.
