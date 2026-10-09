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
