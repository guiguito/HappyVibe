import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Can this process create a symlink?
 *
 * On Windows it needs elevation or Developer Mode, so the FIXTURE — not the
 * behaviour — is what fails there, with EPERM. Every confinement path that resolves
 * through links is identical on all platforms and covered on POSIX, so these tests
 * gate on the CAPABILITY rather than the platform: a Windows box with Developer Mode
 * on still runs them, which a `skipIf(win32)` would have given up for free.
 */
export const CAN_SYMLINK = ((): boolean => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-symlink-probe-"));
  try {
    fs.symlinkSync(dir, path.join(dir, "l"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
