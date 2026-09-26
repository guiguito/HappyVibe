/** Test-only host-forced guard: proves it loaded in a child, and which run it thinks it guards. */
import fs from "node:fs";

export default function twMarkerGuard() {
  const info = (globalThis as any)[Symbol.for("pi-subagents:child-spawn")]?.();
  fs.appendFileSync(`${process.env.TW_PROBE_MARKS}/guard-ran`, JSON.stringify({ pid: process.pid, info }) + "\n");
}
