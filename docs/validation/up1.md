# up1 — open-source release & updates (PRD §38)

The manual gates no unit test can cover, in the order they must happen. Fill in each **Result**
with what was measured and the date. Plan: `docs/superpowers/plans/2026-09-24-open-source-release.md`.

## Already measured (2026-09-24)

- Signing identities on the build Mac: one `Apple Development` cert. **Team ID is `4K6P6U479K` (organisation "BzApps Ltd")**, read from
  the cert's `OU` — the `(BZGBG4WG68)` in the cert NAME is the member ID, and notarytool answers
  `403 Invalid or inaccessible developer team ID` to it (measured 2026-09-24). It cannot notarize; `npm run release:mac` refuses it and names the fix.
- `machOFiles(pi-runtime/node_modules)` finds **11** Mach-O files at Pi 0.86.1 (the Remote Update
  proposal counted 15 at older pins — which is why the set is scanned, never listed).
- Git history (1,065 commits) contains no real secret; the only key-shaped strings are AWS's and
  GitHub's documented fake examples. One 8.5 MB `.tokensave` index blob sits in old history,
  harmless.
- `release:mac` preflight on this Mac with nothing set up reports all five problems in one run.

## Gates

1. **Developer ID Application cert** — Xcode → Settings → Accounts → BzApps Ltd → Manage
   Certificates → + → Developer ID Application. On an organisation team only the **Account Holder**
   can create it. `security find-identity -v -p codesigning` lists it.
   Result:
2. **Notary profile** — `xcrun notarytool store-credentials happyvibe --apple-id … --team-id
   4K6P6U479K` (omit `--password`; paste the app-specific one at the prompt); `xcrun notarytool history --keychain-profile happyvibe`
   exits 0. Result:
3. **Web box** — per-IP rate limit and a raised `maxConcurrency` on `firecrawl.bzapps.eu`, BEFORE
   the flip. Result:
4. **Repo public** — `gh repo edit guiguito/HappyVibe --visibility public
   --accept-visibility-change-consequences`; Settings → Code security → Private vulnerability
   reporting ON. CI runs again (public = free minutes). Result:
5. **First release** — `/release minor` (0.2.0) → `/ship` (pushes `main`, `v0.2.0` and the retro
   `v0.1.0` by name — `--follow-tags` skips lightweight tags) → `release.yml` green → `GH_TOKEN=$(gh auth token) npm run release:mac` → the draft
   holds exe, AppImage, deb, dmg, zip, blockmap and `latest.yml` / `latest-linux.yml` /
   `latest-mac.yml` → Publish. Result:
6. **Second Mac** — the downloaded dmg opens with no Gatekeeper warning; the microphone captures
   (§27 — entitlements survived signing); one MCP credential read prompts once and "Always Allow"
   sticks. Result:
7. **Round-trip** — install 0.2.0, publish 0.2.1; Check now (or wait ≤ 4 h) shows the row;
   Restart lands on 0.2.1 with sessions restored. Record the delta download size (the blockmap).
   Result:
8. **Windows + AppImage round-trip** — same as 7 on each. **deb** — the row reads "is out ·
   Download" and opens the release page. Result:
