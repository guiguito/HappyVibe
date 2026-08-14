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
/**
 * Read stdin as a STREAM, not with readFileSync(0).
 *
 * readFileSync(0) works under plain `node` and hangs forever under the bundled
 * Electron helper (ELECTRON_RUN_AS_NODE), which is the runtime this actually
 * gets in the app — the unit tests passed while the real app timed out on every
 * spawn and left orphaned helper processes behind. pi-mcp-adapter's own
 * mcp-keyring-helper.cjs reads stdin exactly this way, for the same reason.
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
      if (input.length > 1024 * 1024) {
        reject(new Error("request too large"));
        process.stdin.destroy();
      }
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(input));
  });
}

// The `/oauth` subpath (adapter >=2.22.0) is the supported surface, and it is
// used for the token write. It does NOT cover everything an OAuth host needs,
// so the rest comes from mcp-auth.ts by RELATIVE path — an exports map gates
// bare specifiers only, the same escape CLAUDE.md documents for two
// pi-subagents internals. esbuild dedupes the two routes to one module instance
// (verified), so the adapter's store state is shared across them. Both are
// pinned by tests/mcp-adapter-authformat.test.ts.
//
// Why not `inspectMcpOAuthTokensForUrl` for reads: it narrows the entry to
// `tokens`, and the provider also needs `clientInfo` — without it the adapter
// cannot refresh, and the stale-DCR-client guard (which is what stops Notion's
// "Client ID mismatch" after our loopback port changes) has nothing to compare.
// `inspectAuthForUrl` returns the whole entry, is equally non-migrating
// (`migrateLegacy: false`), and reports `unavailable` rather than throwing.
import { updateMcpOAuthTokensForUrl } from "pi-mcp-adapter/oauth";
import {
  inspectAuthForUrl,
  getAuthEntry,
  updateClientInfo,
  removeAuthEntry,
} from "../node_modules/pi-mcp-adapter/mcp-auth.ts";

const req = JSON.parse(await readStdin());

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
      case "inspect": {
        const s = inspectAuthForUrl(op.name, op.url);
        results.push(
          s.status === "present"
            ? { name: op.name, status: "present", tokens: s.entry.tokens, clientInfo: s.entry.clientInfo }
            : { name: op.name, ...s },
        );
        break;
      }
      case "migrate":
        // A MIGRATING read: this is what imports a legacy plaintext tokens.json
        // into the keychain and deletes it. Used only by the one-time sweep —
        // every other read above deliberately does not migrate.
        getAuthEntry(op.name);
        results.push({ name: op.name, status: "ok" });
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
