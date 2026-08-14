/**
 * Builds pi-runtime/bin/mcp-oauth-bridge.mjs from its .src.mjs entry.
 *
 * The sidecar CANNOT be a plain script. Node strips types natively but REFUSES
 * to do so for files under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_
 * STRIPPING), and pi-mcp-adapter ships TypeScript source. Pi loads .ts through
 * its own loader; a bare Node child has none. So we bundle.
 *
 * @napi-rs/keyring stays EXTERNAL — it is a native binding and must be required
 * from pi-runtime/node_modules at runtime, not inlined.
 *
 * Runs from postinstall, beside fix-pty-helper.mjs. The output is generated and
 * gitignored.
 */
import { build } from "esbuild";
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, "pi-runtime", "bin", "mcp-oauth-bridge.src.mjs");
const outfile = path.join(root, "pi-runtime", "bin", "mcp-oauth-bridge.mjs");

// pi-runtime installs separately (npm ci), so on a fresh clone this can run
// before the adapter exists. Skip rather than fail the whole postinstall — the
// next install after `cd pi-runtime && npm ci` produces it.
if (!existsSync(path.join(root, "pi-runtime", "node_modules", "pi-mcp-adapter"))) {
  console.log("[hv] pi-mcp-adapter not installed yet — skipping mcp-oauth-bridge build");
  process.exit(0);
}

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@napi-rs/keyring"],
  outfile,
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});

chmodSync(outfile, 0o755);
console.log(`[hv] built ${path.relative(root, outfile)}`);
