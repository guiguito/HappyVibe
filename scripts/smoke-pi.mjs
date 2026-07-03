import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
// stdin: "ignore" is required — the Pi CLI reads stdin in TTY mode and hangs a
// one-shot invocation if stdin stays open (discovered during Task 2 bring-up).
const r = spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (r.status !== 0) { console.error("FAIL", r.stderr); process.exit(1); }
const version = r.stdout.trim();
if (version !== "0.80.3") { console.error(`FAIL: expected 0.80.3, got ${version}`); process.exit(1); }
console.log("OK pi version:", version);
