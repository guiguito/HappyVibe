---
paths:
  - "src/renderer/src/{tabs,layoutPersist,watchTargets,paneGrid,uiStore}.ts"
  - "tests/{tabs,layout-persist,pane-dividers,watch-targets}.test.ts"
---
# Tabs and layout

- `allFiles` (tabs.ts) means "not a chat, not a terminal, not a browser" — never loosen it. It feeds
  the mounted `FileTab` list, the fs watch targets (`watchTargets.ts`) and the open-files block
  injected into the agent's context. A new tab prefix must be excluded in the SAME commit.
- Every tab prefix must be pruned on layout restore (`AliveSubjects`, `layoutPersist.ts`), or it comes
  back as a ghost tab. Browser panes never survive the app, so restored `:browser:` tabs are pruned.
- The centre layout persists in `config.json` `layout`, validated and pruned by `layoutPersist.ts`
  (main never learns what a tab is). `activeWs` persists in localStorage beside
  `hv:sidebar-collapsed` — without it the layout restores and the app still shows WELCOME.
- `resolveCardPath` is the single answer to "is this a file of ours"; a URL returns null.
