// Where Pi's pi-ai lives, found the way Node resolves it FROM pi-coding-agent: its own
// node_modules first (Pi 1.0.x, nested), then the hoisted copy (Pi 1.3.0 pins it exact,
// so npm hoists it). One copy of this lookup — a hard-coded path silently skipped the
// tests gated on it when the layout moved.
import fs from "node:fs";
import path from "node:path";

/** `<runtimeDir>` is pi-runtime/. Returns pi-ai's `dist` directory. */
export function piAiDist(runtimeDir) {
  const scope = path.join(runtimeDir, "node_modules/@earendil-works");
  const nested = path.join(scope, "pi-coding-agent/node_modules/@earendil-works/pi-ai/dist");
  return fs.existsSync(nested) ? nested : path.join(scope, "pi-ai/dist");
}

/** True when Pi itself is installed — the only honest reason for a pi-ai test to skip. */
export function haveRuntime(runtimeDir) {
  return fs.existsSync(path.join(runtimeDir, "node_modules/@earendil-works/pi-coding-agent/package.json"));
}
