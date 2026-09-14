import { platform } from "../src/main/platform";
import { DEFAULT_TERMINAL_SETTINGS, type TerminalSettings } from "../src/main/terminalSettings";

/**
 * The shell the §26 terminal tests spawn — POSIX on every platform.
 *
 * Those tests are about the TERMINAL MANAGER: does output reach the headless mirror,
 * does the title follow the foreground process, does an exit code arrive. They are
 * not about shell syntax, and their fixtures use POSIX (`$((6*7))`, `printf '\033[31m…'`)
 * because that is what expresses those cases most directly.
 *
 * So on Windows they run under Git Bash rather than PowerShell. It is installed on
 * GitHub's windows runners and is the shell HappyVibe itself prefers there (PRD §4),
 * which makes this the same code path a real Windows user gets — not a test-only one.
 * Rewriting each command per shell would have made the two platforms assert different
 * things, which is how a suite stops being a comparison.
 *
 * `bashPath` is null when no Git Bash exists; the callers skip themselves and
 * tests/windows-skips.test.ts records that.
 */
export const POSIX_SHELL: string | null = platform.isWindows
  ? platform.agentShell().bashPath
  : "/bin/zsh";

/** rc-file skip: `-f` for zsh, `--norc` for bash. A test must not read someone's dotfiles. */
const NO_RC = platform.isWindows ? ["--norc"] : ["-f"];

export const FAST: TerminalSettings = {
  ...DEFAULT_TERMINAL_SETTINGS,
  shellArgs: NO_RC,
  shellPath: POSIX_SHELL,
};

/** True when a POSIX shell is available to spawn. */
export const HAS_POSIX_SHELL = POSIX_SHELL !== null;

/**
 * Can `pty.process` name the foreground command here? Mirrors terminals.ts's
 * FOREGROUND_SUPPORTED, and exists so the terminal tests assert BOTH arms rather
 * than skipping on Windows: what must never happen there is a non-null foreground,
 * which would mark every terminal permanently busy.
 */
export const FOREGROUND_SUPPORTED = !platform.isWindows;

/** The basename the tab shows when nothing else names it (`zsh`, `bash.exe`, …). */
export const SHELL_NAME = (POSIX_SHELL ?? "").split(/[\\/]/).pop() ?? "";
