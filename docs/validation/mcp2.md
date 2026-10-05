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
