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
- **Approval vs activation are separate.** Approval ("I reviewed this content") lives at
  the skill's scope. Activation ("this skill runs here") is **per-workspace**: each
  workspace holds a checklist over all approved skills — global and its own — so a global
  skill can be active in one workspace and off in another. Spawn loads
  approved ∩ active-for-this-workspace.

## 3. Enforcement

- Spawn Pi with `--no-skills` plus one `--skill <path>` per approved+enabled skill.
  Pi never sees unapproved content — no bridge involvement in gating.
- Enable/disable/import/approve → **respawn-resume** via the existing MCP live-reload
  machinery (`scheduleMcpReload` generalizes to a runtime-config reload: debounced,
  idle-only, deferred while busy, session resumed from the session file). One mechanism,
  two config sources.
- A file watcher on skill dirs (same watcher infra as plans) flags on-disk changes live.
- **Bypass is orthogonal.** Dangerous mode (`/hv-dangerous`) and `HV_BYPASS` affect
  tool-call gating only — they never cause an unapproved skill to load. The skill gate is
  config resolved at spawn, not a permission prompt, and has no bypass path.

## 4. Import

Copied imports land in the managed global dir or workspace `.agents/skills/`; linked
dirs are referenced in place; bundled skills ship inside the runtime:

- **Bundled skills** — a small curated set shipped in the runtime bundle
  (**skill-creator** plus 2–3 essentials), pre-approved (we authored them) but
  **off by default** — the user just toggles them on. Zero install steps; "curated
  distribution" applied to skills.
- **Local folder** — copy in (single skill or a parent containing many).
- **Claude Code dirs** — *linked in place* (not copied): a `linkedDirs` list in HappyVibe
  settings; skills from linked dirs still go through review-before-active.
- **Git URL (tarball-based — no git binary required)** — main downloads the forge's
  archive over HTTPS (GitHub `codeload`, GitLab/Bitbucket/Codeberg archive endpoints),
  extracts to a temp dir (`tar` npm package), scans it; a skill-pack repo shows a picker
  so the user imports only the skills they want. Selected skills copy into the managed
  dir with provenance `{sourceUrl, ref, commitSha-or-archiveHash, importedAt}` shown in
  the inspector. "Update" = re-fetch → hash changes → back to needs-review. **No
  auto-update.** SSH/private repos and a system-git fallback are V2.
- **Curated shortlist** — a static in-app list (entries from anthropics/skills,
  badlogic/pi-skills): bundled entries are a toggle; the rest pre-fill the git-URL
  importer with a pinned URL. One click either way. Not a marketplace.

All imports are path-confined writes (the `resolveInWorkspace` pattern), and every
source flows into the same review-before-active gate (bundled skills excepted — we
authored them).

## 5. Creation (agent-assisted, via the bundled skill-creator)

A **"New skill" button at the top of the workspace view** fires `/skill:skill-creator`
(the bundled skill-authoring skill) in the current session — the skill interviews the
user and writes SKILL.md + scripts into the workspace's `.agents/skills/` through normal
gated tools. This keeps every agent write **inside the workspace** (path-confinement
invariant holds; no agent ever writes to `<agentDir>`). On completion the skill appears
already-approved (user authored it interactively).

To make a created skill global, the inspector offers **"Promote to global"** — main
copies it from `.agents/skills/` into the managed global dir (a main-side, path-confined
write; approval carries over since content is identical). No form editor in V1 — "edit"
opens SKILL.md via the file tree.

## 6. UI

- **SkillsSection** (same shape as `McpServersSection`): rendered in the current
  "MCP, Tools & Agents" view, renamed **"Skills, MCP, Agents & Tools"**. Shows **global
  skills only** (managed dir + linked dirs + bundled) — multiple workspaces can be live
  at once, so workspace-scoped skills don't belong on this screen. Each row: name,
  description, source badge (managed / linked / bundled), status (active / disabled /
  needs review / error). Row click → inspector: rendered SKILL.md, file list, provenance,
  approve/disable actions. Rows containing executable files are flagged ("includes N
  scripts") so the risk is visible at review time, and when a changed skill returns to
  needs-review the inspector shows a **before/after diff** against the approved version —
  re-review is a real decision, not a second rubber stamp. Global import/create entry
  points live here. The section is
  titled **"Global skills"**, with a persistent hint under the title: *"Workspace-specific
  skills are managed in each workspace's settings"* (linking to the workspace settings of
  the current session's workspace when one is selected).
- **Workspace settings**: `WorkspaceSettingsModal` is the ONLY management surface for
  workspace-scoped skills (project `.agents/skills` + workspace imports): discovery,
  review, approve — plus the activation checklist over every approved skill (global and
  workspace) with an on/off toggle for this workspace. Sits alongside the existing
  PermissionRulesSection.
- **Context visibility**: skills' system-prompt overhead surfaces in the context panel as
  two lines — global skills and workspace skills — each with an estimated token weight;
  the skill inspector shows the per-skill estimate (name + description are paid on every
  turn; the SKILL.md body only when loaded).
- **Tools list**: per-session (as today — `listTools(sessionId)`), so it shows exactly the
  skills the selected session loaded — global-active AND that session's workspace skills,
  each with a scope badge — under a "skill" category (PRD §13 future-categories slot).
  Read-only; rows link to the SkillsSection (global) or workspace settings (workspace).
- **Composer**: `/skill:name` autocomplete from the session's **active** skill set
  (approved ∩ active for that session's workspace — what the session actually loaded;
  Pi's `enableSkillCommands` provides the RPC command; HappyVibe surfaces it).
- **Review prompt**: opening a workspace with unreviewed project skills shows a
  non-blocking badge/notice — never a modal wall.
- **Skill invocation in chat**: loading a skill surfaces as a distinct transcript card
  (like tool/agent cards) with the skill name and a **model-authored intent** — "why am I
  loading this". Mechanism: the bridge registers a `use_skill(name)` tool that returns the
  SKILL.md content; being a registered tool, it goes through `requireIntent` (INTENT_TOOLS)
  exactly like MCP calls, so intent is a required schema param — built-in `read` can't
  carry intent (params are stripped on built-ins). The bridge steers loading toward
  `use_skill` via appended system guidance; a raw `read` of an active SKILL.md path is
  still detected as a fallback and surfaces a card with a derived label (no intent).
  `/skill:name` invocations card with the user's args as the headline.

## 7. Audit & events

`hv.skill` events in the EventLog: discovered, approved, revoked, imported (with source),
created, invoked. `use_skill` calls make invocation (and its intent) first-class in the
audit trail; raw-read fallback detections are logged as heuristic (`detected: true`).

## 8. Testing

- Unit: discovery / hashing / approval-registry logic (pure, main-side).
- Contract: `--no-skills` + `--skill` behavior on the pinned Pi — added to
  docs/validation and part of the pin-bump gate.
- Live bridge test: an approved skill is visible in the system prompt and `/skill:name`
  works; an unapproved skill is absent; `use_skill` returns the skill content and the
  call carries a model-authored intent.

## 9. Delivery phasing

All of the above is V1 scope, shipped in three validate-as-you-go steps:

1. **Trust core** — discovery, review-before-active, `--no-skills` enforcement,
   per-workspace activation, context-weight visibility, `use_skill` invocation cards.
   Shippable on its own: existing on-disk skills become visible, gated, and honest.
2. **Imports** — bundled starters, linked Claude Code dirs, local folder, git-URL
   (tarball), curated shortlist.
3. **Creation** — skill-creator button, promote-to-global.

Each step is validated (full gate + live tests) before the next starts.

## 10. Out of scope (V2+)

Marketplace/library, SSH/private-repo git import (and a system-git fallback), upstream
update notifications, a skill-editing UI, honoring the experimental `allowed-tools`
frontmatter, per-skill tool-permission narrowing.
