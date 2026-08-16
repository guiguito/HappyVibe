/**
 * V2.A — bash smart parser (PRD "Chat experience": bash commands get parsed
 * explanations — "Installing dependencies (npm install)" — and destructive
 * operations are flagged).
 *
 * Pure `describeCommand(cmd) → {label, destructive?}`; never throws on any
 * input. Used by toolLabel's bash branch; unit-tested exhaustively in
 * tests/describe-command.test.ts.
 *
 * ponytail: heuristic single-pass parser, not a shell grammar — quotes are
 * respected for splitting, subshells/heredocs fall through to the honest
 * "Running: <cmd>" fallback.
 */

export interface CommandDescription {
  label: string;
  /** rm/rmdir — the card badges these. */
  destructive?: boolean;
}

/** Collapse whitespace and cap at `n` chars with an ellipsis. */
const truncate = (s: string, n = 60): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;

/**
 * First segment of a command list, split on the first UNQUOTED separator.
 * sep: "chain" for && / || / ; / & — "pipe" for a single |.
 */
function firstSegment(cmd: string): { seg: string; rest: string | null; sep: "chain" | "pipe" | null } {
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "\\") {
      i++; // skip escaped char
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ";") return { seg: cmd.slice(0, i), rest: cmd.slice(i + 1), sep: "chain" };
    if (ch === "&") {
      const len = cmd[i + 1] === "&" ? 2 : 1;
      return { seg: cmd.slice(0, i), rest: cmd.slice(i + len), sep: "chain" };
    }
    if (ch === "|") {
      if (cmd[i + 1] === "|") return { seg: cmd.slice(0, i), rest: cmd.slice(i + 2), sep: "chain" };
      return { seg: cmd.slice(0, i), rest: cmd.slice(i + 1), sep: "pipe" };
    }
  }
  return { seg: cmd, rest: null, sep: null };
}

/** Whitespace-tokenize one segment, respecting quotes (quotes stripped). */
function tokenize(seg: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let has = false;
  let quote: string | null = null;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === "\\" && i + 1 < seg.length) {
      cur += seg[++i];
      has = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) tokens.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has) tokens.push(cur);
  return tokens;
}

const firstNonFlag = (tokens: string[], from = 1): string | null =>
  tokens.slice(from).find((t) => !t.startsWith("-")) ?? null;

const PKG_MANAGERS = new Set(["npm", "yarn", "pnpm", "bun"]);
const TEST_RUNNERS = new Set(["vitest", "jest", "pytest"]);
const INTERPRETERS = new Set(["node", "python", "python3", "ruby", "deno", "tsx"]);

const GIT_VERBS: Record<string, string> = {
  status: "Checking git status",
  add: "Staging changes",
  commit: "Committing changes",
  push: "Pushing to remote",
  pull: "Pulling from remote",
  branch: "Managing branches",
  log: "Viewing git history",
  diff: "Viewing changes",
  fetch: "Checking the remote",
  init: "Starting version tracking",
  clone: "Cloning a repository",
};

/** Describe one pipeline-free segment. `raw` is the segment text for the fallback. */
function describeSegment(tokens: string[], raw: string): CommandDescription {
  // Skip env-var prefixes (FOO=bar cmd) and sudo/env wrappers.
  let i = 0;
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || tokens[i] === "sudo" || tokens[i] === "env")) i++;
  const t = tokens.slice(i);
  const fallback: CommandDescription = { label: `Running: ${truncate(raw)}` };
  if (t.length === 0) return { label: "Running a command" };
  const cmd = basename(t[0]);

  if (PKG_MANAGERS.has(cmd)) {
    const sub = firstNonFlag(t) ?? "";
    if (["install", "i", "ci", "add"].includes(sub) || (cmd === "yarn" && sub === "")) {
      return { label: "Installing dependencies…" };
    }
    if (["remove", "uninstall", "rm", "un"].includes(sub)) return { label: "Removing dependencies" };
    if (sub === "test" || (cmd === "npm" && sub === "t")) return { label: "Running tests" };
    if (sub === "run") {
      const script = firstNonFlag(t, t.indexOf("run") + 1);
      return { label: script ? `Running script ${truncate(script, 40)}` : "Running a script" };
    }
    return fallback;
  }

  if (cmd === "git") return describeGit(t, fallback);

  if (TEST_RUNNERS.has(cmd)) return { label: "Running tests" };
  if (cmd === "go" && firstNonFlag(t) === "test") return { label: "Running tests" };

  if (cmd === "mkdir") {
    const dir = firstNonFlag(t);
    return { label: dir ? `Creating directory ${truncate(dir, 40)}` : "Creating a directory" };
  }
  if (cmd === "cp") {
    const src = firstNonFlag(t);
    return { label: src ? `Copying ${truncate(src, 40)}` : "Copying files" };
  }
  if (cmd === "mv") {
    const src = firstNonFlag(t);
    return { label: src ? `Moving ${truncate(src, 40)}` : "Moving files" };
  }
  if (cmd === "rm" || cmd === "rmdir") {
    const target = firstNonFlag(t);
    return { label: target ? `Deleting ${truncate(target, 40)}` : "Deleting files", destructive: true };
  }

  if (cmd === "grep" || cmd === "rg") {
    const pattern = firstNonFlag(t);
    return { label: pattern ? `Searching for ${truncate(pattern, 40)}` : "Searching" };
  }
  if (cmd === "find") {
    const nameIdx = t.findIndex((x) => x === "-name" || x === "-iname");
    const pattern = nameIdx >= 0 ? t[nameIdx + 1] : firstNonFlag(t);
    return { label: pattern ? `Searching for ${truncate(pattern, 40)}` : "Searching" };
  }

  if (cmd === "curl" || cmd === "wget") {
    const url = t.slice(1).find((x) => /^https?:\/\//.test(x)) ?? firstNonFlag(t);
    return { label: url ? `Fetching ${truncate(url, 50)}` : "Fetching a URL" };
  }

  if (INTERPRETERS.has(cmd)) {
    const script = firstNonFlag(t);
    return { label: script ? `Running ${basename(truncate(script, 60))}` : fallback.label };
  }

  return describeCommon(cmd, t) ?? fallback;
}

/**
 * Round 15 — the everyday verbs that used to reach "Running: <cmd>".
 *
 * A built-in tool cannot carry an `intent` (fixed schemas — §7 round 1), so for
 * `bash` this table IS the headline: there is no model-authored sentence to fall
 * back to, only the raw command. Reported as "I see some bash commands which do
 * not have it".
 *
 * ponytail: a lookup plus a handful of one-line arms, deliberately not a shell
 * grammar — anything not listed still degrades to the honest raw fallback,
 * which is the behaviour this only narrows.
 */
function describeCommon(cmd: string, t: string[]): CommandDescription | null {
  const arg = (from = 1): string | null => firstNonFlag(t, from);
  const name = (s: string | null, n = 40): string => truncate(basename(s ?? ""), n);

  switch (cmd) {
    case "cat":
    case "head":
    case "tail":
    case "less":
    case "more": {
      const f = arg();
      return { label: f ? `Reading ${name(f)}` : "Reading a file" };
    }
    case "sed":
    case "awk": {
      // The script argument is not a file; take the last non-flag token, which
      // is where the path sits in the shapes an agent actually writes.
      const f = t.slice(1).filter((x) => !x.startsWith("-")).pop();
      return { label: f && /[./]/.test(f) ? `Reading part of ${name(f)}` : "Transforming text" };
    }
    case "ls": {
      const d = arg();
      return { label: d ? `Listing ${name(d)}` : "Listing the current directory" };
    }
    case "pwd":
      return { label: "Checking the current directory" };
    case "which":
    case "command":
    case "type": {
      const what = arg();
      return { label: what ? `Looking for ${truncate(what, 30)}` : "Looking for a program" };
    }
    case "touch": {
      const f = arg();
      return { label: f ? `Creating ${name(f)}` : "Creating a file" };
    }
    case "ln": {
      // The link is the LAST non-flag token — `ln -s <target> <link>`.
      const last = t.slice(1).filter((x) => !x.startsWith("-")).pop();
      return { label: last ? `Linking ${name(last)}` : "Creating a link" };
    }
    case "chmod":
    case "chown": {
      // Skip the mode/owner operand (+x, 755, me:staff) to reach the path.
      const target = t.slice(2).find((x) => !x.startsWith("-"));
      return { label: target ? `Changing permissions of ${name(target)}` : "Changing permissions" };
    }
    case "kill":
    case "pkill":
      return { label: "Stopping a process" };
    case "ps":
      return { label: "Listing processes" };
    case "lsof":
      return { label: "Checking what is using a port" };
    case "wc": {
      const f = arg();
      return { label: f ? `Counting lines in ${name(f)}` : "Counting lines" };
    }
    case "diff": {
      const [a, b] = t.slice(1).filter((x) => !x.startsWith("-"));
      return { label: a && b ? `Comparing ${name(a, 24)} and ${name(b, 24)}` : "Comparing files" };
    }
    case "echo":
    case "printf":
      return { label: "Printing a message" };
    case "sort":
    case "uniq":
      return { label: "Sorting output" };
    case "tar":
    case "unzip":
    case "gunzip":
      return { label: "Extracting an archive" };
    case "make": {
      const target = arg();
      return { label: target ? `Running make ${truncate(target, 30)}` : "Running make" };
    }
    case "cargo": {
      const sub = arg() ?? "";
      if (sub === "test") return { label: "Running tests" };
      if (sub === "build" || sub === "check") return { label: "Building the project" };
      if (sub === "run") return { label: "Running the project" };
      return { label: `Running cargo ${truncate(sub, 30)}` };
    }
    case "docker": {
      const sub = arg() ?? "";
      if (sub === "ps") return { label: "Listing containers" };
      if (sub === "build") return { label: "Building a container image" };
      if (sub === "run") return { label: "Starting a container" };
      if (sub === "logs") return { label: "Reading container logs" };
      return { label: `Running docker ${truncate(sub, 30)}` };
    }
    case "open":
      return { label: `Opening ${name(arg())}` };
    case "sleep":
      return { label: "Waiting" };
    case "date":
      return { label: "Checking the date" };
    default:
      return null;
  }
}

export function describeCommand(cmd: string): CommandDescription {
  try {
    const raw = typeof cmd === "string" ? cmd.trim() : "";
    if (!raw) return { label: "Running a command" };
    const { seg, rest, sep } = firstSegment(raw);
    const tokens = tokenize(seg);
    // Empty first segment (leading separator garbage) — try the rest, else give up.
    if (tokens.length === 0) return rest?.trim() ? describeCommand(rest) : { label: "Running a command" };
    // `cd X && CMD` — the cd is scaffolding; describe what actually runs.
    if (tokens[0] === "cd" && sep === "chain" && rest?.trim()) return describeCommand(rest);
    const d = describeSegment(tokens, seg.trim() || raw);
    if (sep === "pipe") return { ...d, label: `${d.label} | …` };
    if (rest?.trim()) return { ...d, label: `${d.label} + more` };
    return d;
  } catch {
    return { label: "Running a command" }; // never throw on garbage input
  }
}

/**
 * §29 — what a git card can honestly say.
 *
 * Built-in tools cannot carry an `intent` param (it is stripped before
 * tool_call), so the text of the command is the ONLY source. Branch names and
 * commit messages live in that text; file lists do not, so no label here claims
 * to know which files moved — the Changes panel is where that belongs.
 */
function describeGit(t: string[], fallback: CommandDescription): CommandDescription {
  const sub = firstNonFlag(t) ?? "";
  const rest = t.slice(t.indexOf(sub) + 1);
  const flags = new Set(t.filter((x) => x.startsWith("-")));
  const args = rest.filter((x) => !x.startsWith("-"));

  if (sub === "checkout" || sub === "switch") {
    const target = firstNonFlag(t, t.indexOf(sub) + 1);
    return { label: target ? `Switching to ${truncate(target, 40)}` : "Switching branches" };
  }

  if (sub === "commit") {
    const msg = quotedMessage(t);
    const amend = flags.has("--amend");
    if (msg) return { label: `${amend ? "Amending the last version" : "Saving a version"}: "${truncate(msg, 60)}"` };
    return { label: amend ? "Amending the last version" : "Committing changes" };
  }

  if (sub === "push" || sub === "pull") {
    // `git push origin main` → [origin, main]; a lone remote is common too.
    const [remote, branch] = args;
    // A force push must never read as routine — it is the one destructive verb
    // whose card the user has to notice.
    const force = flags.has("--force") || flags.has("-f") || flags.has("--force-with-lease");
    const verb = sub === "push" ? (force ? "FORCE-pushing" : "Pushing") : "Pulling";
    const prep = sub === "push" ? "to" : "from";
    if (branch) return { label: `${verb} ${truncate(branch, 30)} ${prep} ${truncate(remote, 20)}` };
    if (remote) return { label: `${verb} ${prep} ${truncate(remote, 20)}` };
    return { label: `${verb} ${prep} remote` };
  }

  if (sub === "stash") {
    const action = args[0] ?? "push";
    if (action === "pop" || action === "apply") return { label: "Restoring stashed changes" };
    if (action === "drop") return { label: "Dropping a stash" };
    if (action === "list") return { label: "Listing stashes" };
    return { label: "Stashing changes" };
  }

  if (sub === "merge" && args[0]) return { label: `Merging ${truncate(args[0], 40)}` };
  if (sub === "rebase" && args[0]) return { label: `Rebasing onto ${truncate(args[0], 40)}` };
  if (sub === "tag" && args[0]) return { label: `Tagging ${truncate(args[0], 40)}` };
  if (sub === "restore" && args[0]) return { label: `Undoing changes in ${truncate(args[0], 40)}` };

  if (GIT_VERBS[sub]) return { label: GIT_VERBS[sub] };
  return fallback;
}

/** The `-m "…"` message, with whichever quotes the caller used stripped. */
function quotedMessage(tokens: string[]): string | null {
  const i = tokens.findIndex((x) => x === "-m" || x === "--message");
  if (i === -1 || i + 1 >= tokens.length) return null;
  return tokens[i + 1] || null;
}
