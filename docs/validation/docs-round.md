# Docs round (2026-09-28): app bugs found while writing the user guide

Every guide page was written from the code and checked twice by reviewer agents
(`.claude/agents/docs-reviewer.md`). These are the places where the code disagreed with itself or with
the app's own copy. The guide routes readers around each one and never describes broken behaviour as
working. None of them is fixed in this round. Line numbers are as of commit `cea79e7`.

## Trust and safety (fix first)
1. **A subagent's own approval dialog title contains model-written text.** The title is built from the
   task description the model gave in its `Agent` call (`pi-runtime/extensions/happyvibe-bridge.ts:686-691`
   `runLabel: record?.description` → `src/renderer/src/components/PermissionModal.tsx:162`). This breaks
   §13's "the app writes the approval dialog, never the model". The main-session delegation dialog is fine
   (it shows `subagent:<agent>`).
2. **The bypass red banner is missing for sessions started or restarted while bypass is on.** The banner
   is only drawn after an `hv.dangerous` notify, which only `/hv-dangerous` sends (`happyvibe-bridge.ts:1356`).
   A session spawned with `HV_BYPASS=1` never gets one (`:346`), and a restart clears the flag
   (`App.tsx:1422`). Both `PermissionsView.tsx:23` and `WorkspaceSettingsView.tsx:122` promise it in every
   session.
3. **Agent tools pills can say deny while the call still runs.** Pills are computed from the raw tool name
   with no input (`AllToolsView.tsx:84`). `mcp`, `Agent`, `SubagentWorkflow` and the browser/web URL tools
   are checked under other names (`mcp:<tool>`, `subagent:<agent>`, `workflow`, `browser:<host>`,
   `happyvibe-bridge.ts:990-1012`).
4. **A right-click paste skips the multi-line paste warning** (`TerminalTab.tsx:219-225`), which the
   settings call a safety setting.
5. **The shortcut recorder accepts Shift or Alt plus a key with no ⌘/Ctrl** (`shortcuts.ts:98-106`). The
   app-wide handler then swallows that key during normal typing (`App.tsx:3118-3121`).

## Broken flows
6. **Keep planning loses the plan's buttons for good.** The hidden flag is stored per plan file
   (`PlanCard.tsx:163-165`), a revised plan overwrites the same file, and no second card is added for it
   (`App.tsx:711-714`).
7. **Audit log filters:** **Web tools** and **Read-only run** never match anything (the value is compared
   with the label, `AuditView.tsx:274` vs `:378`). There's no filter choice for subagent or document rows
   (`:437-451`), so **Bypass** hides subagent calls. `schedule.*` events are never read
   (`ipc.ts:4406-4425`), so **Schedules** is always empty.
8. **Agents:** **Duplicate** fails silently for any agent outside `<agentDir>/agents` and `.pi/agents`
   (`AgentsView.tsx:77-80`, `agents.ts:15-32`). **Edit** can't load agents in `.agents/agents`.
9. **A rejected API key is never seen on first run.** The Models page calls `onSaved()` before the verdict
   shows (`ModelsView.tsx:237`). The setup window shows only the raw provider error and still ticks the
   step (`OnboardingDoors.tsx:295-297`).
10. **Privacy says "Nothing has been sent from this computer yet." after any restart.** The last report is
    kept in memory only (`crash/index.ts:28`).
11. **Voice:** the Behaviour subtitle renders a literal `⌘` (a JS escape in a JSX attribute string,
    `VoiceView.tsx:336`). On Linux the microphone row always reads **Granted** and **Open System Settings**
    does nothing (`ipc.ts:4239`, `:4255`).
12. **Terminal:** the exit bar hard-codes `{MOD}W`, so Windows and Linux show "CtrlW" and a rebound shortcut
    is ignored (`TerminalTab.tsx:294`). The paste warning says "1 lines" (`:214`).

## Stale or wrong copy
13. Stats lists "AGENTS.md" among the app's own calls, but that kind was removed (`DashboardView.tsx:185`,
    `oneShotLog.ts:24-31`).
14. MCP: "Changes apply to new sessions only" / "Applies to new sessions." (`McpServersSection.tsx:293`,
    `:563`), though idle sessions restart. The 🔌 chip tooltip says "connected for this session", but the
    number is the app's own check (`ChatView.tsx:2815`).
15. Agents' intro promises agents from "your Pi runtime and installed packages", and none can appear
    (`AgentsView.tsx:86`).
16. Prompts still say "commands" / "the Commands page" (`PromptTemplatesSection.tsx:119-120`, `:483`).
17. The rewind tooltip says "files are not rolled back" (`Transcript.tsx:44`), but the dialog offers
    **Conversation and files** and **Files only**.
18. Extended prompt cache: "Other providers ignore it" is false. Bedrock and the OpenAI paths honour it
    (`ModelsView.tsx:69`).
19. The open-files switch doesn't say it also sends the browser pane's address (`SystemPromptView.tsx:157-166`).
20. `HowItWorks.tsx:25` names "Allow for this session" (the button is **Allow for session**) and says
    "nothing is ever allowed by silence" (the safe defaults are). `EmptyState.tsx:47` says "choose Always".
21. The commit wand promises "about $0.001 per draft", but it uses the AI autofill model
    (`ChangesPanel.tsx:948`).
22. Per-OS copy: "Blank uses $SHELL" on Windows (`TerminalView.tsx:226`, `:229`), literal backticks in the
    `-l` hint (`:234`), "⇧Enter" on every OS (`shortcuts.ts:83`), **Reveal crash reports** not per OS
    (`PrivacyView.tsx:93`), and **Open System Settings** on Windows (`VoiceView.tsx:403`).
23. Voice-guide words in app copy: "a sandboxed browser tab" (`BuiltinToolsBlock.tsx:314`). The Models
    search placeholder names a provider count and Pi (`ModelsView.tsx:468`).
24. **Remove** on an installed plugin acts at once with no confirmation (`PluginsSection.tsx:254`), where
    skill **Delete** asks first.
25. **Suspected, not run live: a plugin's MCP servers may be usable before you click Connect.** The install
    writes them straight into the global `mcp.json` with no off flag (`ipc.ts:6772-6777`) and schedules a
    restart (`:6791`). The adapter starts servers lazily on first use (`pi-mcp-adapter/README.md:319`). The
    install dialog promises "MCP servers arrive unconnected — so nothing the agent can do changes yet"
    (`PluginsSection.tsx:464-465`), and the guide quotes it. Each call still asks for permission. Check it
    live before relying on the promise.

## Found writing Everyday use (2026-09-29)
26. **Forget workspace leaves its agents running, invisibly.** It only sets `archived` on each session
    and never calls `endSession` (`ipc.ts:2797-2799`), unlike `hv:archive-session` (`:3362`).
27. **Re-adding a forgotten workspace doesn't bring its sessions back**, although
    `WorkspaceSettingsView.tsx:221` says it does. They come back archived (`ipc.ts:2764`).
    "Show archived (N)" also counts sessions from forgotten workspaces (`Sidebar.tsx:908`).
28. **Hard-coded key hints read "CtrlK" / "Ctrl\" / "Save (CtrlS)" on Windows and Linux** and ignore
    rebinding: `Sidebar.tsx:995,1095,1104`, `FileTab.tsx:436-437` (compare `formatBinding`).
29. **Schedules:** the drawer's "This workspace bypasses permissions — runs will too." warning never
    shows (`App.tsx:3454` passes `bypassHere={() => false}`). **Run now** on a busy workspace says the
    run will wait, but nothing is queued (`SchedulesView.tsx:105` vs `scheduler.ts:142`). **Open at
    login** shows on Linux, where Electron's login items don't apply (`ipc.ts:3350`). Skipped-run
    reasons show as raw codes ("workspace-gone", `schedulesCopy.ts:155`). The "⚠ needs you" outcome is
    never recorded (`scheduler.ts:242`).
30. **Session view:** the `/` menu footer says "Enter to send", but Enter completes while it's open
    (`ChatView.tsx:1807` vs `:1847`). The no-model notice points to "Settings → Models", which doesn't
    exist (`:1638`). A document-only message can be sent with Enter while **Send** stays disabled
    (`:1929` vs `:855`). The model chip has no way back to the default (`:943`, no `onClear`).
31. **Changes panel:** a comment says declining the junk-files dialog still saves (`ChangesPanel.tsx:402`),
    but the dialog only offers **Cancel**. Git actions are logged (`ipc.ts:5114-5118`) but never shown
    in the Audit log.
32. More Everyday-use findings: "Created by the agent." can never show, because nothing sets `createdBy`
    (`SchedulesView.tsx:305`, `ipc.ts:2324`, `ScheduleDrawer.tsx:78-92`). A staged-only save prints
    `git add -A && …` although it skips `add -A` (`ChangesPanel.tsx:406` vs `git.ts:701`). The search
    tooltip reads "(CtrlF)" on Windows and Linux (`ChatView.tsx:1054`).
