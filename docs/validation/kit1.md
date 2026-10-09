# kit1 — tool weights measured on a key-free Pi (2026-10-09)

Pi 1.0.2. Generator: `npm run catalog:tool-weights` (`tools/tool-weights/`). One faux-model Pi per variant,
the app's real spawn args; weight = system chars + tool-definition chars, tokens = chars / 4.
Each family = reference minus reference-with-family-off (Workflows, Images: the other way round;
Ask user measured with Plan off). Absolute figures carry cwd/install paths (a few dozen tokens by machine).

Reference total: 13,243 tokens.

| Family | Tokens | | Family | Tokens |
|---|---|---|---|---|
| plan | 402 | | subagents | 4,488 |
| terminal | 600 | | skills | 1,192 |
| browser | 1,123 | | intent | 1,008 |
| web | 998 | | askUser | 365 |
| document | 244 | | workflows | 6,469 |
| memory | 953 | | images | 153 |
| schedules | 1,293 | | **mcp** | **0** |

Core (delta when that tool is off): read 183, bash 218, edit 440, write 122, grep/find/ls 0
(not in the default active set, so nothing to remove). Sum 963.
Pi's own schema-only measurement of the seven core tool definitions was 1,187 (2026-10-09); the
delta here is lower because grep/find/ls are not active in the reference.

Compaction: Pi's `reserveTokens` = 16,384; `shouldCompact` fires above `window - reserve`.
Quarter-of-window vs reserve rule: both pick basics at 4k/8k/32k and full at 64k/128k.

`mcp = 0`: MCP with no server declares nothing, so it is not a kit tile.

## GUI pass (2026-10-09, built app, throwaway `--user-data-dir` per scenario)

Profiles: **LO** = DeepSeek + OpenRouter keys (both in the launch environment, so every profile is
LO; no pure-L profile was run — the L-only absence of the Images tile is covered by `kitTiles(false)`
in `tests/onboarding-kit.test.ts`). **S4 / S32 / S128** = a seeded custom endpoint (`hv-tiny`, an
unreachable URL) whose one model declares a 4,096 / 32,768 / 131,072 window, seeded as the default
model BEFORE launch — so no S* profile exercised a default set after the kit's window read, which is
why C1 below slipped past this pass.
Projects via **Start fresh…** (`~/Documents/HappyVibe/hv-kit-gui-*`, removed afterwards).

| # | Check | Result |
|---|---|---|
| 1 | 🎉, "You're in.", headline, subline, later-line naming Built-in tools, Skills, Agents and Prompts as plain text | pass |
| 2 | Tile order Plan mode … Skills, Core tools (▸ 7), Prompts (▸ 9, ~0 tokens); every family on except Workflows; Sub-agents ▸ 10, Skills ▸ 8 | pass |
| 3 | 10 s wait: still open. Frame 864×544 at the setup beat and at the kit beat | pass |
| 4 | No ✕, no MCP / Tool intent tile, no checkbox on Core tools or Prompts, no "Opening your first session…", no small-model or too-small line (LO) | pass |
| 5 | LO: Images — 1 tool tile, ticked, ~153; total 13.4k = 13,243 + 153 | pass |
| 6 | Agent browser off: 13.4k → 12.3k. theme-factory off: −69. Skills off: −1,192 only (12,273 → 11,081), items greyed. Ask user locked on under Plan; unlocks with Plan off; Plan back on re-ticks and locks it | pass |
| 7 | Consent line and footer verbatim | pass |
| 8 | S4: every family off; core 7 and prompts 9 stay ticked; "Your model reads 4,096 tokens at a time and the full kit takes about 13.4k, so you're starting with just the basics."; red "Even the basics fill about 39% of it — too little room for real work." + **Give your model more room ↗** (opens the system browser; the URL is `docUrl("connect-a-model", "give-your-model-more-room")`, checked in source — `window.hv` is frozen, so the call could not be spied) | pass |
| 9 | S32: basics, "32,768", no too-small line. S128: full kit, no lines | pass |
| 10 | S32 → Load everything anyway: all on except Workflows, total 13.4k, small-model line hidden | pass |
| 11 | Untick Agent browser + theme-factory + translate + data-analyst → Start: Built-in tools browser off, rest on, Workflows off, MCP on; theme-factory disabled; translate disabled; `agentsEnabled.data-analyst: false`; one session | pass |
| 12 | Built-in tools: grey weight on every row but MCP; "with the bundled ones on" on Skills and Sub-agents; no "about 5.5k" | pass |
| 13 | Context panel after turn 1 (browser off): system 3,403 + tools 8,219 + skills 587 + memory 308 = 12,517 vs kit 12,273 (2%) | pass |
| 14 | Turn 1: tools note, then context note; no GitHub note | pass |
| 15 | Turn 2 end: the GitHub/Linear/Notion note in full, wrapped, **Plugins** link opens Plugins | pass |
| 16 | A second session: none of the three notes | pass |
| R1 | S4, quit at the kit, relaunch: no wizard; every kit family off, MCP on, intent on, coreOff [] | pass |
| R2 | S32 → Load everything anyway → Start: every row on except Workflows | pass |
| R3 | Esc and two Start clicks in the same tick: one session (`listSessions` = 1). The `onboarding_completed` count could not be observed — usage stats are off in this build; the `starting` guard is source-pinned | pass (session) |
| R4 | Browser off → Start → "Open example.com in the browser": the agent used `web_fetch` and said it has no browser tool | pass |

### Found and fixed in this pass
- **A brand-new session was reloaded right after spawning** ("Reloading to apply prompt changes —
  permission grants and dangerous mode reset…"). Start's writes schedule a 500 ms debounced reload of
  live sessions, and the first session spawned inside that window. Fixed at the root: a reload pass
  only reloads sessions alive when the change was scheduled (`mcpReloadScope.ts`, unit-tested).
  Re-checked: no notice.
- **First-run notices landed above the agent's reply** (also the round-25 context note): appended
  before `commitStream`. Moved after `stampTurnEnd`; source-pinned. Re-checked.
- **C1 — a fresh install on a small local model opened the FULL kit.** Seen on the built app: fresh
  profile, Ollama with gemma4:12b (window 4,096), no keys → 10 families ticked, no small-model or
  too-small line, `defaultModel` still null. Every door, and a local runner found at boot, announces
  the provider before main sets the default, so the window read saw no default and settled as
  "unknown ⇒ full". Fixed: the read goes through `hv:ensure-default-model`, which fills a null default
  first (free once set, always resolves); source-pinned in `tests/onboarding.test.ts`.
- **GUI-3 — the footer total was clipped by the scrollbar.** Right padding on the kit's scroll content.
- Layout: Workflows nested inside the Sub-agents tile; footer buttons no longer wrap; expanded items
  show their weight when above 0.

### Observations, not changed
- grep/find/ls weigh 0 on macOS: with the bash shell spawn passes no `--tools`, so Pi activates only
  read/bash/edit/write (an agent asked to "use the ls tool" ran `bash`). `spawn.ts`'s comment says the
  seven builtins are the set — that is only true on the powershell path. Pre-existing, outside this round.
- On a small model the headline still reads "Your agent comes fully loaded." over unticked tiles (the
  spec keeps it).
- Calibration: no real 4k/32k/128k runner was used — seeded windows only. The quarter rule behaved as
  specified at all three.
