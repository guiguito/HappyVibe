# The user guide, inside the app

Date: 2026-09-29 · Follows the Docs round (`docs/prd.md` "Decision (Docs round, 2026-09-28)")
· Classification: bounded — every flow below already exists in the repo.

## Goal

The guide is deployed at `https://happyvibe.dev/docs/`. Until now the only way in from the app was
a "How this page works ↗" link that opened a browser pane. Make the guide a page of the app itself,
reachable from the settings list, the menu bar, first-run setup and a failing model call.

## Design

### 1. A **User guide** page, under The record
- A row **User guide** sits below the last settings group (The record: Stats, Audit log, Changelog).
  It is a sidebar destination **outside `NAV`**, like Schedules, so the guide needs no page about
  itself and the guide's sidebar-mirrors-the-app test is untouched.
- Its view takes the **whole window**: the app's own sidebar is hidden while it is open (the guide has
  a left column of its own; two read as one too many). It is hidden with CSS, not unmounted, so its
  open groups, scroll and dialogs are there after you close the guide. The page is the guide itself, an
  `<iframe>` with the site's own **HappyVibe header** (no `?embed=1`, which hid it), and no bar of our
  own — only one **large circled ✕** at the top right, which returns to the main chat screen. **Esc** closes it too, including with focus inside the frame (main forwards the key via `before-input-event`; the view acts on it only when the frame holds focus, and a dialog that already used the key wins).
- **An iframe, not a browser pane, on purpose.** A pane is a native `WebContentsView`; nothing in
  the DOM paints above it (`.claude/rules/renderer-layers.md`), so a permission prompt or dialog
  would hide behind it. An iframe is plain DOM.
- The renderer CSP gains exactly one directive: `frame-src https://happyvibe.dev`. The site sends
  no `X-Frame-Options` and no `frame-ancestors` (checked with `curl -I`), so framing works today.
- The frame is sandboxed with `allow-scripts allow-same-origin` (the guide's search needs both).
  The preload API is not exposed to a cross-origin frame.
- **Leaving the guide.** A link in the guide to another site would navigate the frame away, and the
  CSP would show a blank frame. Main catches it (`will-frame-navigate`): when the frame is showing the
  guide and the target is not, http(s)/mailto open in the system browser and anything else is
  blocked. Frames not showing the guide (the editor's sandboxed HTML preview) are never touched.
- Offline, the frame is blank; the ✕ is the way out. No error detection, and no separate "open in browser" button.
- Clicking the row again shows the page you were last on, like a tab.

### 2. Every other door converges on it
`openDocs(url)` stops opening browser panes: it sets the guide's address and shows the **User guide**
page. So all of these now land in the app, at the right page:
- the per-screen **How this page works ↗** link (`DocsLink`);
- **Help ▸ HappyVibe Guide** — a Help menu on every platform. Windows and Linux stop using
  Electron's default menu and get the same template: Edit, View, Window and Help, plus
  **File ▸ Quit** where macOS has the app menu. **`F1`** is the item's accelerator on Windows and
  Linux only (the bar stays hidden until Alt; on macOS F1 is a hardware key). With no window open
  (possible on macOS) main opens the system browser instead;
- **Read the guide ↗** on a model-call error card, only where a page fixes it:

| Kind | Link | Why that page fixes it |
|---|---|---|
| `auth` | `connect-a-model#if-the-provider-rejects-the-key` | "check the key for a typo, then paste it again" |
| `model_not_found` | `models#add-a-custom-endpoint` | step 5: **Fetch models** re-reads the server's list |
| `context_overflow` | `models#add-a-custom-endpoint` | step 6: check each model's context window |
| `balance`, `rate_limit`, `overloaded`, `server`, `network`, `other` | **none** | nothing on a page changes them |

The view needs no workspace, so the old "no workspace" fallback goes away. One fallback remains:
while no model is connected the app is locked to Models (`needsSetup`, and the sidebar won't
navigate), so the page could not show — the guide opens in the system browser then.

### 3. First-run setup keeps the system browser
The setup dialog gets one link, **Read the setup guide ↗** (to `first-launch`), in the brand column.
It calls `window.hv.openExternal` and never `openDocs`: setup is a modal, and a page opened behind
it would be invisible. It shows while setup is open and not on the celebration screen.

## Already true — not part of this round
- The browser pane's egress gate is not involved any more (no pane). It had already approved the
  host of a user-started navigation (`browsers.ts:302`).
- The install page is not linked from setup: the app is already installed by then.

## Out of scope
- Bundling the guide for offline use; a link on `balance` errors; a native `WebContentsView` guide.

## Risks
- A slug or anchor that stops matching a real page — pinned by a test that reads the guide's headings.
- The CSP is security-relevant: pinned by a test that allows exactly `https://happyvibe.dev` and
  nothing wider.
- Windows/Linux menu behaviour cannot be exercised on the maintainer's Mac; unit scans pin the template
  and the real check goes on the manual list.
