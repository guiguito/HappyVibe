# PT1 — Prompt templates against pinned Pi 0.83.0

Measured 2026-08-02 against `@earendil-works/pi-coding-agent@0.83.0` as vendored in
`pi-runtime/`. PRD §24 is the product decision; this file is the evidence, written
so the next person does not re-derive it.

The design proposal was originally written against **0.80.10**. The pin moved to
0.83.0 before implementation. **No prompt-template behaviour changed between the
two** — there is no CHANGELOG entry touching prompt templates, `resources_discover`
or `get_commands` in that range. Only `agent-session.js` line numbers moved
(the expansion call went from ~`829` to `825`). Everything below is re-read from
0.83.0, not carried over.

## The gate

`--no-prompt-templates` plus `--prompt-template <path>` is the same additive pair
as `--no-skills` / `--skill`:

```js
// core/resource-loader.js:342-344
const promptPaths = this.noPromptTemplates
    ? this.mergePaths(cliEnabledPrompts, this.additionalPromptTemplatePaths)
    : this.mergePaths([...cliEnabledPrompts, ...enabledPrompts], this.additionalPromptTemplatePaths);
```

With `-np`, auto-discovered prompts are dropped and explicit `--prompt-template`
args survive. Pinned in both directions by `tests/resource-gate-contract.test.ts`.

### `--prompt-template` takes a file OR a directory

`core/prompt-templates.js:199-210` stats the path: a directory is scanned
**non-recursively** for `*.md`; a file is loaded directly; a non-`.md` file path is
**silently ignored**. HappyVibe passes **files**, one per approved prompt template, because
PRD §24 makes approval per-file — approving a directory would silently approve
whatever lands in it later.

That is not merely a policy choice, it is verified behaviour: the per-file arm of
`tests/resource-gate-contract.test.ts` plants a `sibling-cmd.md` next to
`approved-cmd.md` and asserts a file-scoped `--prompt-template` loads only the
latter. **Pi does not widen a file path to its parent directory.** The directory
arm asserts the sibling *is* loaded, so the per-file arm cannot pass vacuously.

## Discovery locations (what the gate turns off)

| Path | Gate |
| --- | --- |
| `<cwd>/.pi/prompts/*.md` | only when the project is trusted (`core/package-manager.js:1968`) |
| `<agentDir>/prompts/*.md` | always (`:1932`, `:1983`) |

Plus `prompts: [...]` arrays in settings and prompts shipped by `-e` packages.
Auto-discovery is **non-recursive** and honours `.gitignore`.

**Pi never reads `.claude/commands`, and there is no `.agents/prompts`.** Grep over
`dist` finds `.claude` only in a Bedrock model id. Both HappyVibe workspace
locations are therefore ours, reached by passing explicit paths — see PRD §24.

## Format

Name is always `basename(file, ".md")` (`core/prompt-templates.js:85`). There is
**no frontmatter `name` key**.

Only two frontmatter keys are read (`:81-109`): `description` and `argument-hint`.
Everything else — including `allowed-tools` — is parsed and discarded.

**A missing description does not block loading.** Pi falls back to the first
non-empty body line, `slice(0, 60)`, with `"..."` appended only when the line was
longer (`:88-96`). So prompt templates have no analogue of skills' `loadable`/`error`
axis, and `src/main/promptTemplates/discovery.ts` mirrors that fallback exactly —
including the fact that the slice is **not trimmed**, and that the body is
CRLF-normalised and trimmed only when frontmatter is present.

Substitution (`substituteArgs`, `:56-80`): `$1`, `$@`, `$ARGUMENTS`,
`${N:-default}`, `${@:N}`, `${@:N:L}`. **Not** implemented: bare `${1}`, `$*`,
nested substitution.

## Precedence — three traps

1. **Extension commands shadow prompt templates, silently.**
   `core/agent-session.js:799-806` matches `pi.registerCommand` names and
   `return`s *before* expansion at `:823-826`. A prompt file named `hv-plan` can
   never run, yet still appears in `get_commands` as `source:"prompt"`. Hence the
   `shadowed` status and the import refusal in PRD §24.
   `tests/prompt-templates-reserved.test.ts` derives the reserved set by scanning the
   bridge's own `registerCommand` literals, so the list cannot rot.

2. **Explicit paths are merged LAST and dedupe is first-wins.**
   `resource-loader.js:342-344` appends `additionalPromptTemplatePaths` after the
   discovered ones, and `dedupePrompts` (`:759-782`) keeps the *existing* entry on
   a name collision. So a `--prompt-template` would **lose** to a same-named
   discovered template. This is harmless for us only because we always pass
   `--no-prompt-templates`, which empties the discovered list — worth knowing
   before anyone considers dropping that flag.

3. **Prompt-vs-prompt collisions are first-wins with a diagnostic**, and prompt
   templates never get the `:2`/`:3` disambiguating suffix that extension
   commands get (`extensions/runner.js:413-421`).

## Expansion is mode-agnostic, and destroys the original

`AgentSession.prompt()` expands at `:823-826` and builds the user message from
`expandedText` alone (`:867-875`). RPC calls the same method with no override
(`modes/rpc/rpc-mode.js:297-318`), so this is not TUI-only.

**The original typed text is preserved nowhere** — not in the message history, not
in the session file, not on any RPC event. `message_start` / `message_end` /
`entry_appended` all carry the expansion. `queue_update` carries the expansion too,
which is why a steered prompt template used to render differently from an idle one.

Two adjacent hooks straddle the expansion in the same call stack:

| hook | fires | carries |
| --- | --- | --- |
| `input` | `agent-session.js:810` | the **original** typed text |
| `before_agent_start` | `agent-session.js:882` | the **expanded** text (`prompt` field) |

so pairing them is exact, not heuristic. That is the whole of
`pi-runtime/extensions/hv-prompt-templates.ts`.

### The `input` hook fails open — verified, not assumed

`extensions/runner.js:933-955` wraps every `input` handler in try/catch and
reports an `extension_error` rather than aborting the prompt; a handler returning
`undefined` falls through to `{action:"continue"}` (`:958-960`). Only an explicit
`{action:"handled"}` swallows a prompt. The bridge additionally wraps its own body,
because the failure mode here is "no user prompt reaches the model" and a
transcript nicety must never be able to cause that — same rule as
`before_provider_request` in `tc1.md`.

`tests/prompt-templates-bridge.test.ts` asserts the fail-open case **first**, before the
feature itself. If that assertion is red, revert the hook.

## `get_commands`

`RpcSlashCommand` (`modes/rpc/rpc-types.d.ts:135-144`) is
`{ name, description?, source: "extension" | "prompt" | "skill", sourceInfo }`.
Names carry **no leading slash**.

**`argumentHint` is not in the response.** It exists on the template object
(`core/prompt-templates.js:100`) but is only consumed by the TUI autocomplete. An
RPC client cannot get argument hints from Pi — HappyVibe's composer gets them by
joining `get_commands` against main's own scan by name.

## Rejected: `resources_discover` as a hot-reload path

The hook is real (`extensions/types.d.ts:402-413`), is genuinely **additive**
(`resource-loader.js:229-254`), and does work under `--no-prompt-templates`
(the `noPromptTemplates && promptPaths.length === 0` bail at `:523` does not
trigger when an extension supplies paths). It was still rejected:

- It fires **only at session boundaries** — `bindExtensions` and `session.reload()`
  (`agent-session.js:1761-1762`, `:2070-2071`). Never per-turn, and there is no
  filesystem watcher.
- `extendResources` **merges and never removes**, so a *deleted* command would
  survive until a full reload anyway.
- Reaching it needs `ctx.reload()`, which tears down and rebuilds the whole
  extension runtime.

So it buys nothing over the existing debounced respawn-resume path that MCP and
skills already share, and adds a second reload mechanism to reason about.
Revisit only if command editing turns out to want sub-respawn feedback.
