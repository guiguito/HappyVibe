# Docs round: app bugs found while writing the user guide — verified and decided

Found 2026-09-28/29 while every guide page was written from the code and reviewed twice
(`.claude/agents/docs-reviewer.md`); the guide routes readers around each one. **Verified 2026-09-29**
against `728debf` by reading the code end to end (line numbers are as of that commit), and decided in
the same session. Implementation plan: `docs/superpowers/plans/2026-09-29-docs-round-fixes.md`.

Every fix below that changes what a screen does or says also updates the guide page named with it,
in the same commit (CLAUDE.md, "Docs workflow").

**Fixed 2026-09-29** on `guiguito/fixes` (commits `60ddd74..HEAD`): every item below except the closed ones, plus a cleanup batch of review follow-ups. Gate green; live batch green (24/25 in the batch, the 25th green on a solo rerun, see Open below); guide build and docs-reviewer pass clean. The GUI pass is still outstanding.

Still to confirm live, because the code alone can't settle it: the keyboard half of #4 (xterm's paste
handler), #25 and #34 (what the adapter does with the call).

## Trust and safety (fix first)

34. **The agent can install an MCP server with no prompt.** `unwrapMcpCall` classes every `action` as
    discovery (`pi-runtime/extensions/hv-mcp.ts:73-74`) and the bridge auto-allows discovery
    (`happyvibe-bridge.ts:1280`). The adapter routes `mcp({action:"install", url})` to `executeInstall`
    (`pi-mcp-adapter/index.ts:1815`), which connects to the URL and then writes the server into the
    global or project `mcp.json`: an outbound request to any HTTPS URL plus a persistent config write,
    past the web-host gate. The classifier also checks keys in a different order from the adapter
    (ours: tool → search → describe → connect → action; the adapter's: action → tool → connect →
    describe → instructions → search), so `{tool:"x", action:"install"}` is gated as `mcp:x` while the
    adapter runs an install.
    **Decision: ask.** The classifier follows the adapter's dispatch order: `action` first.
    `ui-messages` stays discovery. `install`, `auth-start` and `auth-complete` become a new `manage`
    kind that asks by default, with a factual prompt ("MCP: install `https://…` into your global MCP
    config", "MCP: sign in to `<server>`"). Its rule names sit outside `mcp:` (`mcp-manage:install:<url>`,
    `mcp-manage:auth:<server>`), so an `mcp:*` rule or an MCP tool grant never covers an install.
    The adapter ignores an action it doesn't know and dispatches on the next key, so the classifier
    does the same, and the prompt names what will actually run. An unknown action on its own asks as
    `manage`. Plan mode and read-only runs block the `manage` kind. A contract test pins the
    adapter's action list and dispatch order, so a pin bump that adds an action fails.

1. **A subagent's approval dialog title carries model-written text.** The bridge sends
   `runLabel: record?.description` (`happyvibe-bridge.ts:686-691`). That is the model's own `Agent`
   argument, and `PermissionModal.tsx:162` puts it in the title. This breaks §13's rule: the prompt
   shows the factual action, never the model's self-authored words. The app-written "worker · run 2"
   specified in §10 (`prd.md:322`) was never built.
   **Decision:** the title names the agent only ("Sub-agent worker wants to run something"). Delete the
   `runLabel` lookup, its `permission.ts` field and its wire shape (`d1.md:4779-4786`). The run's card
   already turns amber and moves up while it waits, which is how you tell runs apart.

2. **No bypass banner for sessions started or restarted with bypass on.** The spawn sets `HV_BYPASS=1`
   (`ipc.ts:1012` → `spawn.ts:260`) and the bridge reads it (`:346`), but `hv.dangerous` is only ever
   sent by `/hv-dangerous` (`:1356`). A restart clears the renderer flag (`App.tsx:1432`).
   **Fix:** `session_start` sends `{kind:"hv.dangerous", on:true}` when bypass is on, next to the
   read-only notify at `:753`. Also fix `WorkspaceSettingsView.tsx:123` ("Applies to new or restarted
   sessions."): the live toggle reaches open sessions too.

3. **Agent tools pills can say deny while the call still runs.** `AllToolsView.tsx:84` evaluates the raw
   tool name, but the bridge checks `mcp` as `mcp:<tool>`, `Agent` as `subagent:<agent>`,
   `SubagentWorkflow` as `workflow`, and the browser/web URL tools as `browser:<host>`
   (`happyvibe-bridge.ts:1004`, `:1185`). The "test a call" box (`PermissionRulesSection.tsx:36`) has
   the same flaw.
   **Fix:** tools checked per call get a neutral pill ("per MCP tool", "per agent", "per site"). The
   list comes from the existing `AGENT_TOOL` (`hv-tw-gate.ts:15`) and `WEB_URL_TOOLS` (`hv-web.ts:25`),
   plus `mcp`, `browser_open` and `browser_navigate`. `SubagentWorkflow` is evaluated as `workflow`.
   Testing one of those names in the box says which name to test instead.

4. **The multi-line paste warning never fires.** Right-click paste writes the text straight to the shell
   (`TerminalTab.tsx:220-225`), skipping both the warning and bracketed paste. The keyboard paste is
   broken too: xterm's own handler calls `ev.stopPropagation()` on its textarea (`@xterm/xterm`
   `Clipboard.ts:44`), so the React `onPaste` on the wrapper (`:209-218`, `:250`) never runs. The agent
   terminal card (`TerminalRunCard.tsx:234`) has no guard at all.
   **Fix:** a single `allowPaste(text)` check, run from `onPasteCapture` (which fires before xterm's
   handler). Right-click goes through `allowPaste`, then `term.paste(text)`. The agent terminal card gets
   the same check.

5. **The shortcut recorder accepts Shift or Alt plus a key with no ⌘/Ctrl** (`shortcuts.ts:98-106`). The
   app-wide handler (`App.tsx:510-512`) then swallows that key while you type.
   **Fix:** a binding needs ⌘/Ctrl. `resolveBindings` (`:131`) drops a saved binding without it, so an
   already-saved `Shift-a` falls back to the default instead of becoming a dead key.

25. **A plugin's MCP servers are callable right after install.** Checked in the code, not just
    suspected. The install writes them into the global `mcp.json` with no off flag
    (`ipc.ts:6958-6963`) and restarts sessions (`:6978`). The adapter lists every server that isn't
    disabled and connects on the first call (`proxy-modes.ts:1233`, `:1296-1308`). **Connect**
    (`ipc.ts:5855-5891`) only probes and signs in; nothing it writes is read by the adapter. The install
    dialog promises "MCP servers arrive unconnected — so nothing the agent can do changes yet"
    (`PluginsSection.tsx:451`), and §25 requires that (`prd.md:780`).
    **Fix:** the install writes each server with `disabled: true`. The adapter honours the flag
    (`isServerDisabled` = `disabled === true`, `types.ts:515`): no lazy connect (`init.ts:683`), and the
    server is left out of the tool's server list (`direct-tool-surface.ts:205`). Nothing in HappyVibe
    reads the flag today, so three places learn it:
    - **Connect** (`hv:mcp-connect-flow`) is the switch. A successful connect removes the flag and
      reloads sessions (`scheduleMcpReload`). A failed one leaves it off.
    - Main's boot sweep (`ipc.ts:1477-1482`) and the page-open probe skip a disabled server, so main
      doesn't start one either.
    - The MCP page shows it as off until connected.

    User-added servers never get the flag, so the page needs no general on/off toggle.

## Broken flows

6. **Keep planning loses the plan's buttons for good.** The dismissal is stored per plan path
   (`PlanCard.tsx:163-165`), a revision overwrites the same file (by design, `tests/plans.test.ts:34-42`),
   and `ensurePlanCard` adds no second card (`App.tsx:724`).
   **Fix:** a live `plan_complete` (`App.tsx:1137`) clears the dismissal for that path and remounts the
   card, so the buttons and the new text both come back.

7. **Audit log filters.**
   - **Web tools** and **Read-only run** match nothing: the value is compared with the label
     (`AuditView.tsx:378` vs `:274`).
   - Subagent and document rows have no filter (`:437-451`).
   - Subagent rows never record that bypass decided them: `PolicyAuditRow` has no `bypass`
     (`hv-child-policy.ts:25-33`, `hv-child-guard.ts:212`).
   - `schedule.*` events are never read (`hv:read-audit`, `ipc.ts:4544-4577`), so **Schedules** is
     always empty.

   **Fix:**
   - Filter on the stored source value, with `dangerous` counting as bypass.
   - Keep the options in an exported `SOURCE_FILTERS` and add **Sub-agents** and **Documents**.
   - Subagent rows carry `bypass` and show under both **Sub-agents** and **Bypass**.
   - A `SCHEDULE_EVENT_TYPES` list, read the way `MEMORY_EVENT_TYPES` is (`ipc.ts:476`).

8. **Agents: Duplicate and Edit fail for `.agents/agents`.** tintinweb discovers agents there, and the
   bridge labels them "project", but `allowedAgentDirs` only allows `<agentDir>/agents` and `.pi/agents`
   (`agents.ts:15-20`). Duplicate throws with no catch (`AgentsView.tsx:77-80`). Edit shows the raw IPC
   error (`:310-313`). Worktree sessions fail the same way: `ipc.ts:4938` passes `workspaces.list()`,
   not `roots()`.
   **Fix:** add `.agents/agents` (the app already writes `.agents/plans`), pass `roots()`, and show the
   error.

9. **A rejected API key on first run.**
   - The Models page calls `onSaved()` whatever the probe said (`ModelsView.tsx:237`).
   - Separately, `hv:providers-changed` fires before the probe result (`ipc.ts:4010`), which flips
     `keyState` and closes the page anyway (`App.tsx:853-861`, `:3111`).
   - The setup window shows only "HTTP 401" (`providers.ts:408`, `OnboardingDoors.tsx:255`) under a
     ticked step (`OnboardingDialog.tsx:67`).

   **Fix:**
   - Forced setup sets `view` to "models", so the provider push can't close the page.
   - `onSaved` runs only for an accepted key.
   - The step ticks only for an accepted key.
   - Both screens use one sentence, "Saved, but X rejected this key (…)", moved from
     `ModelsView.tsx:246` into `onboarding.ts`.

10. **Privacy says "Nothing has been sent from this computer yet." after any restart.** `lastSent` and
    `recent` live only in memory (`crash/index.ts:27-28`).
    **Fix:** `onSent` also writes the envelope to a small JSON file in the crash store directory. The
    envelope is already scrubbed, so the file holds exactly what left the machine. `crashInfo()` reads
    that file as its fallback. It goes in its own file because the EventLog takes ids, never content.

11. **Voice.** The Behaviour subtitle renders the six characters `⌘`: JSX attribute strings don't
    process escapes (`VoiceView.tsx:336`). **Fix:** `` {`Hold right ${MOD} …`} ``, and
    `tests/mod-key-copy.test.ts` also catches the escape.
    *Linux: not a bug as reported.* Electron has no microphone status there, and **Open System
    Settings** only renders for "denied", which Linux never returns. The row's "Granted" is still
    untrue. **Fix:** on Linux it reads "No permission needed".

12. **Terminal exit bar.** It hard-codes `{MOD}W`, which prints "CtrlW" on Windows and Linux and ignores
    a rebound shortcut (`TerminalTab.tsx:294`). The paste warning says "1 lines" (`:212-214`).
    **Fix:** `formatBinding(closeKey)` (the prop is passed like `searchKey`), and the plural.

26. **Forget workspace leaves its agents running, invisibly.** The forget branch only archives
    (`ipc.ts:2890`) and never calls `endSession`, unlike delete (`:2881`), archive (`:3461`) and
    worktree remove (`:5478`). Nothing hibernates it until app quit or the 9-session cap.
    **Fix:** `endSession` first, as `:3461` does.

27. **Re-adding a forgotten workspace doesn't bring its sessions back.** `WorkspaceSettingsView.tsx:222`
    and §5 (`prd.md:94`) say it does, but forget archives them, so they come back archived. "Show
    archived (N)" counts sessions from forgotten workspaces (`Sidebar.tsx:908`).
    **Decision:** forget no longer archives. A forgotten workspace's sessions are already hidden (only
    registered workspaces render), so re-adding it restores them exactly as they were, and ones you had
    archived stay archived. The archived count covers registered workspaces and their worktrees only.

29. **Schedules.**
    - The drawer's bypass warning never shows: `App.tsx:3480` passes `bypassHere={() => false}`.
      **Fix:** `SchedulesView` resolves it with `resolveBypass` (`src/main/bypass.ts`, import-free).
      The drawer can't do it itself: `schedules-renderer.test.ts:154` bans `setBypass` there.
    - **Run now** on a busy workspace says the run will wait, but nothing is queued
      (`SchedulesView.tsx:105` vs `scheduler.ts:142`, deliberate per `:132`). **Fix:** the copy, "try
      again when that session finishes".
    - **Open at login** shows on Linux, where Electron's login items don't exist (`ipc.ts:3448`
      `available: app.isPackaged`). **Fix:** also require `platform.name !== "linux"`. #33 was the same
      bug.
    - Skip reasons show as raw codes ("workspace-gone", `schedulesCopy.ts:155`,
      `SchedulesView.tsx:290`). **Fix:** a `SKIP_REASON` record used in both places, with a test that
      every `reason:` in `scheduler.ts` has an entry.
    - The "⚠ needs you" outcome is never recorded (`scheduler.ts:247`), and §35 only promises the OS
      notification. **Fix:** delete the dead outcome (`RunOutcome` value, `OUTCOME_MARK`, the
      `lastRunLabel` branch).

30. **Session view.**
    - The `/` menu footer says "Enter to send", but Enter completes (`ChatView.tsx:1853` vs `:1893`).
      **Fix:** "Tab or Enter to complete".
    - The no-model notice points to "Settings → Models", which doesn't exist (`:1684`). **Fix:**
      `<GoTo view="models" />`.
    - Enter sends a documents-only message, and also sends with no model, while **Send** stays disabled
      (`:886` vs `:1975`). **Fix:** one `canSend`, used by both. A documents-only message is valid
      (§31).
    - The model chip has no way back to the default (`:989-994`). **Fix:** `onClear` when a session
      model is set, and main applies the resolved default live (`ipc.ts:5036`).

31. **Changes panel.**
    - The junk-files dialog only offers **Cancel** (`ChangesPanel.tsx:414-431`), but §29 says declining
      still saves (`prd.md:912`), which is what the comment at `:402` describes. **Fix:** add **Save
      anyway**, through the existing `secondary` pattern (`:1068`).
    - Git actions are written (`auditGit`, `ipc.ts:5283`) but never read into the Audit log, although
      §29 audits them as human actions. **Fix:** read `git.action` as a **Git** row with its own
      filter.

32. **Changes and schedules details.**
    - "Created by the agent." can never show. The report's premise was wrong: the agent *can* create a
      schedule (`schedule_create`, `happyvibe-bridge.ts:2232`), but the drawer's save
      (`ScheduleDrawer.tsx:78-92`) never stamps `createdBy`. **Fix:** stamp it in main after an
      agent-opened drawer saves (`ipc.ts:2397-2415`), and stop that same save from also logging a
      user-sourced `schedule.create` (`:3401`), which today produces two audit rows.
    - A staged-only save prints `git add -A && …` although it skips `add -A` (`ChangesPanel.tsx:406` vs
      `git.ts:701`). **Fix:** show the command that actually runs, including `add -A` before an amend
      that isn't staged-only.
    - The search tooltip's "(CtrlF)" is part of #28.

## Stale or wrong copy

13. Stats lists "AGENTS.md" among the app's own calls, but that kind was removed (`DashboardView.tsx:185`,
    `oneShotLog.ts:32`). **Fix:** drop it here and in the comments at `:176-177` and `analytics.ts:69-70`.
    Extend the absence scan in `tests/oneshot-audit.test.ts:231-238` to `DashboardView.tsx`.
14. MCP "Changes apply to new sessions only" / "Applies to new sessions." (`McpServersSection.tsx:293`,
    `:563`) is wrong: idle sessions restart at once and busy ones when their turn ends (`ipc.ts:2795`).
    The 🔌 tooltip "connected for this session" (`ChatView.tsx:2866`) is really main's app-wide check
    (`ipc.ts:5894`). The reload toast always names MCP, whatever the reason (`App.tsx:1799`).
    **Fix:** "Open sessions restart to pick it up once they're idle", "`n` of `m` MCP servers answered
    HappyVibe's check", and a toast worded per reason.
15. The Agents intro promises agents from "your Pi runtime and installed packages", and its loading
    subtitle names five sources (`AgentsView.tsx:86`, `:93`). The bridge only ever emits bundled and
    project. **Fix:** copy that names only those. `AgentSource` keeps its other values until the next
    tintinweb bump, with a test that the intro names only sources the bridge can emit.
16. Prompts still say "commands" and "the Commands page" (`PromptTemplatesSection.tsx:119-120`, `:483`).
    **Fix:** "prompts", plus `<GoTo view="promptTemplates" />`. The sibling at `SkillsSection.tsx:540`
    gets a `GoTo` too.
17. The rewind tooltip says "files are not rolled back" (`Transcript.tsx:44`), but the dialog offers
    **Conversation and files** and **Files only**. The dialog body also says the conversation is
    truncated for **Files only** (`ChatView.tsx:1201-1203`). **Fix:** "Rewind to this message — you choose
    whether files roll back too", and the body follows `rewindActions(scope).truncateChat`.
18. The extended prompt cache copy "Other providers ignore it" (`ModelsView.tsx:69`) is false. Pi sends
    long retention on the Anthropic, OpenAI Responses/Completions and pi-messages paths. Google, Mistral,
    OpenAI Codex, and providers whose compat turns it off (xAI among them) ignore it. Bedrock isn't in
    our catalog, so the copy doesn't name it. **Fix:** name who ignores it, and add a contract test that
    pins which `pi-ai/dist/api/*` modules read `PI_CACHE_RETENTION`.
19. The open-files switch doesn't say it also sends the address of the browser pane the agent opened
    (`SystemPromptView.tsx:157-166`; `ipc.ts:3624-3629`). **Fix:** one clause in the body. The guide is
    already right.
20. `HowItWorks.tsx:27` and `:52` name "Allow for this session" (the button is **Allow for session**,
    `PermissionModal.tsx:41-45`). They also say "nothing is ever allowed by silence", but `SAFE_TOOLS`
    runs when no rule matches (`hv-rules.ts:347`). `EmptyState.tsx:47` says "choose Always", and
    `PermissionRulesSection.tsx:109` says "No match falls back to asking you." **Fix:** the real label,
    and "When no rule matches, a short list of safe tools runs on its own; everything else asks you."
    `tests/how-it-works.test.ts:178` changes with the copy and asserts that the quoted label is one of
    the modal's choices.
21. The commit wand promises "about $0.001 per draft" (`ChangesPanel.tsx:948`), but it uses the Commit
    message model from AI autofill, or the default model (`ipc.ts:5602`). **Fix:** drop the figure and
    name the model setting.
22. Per-OS copy.
    - "Blank uses $SHELL" and "login shell" on Windows (`TerminalView.tsx:225-229`): **Fix:** name the
      real Windows fallback order.
    - Literal backticks in the `-l` hint (`:234`): **Fix:** drop them.
    - "⇧Enter" on every OS (`shortcuts.ts:83`): **Fix:** `formatBinding("Shift-Enter")`.
    - **Reveal crash reports** (`PrivacyView.tsx:133`): **Fix:** `REVEAL_IN_FILE_MANAGER`.
    - **Open System Settings** on Windows (`VoiceView.tsx:403`): **Fix:** "Open Settings".
24. **Remove** on an installed plugin acts at once (`PluginsSection.tsx:217-224`), and so does MCP server
    **Remove** (`McpServersSection.tsx:226`). **Fix:** both confirm first, the way skill **Delete** does
    (`SkillsSection.tsx:510`).
28. Hard-coded key hints print "CtrlK"-style text off macOS and ignore rebinding: `Sidebar.tsx:995`,
    `:1095`, `:1104`, `FileTab.tsx:342-343`, `ChatView.tsx:1100`, `TerminalTab.tsx:294`, `feedbackCopy.ts:30`.
    **Fix:** every hint goes through `formatBinding` with the resolved binding (the pattern at
    `App.tsx:3305`). A test bans `${MOD}` followed by a key character in the renderer.

## Closed without a change

- **23. Not a bug.** `docs/guide/VOICE.md` governs guide pages, not app copy. "a sandboxed browser tab" is
  true (`browsers.ts:103`), and the Models placeholder counts providers live.
- **33.** The same bug as #29's Open at login.
- **11, the Linux button:** **Open System Settings** can't appear on Linux (the row's wording is still fixed, above).

## Open after the fix round

- **GUI pass not run yet.** Every task's GUI assertions (plan Task 21 step 4) still need the app. The Windows and Linux key-hint and copy checks need those machines.
- **35 (new, pre-existing, found by the live batch): MCP namespace tools bypass `mcp:<tool>` rules.** pi-mcp-adapter 2.35.0 (pinned since `8247973`) registers one `mcp__<server>` tool per proxy-only server that takes `{tool, args}` and runs the MCP tool. The bridge unwraps only the tool named `mcp` (`happyvibe-bridge.ts:996`), so a `mcp__echo` call is gated under its raw name: it still asks by default, but a deny rule on `mcp:<tool>` doesn't cover it and the prompt shows raw JSON. `tests/mcp-bridge.test.ts` fails whenever the model picks the namespace tool. Fix: unwrap `mcp__<server>` calls with `unwrapMcpCall` (forcing `server`), and add them to the Agent tools per-call pills.
- **36 (new, pre-existing): sub-agents ignore a live bypass Turn off.** The child guard reads `HV_BYPASS` once per child (`hv-child-guard.ts:205`), not the parent's live `dangerous && !plan.enabled && !readonly`. Fix: a `ChildPolicy.bypass()` getter from the bridge.
- **Always allow persists a wildcard.** A persistent grant stores `pattern: tool` as a glob, so a model-chosen install URL such as `https://*/mcp` becomes a rule matching every such install. Needs a decision: escape `*`/`?` in grants, or don't offer Always allow on `mcp-manage:` prompts.

