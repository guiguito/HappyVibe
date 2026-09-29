---
paths:
  - "docs/guide/**"
  - "src/renderer/src/theme.css"
  - "src/renderer/src/docsLinks.ts"
  - "src/renderer/src/components/DocsLink.tsx"
  - "tests/docs-*.test.ts"
---
# User guide (`docs/guide/`)

- Astro Starlight, its own npm project: `cd docs/guide && npm install`, then `npm run dev`
  (http://localhost:4321/docs/) or `npm run build`, which builds and then runs
  `scripts/check-build.mjs` against the output.
- Publish: `npm run publish:site` copies the build into the website repo's `public/docs/`
  (`WEBSITE_REPO`, default the sibling checkout). Deploy from the website repo with
  `firebase deploy --only hosting`.
- One page per sidebar screen. Its flat URL is the screen's label in kebab case (`docsLinks.ts`,
  pinned by `tests/docs-links.test.ts` and `tests/docs-structure.test.ts`), and its `title` is the
  label exactly.
- A change to a screen's behaviour or copy updates its page in the same commit.
- Every fact comes from the code. Quoted UI strings match the code character for character. Voice:
  `docs/guide/VOICE.md`, a mirror of the Notion "Docs voice guide" — edit Notion first.
- Before finishing any page change, run the `docs-reviewer` agent on it and fix every finding.
- Tokens come from `src/renderer/src/theme.css` (`@theme static`, so every token reaches the guide's
  CSS). Never write a colour value into `docs.css`; map Starlight's `--sl-*` variables onto the app's.
- Light only (`ThemeProvider` and `ThemeSelect` are overridden). Links are ink with a tangerine
  underline because tangerine-deep text is 4.3:1 on paper, under AA.
- `?embed=1` hides the site title for the rest of the tab. The app no longer sends it: the in-app guide
  keeps the HappyVibe header. The site still honours it.
- In the app the guide is the **User guide** page (`GuideView.tsx`): an iframe of the deployed site, a
  settings row below the last group (outside `NAV`, so no guide page about itself). While it is open the
  app's sidebar is hidden (CSS, not unmounted) so the guide's own left column is the only one. Every link goes
  through `openDocs` in `App.tsx`; only "no model connected yet" and the setup dialog use the system
  browser. An iframe on purpose — a browser pane is a native view that paints above prompts. The
  renderer CSP allows exactly `frame-src https://happyvibe.dev`. The CSP blocks a cross-origin frame
  navigation before main can see it (no `will-frame-navigate`), so main injects `guideLinkScript`
  (`navGuard.ts`) into the guide's frame on load: it turns a click on an outside link into
  `window.open`, which the popup handler sends to the system browser (web and mail schemes only).
- Media: `public/media/<slug>/<shot-id>.<ext>`, referenced as `/docs/media/<slug>/<shot-id>.<ext>`.
  Until a file exists, its page holds `<!-- TODO(media): <file> — <Shows line> -->` on its own line
  where the shot goes; `markdown()` (`src/lib/pages.ts`) strips it from the agent copies. List what
  is still missing with `grep -rn "TODO(media)" docs/guide/src/content/docs/`.
  Videos use `autoplay muted loop playsinline controls`, with a WebM and an MP4 `<source>` and a
  JPG `poster`. The v1 shots:

  | Shot (under `media/`) | Pages | Shows (the alt text, and the placeholder's text) |
  |---|---|---|
  | `install/install-smartscreen.png` | `install` | Windows SmartScreen after clicking More info, with Run anyway visible |
  | `first-launch/onboarding-setup.png` | `first-launch` | The Setup step: step 1 "Connect a model" with its three choices, step 2 "Pick a project" |
  | `models/models-populated.png` | `connect-a-model`, `models` | Providers with rows tagged "signed in", "running" and "key saved"; Default model with the Thinking effort pills |
  | `first-session/session-running.png` | `first-session` | A turn in progress: tool cards editing a file and running a command, the composer reading "Steer the agent — lands between tool calls…", the Stop button |
  | `approve-a-tool-call/permission-modal.png` | `approve-a-tool-call`, `permissions` | "The agent wants to run something" with all five buttons: Allow, Allow for session, Allow for workspace, Always allow, Deny |
  | `approve-a-tool-call/permission-approve.{webm,mp4,jpg}` | `approve-a-tool-call` | Ask to create hello.txt, the dialog appears, click Allow, and the card turns done with its approval mark |
  | `memory/memory-save-prompt.png` | `memory` | In a session, the approval dialog for saving a memory, with the memory and what changes |
  | `built-in-tools/builtin-tools.png` | `built-in-tools` | The Built-in tools list with its toggles, and Plan mode expanded to show its read-only prompt |
  | `plugins/plugins-marketplace.png` | `plugins` | The Marketplace: search box, category chips and the card grid |
  | `mcp/mcp-add.{webm,mp4,jpg}` | `mcp` | Pick Playwright, Add, and it connects: "Connected to Playwright" with the number of tools discovered |
  | `permissions/permissions-rules.png` | `permissions` | The rule list mixing allow, ask and deny, with the test box |
  | `audit-log/audit-log.png` | `audit-log` | Permission decisions including denials, with the filters visible |
  | `workspaces-and-sessions/sidebar-workspaces.png` | `workspaces-and-sessions` | The sidebar with two workspaces and their sessions, showing the working, plan-mode and sleeping marks, with the + menu open on New session |
  | `session-view/session-view.png` | `session-view` | A session with its top bar (model, thinking effort, cost, context gauge), a second tab in a split pane, and the message box |
  | `files-and-changes/changes-panel.png` | `files-and-changes` | The Changes panel with its changed files, one diff open and a drafted commit message |
  | `schedules/schedules-list.png` | `schedules` | The Schedules screen with two schedules and a recent run |

  A video's placeholder names it without an extension (`mcp/mcp-add`).
