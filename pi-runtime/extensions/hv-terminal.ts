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

/**
 * Appended to the system prompt while the Terminal group is enabled.
 *
 * It OPENS by affirming bash, and that is not padding — measured. An earlier
 * draft led with "long-running commands go to terminal_run, never to bash with
 * a trailing &" and mentioned bash only as the wrong answer. Over 5 trials of a
 * plain `touch forbidden.txt` prompt, the model called bash 3/5 times without
 * the line and 0/5 with it: it never reached for terminal_run either, it simply
 * stopped calling tools. Two negative mentions of bash and no positive one made
 * it bash-averse in general.
 *
 * So the scope is stated first and the exception second. If this line is ever
 * reworded, re-run that measurement — tests/bridge.test.ts and
 * tests/rules-bridge.test.ts both depend on the model still reaching for bash.
 */
// A5 (2026-09-10): one sentence. This restated terminal_run's own description
// almost word for word, and the bash-`&` refusal is a third copy that fires
// exactly when the model gets it wrong (X2: the tool description holds the how,
// the system section one sentence of when, the refusal the why). Scope first,
// exception second — the ordering the measurement above depends on.
export const TERMINAL_STEER_LINE =
  "`bash` runs commands that finish on their own; a command that would run indefinitely " +
  "(a dev server, a watcher) goes to `terminal_run`, so the user can watch it and stop it.";

/**
 * The three tool descriptions, HERE rather than inline at their registerTool
 * calls, because §13 round 6 shows a built-in's prompt read-only on the All
 * Tools page and "read-only" is worth nothing if the page renders a second copy
 * that can drift from what the model is actually told. The bridge registers
 * these; main serves the same constants to the settings page.
 */
export const TERMINAL_TOOL_DESCRIPTIONS: Record<string, string> = {
  terminal_run:
    "Run ONE command line in a persistent terminal the user can see, type into and stop. " +
    "Use this for anything long-running (dev servers, watchers, `docker compose up`) instead of " +
    "backgrounding a bash command. Omit terminalId to open a new terminal; pass one to reuse an " +
    "IDLE terminal you already own (reusing a busy one is refused — the bytes would go to the " +
    "running program's stdin, not the shell). Exactly one command line per call: newlines are " +
    "rejected, and each call is permission-gated separately. Poll the output with terminal_read.",
  terminal_read:
    "Read the most recent output of one of your terminals, as plain text. Defaults to the last " +
    "200 lines and is capped there. Pass waitMs to wait (up to 15s) for the output to go quiet " +
    "before reading, instead of sleeping in bash. Tells you whether the terminal is still running " +
    "and whether the USER has typed into it since your last read — if they have, re-read before " +
    "assuming you know its state.",
  terminal_kill:
    "Stop one of your terminals and the process running in it. Clean up when you are done, and " +
    "when you have hit the limit on open terminals.",
};

/** What the All Tools page shows for the grouped Terminal entry. */
export function buildTerminalPrompt(append = ""): string {
  const tools = Object.entries(TERMINAL_TOOL_DESCRIPTIONS)
    .map(([name, description]) => `${name}\n  ${description}`)
    .join("\n\n");
  const body = `${TERMINAL_STEER_LINE}\n\n${tools}`;
  return append.trim() ? `${body}\n\n${append.trim()}` : body;
}
