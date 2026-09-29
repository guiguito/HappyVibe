# The user guide, reachable from everywhere in the app

Date: 2026-09-29 · Round follows the Docs round (`docs/prd.md` "Decision (Docs round, 2026-09-28)")
· Classification: bounded — every flow below already exists in the repo.

## Goal

The guide is deployed at `https://happyvibe.dev/docs/`. Today the only way into it from the app is
the "How this page works ↗" link at the foot of a settings screen. Add three more doors, each at a
moment someone actually needs one: the menu bar, first-run setup, and a failing model call.

## Already built — not part of this round

- **The egress exemption.** A navigation the human starts (`hv:browser-navigate`, `ipc.ts:4237`)
  reaches `browsers.navigate(id, url, "user")`, which approves the host outright (`browsers.ts:302`),
  and `decideMainFrame` clears same-host follow-ups (`browserEgress.ts:73-76`). Every door below
  goes through the same path, so `happyvibe.dev` never shows an "allow this site?" prompt and
  needs no allowlist entry. (Read from the code; the GUI pass confirms it.)
- **The opener.** `openDocs` (`App.tsx:2169`): a browser pane in the active workspace, or the system
  browser while no workspace exists. All three doors reuse it.
- **The install page.** Not linked from setup: the app is already installed by then, and that page is
  about the installer (Windows SmartScreen).

## Design

### 1. Help menu — every platform
- A **Help** menu with one item, **HappyVibe Guide**, opens the guide's front page
  (`https://happyvibe.dev/docs/?embed=1`) through `openDocs`.
- macOS keeps its menu and gains Help. Windows and Linux stop using Electron's default menu and get
  the same template: Edit, View, Window and Help, plus **File ▸ Quit** where macOS has the app menu.
- **Windows and Linux: `F1`** is the item's accelerator, so Help works while `autoHideMenuBar` keeps
  the bar hidden (Alt still reveals it). macOS: no accelerator — F1 is a hardware key there.
- The click cannot call the renderer directly: main sends `hv:open-docs` to the focused window and
  the renderer answers with `openDocs(docsIndexUrl)`. With **no window open** (possible on macOS)
  main opens the system browser itself.
- Each click opens a new pane, exactly like the per-screen links. No de-duplication.
- An accelerator is served before the renderer sees the key, and `findConflict` only knows the
  renderer's list — so `F1` is recorded beside the existing Mod-Shift-n / Mod-Shift-w note in
  `shortcuts.ts`.

### 2. First-run setup — one link
- The setup dialog gets one link, **"Read the setup guide ↗"**, to `first-launch`. It sits in the
  brand column, not the right column: that column is already at its height limit.
- It shows while setup is open and not on the celebration screen.
- It always opens the **system browser** (`window.hv.openExternal`), never `openDocs`. Setup starts
  only with no workspaces (`shouldShowOnboarding`), but the dialog stays open after a project is
  picked, and `openDocs` would then open a pane behind the modal where nobody can see it.

### 3. Model-call errors — only where a page fixes them
`describeProviderError` gains an optional `doc: { slug, anchor? }`. It is data in a module that
imports nothing, so main and renderer both keep using it, and §39's "only `kind` leaves the app"
is untouched. The error card shows **"Read the guide ↗"** beside its hint when `doc` is set.

| Kind | Link | Why that page fixes it |
|---|---|---|
| `auth` | `connect-a-model#if-the-provider-rejects-the-key` | "check the key for a typo, then paste it again" |
| `model_not_found` | `models#add-a-custom-endpoint` | step 5: **Fetch models** re-reads the server's list |
| `context_overflow` | `models#add-a-custom-endpoint` | step 6: check each model's context window |
| `balance`, `rate_limit`, `overloaded`, `server`, `network`, `other` | **none** | nothing on a page changes them |

`docUrl(slug, anchor?)` puts the anchor after the query (`…/?embed=1#anchor`).

## Out of scope
- Bundling the guide for offline use; a dedicated Docs tab (rejected/deferred by the maintainer).
- Reusing an already-open docs pane.
- A link on `balance` errors, even though `connect-a-model` ends with a paragraph about credit.

## Risks
- A slug or anchor that stops matching a real page. Pinned by a test that reads the guide's headings.
- Windows/Linux menu behaviour cannot be exercised on the maintainer's Mac. Unit scans pin the
  template; the real check goes on the manual list (`docs/validation/`).
