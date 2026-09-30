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
   Result: **Done.** `Developer ID Application: BzApps Ltd (4K6P6U479K)` is in the keychain (2026-09-30).
2. **Notary profile** — `xcrun notarytool store-credentials happyvibe --apple-id … --team-id
   4K6P6U479K` (omit `--password`; paste the app-specific one at the prompt); `xcrun notarytool history --keychain-profile happyvibe`
   exits 0. Result: **Done.** The `happyvibe` profile answers (`history` exits 0, 2026-09-30) and
   notarized the 0.1.0 build.
3. **Web box** — per-IP rate limit and a raised `maxConcurrency` on `firecrawl.bzapps.eu`, BEFORE
   the flip. Result: **Not checked** — nothing here can reach the box. Confirm by hand.
4. **Repo public** — `gh repo edit guiguito/HappyVibe --visibility public
   --accept-visibility-change-consequences`; Settings → Code security → Private vulnerability
   reporting ON. CI runs again (public = free minutes). Result: **Done 2026-09-30.** Public,
   Apache-2.0, CI green on `main`. Private vulnerability reporting was **off** and is now on —
   `SECURITY.md` sends reporters to the advisory form, which does not work without it.
5. **First release** — `/release` (0.1.0: the first release, so no bump) → `/ship` (pushes `main` and
   `v0.1.0` by name — `--follow-tags` skips lightweight tags) → `release.yml` green → `GH_TOKEN=$(gh auth token) npm run release:mac` → the draft
   holds exe, AppImage, deb, dmg, zip, blockmap and `latest.yml` / `latest-linux.yml` /
   `latest-mac.yml` → Publish. Result: **Done 2026-09-30.** `release.yml` green (draft, Windows,
   Linux); `release:mac` exited 0 and Gatekeeper accepted the app as notarized. The draft held all
   eleven files: dmg 270 MB, mac zip 284 MB, Setup.exe 314 MB, AppImage 370 MB, deb 295 MB, the four
   blockmaps and the three `latest*.yml`. Published 08:23 UTC. With no token, the three `latest*.yml`,
   the zip and the dmg all download, and `releases/latest` redirects to `v0.1.0`.
6. **Second Mac** — the downloaded dmg opens with no Gatekeeper warning; the microphone captures
   (§27 — entitlements survived signing); one MCP credential read prompts once and "Always Allow"
   sticks. Result: **Partly.** Guilhem opened the downloaded dmg on 2026-09-30 and reported "all
   good". Microphone capture and the prompt-once keychain behaviour were not recorded separately —
   confirm both.
7. **Round-trip** — install 0.1.0, publish 0.1.1; Check now (or wait ≤ 4 h) shows the row;
   Restart lands on 0.1.1 with sessions restored. Record the delta download size (the blockmap).
   Result: **Pending** — needs 0.1.1 published; the update path has never run end to end.
8. **Windows + AppImage round-trip** — same as 7 on each. **deb** — the row reads "is out ·
   Download" and opens the release page. Result: **Pending**, same as 7.
