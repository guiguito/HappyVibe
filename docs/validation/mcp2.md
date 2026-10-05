# MCP on Pi's built-in MCP — Phase 0 (2026-10-05)

Evidence for PRD §13 **Decision (2026-10-05)**. Pi 1.0.2, adapter 2.35.0, macOS arm64, Node 22.21.

## Gate

`tests/mcp-builtin-gate.test.ts`, key-free: Pi's `faux` provider scripts `tool_search {query:"echo"}`
then `mcp__echo__echo {text:"hi"}`; `-e builtin:mcp -e builtin:tool-search`, real bridge last; one
stdio echo server, `exposure: "deferred"`, in `<agentDir>/mcp.json`. Before the bridge knows Pi's
MCP, both calls raise `hv.permission` under their raw names:

```
{"kind":"hv.permission","tool":"tool_search","summary":"{\"query\":\"echo\"}"}
{"kind":"hv.permission","tool":"mcp__echo__echo","summary":"{\"text\":\"hi\"}"}
```

Deny on the MCP call → the echo server logged **zero** `tools/call`. The whole turn (Pi boot + 3 model
steps) takes ~240 ms — Pi's bundled CLI boots fast; a near-instant run here is real, not a skip.

## Footprint

`scripts/spike/mcp-footprint.mjs` (throwaway): 4 idle RPC sessions (faux model, one 1-word turn),
3 servers in `<agentDir>/mcp.json` — `chrome-devtools` (`npx -y chrome-devtools-mcp@latest`, stdio),
`context7` and `deepwiki` (remote, no auth). RSS summed over each Pi's process tree 20 s after boot;
start = spawn → first `get_state` response. 3 runs per arm, interleaved, no app running.

| Run | Arm | RSS (MB) | Processes | Start (ms, 4 sessions) |
|---|---|---|---|---|
| 1 | adapter | 657 | 6 | 1546–1758 (cold) |
| 1 | built-in | 1439 | 16 | 442–489 |
| 2 | adapter | 781 | 10 | 566–698 |
| 2 | built-in | 377 | 4 | 399–423 |
| 3 | adapter | 888 | 10 | 605–744 |
| 3 | built-in | 1566 | 16 | 427–464 |

- Medians: adapter **781 MB**, built-in **1439 MB** → **+658 MB**, under the ~1 GB pass line.
- Built-in run 2 is an outlier: no stdio server came up (4 processes = the 4 Pis). It is excluded
  from the median judgement, not from the table.
- 16 processes = 4 Pis + 3 per session for `chrome-devtools` (npx → node chain): the stdio server
  is the whole cost; the two remote servers add nothing visible.
- The adapter is not fully lazy either: from run 2 it also started `chrome-devtools` (10 processes).
- Start time is **faster** on built-in (~440 ms vs ~600–700 ms warm): no adapter `.ts` to load.

## Tokens

Same sessions, `/hv-context` after one turn (bridge's chars/4 accounting).

| | System prompt (est.) | Tool definitions | MCP rows |
|---|---|---|---|
| adapter | 862–903 | 6,912–7,417 | `mcp` 872, `mcpScript` 320, + one `mcp__<server>` namespace tool per server (~167 each) |
| built-in (`deferred`) | 835 | 5,874 | `tool_search` 154 |

Built-in saves **~1,040–1,540 tokens per request** with 3 servers, and the saving grows with the
server count (the adapter adds a namespace tool per server; deferred adds nothing until searched).
Static cost only — the search round trips per task are not measured (needs interleaved live arms).

## Elicitation

`grep -rln elicitation src/ pi-runtime/extensions/` → nothing. No shipped flow depends on it.
