// HappyVibe: the WINDOWS sub-agent launcher (PRD §4 Windows round; §12 child guard).
//
// pi-subagents runs PI_SUBAGENT_PI_BINARY as the child command. pi-node.sh does that
// job on macOS/Linux, but it is a POSIX shell script and Windows cannot run it — and a
// .cmd shim is not a drop-in, because Node refuses to spawn() a .cmd without
// shell:true (the BatBadBut fix).
//
// Upstream's own win32 rule is what makes THIS file work: getPiSpawnCommand
// (pi-subagents src/runs/shared/pi-spawn.ts) runs a PI_SUBAGENT_PI_BINARY matching
// isNodeScriptPath (/\.(?:mjs|cjs|js)$/i) as `process.execPath <script> …args`, and
// process.execPath in the parent Pi is our Electron binary already running as Node
// (ELECTRON_RUN_AS_NODE=1 is inherited). So: no shell, no .exe, no system Node.
// Pinned by tests/pi-subagents-contract.test.ts — if a pin bump drops that branch,
// every Windows delegation dies at spawn and that test says why.
//
// Keep the CLI path in step with PI_CLI_RELPATH in src/main/pi/spawn.ts and with
// pi-node.sh; tests/pi-cli-entry.test.ts pins all three to one entry.
import { fileURLToPath } from "node:url";
import path from "node:path";

const RUNTIME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(RUNTIME, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");

// PRD §12: every sub-agent child loads HappyVibe's permission guard. PREPENDED, never
// appended — pi-args puts the task LAST as a positional (`Task: …` or `@…/task.md`),
// and whether a flag after a positional is still parsed is not worth betting the
// permission gate on.
const GUARD = path.join(RUNTIME, "extensions", "hv-child-guard.ts");

process.argv = [process.argv[0], CLI, "--extension", GUARD, ...process.argv.slice(2)];
await import(CLI);
