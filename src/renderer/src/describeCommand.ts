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

  if (cmd === "git") {
    const sub = firstNonFlag(t) ?? "";
    if (sub === "checkout" || sub === "switch") {
      const target = firstNonFlag(t, t.indexOf(sub) + 1);
      return { label: target ? `Switching to ${truncate(target, 40)}` : "Switching branches" };
    }
    if (GIT_VERBS[sub]) return { label: GIT_VERBS[sub] };
    return fallback;
  }

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

  return fallback;
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
