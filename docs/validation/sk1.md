# SK1 Validation — Skills enforcement + `use_skill` (PRD §14)

## Verdict: PASS (contract) — the `--no-skills` + `--skill` gate holds on pinned Pi 0.80.10

The whole HappyVibe skills trust model rests on ONE Pi behavior: spawning with
`--no-skills` disables Pi's own skill discovery, and `--skill <dir>` still loads
the paths we pass (additive even with `--no-skills`). If a Pi pin bump breaks
this, unapproved skills would reach the model and the review-before-active gate
would be void. `tests/skills-contract.test.ts` pins it and is part of the
pin-bump gate. Verified 2026-07-23 against the vendored 0.80.10.

## Enforcement primitive (contract test, key-free)

Spawn `pi --mode rpc --no-skills --skill <approvedDir>` with an *unapproved*
skill planted in a discovery location (`~/.agents/skills/sneaky`), then query the
pure `get_commands` RPC (no model turn, no API key needed — skills load at
startup via `resourceLoader.reload()` in `agent-session-services`):

```
get_commands → commands[].name where startsWith("skill:")
  → ["skill:pdf-tools"]        // the --skill dir loaded
  → NOT "skill:sneaky-skill"   // --no-skills suppressed discovery
```

Pi facts confirmed by reading the vendored source (`dist/core/skills.js`,
`dist/core/resource-loader.js`, `dist/cli/args.js`, `dist/modes/rpc/rpc-mode.js`):

- `--skill` → `parsed.skills` → `additionalSkillPaths`. With `noSkills`, the
  resource loader computes `skillPaths = merge(cliEnabledSkills, additionalSkillPaths)`
  — the CLI `--skill` dirs are always included.
- `enableSkillCommands` defaults `true`; `get_commands` lists loaded skills as
  `{ name: "skill:<name>", source: "skill" }` unconditionally.
- Frontmatter: `name` falls back to the dir basename; a **missing description →
  skill not loaded** (Pi's one hard rule). HappyVibe mirrors this in
  `src/main/skills/discovery.ts` (status `error`).
- A dir containing `SKILL.md` is a skill root (no deeper recursion); otherwise
  recurse to find `SKILL.md` dirs.

## `use_skill` + intent (live test)

`tests/skills-bridge.test.ts` (skipIf no `DEEPSEEK_API_KEY`; batched with the
other live files). With the bridge loaded and `HV_SKILLS_FILE` pointing at the
per-session manifest, the model loads a skill via `use_skill(name, intent)`:

- `use_skill` is in `INTENT_TOOLS` → `requireIntent` injects a required `intent`,
  so the call carries a model-authored headline (asserted non-empty) and cards
  distinctly (toolLabel `use_skill` → "Using skill: <name>" / intent).
- `use_skill` is in `SAFE_TOOLS` (`hv-rules.ts`) → no permission prompt.
- The tool returns the SKILL.md body wrapped in `<skill name=… location=…>`.
- The unapproved skill is absent from `get_commands` (enforcement, above).

## Wire shapes

### HV_SKILLS_FILE manifest (main → bridge, per session)

Written by `src/main/skills` `buildManifest`; read by `hv-skills.ts` `loadManifest`.

```jsonc
{ "skills": [
  { "name": "pdf-tools",
    "dir": "/abs/managed/skills/pdf-tools",
    "skillMdPath": "/abs/managed/skills/pdf-tools/SKILL.md",
    "scope": "global",              // "global" | "workspace"
    "estTokens": { "card": 20, "body": 400 } }
] }
```

### `hv.skill` notify (bridge → main → renderer + EventLog)

Fire-and-forget notify (message field carries the JSON, B4 `hv.audit` convention).
Emitted by `use_skill.execute` (detected:false) and by the raw-read fallback in
the `tool_call` handler (detected:true). Main logs it as EventLog
`type:"skill.invoked"` and forwards it to the renderer.

```jsonc
{ "kind": "hv.skill", "stage": "invoked", "name": "pdf-tools",
  "scope": "global", "detected": false }   // detected:true = raw `read` of a SKILL.md
```

### `hv.context` snapshot — skills weight (bridge → renderer)

The `system` object of the `hv.context` snapshot gains:

```jsonc
"skills": { "global": { "tokens": 40, "count": 2 },
            "workspace": { "tokens": 12, "count": 1 } }
```

surfaced as two context-panel lines (`skills-global` / `skills-workspace`).

## EventLog event types (audit + analytics)

`skill.discovered` · `skill.approved` · `skill.enabled` · `skill.disabled` ·
`skill.activation` · `skill.invoked` (with `detected` for raw-read heuristics) ·
`skill.imported` (Phase 2) · `skill.created` / `skill.promoted` (Phase 3).

## Phase 2 — Imports

- **Bundled** (`pi-runtime/skills/`): skill-creator + frontend-design +
  brand-guidelines, vendored from `github.com/anthropics/skills` @
  `1f630fdf9259cec4a14913127dfd7c3b69ef72eb` via the pinned-commit tarball
  (`bundled.json` records provenance). `installBundledSkills` pre-approves them
  at startup with `enabled:false` (off by default; one "Enable" turns one on) and
  re-approves across bundle bumps without clobbering the user's on/off.
- **Local folder / git-URL**: two-phase scan → pick → copy. Git import
  (`src/main/skills/gitImport.ts`) downloads a forge archive over HTTPS (no git
  binary), extracts with the `tar` npm package, scans, and copies chosen skills
  into the managed dir (global) or `<ws>/.agents/skills` (workspace), approved at
  import with provenance `{source, sourceUrl, ref, commitSha=archiveHash}`.
  `parseForgeUrl` (GitHub/GitLab/Bitbucket/Codeberg) is pure + unit-tested;
  `tests/skills-git-import.test.ts`, `tests/skills-bundled.test.ts`.
- **Linked dirs / curated shortlist**: `linkedSkillDirs` in config (scanned in
  place, source badge "linked"); a static shortlist prefills the git importer.

## Phase 3 — Creation

- **"New skill"** button (`hv:skills-new-skill`): enables + activates the bundled
  skill-creator for the session's workspace, respawn-resumes if it wasn't loaded,
  then the renderer fires `/skill:skill-creator` so the skill interviews the user
  and writes into `.agents/skills` via normal gated tools.
- **Auto-approval**: the workspace watcher auto-approves a BRAND-NEW workspace
  skill (`provenance:"created"`) only while skill-creator is active in a live
  session for that workspace; content changes to an approved skill still flip to
  needs-review.
- **Promote to global** (`hv:skills-promote`): main-side confined copy of a
  workspace skill into the managed dir, approved (identical content → same hash).

## Known deferrals (ponytail)

- **Composer `/skill:name` autocomplete** — the app has no slash-command menu
  framework (only @-mention autocomplete). `/skill:name` already WORKS by typing
  (Pi's `enableSkillCommands` + expansion). Building a slash menu is
  disproportionate; deferred until such a menu exists. Skills stay discoverable
  via the Global skills section.
- **Per-skill rows in the Tools list** — skills have a dedicated Global-skills
  section, and `use_skill` already appears in the Tools list. Duplicating each
  skill as a pseudo-tool (with a meaningless permission state) was skipped.
- **"New skill" placement** — the design put it "at the top of the workspace
  view" (chat). The v5 refactor removed the chat header (actions moved to the tab
  strip), so adding a chat-header button was invasive. It lives in the Global
  skills section's import bar, wired to the focused session — same capability,
  less churn. Move to the chat surface if a natural slot appears.
