/**
 * Give the app the user's login-shell PATH.
 *
 * A GUI-launched macOS app inherits a minimal PATH from launchd, not the one
 * your terminal has — so nvm's node, uv, and everything under /opt/homebrew are
 * invisible. Every child we spawn inherits that: the Pi CLI, the agent's `bash`
 * tool, `npx` stdio MCP servers, and nodePreflight's "needs Node" probe. The
 * symptom is a catalog card badged "needs Node" on a machine where node works
 * fine, and `npx foo` failing in a session while the identical command works in
 * the user's terminal.
 *
 * Heuristics can't fix this: node lives in a version-specific nvm directory
 * (~/.nvm/versions/node/v22.21.1/bin) that changes on every `nvm install` and is
 * injected by .zshrc. The user's shell is the only source of truth, so ask it.
 *
 * Never observed in dev, because `npm run dev` inherits the terminal's PATH —
 * the exact "verifying in dev is not verifying the app" trap in CLAUDE.md.
 *
 * ponytail: no dependency — this is what shell-env/fix-path do, in 30 lines.
 * Electron-free so it is unit-testable, same as nodePreflight.ts.
 */
import { spawnSync } from "node:child_process";

/** Sentinel around the PATH so rc-file banners, version managers and direnv chatter can't be mistaken for output. */
const DELIM = "__HV_PATH__";

let cached: string | undefined;

/**
 * The login shell's PATH, or undefined if it can't be determined (in which case
 * callers keep today's behaviour). Costs one shell spawn — measured at ~1.0-1.2s
 * with a real .zshrc — so it runs once per launch and is memoised.
 */
export function loginShellPath(): string | undefined {
  if (cached !== undefined) return cached || undefined;
  cached = "";
  if (process.platform === "win32") return undefined; // Windows inherits correctly
  const shell = process.env.SHELL;
  if (!shell) return undefined;
  try {
    const r = spawnSync(shell, ["-ilc", `printf %s ${DELIM}; printf %s "$PATH"; printf %s ${DELIM}`], {
      encoding: "utf8",
      timeout: 5_000,
      // A misbehaving rc file must not hang startup, and a shell that decides to
      // prompt must not block on a stdin nobody is writing to.
      stdio: ["ignore", "pipe", "ignore"],
    });
    const out = r.stdout ?? "";
    const a = out.indexOf(DELIM);
    const b = out.indexOf(DELIM, a + DELIM.length);
    if (a === -1 || b === -1) return undefined;
    cached = out.slice(a + DELIM.length, b).trim();
    return cached || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Merge the shell PATH into an existing one: shell entries first so user tooling
 * wins over anything Electron or the bundle contributed, order preserved, no
 * duplicates. Merge rather than replace — the packaged app's own entries matter.
 */
export function mergePath(current: string | undefined, shell: string | undefined): string | undefined {
  if (!shell) return current;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...shell.split(":"), ...(current ?? "").split(":")]) {
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out.join(":");
}

/** Tests only — the real app asks the shell once per launch. */
export function resetShellPathCache(): void {
  cached = undefined;
}
