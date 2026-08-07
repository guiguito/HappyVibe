/**
 * node-pty's prebuilt `spawn-helper` arrives from npm WITHOUT its executable
 * bit (`-rw-r--r--`), and every `pty.spawn` then fails with the entirely
 * unhelpful `posix_spawnp failed.` — in development, not only when packaged.
 *
 * Measured on this repo at install time, which is why this runs from
 * `postinstall` rather than living in a build script: a fresh clone is broken
 * without it. Idempotent, and a no-op on Windows (conpty has no spawn-helper).
 *
 * Pinned by the first test in `tests/terminals.test.ts`.
 */
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const prebuilds = path.join("node_modules", "node-pty", "prebuilds");
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, dir, "spawn-helper");
    if (!existsSync(helper)) continue;
    const { mode } = statSync(helper);
    if (!(mode & 0o111)) {
      chmodSync(helper, mode | 0o111);
      console.log(`[fix-pty-helper] chmod +x ${helper}`);
    }
  }
}
