---
paths:
  - "src/renderer/src/**/*.tsx"
  - "src/renderer/src/{browserCoverage,paneDialog,paneGrid}.ts"
  - "src/renderer/src/styles.css"
  - "tests/{browser-coverage,modal-layer,pane-dialog,pane-dividers,tabstrip-menu,star-nudge}.test.ts"
---
# Renderer layers: browser panes, overlays, z-index, menus

## A browser pane is a `WebContentsView` — nothing in the DOM paints above it
- It composites over the whole renderer, so hiding it IS the z-order. `paneIsCovered`
  (`browserCoverage.ts`) decides by RECTANGLE. Candidates are every element with `absolute` or `fixed`
  as a literal class word (`[class~="absolute"]`) — no marker list to remember, because this app is
  all Tailwind. `data-covered` on the placeholder exposes the live decision.
- The check is coalesced and races rAF with a 200 ms timer — rAF pauses while the window is occluded.
- A candidate is judged by its BOX: a positioned wrapper that centres small content in a full-width
  box blanks the page. Shrink the box; never loosen the check. The check has no false positives —
  when a pane goes blank, find the overlapping `absolute`/`fixed` rectangle (e.g. pane dividers are
  one strip per sub-split half, `crossDividerSpans` in tabs.ts, not one strip across the grid).
- Never put a `fixed inset-0` click-catcher or positioner near a browser — it reads as covering
  every pane.
- The drawer is the one overlay a pane makes ROOM for: `paneViewRect` insets the view to end where
  the drawer begins. Inset and coverage must use the same rect (`effectiveRect`). The view also
  insets by `DIVIDER_INSET` on sides touching another pane so the divider stays grabbable.
- The star nudge (`StarNudge.tsx`, `fixed bottom-6 right-6 w-[340px]`, z-40) deliberately accepts
  blanking a pane in its corner while it shows. If that grates: skip it when a `:browser:` tab is
  mounted — never loosen the coverage check.

## z-index
- `.hv-overlay`/`.hv-dialog` are `z-index: 100`; the app's own scale tops out at z-50. Portalling to
  `<body>` doesn't put anything on top — an explicit z-index beats document order. Anything that must
  sit above a dialog has to BE a dialog. `tests/modal-layer.test.ts` fails on anything else reaching 100.
- Session prompts (permission, ask_user) add `.hv-prompt` (z-index 110, the constants in `paneDialog.ts`)
  so they sit above every dialog: a prompt never times out, and a covered one deadlocks
  (seen with the AGENTS.md draft). Nothing else may use it.
- A session dialog (permission, ask_user) portalled into a pane falls back to the viewport when that
  pane is hidden (`dialogHost`, `paneDialog.ts`: null for `offsetParent === null` or a zero rect) —
  prompts never time out, so an invisible one waits forever. The pane wrapper needs `relative`.

## Menus
- A menu dismissed by `onBlur` loses its own clicks: pressing a `<button>` doesn't focus it, so the
  menu unmounts between mousedown and mouseup. Items act on `onMouseDown` + `preventDefault()`
  (`TabStrip.tsx` `NewTabButton`, `tests/tabstrip-menu.test.ts`). Other menus use a `fixed inset-0`
  click-catcher, which closes on click and is immune. A synthetic `.click()` never reproduces this —
  test with real CDP input.

## Tailwind
- The JIT scanner never sees a computed class name — dynamic colours go in an inline `style`.
