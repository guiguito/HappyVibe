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
- `?embed=1`, from the app's help links, hides the site title for the rest of the tab.
- Media: `public/media/<slug>/<shot-id>.<ext>`, referenced as `/docs/media/<slug>/<shot-id>.<ext>`.
  Until a file exists, its page holds `<!-- TODO(media): <file> — <Shows line> -->` on its own line
  where the shot goes; `markdown()` (`src/lib/pages.ts`) strips it from the agent copies. List what
  is still missing with `grep -rn "TODO(media)" docs/guide/src/content/docs/`.
  Videos use `autoplay muted loop playsinline controls`, with a WebM and an MP4 `<source>` and a
  JPG `poster`. The v1 shots:

  | Page | Shots |
  |---|---|
  | `install` | `install/install-smartscreen.png` |
  | `first-launch` | `first-launch/onboarding-setup.png` |
  | `connect-a-model`, `models` | `models/models-populated.png` |
  | `first-session` | `first-session/session-running.png` |
  | `approve-a-tool-call` | `approve-a-tool-call/permission-modal.png`, `approve-a-tool-call/permission-approve.{webm,mp4,jpg}` |
  | `permissions` | `approve-a-tool-call/permission-modal.png`, `permissions/permissions-rules.png` |
  | `memory` | `memory/memory-save-prompt.png` |
  | `built-in-tools` | `built-in-tools/builtin-tools.png` |
  | `plugins` | `plugins/plugins-marketplace.png` |
  | `mcp` | `mcp/mcp-add.{webm,mp4,jpg}` |
  | `audit-log` | `audit-log/audit-log.png` |
