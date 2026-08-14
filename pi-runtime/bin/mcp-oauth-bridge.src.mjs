// HappyVibe: the ONLY route main has to MCP OAuth credentials.
//
// pi-mcp-adapter >=2.17.0 keeps credentials in the OS keychain and treats
// <agentDir>/mcp-oauth/.../tokens.json as a legacy artefact to import and then
// DELETE. Main must therefore never mirror that store — it runs the adapter's
// own code here, in a child process, because the adapter ships TypeScript
// source and a native @napi-rs/keyring binding, neither of which belongs in
// the Electron main bundle.
//
// This file is the SOURCE. It is bundled by scripts/build-mcp-oauth-bridge.mjs
// into mcp-oauth-bridge.mjs, and that is what actually runs — Node refuses to
// strip types for files under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_
// STRIPPING), so importing the adapter's .ts directly cannot work. Keep these
// as STATIC imports: esbuild has to follow them.
//
// Protocol: ONE JSON request on stdin, ONE JSON response line on stdout.
// Batching ops per invocation is load-bearing — the startup sweep reads every
// configured server in a single spawn rather than one spawn per server.
import { readFileSync } from "node:fs";

// The `/oauth` subpath (adapter >=2.22.0) is the supported surface, but it
// covers token read/write only. Client-info writes and removal live in
// mcp-auth.ts, reached by RELATIVE path — an exports map gates bare specifiers
// only, the same escape CLAUDE.md documents for two pi-subagents internals.
// esbuild dedupes the two routes to one module instance (verified), so the
// adapter's store state is shared across them. Both are pinned by
// tests/mcp-adapter-authformat.test.ts.
import { inspectMcpOAuthTokensForUrl, updateMcpOAuthTokensForUrl } from "pi-mcp-adapter/oauth";
import { updateClientInfo, removeAuthEntry } from "../node_modules/pi-mcp-adapter/mcp-auth.ts";

const req = JSON.parse(readFileSync(0, "utf-8"));

// getAuthBaseDir() reads PI_CODING_AGENT_DIR on every call, so setting it here
// is in time — agent-dir.ts does not cache it (verified, and it was one of the
// investigation's recorded wrong turns).
if (req.agentDir) process.env.PI_CODING_AGENT_DIR = req.agentDir;

const results = [];
let ok = true;
let error;

try {
  for (const op of req.ops ?? []) {
    switch (op.op) {
      case "inspect":
        results.push({ name: op.name, ...inspectMcpOAuthTokensForUrl(op.name, op.url) });
        break;
      case "writeTokens":
        updateMcpOAuthTokensForUrl(op.name, op.url, op.tokens);
        results.push({ name: op.name, status: "ok" });
        break;
      case "writeClientInfo":
        updateClientInfo(op.name, op.clientInfo, op.url);
        results.push({ name: op.name, status: "ok" });
        break;
      case "remove":
        removeAuthEntry(op.name);
        results.push({ name: op.name, status: "ok" });
        break;
      default:
        results.push({ name: op.name, status: "unavailable", message: `unknown op ${op.op}` });
    }
  }
} catch (err) {
  // Fail LOUDLY, never silently: an unreadable credential store must surface as
  // "unavailable", not as "absent". Reporting absent on no evidence is a
  // confident claim that the user is signed out — precisely the bug this whole
  // sidecar exists to replace.
  ok = false;
  error = err?.message ?? String(err);
}

process.stdout.write(`${JSON.stringify({ ok, error, results })}\n`);
