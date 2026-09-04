import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// dist/bundle/cli.js is upstream's own bin.pi since Pi 0.84.3, and the modular
// dist/cli.js is broken at 0.85.0 — see PI_CLI_RELPATH in src/main/pi/spawn.ts.
// Hardcoded here because .mjs cannot import the TypeScript constant.
const cli = path.join(root, "pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
// stdin: "ignore" is required — the Pi CLI reads stdin in TTY mode and hangs a
// one-shot invocation if stdin stays open (discovered during Task 2 bring-up).
const r = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (r.status !== 0) { console.error("FAIL", r.stderr); process.exit(1); }
const version = r.stdout.trim();
if (version !== "0.80.3") { console.error(`FAIL: expected 0.80.3, got ${version}`); process.exit(1); }
console.log("OK pi version:", version);
