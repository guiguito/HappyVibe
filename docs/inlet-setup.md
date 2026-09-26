# Inlet setup — HappyVibe (reinstall reference)

Sep 26, 2026 · @Guilhem

## Current install (reinstalled 2026-09-26)

The setup below was recreated on the new install with the same names, form definitions (element and option IDs included) and hosted-form settings. The tables further down keep the OLD install's IDs as a record.

| Project | ID | General Feedback | Session Rating | Crash database | Smoke tests |
| --- | --- | --- | --- | --- | --- |
| HappyVibe Dev | `prj_gs5pw3fdpq4q` | `fdb_k1wv6q4f5y3d` | `fdb_8acy05bfbdd8` | `cdb_38g7t8v30pxe` | `fdb_d27rwrartady` |
| HappyVibe Prod | `prj_3vjpv09w9kkp` | `fdb_kvsfs4azz0xc` | `fdb_fg71xjz0y9t6` | `cdb_2nt89ap6w63j` | — |

Smoke tests is new: one required single-line text question (`el_7smk4t0xw2nq`, max 500) and one optional screenshot (`el_8pqz3wm6kd1r`, max 1), which is all `tests/feedback-live.test.ts` sends.

## Overview

HappyVibe uses two Inlet projects, one per environment. A secret server key reaches exactly one project, so the MCP config has two servers: `inlet` (Dev) and `inlet-prod` (Prod).

| Project | Old ID | MCP server | Feedback DBs | Created |
| --- | --- | --- | --- | --- |
| HappyVibe Dev | `prj_7j3jft425x3h` | `inlet` | 2 | 2026-09-09 |
| HappyVibe Prod | `prj_633jq7ze7n5b` | `inlet-prod` | 2 | 2026-09-09 |

Every ID in this doc (`prj_`, `fdb_`, `cdb_`, `fv_`, `ipk_`, `isk_`) belongs to the OLD install and will change. After recreating, update the repo (see Repo wiring).

## Feedback databases

Each project holds the same two databases, with identical forms. Only the database NAMES matter to recreate; IDs are regenerated.

| Project | Database name | Old ID | Active form version | Responses (2026-09-26) |
| --- | --- | --- | --- | --- |
| Dev | General Feedback | `fdb_h2ntrck1mywr` | v2 | 2 |
| Dev | Session Rating | `fdb_384szrcgeb7n` | v1 | 2 |
| Prod | General Feedback | `fdb_yfre0219xr82` | v1 | 0 |
| Prod | Session Rating | `fdb_hnbkxr94p5cd` | v1 | 0 |

Dev General Feedback is at v2 only because v1 put every field on one page; v2 split it into five pages. Prod was created straight from the v2 layout. Publish the five-page layout once and you get the current state.

The Smoke tests database (`fdb_dcjfkk5yfhgt`) that `tests/feedback-live.test.ts` writes to does not appear in either project's list today.

### Hosted form (public link)

Only Dev General Feedback has a hosted form in use. The other three show Inlet's defaults, disabled: reading a hosted form creates a disabled one if none exists, so they carry no settings worth copying.

| Setting | Dev General Feedback |
| --- | --- |
| Enabled | yes |
| Slug | `happyvibe` (old URL `https://feedback.bzapps.eu/f/happyvibe`) |
| Accent colour | `#EE5A24` |
| Colour scheme | light |
| Corner radius | sharp |
| Typeface | sans |
| Logo | none |
| Submit label | Send feedback |
| Thank-you title | Thank you |
| Thank-you body | That is genuinely useful. If you left an email address we may come back to you. |
| Closed message | HappyVibe feedback is closed at the moment. Thanks for stopping by. |
| Redirect URL | none |
| Show progress | yes |
| Embedding | nowhere (no allowed origins) |

## Form definitions

The `el_`, `op_` and `pg_` IDs are chosen by whoever submits the form (`save_form_draft` takes them in the definition), so reuse the exact IDs below. The app reads the form at runtime and needs no IDs, but the test fixtures (`tests/fixtures/inlet-general-v2.json`, `inlet-session-v1.json`) and `tests/feedback-form.test.ts` hard-code them. Dev and Prod use the same definitions, IDs included.

### General Feedback — five pages

| Page | Element | Type | Label / text | Required | Details |
| --- | --- | --- | --- | --- | --- |
| 1 | `el_qqeqaggpvang` | title | Feedback for HappyVibe | — |  |
| 1 | `el_2xya17ejhnzp` | body\_text | Anything you noticed while using the app — broken, confusing, missing or good. Two fields are all that is required. | — |  |
| 1 | `el_szbmd4ddzewt` | choice | What kind of feedback is this? | yes | single, text options, vertical |
| 2 | `el_5evwc8vfj3yc` | text | What happened? | yes | multiline, max 4000 chars, helper and placeholder below |
| 3 | `el_fppmeabbfspe` | choice | How is HappyVibe treating you overall? | no | single, emoji options, horizontal |
| 4 | `el_pebaya4w61jq` | screenshot | A screenshot, if it helps | no | max 3 images, helper: *Optional. Up to three images.* |
| 5 | `el_86jj3z6wcjh6` | email | Your email, if you would like a reply | no | helper: *Optional. Only used to answer this feedback.*, placeholder `you@example.com` |

The *What happened?* helper is *What you were doing, what you expected, and what happened instead.* and its placeholder is `I was trying to…`. The server sets screenshot limits itself: JPEG, PNG or WebP, 10 MB each.

Options for *What kind of feedback is this?*: Something is broken (`op_7484gpbkt32d`) · An idea or a request (`op_wmg8jyckcgh2`) · Something was confusing (`op_byyr6kw8s1h3`) · Something worked well (`op_mnazdt2gm0e9`) · Something else (`op_2efhpnkc12ck`).

Options for *How is HappyVibe treating you overall?*: 😖 Frustrating (`op_5ef2m5c9854y`) · 😕 Rough edges (`op_7xq44nmgbb5v`) · 🙂 Fine (`op_fhwv8g1advac`) · 😄 Great (`op_kc7172rqc53r`).

### Session Rating — one page

One required single-choice question, emoji options laid out horizontally: *How did the session go?* (`el_m1jnhejwr94k`, page `pg_bahgvpt1yypq`). The app's session pulse depends on this shape: one emoji choice.

Options: 😖 Very bad (`op_q43mx0mmzxnm`) · 😕 Bad (`op_52t7zzraqkzn`) · 😐 Okay (`op_9k5hjev2vpgs`) · 🙂 Good (`op_frm6a7s5vdeq`) · 😄 Great (`op_42wz4qrhyfnv`).

### Paste-ready definitions for `save_form_draft`

General Feedback:

```json
{"pages":[
 {"id":"pg_0h7213ch39n3","elements":[
  {"id":"el_qqeqaggpvang","type":"title","text":"Feedback for HappyVibe"},
  {"id":"el_2xya17ejhnzp","type":"body_text","text":"Anything you noticed while using the app — broken, confusing, missing or good. Two fields are all that is required."},
  {"id":"el_szbmd4ddzewt","type":"choice","label":"What kind of feedback is this?","required":true,"optionKind":"text","selection":"single","orientation":"vertical","options":[
   {"id":"op_7484gpbkt32d","label":"Something is broken"},
   {"id":"op_wmg8jyckcgh2","label":"An idea or a request"},
   {"id":"op_byyr6kw8s1h3","label":"Something was confusing"},
   {"id":"op_mnazdt2gm0e9","label":"Something worked well"},
   {"id":"op_2efhpnkc12ck","label":"Something else"}]}]},
 {"id":"pg_858p3y4hd1x8","elements":[
  {"id":"el_5evwc8vfj3yc","type":"text","label":"What happened?","helperText":"What you were doing, what you expected, and what happened instead.","required":true,"multiline":true,"maxLength":4000,"placeholder":"I was trying to…"}]},
 {"id":"pg_ytkz3ze7srhd","elements":[
  {"id":"el_fppmeabbfspe","type":"choice","label":"How is HappyVibe treating you overall?","required":false,"optionKind":"emoji","selection":"single","orientation":"horizontal","options":[
   {"id":"op_5ef2m5c9854y","label":"Frustrating","emoji":"😖"},
   {"id":"op_7xq44nmgbb5v","label":"Rough edges","emoji":"😕"},
   {"id":"op_fhwv8g1advac","label":"Fine","emoji":"🙂"},
   {"id":"op_kc7172rqc53r","label":"Great","emoji":"😄"}]}]},
 {"id":"pg_ww0vb8253e5y","elements":[
  {"id":"el_pebaya4w61jq","type":"screenshot","label":"A screenshot, if it helps","helperText":"Optional. Up to three images.","required":false,"maxCount":3}]},
 {"id":"pg_qcpj4fgnsxq2","elements":[
  {"id":"el_86jj3z6wcjh6","type":"email","label":"Your email, if you would like a reply","helperText":"Optional. Only used to answer this feedback.","required":false,"placeholder":"you@example.com"}]}
]}
```

Session Rating:

```json
{"pages":[
 {"id":"pg_bahgvpt1yypq","elements":[
  {"id":"el_m1jnhejwr94k","type":"choice","label":"How did the session go?","required":true,"optionKind":"emoji","selection":"single","orientation":"horizontal","options":[
   {"id":"op_q43mx0mmzxnm","label":"Very bad","emoji":"😖"},
   {"id":"op_52t7zzraqkzn","label":"Bad","emoji":"😕"},
   {"id":"op_9k5hjev2vpgs","label":"Okay","emoji":"😐"},
   {"id":"op_frm6a7s5vdeq","label":"Good","emoji":"🙂"},
   {"id":"op_42wz4qrhyfnv","label":"Great","emoji":"😄"}]}]}
]}
```

## Crash databases

One crash database per project (§37 crash reports), both on default retention. They ingest with the project's existing publishable key, so no new credential is needed.

| Project | Name | Old ID | Max reports | Max age | Groups / reports (2026-09-26) |
| --- | --- | --- | --- | --- | --- |
| Dev | HappyVibe Dev Crashes | `cdb_aamshzzkjx9c` | 10,000 | 90 days | 14 / 57 |
| Prod | HappyVibe Prod Crashes | `cdb_64m8jfkbxw2y` | 10,000 | 90 days | 0 / 0 |

Both use grouping version 1. The 57 Dev reports (all test and probe traffic) are lost in a wipe unless exported first with `export_crash_groups` / `export_crash_reports`.

## Members and Slack

Nothing to recreate here beyond your own admin account.

- **Members:** one per project, your admin account (display name *Admin*, role admin, set directly on the project). No database-level members.
- **Invitations:** none, pending or past, in either project.
- **Slack notifications:** off on all six databases (four feedback, two crash). No webhook saved, and nothing has ever been delivered.

## Repo wiring to update after the reinstall

Nine places hold old IDs or keys. The first two are shipped app code. The rest are tests, scripts and local config.

| Where | What it holds | New value comes from |
| --- | --- | --- |
| `src/main/feedback/config.ts:39-41` (`FEEDBACK_CHANNELS.dev`) | Dev `publishableKey`, `databases.general` / `.session`, `crashDatabase` | Dev project, a new publishable `ipk_` key minted in the Inlet web UI |
| `src/main/feedback/config.ts:45-47` (`FEEDBACK_CHANNELS.prod`) | Prod `publishableKey`, `databases`, `crashDatabase` | Prod project, a new `ipk_` key |
| `tests/feedback-config.test.ts:9, 22, 40` | Expected Dev and Prod `fdb_` IDs | Same as config.ts |
| `tests/fixtures/inlet-general-v2.json`, `inlet-session-v1.json` | `feedbackDatabaseId` (element IDs stay the same if reused) | New Dev `fdb_` IDs |
| `tests/feedback-live.test.ts:27` | `SMOKE_DB = "fdb_dcjfkk5yfhgt"` | A new Smoke tests database in the Dev project (not in the list today, so decide whether to recreate it) |
| `scripts/crash-probe.mjs:25` | Default `cdb_aamshzzkjx9c` | New Dev crash DB |
| `.env` (`FEEDBACK_API_KEY`, `FEEDBACK_API_KEY_PROD`) | `isk_` server keys, Dev and Prod | New server keys from each project |
| `~/.claude.json` → project `mcpServers.inlet` / `inlet-prod` | `Authorization: Bearer isk_…` against `https://feedback.bzapps.eu/v1/mcp` | Same new server keys |
| CLAUDE.md §34 / §37 entries, `docs/validation/d1.md` §37 | Prose mentions of the Smoke tests DB and crash DB IDs | Update text only |

If the server moves off `https://feedback.bzapps.eu`, also change `baseUrl` in both channels of `config.ts:38, 44`, `BASE` in `scripts/crash-probe.mjs:26`, and the two MCP URLs.

To try a new install before committing, env overrides exist: `HV_FEEDBACK_PUBLISHABLE_KEY`, `HV_FEEDBACK_BASE_URL`, `HV_FEEDBACK_DB_GENERAL`, `HV_FEEDBACK_DB_SESSION`, `HV_CRASH_DB`.

Shipped builds hold the OLD key and IDs baked in, so feedback and crash reports from any released version fail once the old install is gone. Only a new release fixes that.

## Recreate checklist

Web-UI steps come first, because a server key can create neither projects nor keys. Everything after that can run through the MCP servers.

**Before the wipe**

- [ ] Optional: export the 2 Dev feedback submissions (`export_submissions`) and the 57 Dev crash reports (`export_crash_reports`). All of it is test traffic.

**In the Inlet web UI (your admin account)**

- [ ] Create project **HappyVibe Dev**.
- [ ] Create project **HappyVibe Prod**.
- [ ] In each project, mint one secret server key (`isk_`) and one publishable key (`ipk_`).

**Point the MCP servers at the new keys**

- [ ] Put the Dev `isk_` key in `~/.claude.json` → `inlet`, and the Prod one → `inlet-prod`. Restart Claude Code.
- [ ] Put the same keys in `.env` as `FEEDBACK_API_KEY` and `FEEDBACK_API_KEY_PROD`.

**For each project (via MCP)**

- [ ] `create_feedback_database` named **General Feedback** → `save_form_draft` with the General Feedback JSON above → `publish_form`.
- [ ] `create_feedback_database` named **Session Rating** → `save_form_draft` with the Session Rating JSON → `publish_form`.
- [ ] `create_crash_database` named **HappyVibe Dev Crashes** / **HappyVibe Prod Crashes**. Default retention (10,000 reports, 90 days) already matches.
- [ ] Dev only: `update_hosted_form` on General Feedback with the Hosted form settings above (slug `happyvibe`, enabled).
- [ ] Dev only, if the live test should keep running: `create_feedback_database` named **Smoke tests**.

**Back in the repo**

- [ ] Update every row of the Repo wiring table.
- [ ] Run `npm run gate`. `tests/feedback-config.test.ts` and `tests/feedback-secrets.test.ts` check the new values.
- [ ] Run `tests/feedback-live.test.ts` and `scripts/crash-probe.mjs` once each against the new install.
- [ ] Cut a release, because shipped builds still carry the old key.
