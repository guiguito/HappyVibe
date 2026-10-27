# Fewer Permission Prompts (Round 29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut permission prompts that protect nothing (edits inside the workspace, read-only shell commands, read-only sub-agents, grants lost on respawn) and close the two command-rule holes, without widening what the agent can reach.

**Architecture:** Almost everything lands in the one pure engine (`hv-rules.ts`) plus a new import-free shell module (`hv-shell.ts`) that takes plan mode's ported classifier unchanged, so the bridge, the child guard, main's "test a call" and the tests all inherit it. The bridge adds the read-only-delegation default and a `commandGrant` field on shell prompts; main keeps session grants across respawns and reports when each rule last decided a call.

**Tech Stack:** TypeScript, vitest (no DOM), Electron main/renderer, Pi extension (bridge).

**Spec:** Notion "Feedbacks v17 — fewer permission prompts" (`406d33dfffca81528ce9dc077fac5b3e`) and `docs/prd.md` §10 "Decision (Feedback round 29, 2026-10-27)". Read both before starting.

## Global Constraints

- `hv-rules.ts`, `hv-shell.ts`, `hv-paths.ts` stay import-free except `hv-rules → hv-shell → hv-paths` (renderer and vitest import them).
- The classifier moves VERBATIM from `hv-plan.ts` ("ported verbatim, do not relax") — wrap it, never edit it.
- Read-only safe default is `bash` only — not `powershell`, not `terminal_run`.
- Protected edit paths: any path part starting with `.`, and `AGENTS.md`/`CLAUDE.md` at any depth, any letter case.
- Command grants: program + subcommand for `npm`, `npx`, `pnpm`, `yarn`, `git`, `uv`, and `python -m`/`python3 -m`; program alone otherwise; never offered for `bash`, `sh`, `zsh`, `fish`, `dash`, `eval`, `env`, `sudo`, `xargs`, `exec`, `command`, `nohup`, `time`, `powershell`, `pwsh`.
- Deny/ask wrappers skipped: leading `VAR=value`, `env`, `command`, `exec`, `nohup`, `time`, `sudo`, `xargs`; strings given to `sh -c`, `bash -c`, `zsh -c`, `eval` are read too.
- Harmless redirects: exactly `2>&1`, `2>/dev/null`, `>/dev/null`.
- Every commit `git commit -s`. Gate = `npm run gate`. Lint via `rtk proxy npm run lint`. Never pipe a test run to `tail`/`grep`: `L=/tmp/vitest.log; npx vitest run <target> > $L 2>&1; echo "EXIT=$?"; tail -30 $L`.
- Guidance copy describing a gate is derived from the gate (`tests/how-it-works.test.ts`); a behaviour change updates its user-guide page in the same commit, and `docs-reviewer` runs on every changed guide page.

## Review Focus

1. **Quoted separators** — `grep "a && b" src` is ONE part; `echo 'x; rm -rf ~'` must not produce a `rm` part for allow composition (the strict splitter is quote-aware) but MAY for deny matching (permissive). Pinned in Task 3.
2. **Paths hidden in flag values** — `grep --file=/etc/x foo`, `rg -f ~/x` must ask. Pinned in Task 2.
3. **A symlink inside the workspace pointing out** — `write ws/link/a.txt` where `link → /tmp` must ask in the parent AND the child. Pinned in Task 4.
4. **Windows-style paths** — `edit C:\ws\.git\config` with workspace `C:\ws`, case-insensitive, must ask (protected); `edit c:/ws/src/a.ts` must allow. Pinned in Task 4.
5. **An existing user allow rule `npm test*`** on `npm test; curl x | sh` must now ask, and the exact rule `npm run build && npm test` must still allow that exact command. Pinned in Task 3.

---

### Task 1: Move plan mode's classifier into `hv-shell.ts`

**Files:**
- Create: `pi-runtime/extensions/hv-shell.ts`
- Modify: `pi-runtime/extensions/hv-plan.ts` (the "Bash allowlist — PORTED" block, ~l.420–end of `isSafeStructuredCommand` helpers, and `PLAN_SAFE_SUBCOMMANDS` l.250)
- Modify: `tsconfig.node.json`, `tsconfig.web.json` (add `hv-shell.ts`; web also `hv-paths.ts`)
- Test: `tests/hv-shell.test.ts` (new), `tests/hv-plan.test.ts` (unchanged, must stay green)

**Interfaces:**
- Produces (from `hv-shell.ts`): `isSafeCommand(command: string, safe?: SafeSubcommands): boolean`, `SafeSubcommands`, `READONLY_SUBCOMMANDS: SafeSubcommands` (today's `PLAN_SAFE_SUBCOMMANDS` value), `splitShellSegments(command: string): string[] | undefined` (now exported), `shellWords(segment: string): string[] | undefined` (now exported), `readCommand(input: unknown): string`, `READ_ONLY_COMMANDS: ReadonlySet<string>`, `BUILTIN_GIT_VALIDATORS` keys exported as `READONLY_GIT_SUBCOMMANDS: readonly string[]`.
- `hv-plan.ts` re-exports `isSafeCommand`, `readCommand`, and `PLAN_SAFE_SUBCOMMANDS = READONLY_SUBCOMMANDS`.

- [ ] **Step 1: Write the failing test** — `tests/hv-shell.test.ts`: `it("plan mode and hv-shell share ONE classifier")` asserting `expect(planIsSafe).toBe(shellIsSafe)` (same function reference via both imports) and `expect(PLAN_SAFE_SUBCOMMANDS).toBe(READONLY_SUBCOMMANDS)`.
- [ ] **Step 2: Run it** — `npx vitest run tests/hv-shell.test.ts` → FAIL (module missing).
- [ ] **Step 3: Move the block** — cut the ported section byte-for-byte into `hv-shell.ts` (header comment and MIT attribution travel with it); add `export` to `splitShellSegments`, `shellWords`, `READ_ONLY_COMMANDS`; `hv-plan.ts` imports and re-exports. `hv-shell.ts` imports nothing in this task.
- [ ] **Step 4: Run** — `npx vitest run tests/hv-shell.test.ts tests/hv-plan.test.ts` → PASS; `git diff --stat` shows the block moved, not edited (`git diff -M --color-moved` shows it as moved).
- [ ] **Step 5: Commit** — `git commit -s -m "refactor(permissions): move plan mode's read-only shell classifier to hv-shell"`

### Task 2: The read-only shell check (wrapper around the classifier)

**Files:**
- Modify: `pi-runtime/extensions/hv-shell.ts`
- Test: `tests/hv-shell.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `containsPath`, `isAbsolutePath`, `toPosix` from `hv-paths.ts`.
- Produces:
  - `stripHarmlessRedirects(cmd: string): string` — removes unquoted `2>&1`, `2>/dev/null`, `>/dev/null` tokens only.
  - `commandParts(cmd: string): string[] | null` — `splitShellSegments(stripHarmlessRedirects(cmd))`, `null` when it returns `undefined` (substitution, here-doc, redirect into a file, `(`, newline, backtick, unbalanced quote).
  - `isReadOnlyPart(part: string, workspace: string, caseInsensitive?: boolean): boolean` — `cd <dir>` with `<dir>` inside the workspace (relative, or absolute under it); otherwise first word ≠ `printenv`, every path-looking word (starts with `/`, `~`, a drive letter or `\\`, or contains a `..` segment — including the value after `=` in `--flag=value`) inside the workspace, and `isSafeCommand(part, READONLY_SUBCOMMANDS)`.
  - `isReadOnlyShellCommand(cmd: string, workspace: string, caseInsensitive?: boolean): boolean` — `commandParts` non-null, non-empty, every part `isReadOnlyPart`.
  - `READ_ONLY_SHELL_SUMMARY: readonly string[]` — display list DERIVED from `READ_ONLY_COMMANDS` minus `printenv`, plus `git <sub>` for each of `READONLY_GIT_SUBCOMMANDS` and `READONLY_SUBCOMMANDS.git`, `gh <sub>` for `READONLY_SUBCOMMANDS.gh`, and `sed -n 'N,Mp'`. Never a hand-typed second list.

- [ ] **Step 1: Write the failing tests** — `describe("isReadOnlyShellCommand", …)` with workspace `/ws`, a table:
  - true: `ls`, `git status`, `git log --oneline -5`, `grep -rn foo src 2>/dev/null | head -20`, `cd /ws/src && cat a.ts`, `cd src && wc -l a.ts`, `sed -n '120,160p' src/a.ts`, `rg foo`.
  - false: `npm test 2>&1 | tail -5` (npm test is not read-only), `cat ~/.ssh/id_rsa`, `cat /etc/passwd`, `cd /tmp && ls`, `cd src && cat ../../x`, `printenv`, `printenv AWS_SECRET_ACCESS_KEY`, `sed -i s/a/b/ x`, `find . -delete`, `rg --pre sh foo`, `ls > out.txt`, `cat "$HOME/x"`, `echo $(whoami)`, `grep -f /etc/x foo`, `grep --file=/etc/x foo`, `ls src/*.ts` (glob — the classifier asks), `curl https://x`.
  - `it("the displayed list is derived and never lists printenv")`: `READ_ONLY_SHELL_SUMMARY` contains `"ls"` and `"git status"`, does not contain `"printenv"`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the five exports in `hv-shell.ts` (add `import { containsPath, isAbsolutePath, toPosix } from "./hv-paths";`).
- [ ] **Step 4: Run** `npx vitest run tests/hv-shell.test.ts tests/hv-plan.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(permissions): read-only shell check, workspace-confined, around plan mode's classifier`

### Task 3: Command rules read each part (holes 1 and 2), trailing ` *`, escaped wildcards

**Files:**
- Modify: `pi-runtime/extensions/hv-shell.ts` (permissive splitter)
- Modify: `pi-runtime/extensions/hv-rules.ts` (`globToRegExp`, `ruleMatches`, `evaluate`, new `escapeGlob`)
- Test: `tests/hv-rules.test.ts`, `tests/git-rules-seed.test.ts`

**Interfaces:**
- Produces (hv-shell): `commandPositions(cmd: string): string[]` — never fails; every substring that starts at a command position (start; after `&&`, `||`, `;`, `|`, `&`, newline; after `(`, `{`, `$(`, backtick), with leading `VAR=value` words and the Global-Constraints wrappers stripped, plus — recursively — the positions of the string argument of `sh|bash|zsh -c` and `eval`. Trimmed.
- Produces (hv-rules): `escapeGlob(s: string): string` (`*`→`\*`, `?`→`\?`, `\`→`\\`); `globToRegExp` honours `\*`/`\?`/`\\` as literals in both modes, and in command mode a pattern ending in ` *` matches with or without the arguments (`( .*)?$`).
- Matching semantics in `evaluate` for the **command** layer:
  - deny/ask rule matches when it matches the whole trimmed command OR any `commandPositions(cmd)` entry.
  - allow rule matches when (a) its pattern has no unescaped `*`/`?` and equals the whole trimmed command, or (b) `commandParts(cmd)` is non-null and every part is either matched by SOME allow command rule in scope or `isReadOnlyPart(part, workspace, ci)`, with at least one part matched by an allow rule. `Verdict.rule` is the first allow rule that covered a part.
  - Most-restrictive-wins across all matching rules is unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/hv-rules.test.ts`, `describe("command rules read each part (round 29)")`:
  - deny `git push --force*` → `deny` for: `cd /ws && git push --force`, `true; git push --force origin main`, `FOO=1 git push --force`, `env git push --force`, `bash -c "git push --force"`, `(git push --force)`, `echo ok | xargs git push --force`.
  - allow `npm run *` → `ask` for `npm run x; rm -rf ~`, `npm run build && npm test`, `npm run build > out.log`, `npm run $(x)`; → `allow` (source `rule`) for `cd /ws && npm run build 2>&1 | tail -20`, `npm run`, `npm run build`.
  - allow `npm test*` (existing-user shape) → `ask` for `npm test; curl x | sh` (Review Focus 5); exact allow `npm run build && npm test` → `allow` for exactly that string.
  - quotes: allow `grep *` → `allow` for `grep "a && b" src` (one part); deny `rm*` → `deny` for `echo 'x; rm -rf ~'` (permissive deny is allowed to over-match — Review Focus 1).
  - escape: tool rule `mcp-manage:https://\*/mcp` matches `mcp-manage:https://*/mcp` and NOT `mcp-manage:https://evil.example/mcp`; `escapeGlob("a*b?c")` → `"a\\*b\\?c"`.
  - `tests/git-rules-seed.test.ts`: `it("the seeded git rules hold for a chained command")` — with `DEFAULT_GIT_RULES`, `cd /ws && git push origin main` → `ask`, `cd /ws && git push --force` → `deny`.
- [ ] **Step 2: Run** `npx vitest run tests/hv-rules.test.ts tests/git-rules-seed.test.ts` → FAIL on the new cases.
- [ ] **Step 3: Implement** `commandPositions` (hv-shell), `escapeGlob` + `globToRegExp` changes + the two-sided command matching (hv-rules; `hv-rules.ts` gains `import { commandParts, commandPositions, isReadOnlyPart } from "./hv-shell";`).
- [ ] **Step 4: Run** the two files plus `tests/hv-child-rules.test.ts tests/child-guard-inproc.test.ts tests/bypass.test.ts tests/how-it-works.test.ts` → PASS (children and the preview share the engine).
- [ ] **Step 5: Commit** — `fix(permissions): command rules check every part of a chained command`

### Task 4: Safe defaults — edits inside the workspace, read-only bash

**Files:**
- Modify: `pi-runtime/extensions/hv-rules.ts` (`ToolCall`, `evaluate`, new exports)
- Modify: `pi-runtime/extensions/hv-child-guard.ts` (export `resolveThroughLinks`; pass `realPath` into the `childDecision` call in `guardDecision`)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (pass `realPath` on BOTH `evaluate` calls in `tool_call`, l.~1277 and l.~1298)
- Test: `tests/hv-rules.test.ts`, `tests/hv-child-rules.test.ts`, `tests/child-guard-inproc.test.ts`, `tests/how-it-works.test.ts`

**Interfaces:**
- Produces (hv-rules): `WORKSPACE_EDIT_TOOLS: ReadonlySet<string>` = `write`, `edit`; `isProtectedPath(relPosix: string, caseInsensitive?: boolean): boolean`; `ToolCall.realPath?: (p: string) => string` (absent in main's preview — documented there as the one place a symlink is not followed).
- `evaluate` order after the existing outside-workspace check: (1) `WORKSPACE_EDIT_TOOLS` with ≥1 path arg, every path inside (and, with `realPath`, its resolved form inside the resolved workspace), none protected → `{action:"allow", source:"safe-default"}`; (2) `call.tool === "bash"` and `isReadOnlyShellCommand(command, workspace, ci)` → same; then the existing `SAFE_TOOLS` line.

- [ ] **Step 1: Write the failing tests** (`tests/hv-rules.test.ts`, `describe("safe defaults (round 29)")`, workspace `/ws`, no rules):
  - edit/write `src/a.ts`, `/ws/src/a.ts`, `docs/notes.md` → allow `safe-default`.
  - ask `default`: `.env`, `.git/hooks/pre-commit`, `.github/workflows/ci.yml`, `.pi/settings.json`, `.agents/plans/001-x.md`, `AGENTS.md`, `packages/api/AGENTS.md`, `agents.md`, `CLAUDE.md`.
  - ask `outside-workspace`: `../x.ts`, `/tmp/x.ts`, `~/x.ts`.
  - `realPath` mapping `/ws/link/a.txt → /tmp/a.txt` → ask (Review Focus 3).
  - Windows, `caseInsensitivePaths: true`, workspace `C:\ws`: `C:\ws\.git\config` → ask; `c:/ws/src/a.ts` → allow (Review Focus 4).
  - an `ask` tool rule on `edit` → ask, source `rule`.
  - bash `git status` → allow `safe-default`; `cat ~/.ssh/id_rsa` → ask `default`; powershell `ls` → ask; terminal_run `ls` → ask.
  - `hv-child-rules.test.ts`: `it("a child's edit inside the workspace is a safe default")` → `childDecision(EMPTY_RULES, call("edit", {path:"/ws/a.ts"}), open).action === "allow"`.
  - `child-guard-inproc.test.ts`: a `write` to `path.join(ws, "link", "a.txt")` where `link` is a real symlink to `os.tmpdir()` → deny (parent-side resolver reaches the child too).
- [ ] **Step 2: Update tests whose premise moved** — `hv-child-rules.test.ts` l.24/l.30 use `call("bash", { command: "npm install" })` instead of `write /ws/a.ts`; `child-guard-inproc.test.ts` l.31 uses `.env`; `how-it-works.test.ts` l.64 uses `npm install`; re-read every `write`/`edit`/`bash` case in `hv-rules.test.ts` (l.237–259) and keep each testing what its name says (protected path or non-read-only command where it relied on the old default).
- [ ] **Step 3: Run** → FAIL on the new cases.
- [ ] **Step 4: Implement** in hv-rules; export `resolveThroughLinks` from hv-child-guard and pass `realPath: resolveThroughLinks` (wrapped to `path.resolve(workspace, p)` first) from the bridge and from `guardDecision`.
- [ ] **Step 5: Run** `npx vitest run tests/hv-rules.test.ts tests/hv-child-rules.test.ts tests/child-guard-inproc.test.ts tests/child-write-confine.test.ts tests/how-it-works.test.ts` → PASS.
- [ ] **Step 6: Commit** — `feat(permissions): edits inside the workspace and read-only shell commands run without asking`

### Task 5: Read-only sub-agents start without asking (in and out of plan mode)

**Files:**
- Modify: `pi-runtime/extensions/hv-plan.ts` (`resolvePlanVerdict` l.292; `buildPlanPrompt` `delegateClause`)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (`tool_call`, after the `v.action === "allow"` block, before the session-grant check)
- Modify: `src/renderer/src/components/HowItWorks.tsx` (plan body sentence on sub-agents)
- Test: `tests/hv-plan.test.ts`, `tests/how-it-works.test.ts`, live `tests/tw-gate-bridge.test.ts`

**Interfaces:**
- Consumes: `isReadOnlyBoundary` (`hv-subagent-boundary.ts`).
- Bridge rule: `boundary && !planFloorAsk && v.source === "default" && isReadOnlyBoundary(boundary.tools)` → audit `{decision:"allow", source:"safe-default"}`, `grantBoundary()`, return. An explicit ask rule (`v.source === "rule"`) still prompts.
- `resolvePlanVerdict`: read-only boundary → `{ kind: "pass" }` (was `floor-ask`).
- New `delegateClause` text (exact): ` Delegating to a read-only sub-agent starts without asking, and it is the most useful thing a planning session can do; a sub-agent that can change things needs the user's approval first.`

- [ ] **Step 1: Failing tests** — `hv-plan.test.ts`: `resolvePlanVerdict({kind:"needs-boundary"}, {agent:"code-explorer", tools:["find","grep","ls","read"]})` → `{kind:"pass"}`; with `["read","write"]` still `block`. `how-it-works.test.ts`: `buildPlanPrompt()` contains the exact new clause and not `the user approves its\nboundary first`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/hv-plan.test.ts tests/how-it-works.test.ts tests/plan-renderer.test.ts` → PASS.
- [ ] **Step 5: Update the live test** `tests/tw-gate-bridge.test.ts`: the prompt test (l.~67–76) delegates to `worker` (write-capable) and asserts `b.writeCapable` contains `"write"`; a new case asserts a `code-explorer` delegation raises NO `hv.permission` for `subagent:code-explorer` and audits `{tool:"subagent:code-explorer", decision:"allow", source:"safe-default"}`. Re-ask with `askUntil`, never a longer timeout.
- [ ] **Step 6: Commit** — `feat(subagents): read-only delegations start without asking, plan mode included`

### Task 6: "Allow for session" survives respawns until the app quits

**Files:**
- Create: `src/main/sessionGrants.ts`
- Modify: `src/main/pi/spawn.ts` (`grants?: string[]` option → `HV_GRANTS` env, beside `HV_BYPASS` l.~293)
- Modify: `src/main/ipc.ts` (audit sink l.~1819; `spawnOpts` l.1022; `runMcpReloadPass` l.~2910; `hv:close-session` l.3352; `hv:delete-session` l.3381)
- Modify: `pi-runtime/extensions/hv-rules.ts` (`parseGrants`), `pi-runtime/extensions/happyvibe-bridge.ts` (l.47 seeds `sessionGrants`)
- Test: `tests/session-grants.test.ts` (new), `tests/grants-spawn.test.ts` (new), `tests/hv-rules.test.ts`

**Interfaces:**
- Produces: `class SessionGrants { record(sessionId: string, permTool: string): void; list(sessionId: string): string[]; dropMcp(sessionId: string): void; forget(sessionId: string): void }` (in-memory `Map<string, Set<string>>`; `dropMcp` removes entries starting `mcp:`).
- `parseGrants(raw: string | undefined): string[]` — JSON array of non-empty strings, anything else → `[]` (fail closed = fewer grants).
- ipc: record when a parsed audit row has `decision === "allow-session"`; `spawnOpts` adds `grants: sessionId ? grants.list(sessionId) : undefined`; `runMcpReloadPass` calls `grants.dropMcp(id)` for each affected id whose `reason === "mcp"`; close/delete call `grants.forget`. NOT on session exit (a respawn is an exit). Fork/duplicate need nothing (new id).

- [ ] **Step 1: Failing tests** — `session-grants.test.ts`: record/list per session; two sessions independent; `dropMcp` keeps `bash`, drops `mcp:notion_search`; `forget` empties. `grants-spawn.test.ts`: `resolvePiSpawn(…, { grants: ["bash","mcp:x_y"] })` env has `HV_GRANTS === '["bash","mcp:x_y"]'`; no `grants` / `[]` → no `HV_GRANTS` key. `hv-rules.test.ts`: `parseGrants('["bash"]')` → `["bash"]`; `parseGrants("nope")`, `parseGrants(undefined)`, `parseGrants('[1,""]')` → `[]`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the three files + `tests/tool-switches-spawn.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(permissions): session grants survive respawns until the app quits`

### Task 7: One-click command grants on shell prompts

**Files:**
- Modify: `pi-runtime/extensions/hv-rules.ts` (`commandGrantPatterns`)
- Modify: `pi-runtime/extensions/happyvibe-bridge.ts` (prompt envelope, l.~1345–1360)
- Modify: `src/renderer/src/permission.ts` (`PermissionInfo.commandGrant`, `parsePermission`)
- Modify: `src/renderer/src/components/PermissionModal.tsx` (choices + pattern line)
- Modify: `src/renderer/src/App.tsx` (`respondPermission`, l.~3039)
- Modify: `src/preload/index.ts` l.339, `src/renderer/src/hv.d.ts` l.1042, `src/main/ipc.ts` `hv:add-permission-rule` l.~4378
- Modify: `docs/validation/d1.md` (new `commandGrant` field on `hv.permission`, new `HV_GRANTS` env)
- Test: `tests/hv-rules.test.ts`, `tests/permission-command-grant.test.ts` (new), `tests/permission-workspace-grant.test.ts`

**Interfaces:**
- `commandGrantPatterns(cmd: string, workspace: string, caseInsensitive?: boolean): string[] | null` — `null` when `commandParts` is null or any non-read-only part starts with `VAR=` or its program is in the Global-Constraints never-offer list; otherwise one `escapeGlob(prefix) + " *"` per part that is not `isReadOnlyPart`, deduped, in order.
- Envelope: for `isShellTool(tool) || tool === "terminal_run"` prompts (not outside-workspace ones), `commandGrant: string[] | null` is always present.
- Renderer: `PermissionInfo.commandGrant?: string[] | null`; `export function persistentChoices(info: PermissionInfo): PermissionChoice[]` — `EXPANDED_CHOICES` minus "Allow for workspace"/"Always allow" when `info.commandGrant === null`; unchanged otherwise. `export const commandGrantLine = (p: string[]): string => \`“Allow for workspace” and “Always allow” save: ${p.join(", ")}\``.
- IPC: `addPermissionRule(workspace: string | null, tool: string, commands?: string[])` — with `commands`, append one `{layer:"command", pattern, action:"allow"}` per entry (already escaped by the bridge); without, the tool-layer rule stores `escapeGlob(tool)`. Dedup unchanged.

- [ ] **Step 1: Failing tests** — `hv-rules.test.ts` `describe("commandGrantPatterns")`: `npm run build` → `["npm run *"]`; `cd /ws && npm run build 2>&1 | tail -20` → `["npm run *"]`; `npm run build && npm test` → `["npm run *","npm test *"]`; `node scripts/x.mjs` → `["node *"]`; `python3 -m pytest -q` → `["python3 -m pytest *"]`; `git commit -m x` → `["git commit *"]`; `bash -c "x"`, `sudo rm x`, `FOO=1 npm test`, `npm run $(x)`, `cat <<EOF\nx\nEOF`, `npm run build > out.log` → `null`; `ls` → `[]`. `permission-command-grant.test.ts`: `parsePermission` keeps `commandGrant` array and `null`; `persistentChoices({…, commandGrant:null})` has no "Always allow"/"Allow for workspace"; `commandGrantLine(["npm run *"])` exact string. `permission-workspace-grant.test.ts`: tool grant `mcp-manage:https://*/mcp` is stored as `mcp-manage:https://\*/mcp`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (modal renders `commandGrantLine` under the summary when `info.commandGrant?.length`). **Step 4: Run** the three files + `tests/permission-workflow.test.ts tests/permission-queue.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(permissions): "Always allow" on a shell prompt saves a command rule, not the shell`

### Task 8: Each rule shows when it last decided a call

**Files:**
- Modify: `pi-runtime/extensions/hv-child-rules.ts` (`ChildDecision.rule`), `hv-child-guard.ts` (`guardDecision` + `report` carry `rule`), `happyvibe-bridge.ts` (policy `audit` forwards `rule`)
- Create: `src/main/ruleUsage.ts`
- Modify: `src/main/ipc.ts` (`hv:rules-last-decided`), `src/preload/index.ts`, `src/renderer/src/hv.d.ts`, `src/renderer/src/components/PermissionRulesSection.tsx`
- Test: `tests/rule-usage.test.ts` (new), `tests/hv-child-rules.test.ts`

**Interfaces:**
- `ruleKey(r: { layer: string; pattern: string; action: string; scope: "global" | "workspace" }, workspace?: string): string` → `${scope}|${scope === "workspace" ? normPath(workspace) : ""}|${layer}|${action}|${pattern}`.
- `lastDecided(rows: { ts: string; workspaceId?: string; data?: { rule?: {layer:string;pattern:string;action:string;scope:"global"|"workspace"} } }[]): Record<string, string>` — latest `ts` per `ruleKey`, workspace rows keyed by the row's `workspaceId`.
- IPC `hv:rules-last-decided` → `lastDecided(await log.read({ type: "permission.decision" }))`.
- Row copy (exact): `Last decided a call ${timeagoLong(ts)}` / `Never decided a call` (reuse `timeagoLong`, `src/renderer/src/timeago.ts`).

- [ ] **Step 1: Failing tests** — `rule-usage.test.ts`: latest of two rows wins; a workspace rule is keyed by its workspace (two workspaces don't collide); rows without `rule` are ignored; a bypass row carrying `rule` counts. `hv-child-rules.test.ts`: an allow command rule's decision carries `rule.pattern`. Source scan of `PermissionRulesSection.tsx` contains `Never decided a call` and `Last decided a call`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the two files + `tests/audit-filters.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(permissions): every rule shows when it last decided a call`

### Task 9: Copy, guide, rules files

**Files:**
- Modify: `src/renderer/src/components/HowItWorks.tsx` (`rules.body`), `PermissionRulesSection.tsx` (subtitle, command-layer note, read-only list from `READ_ONLY_SHELL_SUMMARY`), `tests/how-it-works.test.ts`
- Modify: `docs/guide/src/content/docs/permissions.md`, `docs/guide/src/content/docs/approve-a-tool-call.md`
- Modify: `.claude/rules/permissions-plan.md` (session-grant bullet; new bullet: the engine's safe defaults and `hv-shell.ts`), `AGENTS.md` (import hygiene: `hv-shell.ts` imports only `hv-paths`)

**Exact copy:**
- HowItWorks, replace the no-match sentence with: `When no rule matches, a short list of safe tools runs on its own, and so do edits inside the workspace, read-only shell commands and read-only sub-agents; everything else asks you.` Replace the session sentence with: `“Allow for session” lasts until you close the session or quit HappyVibe, through any restart in between; changing MCP configuration clears it for MCP tools only.`
- PermissionRulesSection subtitle: `With no match, safe tools, edits inside the workspace and read-only shell commands run on their own, and everything else asks you.`
- Command-layer note: `A command rule checks every part of a chained command. It guards against mistakes; it is not a sandbox.`
- List heading: `Shell commands that run without asking`.

- [ ] **Step 1: Update `how-it-works.test.ts`** — derive each claim from `evaluate` (an inside edit, `git status`, a protected `.env` edit asks) and pin the exact strings above; drop the old strings (`gone when the session restarts`, `With no match, a short list of safe tools runs on its own and everything else asks you.`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Change the copy.** **Step 4: Run** `npx vitest run tests/how-it-works.test.ts` → PASS.
- [ ] **Step 5: Guide pages** — rewrite only the paragraphs that change: permissions.md l.20 (quoted subtitle), l.87–96 ("Turn Always allow into a rule": a shell prompt saves a command rule, the buttons vanish for shells/wrappers), l.122–125 (session grants until quit; MCP change), add the "Last decided" line and the read-only list; approve-a-tool-call.md: the pattern line on shell prompts. Run the `docs-reviewer` agent on both pages and fix every finding.
- [ ] **Step 6: Commit** — `docs(permissions): copy, guide and rules for round 29`

### Task 10: Gate, live batch, GUI pass

- [ ] **Step 1:** `npm run gate` → exit 0. `rtk proxy npm run lint` clean.
- [ ] **Step 2:** commit, then `npm run live:why`; it will name bridge-touching live files — run `npm run test:live` with `run_in_background` (worktree: `ln -s ~/Documents/Github/HappyVibe/.env .env` first; ~7–8 min is the real-run tell). Before believing a failure: `pgrep -fl electron-vite`, provider balance, rerun the file alone.
- [ ] **Step 3:** GUI pass (below), with the dev app on `--remoteDebuggingPort=9333` (`/uicheck`). Restart the dev server after main-side changes; grep `out/main/index.js` for `HV_GRANTS` before claiming it's live.
- [ ] **Step 4:** Release note for the next `/release` (changelog skill, not now): **Heads up** — the agent edits files in your project without asking (add an `ask` rule on `edit`/`write` to go back), and a command allow rule now needs every part of a chained command covered.

## Verification — what must be TRUE on screen

Fresh workspace with NO rules (move `permission-rules.json` aside for the pass, restore after).

1. **Edits** — chat: ask "add a line to src/notes.ts". Observed in the **chat pane**: the edit card appears and **no permission dialog** opens. Ask "add FOO=1 to .env": a dialog opens naming `.env`. Ask "edit AGENTS.md": a dialog opens.
2. **Read-only shell** — chat: "run git status, then ls". Observed in the **chat pane**: both cards run with **no dialog**. "run cat ~/.zshrc": a dialog opens. Observed on **Settings → Audit log**: the `git status` row's source reads the safe-default label, not "user".
3. **Command grant** — chat: "run npm run build". The dialog shows `“Allow for workspace” and “Always allow” save: npm run *`. Click **Always allow**. Observed on **Settings → Permissions**: a new row `command · npm run * · allow`; **absent**: any `tool · bash · allow` row created by that click.
4. **No grant for shells** — chat: `run bash -c "echo hi"`. The dialog shows exactly **Allow · Allow for session · Deny** — **"Always allow" and "Allow for workspace" are absent**.
5. **Chained git** — with the seeded git rules: "run cd <workspace> && git push --dry-run". A dialog opens (it used to run silently).
6. **Sub-agents** — "delegate listing the files to code-explorer": a run card appears, **no dialog**. "delegate a small edit to worker": a dialog with the boundary ("It can change things with: bash, edit, write"). Turn plan mode on, delegate to code-explorer again: **no dialog**.
7. **Grants through a restart** — session A: run `npm install`, choose **Allow for session**. Open session B in the same workspace, run `npm install`: B **asks** (grants are per session). Change MCP configuration (add/remove a server) so A reloads; in A run `npm install` again: **no dialog**. Fork A from its last message, run `npm install` in the fork: it **asks**. Quit the app, relaunch, resume A, run `npm install`: it **asks**.
8. **Last decided** — **Settings → Permissions**: every rule row carries "Last decided a call … ago" or "Never decided a call"; the `npm run *` rule from step 3 reads "just now" or "Nm ago". In a **workspace's settings** (workspace rules list) the same line appears per row.
9. **Read-only list** — **Settings → Permissions** shows "Shell commands that run without asking" listing `ls` and `git status`; **`printenv` is absent**.

**The regression this design risks** (perform it): with the seeded git rules present, open session A, choose **Always allow** on an `npm run build` prompt, then ask for `npm run build && git push origin main`. Expected: a dialog opens for the `git push` part — the new allow rule must not carry the chain past the ask rule.
