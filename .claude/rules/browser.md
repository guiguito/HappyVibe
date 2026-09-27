---
paths:
  - "src/main/{browsers,browserEgress,browserPicker,agentBrowsers}.ts"
  - "pi-runtime/extensions/hv-browser.ts"
  - "src/renderer/src/{browserCoverage,browserError}.ts"
  - "src/renderer/src/components/BrowserTab.tsx"
  - "tests/browser*.test.ts"
---
# Embedded browser (§28)

- **The egress gate is on the PARTITION, not the tool call** — one `location.href` from injected JS
  bypasses tool gating. Enforcement is
  `session.fromPartition("persist:hv-browser").webRequest.onBeforeRequest` (`browsers.ts`), deciding
  through the pure `EgressState` (`browserEgress.ts`).
- Main-frame navigations gate as the virtual rule `browser:<host>` (no new rule machinery).
  Subresources of an allowed page run silently but are recorded for `browser_read_network`.
  Redirects inherit the approval that started them (or every IdP bounce breaks).
- Electron REPLACES `onBeforeRequest` rather than stacking it: install ONCE per partition with a
  `webContents.id → pane` map.
- `localhost` is an exact-hostname safe default — `localhost.evil.com` is a real remote host.
- A gate-cancelled main frame reports `ERR_BLOCKED_BY_CLIENT (-20)`, not `ERR_ABORTED (-3)`.
  `did-fail-load` skips both AND re-checks `state === "blocked"`.
- Honest limit: in-page `fetch` reaches anything the page can. The claim is "only NAVIGATES where you
  allow"; `browser_evaluate` carries its own stricter rule.
- The guest has NO preload (the agent drives from main, outside the sandbox); the element picker is
  injected via `executeJavaScript`.
- The pane has its own cookie jar — the user isn't signed in there.
- `browser_screenshot` hands the PNG to the model only if the session model advertises
  `input: ["image"]` in Pi's registry (resolved in ipc.ts off `resolveSpawnModel`, never a second
  capability table); otherwise a text result points at `browser_get_text`. The user sees the
  screenshot either way (`hv.browser` notify).
- A browser URL rides the tool card's `path` slot; `resolveCardPath` (tabs.ts) returns null for any
  `scheme://`, or the chip offers to open a web page in the code editor.
- Keeping the pane visible under DOM overlays: `renderer-layers.md`.
