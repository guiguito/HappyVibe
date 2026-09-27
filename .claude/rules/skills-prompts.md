---
paths:
  - "src/main/skills/**"
  - "src/main/promptTemplates/**"
  - "src/main/{promptTemplatesImport,promptTemplateMentions,promptRouting}.ts"
  - "pi-runtime/extensions/{hv-skills,hv-prompt-templates}.ts"
  - "pi-runtime/{skills,prompts}/**"
  - "src/renderer/src/{skillMd,promptTemplatePair}.ts"
  - "src/renderer/src/components/{Skills,PromptTemplates}*.tsx"
  - "tests/{skills,prompt-templates}*.test.ts"
---
# Skills (§14) and prompt templates (§24)

## Frontmatter
- Parse frontmatter with `yaml.parse`, exactly as Pi does (`parseSkillFrontmatter`,
  `parsePromptTemplateFrontmatter`) — never a line scan. A multi-line `description:` (idiomatic for
  long ones) would read as empty → `loadable:false` → the skill is refused though Pi loads it.
  Match Pi on types: `disable-model-invocation` is `=== true`; malformed YAML degrades to "no
  frontmatter" rather than throwing. The root `yaml` dep tracks Pi's version.

## Skills
- Trust gate: spawn with `--no-skills` + one `--skill <dir>` per approved skill — additive, the ONE Pi
  behaviour the model rests on (`tests/skills-contract.test.ts`, `docs/validation/sk1.md`).
- Main resolves approved ∩ enabled ∩ active-for-workspace and writes the per-session manifest to
  `HV_SKILLS_FILE`. The bridge only REFLECTS it (never re-derives trust) to serve `use_skill`, detect
  raw SKILL.md reads, and report context weight.
- Bundled skills are pre-approved and ON by default; a bundle hash bump re-approves while KEEPING the
  user's on/off.
- Scopes: `<agentDir>/skills` (managed), `<runtimeDir>/skills` (bundled), linked dirs (global);
  `<workspace>/.agents/skills` (workspace).

## Prompt templates
- One `.md` FILE each, approved per file (`--prompt-template <file>`, never a directory — approving a
  folder would approve whatever lands in it later). `--no-prompt-templates` always ships.
- No `scriptCount` (a `` !`bash` `` risk pill instead — Pi silently drops that Claude Code feature)
  and no `loadable`/`error`: a description-less template still loads (Pi uses the first body line,
  60 chars).
- The bridge does no gating and there is NO manifest — Pi expands templates itself, so resting
  context cost is zero and templates are excluded from the gauge.
- Scopes: `<agentDir>/prompts`, `<runtimeDir>/prompts`, linked dirs (global);
  `<workspace>/.agents/prompts`. `.claude/commands` is NEVER auto-scanned — the app doesn't reach
  into another tool's directory unasked; the user imports or links it. `docs/validation/pt1.md`.
- A template whose name collides with a `/hv-*` command is silently unreachable: Pi matches extension
  commands first, yet the file still appears in `get_commands`. Hence the `shadowed` status and the
  import refusal. `RESERVED_SLASH_COMMANDS` is derived by `tests/prompt-templates-reserved.test.ts`
  from the bridge's `registerCommand` literals.
- The bridge's `input` hook sits in front of EVERY user prompt and must fail OPEN (it only captures
  the typed text before Pi expands a template over it). `undefined` continues; only
  `{action:"handled"}` swallows a prompt. `tests/prompt-templates-bridge.test.ts` asserts a plain
  prompt still completes BEFORE testing the feature — if that is red, revert the hook, not the test.
