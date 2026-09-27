---
paths:
  - "electron-builder.yml"
  - "build/afterPack*.mjs"
  - "scripts/{release-mac,changelog-entry}.mjs"
  - ".github/workflows/release.yml"
  - "src/main/update/**"
  - "src/renderer/src/components/{UpdateRow,updateCopy,ChangelogView}.*"
  - "CHANGELOG.md"
  - ".claude/commands/{release,ship}.md"
  - "tests/{changelog,update}*.test.ts"
---
# Shipping (§38) and the updater

- `/ship` pushes `main` and the tag BY NAME: `/release` makes a LIGHTWEIGHT tag and `--follow-tags`
  pushes only annotated ones, so `main` would go up alone and the release workflow would never start.
- The tag fires `.github/workflows/release.yml`: a first job creates ONE draft (so the builds can't
  race to create two), then Windows + Linux build into it. `/ship` then runs `npm run release:mac` on
  the Mac holding the Developer ID Application cert and the `happyvibe` notarytool profile — no Apple
  secret is in GitHub, by decision. Then a human presses Publish; a draft is invisible to running apps.
- `electron-builder.yml` keeps `identity: null`, so a laptop build stays ad-hoc. `release:mac`
  overrides it on the CLI and sets `HV_MAC_IDENTITY`, which makes afterPack sign the pi-runtime
  binaries — `--deep` never reaches `Resources/`, and electron-builder signs AFTER our hook.
- Updater (`src/main/update/`): `state.ts` is pure and import-free (the renderer imports its types);
  `index.ts` is Electron-only and never imported by `ipc.ts` — `registerIpc` RETURNS the live facts
  the restart gate needs and `index.ts` hands them over. Off in dev; `HV_UPDATE_FAKE=ready:0.3.0`
  (or `available:` / `downloading:`) shows the row for a GUI pass. The restart gate counts retained
  prompts even when every session reads idle.
- Windows installer and signing: `windows.md`. Manual release gates: `docs/validation/up1.md`.
