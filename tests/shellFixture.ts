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
/**
 * macOS has shipped zsh as the default login shell since Catalina, so that is the
 * path a Mac actually has. Linux ships bash and frequently NO zsh at all —
 * ubuntu-latest has none — and hardcoding `/bin/zsh` for "not Windows" is what
 * took eleven tests red across the two terminal files on the first Linux CI run.
 *
 * The failure is worth remembering because it named no shell: `pty.spawn` does not
 * throw on a missing shell (see terminals.test.ts), so every assertion downstream
 * failed on its own terms — `expected null to be 'sleep'`, `expected [] to include
 * 'sleep'` — and the only hint was one `execvp(3) failed.: No such file or
 * directory` sitting in a buffer three assertions away.
 */
const POSIX_DEFAULT = platform.name === "darwin" ? "/bin/zsh" : "/bin/bash";

export const POSIX_SHELL: string | null = platform.isWindows
  ? platform.agentShell().bashPath
  : POSIX_DEFAULT;

/**
 * rc-file skip: `-f` for zsh, `--norc` for bash. A test must not read someone's
 * dotfiles. Derived from the shell we actually chose rather than from the platform
 * — those were the same question until Linux arrived and stopped being zsh.
 */
const NO_RC = (POSIX_SHELL ?? "").endsWith("zsh") ? ["-f"] : ["--norc"];

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

/** The basename the tab shows when nothing else names it (`zsh`, `bash`, `bash.exe`). */
export const SHELL_NAME = (POSIX_SHELL ?? "").split(/[\\/]/).pop() ?? "";
