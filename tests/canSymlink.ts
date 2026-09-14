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

/**
 * Can a chmod actually make a file unreadable to this process?
 *
 * On Windows it cannot: NTFS permissions are ACL-based and `chmod 0o000` is a no-op
 * for the owner, so a "the store is unreadable" fixture simply reads fine. The
 * behaviour under test (degrade to nothing rather than throw) is platform-neutral and
 * covered by the missing and malformed cases either way.
 */
export const CAN_DENY_READ = process.platform !== "win32";
