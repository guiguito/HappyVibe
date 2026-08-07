/**
 * §26 part 2 — terminal-tool policy. PURE module, zero imports.
 *
 * Same discipline as hv-rules.ts: it is imported by the bridge (inside Pi), by
 * src/main, and by vitest, so the rule the model is gated on and the rule main
 * enforces are one function rather than two that drift.
 */

export const TERMINAL_TOOLS = new Set(["terminal_run", "terminal_read", "terminal_kill"]);

export type CommandCheck = { ok: true; command: string } | { ok: false; reason: string };

/**
 * One command line per call. Newlines are rejected, and NOT for tidiness:
 * `describeCommand` (the permission modal's label) reads only the first
 * segment, so a two-line string would be approved on the strength of its
 * harmless first line. A prompt that under-describes what it approves is worse
 * than no prompt.
 */
export function checkCommand(cmd: unknown): CommandCheck {
  if (typeof cmd !== "string") return { ok: false, reason: "terminal_run requires a `command` string." };
  if (/[\r\n]/.test(cmd)) {
    return {
      ok: false,
      reason:
        "terminal_run takes one command line per call — embedded newlines are rejected. " +
        "Send each line as its own call; each is gated separately.",
    };
  }
  const command = cmd.trim();
  if (!command) return { ok: false, reason: "terminal_run requires a non-empty `command`." };
  return { ok: true, command };
}

/**
 * Does this shell command line end a segment with a REAL background operator?
 *
 * Deliberately narrow. `&&` is a sequencer and `2>&1` / `&>` are redirects —
 * firing on those would block the honest `npm ci && npm run build`, which is
 * the common case. So: scan character by character, skip quoted spans, skip a
 * `&` that is part of `&&`, `>&` or `&>`, and report the rest.
 */
export function hasBackgroundAmpersand(cmd: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c !== "&") continue;
    if (cmd[i + 1] === "&") {
      i++;
      continue; // `&&` — a sequencer, not a backgrounder
    }
    if (cmd[i - 1] === ">") continue; // `2>&1`
    if (cmd[i + 1] === ">") {
      i++;
      continue; // `&> /tmp/log`
    }
    return true;
  }
  return false;
}

/** Appended to the system prompt while the Terminal group is enabled. */
export const TERMINAL_STEER_LINE =
  "Long-running commands (dev servers, watchers, `docker compose up`, anything you would " +
  "background) go to `terminal_run`, never to `bash` with a trailing `&`. A backgrounded bash " +
  "process is invisible to the user and cannot be stopped by them; a terminal is a card they " +
  "can watch, type into and kill. Poll it with `terminal_read`, and clean up with `terminal_kill`.";
