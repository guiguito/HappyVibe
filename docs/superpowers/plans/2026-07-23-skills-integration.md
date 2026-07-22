# Skills Integration V1 — PRD fold-in + full implementation

## Context

PRD §14 ("Skills", `docs/prd.md:300`) is a two-line "coming soon" stub. The approved design
lives in `docs/superpowers/specs/2026-07-22-skills-integration-design.md` (mirrored on the
Notion proposal page). This plan (a) folds it into the PRD — repo **and** Notion, same
session, per the standing sync instruction — and (b) implements all of V1.

Core idea: Pi 0.80.10 loads skills silently; HappyVibe makes them **visible, reviewable,
gated** — review-before-active trust keyed by path+content-hash, enforcement via spawning
Pi with `--no-skills` + one `--skill <path>` per approved∩workspace-active skill,
respawn-resume on change (MCP live-reload machinery), `use_skill` intent cards, context
weight visibility, imports, and agent-assisted creation.

**User decisions (2026-07-23, this session):**
- Bundled skills = **skill-creator + 2–3 curated from anthropics/skills** (vendored with
  provenance, pinned at import; pre-approved, off by default).
- Delivery = **all 3 phases straight through** in one Opus session; full gate + live tests
  between phases; no stop-for-review between phases.

**Defaults chosen (flag if you disagree):** a skill the user explicitly approves becomes
**active by default** in the workspace where it was reviewed (checklist is opt-out);
bundled skills stay **off by default** per spec. Token estimate = chars/4 (existing
`estTokens` convention).

---

## Phase 0 — Docs fold-in (before any code) — ✅ DONE 2026-07-23 (Fable planning session)

1. **`docs/prd.md` §14 rewrite** — replace the stub with narrative + dated `**Decision (…)**`
   paragraphs (same convention as §13 MCP): scope (V1 = visibility/trust/import/creation,
   marketplace V2), review-before-active + content-hash, `--no-skills`+`--skill` enforcement
   + respawn-resume, bypass orthogonality, approval-vs-per-workspace-activation, import
   sources (bundled / local / linked Claude Code dirs / git-tarball / curated shortlist),
   skill-creator creation flow + promote-to-global, UI decisions (global-only SkillsSection
   in renamed "Skills, MCP, Agents & Tools" view; workspace skills only in
   WorkspaceSettingsModal), context-weight visibility, `use_skill` intent cards, phased
   delivery, V2 out-of-scope list. Reference spec + plan paths. Fold in this session's two
   new decisions (bundled set; straight-through delivery). Update §13's future-categories
   line if needed ("skills" category now real).
2. **Notion PRD** — apply the same §14 fold to the Notion PRD page (find under the
   "Happyibe" parent page via notion-search; the proposal page 3a5d33dfffca81d1… links it).
   Also append the two new dated decisions to the Notion proposal page AND the repo spec's
   decision list so all three mirrors agree.
3. **Plan doc in repo** — copy this implementation plan to
   `docs/superpowers/plans/2026-07-23-skills-integration.md` (repo convention, cf. MCP).
4. Update memory `skills-integration-proposal.md` → locked/in-implementation.

---

## Phase 1 — Trust core

### Main process (new module `src/main/skills/`)
- **`discovery.ts` (pure, vitest-importable):** scan managed global dir
  (`<agentDir>/skills/`), workspace `.agents/skills/`, and linked dirs. Parse SKILL.md
  frontmatter with Pi's rules (name + description required; missing description → not
  loadable — surface as `error` status). Per skill: sha256 content hash over sorted
  relative paths + file bytes; executable/script file count; est tokens (chars/4 of
  name+description, and of full SKILL.md body).
- **`registry.ts`:** JSONL-backed approval store (EventLog append/read pattern from
  `src/main/log.ts`; no SQLite), global file in `userData`, workspace entries keyed by
  workspaceId. Record: `{skillId(path), scope, hash, status: approved|revoked, approvedAt,
  provenance?, snapshot}` — `snapshot` = approved SKILL.md content + file list, needed for
  the re-review before/after diff. Current state = last record per skill; hash mismatch vs
  on-disk ⇒ needs-review.
- **Activation:** per-workspace checklist in `WorkspaceRegistry` (`src/main/store.ts`,
  extend `WorkspaceEntry` with `skillsActive?: Record<string, boolean>` + get/set,
  mirroring `getModel/setModel`). Covers global AND workspace skills.
- **Spawn enforcement:** `PiSpawnOptions.skills?: string[]` in `src/main/pi/spawn.ts` →
  emit `--no-skills` always + one `--skill <abs path>` per entry (after the `-e` block).
  `spawnOpts()` in `src/main/ipc.ts` adds `skills: resolveActiveSkills(workspace)` =
  approved ∩ active-for-this-workspace (global ∪ workspace). Also write a per-session
  **skills manifest JSON** (name → {path, scope}) and pass `HV_SKILLS_FILE` in env
  (HV_RULES_FILE pattern) so the bridge can serve `use_skill` and detect raw reads.
- **Live reload:** generalize `scheduleMcpReload`/`runMcpReloadPass`/`reloadSession`
  (`ipc.ts` ~L534–620) into a shared runtime-config reload with a `reason` param
  (`"mcp" | "skills"`); `affectedSessionIds` (`mcpReloadScope.ts`) reused as-is. Approve /
  revoke / toggle-active / import all call `scheduleRuntimeReload("skills", scope, wsId)`.
- **Watcher:** workspace `.agents/skills` via existing `watchWorkspace`
  (`src/main/watch.ts`) filter on the fs-changed path; small dedicated watcher (same
  debounce pattern) for the global managed dir + linked dirs. On change: rescan → hash
  mismatch flips to needs-review → EventLog + `hv:skills-changed` push to renderer.
- **IPC + preload:** `hv:skills-list (scope/workspace)`, `hv:skills-approve`,
  `hv:skills-revoke`, `hv:skills-set-active`, `hv:skills-read (SKILL.md + diff payload)`;
  `window.hv.*` + `onSkillsChanged` in `src/preload/index.ts`.
- **Audit:** `log.append({type: "skill.discovered"|"skill.approved"|"skill.revoked"|
  "skill.invoked", …})`; raw-read fallback logs `detected: true`.

### Bridge (`pi-runtime/extensions/`)
- **`use_skill` tool** (new `hv-skills.ts` + registration in `happyvibe-bridge.ts`):
  `use_skill(name)` reads the manifest from `HV_SKILLS_FILE`, returns SKILL.md content.
  Add `"use_skill"` to `INTENT_TOOLS` (required model-authored intent, like `mcp`) and to
  `SAFE_TOOLS` in `hv-rules.ts` (read-only; never prompts). Append system guidance steering
  the model to `use_skill` instead of raw `read` of SKILL.md paths.
- **Raw-read fallback:** in the existing `tool_call` path, detect `read` of a path inside
  an active skill dir → emit `hv.skill` notify with derived label (no intent) +
  `detected: true`.
- **Invocation envelope:** `hv.skill` notify `{kind:"hv.skill", name, intent?, detected?}`
  → main relays → renderer transcript card. `/skill:name` composer invocations card with
  the user's args as headline.
- **Context weight:** bridge's existing `before_agent_start`/`hv.context` capture gains
  two aggregate lines (global-skills / workspace-skills est tokens) using the manifest.

### Renderer
- **`SkillsSection.tsx`** (clone `McpServersSection` shape): global skills only — rows
  (name, description, source badge managed/linked/bundled, status active/disabled/
  needs-review/error, "includes N scripts" flag), inspector panel (rendered SKILL.md, file
  list, provenance, per-skill token estimate, approve/disable, before/after diff when
  needs-review-after-change). Mounted in `AgentsView.tsx`; h1 renamed
  **"Skills, MCP, Agents & Tools"**; section titled "Global skills" with the persistent
  workspace-settings hint.
- **`WorkspaceSettingsModal.tsx`:** new Block — workspace skill review (project
  `.agents/skills`) + the activation checklist over all approved skills (global +
  workspace) with per-workspace toggles.
- **Review badge:** non-blocking badge/notice when a workspace has unreviewed project
  skills (never a modal wall).
- **Tools list:** "skill" category in the `/hv-tools` → `hv.tools` flow
  (`src/renderer/src/agents.ts`), scope badges, rows link to SkillsSection / workspace
  settings.
- **Composer:** `/skill:name` autocomplete in ChatView's slash menu from the session's
  loaded commands (Pi `get_commands` RPC — session's active set by construction).
- **Context panel** (`ContextPanel.tsx`): two skill lines (global / workspace weight).
- **Transcript:** skill invocation card (tool-card styling, skill name + intent headline).

### Tests & validation (phase 1 gate)
- Unit: discovery/frontmatter/hash, registry state machine, activation resolution
  (`resolveActiveSkills`), spawn arg emission, reload-scope reuse.
- Contract (pin-bump gate): pinned Pi honors `--no-skills` + explicit `--skill`
  (skill visible in system prompt / commands; undeclared skill absent). New
  `docs/validation/sk1.md` documenting flags + `hv.skill` envelope shape (d1 convention).
- Live: `tests/skills-bridge.test.ts` (skipIf DEEPSEEK_API_KEY) — approved skill loads,
  `/skill:name` works, unapproved absent, `use_skill` returns content with model intent.
- Full gate: both typechecks + non-live suite + live batched + build.

---

## Phase 2 — Imports

- **Bundled skills:** create `pi-runtime/skills/` (shipped via existing `extraResources`).
  Author **skill-creator**; vendor **2–3 curated skills from anthropics/skills** (pinned
  commit, provenance recorded). Install at startup via an `installBundledSkills` sibling of
  `installBuiltinAgents` (`config.ts`) — non-clobbering, stamp file, pre-approved records
  written to the registry, **off by default**.
- **Local folder import:** file dialog → temp scan → multi-skill picker → path-confined
  copy into managed dir (global) or `.agents/skills` (workspace); approved at import.
- **Linked Claude Code dirs:** `linkedDirs: string[]` in `config.ts` config.json; scanned
  in place; review-before-active still applies; source badge "linked".
- **Git URL (tarball):** `src/main/skills/gitImport.ts` — parse forge URLs (GitHub
  codeload, GitLab/Bitbucket/Codeberg archive endpoints), HTTPS download, extract with the
  `tar` npm package (add dep) to a temp dir, scan, picker for skill-pack repos, copy with
  provenance `{sourceUrl, ref, commitShaOrArchiveHash, importedAt}`. "Update" = re-fetch →
  hash change → needs-review. No auto-update; SSH/private/system-git = V2.
- **Curated shortlist:** static list in the renderer (entries from anthropics/skills,
  badlogic/pi-skills) — bundled entries toggle; others pre-fill the git importer.
- **UI:** import entry points in SkillsSection (global) and WorkspaceSettingsModal
  (workspace).
- **Tests:** forge-URL parsing + tarball extraction (fixture archive, no network),
  import path-confinement, bundled-install idempotence. Full gate again.

---

## Phase 3 — Creation

- **"New skill" button** at the top of the workspace view → fires `/skill:skill-creator`
  as a prompt in the current session (requires skill-creator toggled on; button prompts to
  enable it if not). All writes happen through normal gated tools into `.agents/skills/` —
  path-confinement invariant holds; no agent writes to `<agentDir>`.
- **Auto-approval of created skills:** watcher detects a new workspace skill written by
  the session's gated (user-permitted) tools while skill-creator is active → registry marks
  it approved (`provenance: created`); EventLog `skill.created`.
- **Promote to global:** inspector action → IPC → main-side path-confined copy
  `.agents/skills/<name>` → managed global dir; approval record carries over (same hash).
- **Tests:** promote-copy + approval-carryover unit tests; live end-to-end optional.
  Full gate + build.

---

## Verification (end of run)

1. Full gate: `npx tsc --noEmit -p tsconfig.node.json && -p tsconfig.web.json`, non-live
   vitest suite, live files batched in one vitest invocation (rerun any flake in
   isolation), `npm run build`.
2. Manual E2E via electron-debug MCP: launch app → drop a skill into a workspace's
   `.agents/skills` → see needs-review badge → approve → session respawn-resumes →
   `/skill:name` autocompletes → invoke → intent card + audit event → toggle off in
   workspace settings → skill disappears from session. Import a git-URL skill pack;
   create a skill via the button; promote it to global.
3. Confirm docs mirrors: repo `docs/prd.md` §14, Notion PRD §14, spec decision list, and
   `docs/superpowers/plans/2026-07-23-skills-integration.md` all consistent.

## Execution note

Implementation is intended to run on **Opus** — after plan approval, switch model before
implementation begins. Work happens on this `skills` branch/worktree.
