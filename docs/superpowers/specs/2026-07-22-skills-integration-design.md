# Skills Integration — Design (V1)

Date: 2026-07-22
Status: Approved design (brainstorm); PRD §14 currently marks skills "coming soon" — this is the proposal to fill that section.

## 1. Concept

Skills (Agent Skills standard, natively supported by the pinned Pi 0.80.10) become a
first-class HappyVibe surface: visible, reviewable, and gated — turning Pi's silent skill
loading into a differentiator consistent with the permission story. Marketplace is V2.

Pi facts this design builds on:
- Pi discovers skills from `<agentDir>/skills/`, `~/.agents/skills/`, project `.agents/skills/`
  (cwd + ancestors), settings `skills` array, and `--skill <path>` (repeatable).
- `--no-skills` disables discovery, but explicit `--skill` paths still load.
- Skills register as `/skill:name` commands (`enableSkillCommands`).
- Skill descriptions go into the system prompt at startup; there is no runtime add/remove API.

## 2. Discovery & trust (review-before-active)

- **Main** (not Pi) scans skill locations: the HappyVibe-managed global dir
  (`<agentDir>/skills/`), workspace `.agents/skills/`, and linked external dirs
  (e.g. `~/.claude/skills`), parsing SKILL.md frontmatter with the same rules as Pi's
  `core/skills.ts` (name/description required; description missing → not loaded).
- Every skill has an approval record keyed by **path + content hash** (hash over SKILL.md
  and referenced files in the skill dir). New skill → "needs review" with SKILL.md preview;
  user approves once. Content change → hash mismatch → back to needs-review.
- Skills imported or created through the app are approved at import time (the user already
  saw them).
- The approval registry persists as a JSONL-backed store (existing persistence pattern —
  no SQLite), scoped global vs workspace.

## 3. Enforcement

- Spawn Pi with `--no-skills` plus one `--skill <path>` per approved+enabled skill.
  Pi never sees unapproved content — no bridge involvement in gating.
- Enable/disable/import/approve → **respawn-resume** via the existing MCP live-reload
  machinery (`scheduleMcpReload` generalizes to a runtime-config reload: debounced,
  idle-only, deferred while busy, session resumed from the session file). One mechanism,
  two config sources.
- A file watcher on skill dirs (same watcher infra as plans) flags on-disk changes live.

## 4. Import

Three sources, one funnel — copied imports land in the managed global dir or workspace
`.agents/skills/`; linked dirs are referenced in place:

- **Local folder** — copy in (single skill or a parent containing many).
- **Claude Code dirs** — *linked in place* (not copied): a `linkedDirs` list in HappyVibe
  settings; skills from linked dirs still go through review-before-active.
- **Curated shortlist** — a static in-app list (entries from anthropics/skills,
  badlogic/pi-skills) linking to the repos; the user downloads and brings a skill in via
  the local-folder import. Not a marketplace.

Git-URL import was cut from V1 (Notion edit, 2026-07-22) — moved to Out of scope.

All imports are path-confined writes (the `resolveInWorkspace` pattern).

## 5. Creation (agent-assisted)

"New skill" starts a session pre-loaded with a **built-in skill-authoring skill** (shipped
in the runtime bundle, always approved) that interviews the user and writes SKILL.md +
scripts into the chosen dir. The write lands via normal gated tools; on completion the new
skill appears already-approved (user authored it). No form editor in V1 — "edit" opens
SKILL.md via the file tree.

## 6. UI

- **SkillsSection** (scope-aware, same shape as `McpServersSection`): rendered in the
  "MCP, Tools & Agents" view with Global and This-workspace lists. Each row shows name,
  description, source badge (managed / linked / project), status (active / disabled /
  needs review / error). Row click → inspector: rendered SKILL.md, file list, provenance,
  approve/disable actions. Import/create entry points live here.
- **Workspace settings**: `WorkspaceSettingsModal` embeds the workspace-scoped
  SkillsSection (project `.agents/skills` + workspace imports), alongside the existing
  PermissionRulesSection — review/enable available in both places.
- **Tools list**: loaded skills appear under a "skill" category (PRD §13 future-categories
  slot) as a read-only pointer to the SkillsSection.
- **Composer**: `/skill:name` autocomplete from the active session's approved skill set
  (Pi's `enableSkillCommands` provides the RPC command; HappyVibe surfaces it).
- **Review prompt**: opening a workspace with unreviewed project skills shows a
  non-blocking badge/notice — never a modal wall.

## 7. Audit & events

`hv.skill` events in the EventLog: discovered, approved, revoked, imported (with source),
created, invoked (from Pi's skill command / observable SKILL.md reads). Skill invocations
show in the transcript like other tool activity.

## 8. Testing

- Unit: discovery / hashing / approval-registry logic (pure, main-side).
- Contract: `--no-skills` + `--skill` behavior on the pinned Pi — added to
  docs/validation and part of the pin-bump gate.
- Live bridge test: an approved skill is visible in the system prompt and `/skill:name`
  works; an unapproved skill is absent.

## 9. Out of scope (V2+)

Marketplace/library, git-URL import (and update/provenance flows), a skill-editing UI, honoring the
experimental `allowed-tools` frontmatter, per-skill tool-permission narrowing.
