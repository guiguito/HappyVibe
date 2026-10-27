/**
 * The fail-closed read-only shell classifier — PURE module.
 *
 * Moved here unchanged from hv-plan.ts (round 29) so Plan Mode and the
 * permission engine's read-only shell default share ONE list. Ported from
 * @narumitw/pi-plan-mode `src/tool-policy.ts` (MIT, © narumiruna): do not
 * "improve" it — wrap it.
 */

import { containsPath, isAbsolutePath, toPosix } from "./hv-paths";

/**
 * Read-only extras enabled by default (the ported policy leaves these opt-in;
 * all are read-only).
 */
export const READONLY_SUBCOMMANDS: SafeSubcommands = {
  git: ["rev-parse", "blame", "describe", "merge-base", "ls-tree", "cat-file"],
  gh: ["pr view", "pr list", "issue view", "issue list"],
};

// ═══════════════════════════════════════════════════════════════════════════
// Bash allowlist — PORTED from @narumitw/pi-plan-mode src/tool-policy.ts (MIT).
// Fail-closed: read-only commands + reviewed git/gh/npm queries only; rejects
// redirects, substitutions, subshells, background jobs, mutating flags, and any
// chain with an unsafe segment. Ported verbatim; do not relax.
// ═══════════════════════════════════════════════════════════════════════════

export interface SafeSubcommands {
  git?: string[];
  gh?: string[];
}

const MUTATING_COMMANDS = new Set([
  "rm", "rmdir", "mv", "cp", "mkdir", "touch", "chmod", "chown", "chgrp", "ln",
  "tee", "truncate", "dd", "sudo", "su", "kill", "pkill", "killall", "reboot",
  "shutdown", "vim", "vi", "nano", "emacs", "code", "subl",
]);
export const READ_ONLY_COMMANDS = new Set([
  "cat", "head", "tail", "grep", "find", "ls", "pwd", "echo", "printf", "wc",
  "sort", "uniq", "diff", "file", "stat", "du", "df", "tree", "which", "whereis",
  "type", "printenv", "uname", "whoami", "id", "date", "uptime", "ps", "jq",
  "rg", "fd", "bat", "eza",
]);

export function readCommand(input: unknown): string {
  const command = input as { command?: unknown } | undefined;
  return typeof command?.command === "string" ? command.command : "";
}

export function isSafeCommand(command: string, safeSubcommands: SafeSubcommands = {}): boolean {
  const segments = splitShellSegments(command);
  return (
    segments !== undefined &&
    segments.length > 0 &&
    segments.every((segment) => isSafeSegment(segment, safeSubcommands))
  );
}

export function splitShellSegments(command: string): string[] | undefined {
  const trimmed = command.trim();
  if (!trimmed || /[\n\r`]/.test(trimmed)) return undefined;

  const segments: string[] = [];
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ">" || character === "<" || character === "(" || character === ")") {
      return undefined;
    }
    const next = trimmed[index + 1];
    if (character === "&" && next !== "&") return undefined;
    const separatorLength =
      character === ";" || character === "|"
        ? next === character
          ? 2
          : 1
        : character === "&" && next === "&"
          ? 2
          : 0;
    if (separatorLength === 0) continue;
    const segment = trimmed.slice(start, index).trim();
    if (!segment) return undefined;
    segments.push(segment);
    index += separatorLength - 1;
    start = index + 1;
  }
  if (quote || escaped) return undefined;
  const finalSegment = trimmed.slice(start).trim();
  if (!finalSegment) return undefined;
  segments.push(finalSegment);
  return segments;
}

function isSafeSegment(segment: string, safeSubcommands: SafeSubcommands): boolean {
  if (hasShellExpansion(segment) || /(^|\s)[A-Za-z_][A-Za-z0-9_]*=/.test(segment)) {
    return false;
  }
  const tokens = shellWords(segment);
  if (!tokens || tokens.length === 0) return false;
  const command = tokens[0]?.toLowerCase();
  if (!command || MUTATING_COMMANDS.has(command)) return false;
  const args = tokens.slice(1);
  if (!hasSafeArguments(command, args)) return false;
  if (READ_ONLY_COMMANDS.has(command)) return true;
  return isSafeStructuredCommand(command, args, safeSubcommands);
}

function hasShellExpansion(segment: string): boolean {
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of segment) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "$" && quote === '"') return true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (["$", "*", "?", "[", "{"].includes(character)) return true;
  }
  return false;
}

export function shellWords(segment: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of segment) {
    if (escaped) {
      word += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (/\s/.test(character)) {
      if (word) words.push(word);
      word = "";
    } else word += character;
  }
  if (quote || escaped) return undefined;
  if (word) words.push(word);
  return words;
}

function hasSafeArguments(command: string, args: string[]): boolean {
  const forbidden = new Set(["-i", "--in-place", "--fix", "--write", "-delete", "--delete"]);
  if (args.some((argument) => forbidden.has(argument))) return false;
  if (
    command === "sed" &&
    args.some(
      (argument) =>
        argument.startsWith("--in-place=") ||
        (/^-[^-]+/.test(argument) && argument.slice(1).includes("i")),
    )
  ) {
    return false;
  }
  if (
    command === "find" &&
    args.some((argument) =>
      ["-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(argument),
    )
  ) {
    return false;
  }
  if (command === "date" && args.some((argument) => argument === "-s" || argument.startsWith("--set"))) {
    return false;
  }
  if (
    (command === "sort" || command === "tree") &&
    args.some(
      (argument) =>
        argument === "-o" ||
        (argument.startsWith("-o") && !argument.startsWith("--")) ||
        argument.startsWith("--output"),
    )
  ) {
    return false;
  }
  if (
    command === "sort" &&
    args.some(
      (argument) =>
        argument === "-T" ||
        (argument.startsWith("-T") && argument.length > 2) ||
        argument.startsWith("--temporary-directory") ||
        argument.startsWith("--compress-program"),
    )
  ) {
    return false;
  }
  if (
    command === "diff" &&
    args.some((argument) => argument === "--output" || argument.startsWith("--output="))
  ) {
    return false;
  }
  if (command === "uniq" && args.filter((argument) => !argument.startsWith("-")).length > 1) {
    return false;
  }
  if (
    command === "fd" &&
    args.some((argument) =>
      ["-x", "-X", "--exec", "--exec-batch"].some((flag) => argument === flag || argument.startsWith(`${flag}=`)),
    )
  ) {
    return false;
  }
  if (command === "rg" && args.some((argument) => argument === "--pre" || argument.startsWith("--pre="))) {
    return false;
  }
  if (command === "bat" && args.some((argument) => argument === "--pager" || argument.startsWith("--pager="))) {
    return false;
  }
  return true;
}

type ArgumentValidator = (args: string[]) => boolean;
const allowReadOnlyArguments: ArgumentValidator = () => true;
const BUILTIN_GIT_VALIDATORS: Record<string, ArgumentValidator> = {
  status: allowReadOnlyArguments,
  log: isSafeGitLogArguments,
  diff: isSafeGitDiffArguments,
  show: requiresNoTextconv,
  branch: isSafeGitBranchArguments,
  remote: isSafeGitRemoteArguments,
  "ls-files": allowReadOnlyArguments,
  grep: isSafeGitGrepArguments,
};
const CONFIGURABLE_GIT_VALIDATORS: Record<string, ArgumentValidator> = {
  "rev-parse": allowReadOnlyArguments,
  blame: requiresNoTextconv,
  describe: allowReadOnlyArguments,
  "merge-base": allowReadOnlyArguments,
  "ls-tree": allowReadOnlyArguments,
  "cat-file": isSafeGitCatFileArguments,
};
const GH_VALIDATORS: Record<string, ArgumentValidator> = {
  "pr view": isSafeGhReadArguments,
  "pr list": isSafeGhReadArguments,
  "issue view": isSafeGhReadArguments,
  "issue list": isSafeGhReadArguments,
};

function isSafeStructuredCommand(command: string, args: string[], safeSubcommands: SafeSubcommands): boolean {
  if (command === "git") return isSafeGitCommand(args, safeSubcommands);
  if (command === "gh") return isSafeGhCommand(args, safeSubcommands);

  const subcommandIndex = args.findIndex((argument) => !argument.startsWith("-"));
  const subcommand = args[subcommandIndex]?.toLowerCase();
  const subcommandArgs = subcommandIndex >= 0 ? args.slice(subcommandIndex + 1) : [];
  if (command === "sed") {
    const script = args.find((argument) => !argument.startsWith("-"));
    return (
      Boolean(script) &&
      (args.includes("-n") || args.some((argument) => /^-[^-]*n[^-]*$/.test(argument))) &&
      /^\d+(,\d+)?p$/.test(script ?? "")
    );
  }
  if (["node", "python", "python3", "tsc", "biome", "ruff", "ty"].includes(command)) {
    if (args.includes("--version")) return true;
    return (
      command === "tsc" &&
      args.includes("--noEmit") &&
      !args.some(
        (argument) =>
          argument === "--incremental" ||
          argument.startsWith("--incremental=") ||
          argument === "--tsBuildInfoFile" ||
          argument.startsWith("--tsBuildInfoFile=") ||
          argument === "--generateTrace" ||
          argument.startsWith("--generateTrace="),
      )
    );
  }
  if (command === "npm") {
    if (subcommand === "audit" && subcommandArgs.includes("fix")) return false;
    if (["list", "ls", "view", "info", "search", "outdated", "audit", "test"].includes(subcommand ?? "")) {
      return true;
    }
    return subcommand === "run" && ["test", "check", "typecheck", "lint"].includes(args[1] ?? "");
  }
  if (["cargo", "go", "pytest", "vitest", "jest"].includes(command)) {
    return (
      ["test", "check"].includes(subcommand ?? "") || ["pytest", "vitest", "jest"].includes(command)
    );
  }
  return false;
}

function isSafeGitCommand(args: string[], safeSubcommands: SafeSubcommands): boolean {
  let subcommandIndex = 0;
  while (args[subcommandIndex] === "--no-pager") subcommandIndex += 1;
  const subcommand = args[subcommandIndex]?.toLowerCase();
  if (!subcommand || subcommand.startsWith("-")) return false;
  const subcommandArgs = args.slice(subcommandIndex + 1);
  const builtinValidator = BUILTIN_GIT_VALIDATORS[subcommand];
  const configuredValidator = CONFIGURABLE_GIT_VALIDATORS[subcommand];
  const configured = safeSubcommands.git?.includes(subcommand) === true;
  const validator = builtinValidator ?? (configured ? configuredValidator : undefined);
  return validator !== undefined && hasSafeGitArguments(subcommand, subcommandArgs) && validator(subcommandArgs);
}

function hasSafeGitArguments(subcommand: string, args: string[]): boolean {
  return !args.some(
    (argument) =>
      argument === "--help" ||
      argument === "--show-signature" ||
      argument.startsWith("--show-signature=") ||
      argument.includes("%G") ||
      argument === "--output" ||
      argument.startsWith("--output=") ||
      argument === "--ext-diff" ||
      argument.startsWith("--ext-diff=") ||
      argument === "--textconv" ||
      argument.startsWith("--textconv=") ||
      argument === "--paginate" ||
      argument === "--open-files-in-pager" ||
      argument.startsWith("--open-files-in-pager=") ||
      (subcommand === "grep" && (argument === "-O" || argument.startsWith("-O"))),
  );
}

function isSafeGitCatFileArguments(args: string[]): boolean {
  return !args.some(
    (argument) =>
      matchesLongOptionPrefix(argument, "--filters", "--fi") ||
      matchesLongOptionPrefix(argument, "--textconv", "--t"),
  );
}

function isSafeGitGrepArguments(args: string[]): boolean {
  return !args.some(
    (argument) =>
      matchesLongOptionPrefix(argument, "--textconv", "--textc") ||
      matchesLongOptionPrefix(argument, "--open-files-in-pager", "--op") ||
      matchesLongOptionPrefix(argument, "--ext-grep", "--ext"),
  );
}

function matchesLongOptionPrefix(argument: string, option: string, shortest: string): boolean {
  const optionName = argument.split("=", 1)[0] ?? "";
  return optionName.length >= shortest.length && option.startsWith(optionName);
}

function isSafeGitDiffArguments(args: string[]): boolean {
  return args.includes("--check") || (args.includes("--no-ext-diff") && args.includes("--no-textconv"));
}

function isSafeGitLogArguments(args: string[]): boolean {
  if (args.includes("--no-textconv")) return true;
  return !args.some(requiresTextconvGuardForGitLog);
}

function requiresTextconvGuardForGitLog(argument: string): boolean {
  return (
    argument === "-p" ||
    argument.startsWith("-p") ||
    argument === "-u" ||
    argument.startsWith("-U") ||
    argument === "-c" ||
    argument === "--patch" ||
    argument.startsWith("--patch=") ||
    argument.startsWith("--patch-with-") ||
    argument === "--unified" ||
    argument.startsWith("--unified=") ||
    argument === "--binary" ||
    argument === "--cc" ||
    argument === "--remerge-diff" ||
    argument.startsWith("-S") ||
    argument.startsWith("-G") ||
    argument === "--find-object" ||
    argument.startsWith("--find-object=")
  );
}

function requiresNoTextconv(args: string[]): boolean {
  return args.includes("--no-textconv");
}

function isSafeGitBranchArguments(args: string[]): boolean {
  if (args.some((argument) => !argument.startsWith("-"))) return false;
  return !args.some(
    (argument) =>
      /^-[^-]*[dDmMcCu]/.test(argument) ||
      matchesLongOptionPrefix(argument, "--delete", "--del") ||
      matchesLongOptionPrefix(argument, "--move", "--mov") ||
      matchesLongOptionPrefix(argument, "--copy", "--cop") ||
      matchesLongOptionPrefix(argument, "--edit-description", "--e") ||
      matchesLongOptionPrefix(argument, "--unset-upstream", "--u") ||
      matchesLongOptionPrefix(argument, "--set-upstream-to", "--set-u") ||
      matchesLongOptionPrefix(argument, "--create-reflog", "--creat"),
  );
}

function isSafeGitRemoteArguments(args: string[]): boolean {
  const actionIndex = args.findIndex((argument) => !argument.startsWith("-"));
  if (actionIndex < 0) return true;
  const action = args[actionIndex];
  if (action === "get-url") return true;
  if (action !== "show") return false;

  const showArgs = args.slice(actionIndex + 1);
  if (showArgs.includes("--")) return false;
  const remotes = showArgs.filter((argument) => !argument.startsWith("-"));
  return remotes.length === 0 || (remotes.length === 1 && showArgs.includes("-n"));
}

function isSafeGhCommand(args: string[], safeSubcommands: SafeSubcommands): boolean {
  const group = args[0]?.toLowerCase();
  const action = args[1]?.toLowerCase();
  if (!group || !action || group.startsWith("-") || action.startsWith("-")) return false;
  const path = `${group} ${action}`;
  if (!safeSubcommands.gh?.includes(path)) return false;
  const validator = GH_VALIDATORS[path];
  return validator?.(args.slice(2)) ?? false;
}

function isSafeGhReadArguments(args: string[]): boolean {
  return !args.some(isUnsafeGhReadArgument) && hasGhJsonOutput(args);
}

function isUnsafeGhReadArgument(argument: string): boolean {
  return (
    argument.startsWith("-w") ||
    argument === "--web" ||
    argument.startsWith("--web=") ||
    argument === "--browser" ||
    argument.startsWith("--browser=") ||
    argument === "--paginate" ||
    argument === "--pager" ||
    argument.startsWith("--pager=") ||
    argument === "--output" ||
    argument.startsWith("--output=")
  );
}

function hasGhJsonOutput(args: string[]): boolean {
  let hasJson = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return false;
      hasJson = true;
      index += 1;
    } else if (argument.startsWith("--json=")) {
      if (argument === "--json=") return false;
      hasJson = true;
    }
  }
  return hasJson;
}

/** The git subcommands the classifier always accepts (display: READ_ONLY_SHELL_SUMMARY). */
export const READONLY_GIT_SUBCOMMANDS: readonly string[] = Object.keys(BUILTIN_GIT_VALIDATORS);

// ═══════════════════════════════════════════════════════════════════════════
// Round 29 — the read-only shell DEFAULT: the classifier above, wrapped.
// The classifier answers "is this read-only?" for Plan Mode, where a passing
// command still meets the permission rules. Running WITHOUT asking needs more,
// so this wrapper adds it around the classifier instead of relaxing it.
// ═══════════════════════════════════════════════════════════════════════════

/** The only redirects that change nothing on disk. */
const HARMLESS_REDIRECTS = new Set(["2>&1", "2>/dev/null", ">/dev/null"]);

/**
 * The classifier accepts these as "checks" for Plan Mode, but each one RUNS
 * project code — code the agent may have just written without asking. A
 * read-only default must never execute what it was handed.
 */
const RUNS_PROJECT_CODE = new Set(["cargo", "go", "pytest", "vitest", "jest"]);
const NPM_RUNS_CODE = new Set(["test", "run", "t", "tst", "start", "exec", "x"]);

/** Removes unquoted `2>&1`, `2>/dev/null` and `>/dev/null` words; everything else is kept as typed. */
export function stripHarmlessRedirects(cmd: string): string {
  let out = "";
  let quote: "'" | '"' | undefined;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (!quote && (i === 0 || /\s/.test(cmd[i - 1]))) {
      const hit = [...HARMLESS_REDIRECTS].find((r) => cmd.startsWith(r, i) && (i + r.length === cmd.length || /[\s|;&]/.test(cmd[i + r.length])));
      if (hit) { i += hit.length; continue; }
    }
    if (c === "\\" && quote !== "'") { out += c + (cmd[i + 1] ?? ""); i += 2; continue; }
    if (quote) { if (c === quote) quote = undefined; }
    else if (c === "'" || c === '"') quote = c;
    out += c;
    i++;
  }
  return out;
}

/** The parts of a command the classifier can vouch for, or null when it cannot split it safely. */
export function commandParts(cmd: string): string[] | null {
  return splitShellSegments(stripHarmlessRedirects(cmd)) ?? null;
}

/** Does one word (or a `--flag=value`'s value) point outside the workspace? */
function wordEscapes(word: string, workspace: string, ci: boolean): boolean {
  const v = word.startsWith("-") && word.includes("=") ? word.slice(word.indexOf("=") + 1) : word;
  if (v.startsWith("~")) return true;
  if (toPosix(v).split("/").includes("..")) return true;
  // `C:foo` is drive-relative on Windows: not provably inside, so treated like an absolute path.
  if (isAbsolutePath(v) || /^[A-Za-z]:/.test(v)) return v !== "/dev/null" && !containsPath(workspace, v, ci);
  return false;
}

/** One part: a `cd` into the workspace, or a classifier-safe, workspace-confined, code-free command. */
export function isReadOnlyPart(part: string, workspace: string, caseInsensitive = false): boolean {
  const words = shellWords(part);
  if (!words || words.length === 0) return false;
  const [program, ...args] = words;
  if (program === "cd") return args.length === 1 && !wordEscapes(args[0], workspace, caseInsensitive);
  const name = program.toLowerCase();
  if (name === "printenv" || RUNS_PROJECT_CODE.has(name)) return false;
  if (name === "npm" && NPM_RUNS_CODE.has((args.find((a) => !a.startsWith("-")) ?? "").toLowerCase())) return false;
  if (args.some((a) => wordEscapes(a, workspace, caseInsensitive))) return false;
  return isSafeCommand(part, READONLY_SUBCOMMANDS);
}

/** True when every part of the command is read-only and stays inside the workspace. */
export function isReadOnlyShellCommand(cmd: string, workspace: string, caseInsensitive = false): boolean {
  const parts = commandParts(cmd);
  return !!parts && parts.length > 0 && parts.every((p) => isReadOnlyPart(p, workspace, caseInsensitive));
}

/** What the Permissions page lists — derived from the classifier, never re-typed. */
export const READ_ONLY_SHELL_SUMMARY: readonly string[] = [
  ...[...READ_ONLY_COMMANDS].filter((c) => c !== "printenv"),
  ...[...READONLY_GIT_SUBCOMMANDS, ...(READONLY_SUBCOMMANDS.git ?? [])].map((s) => `git ${s}`),
  ...(READONLY_SUBCOMMANDS.gh ?? []).map((s) => `gh ${s}`),
  "sed -n 'N,Mp'",
];

// ── Round 29: where a deny/ask command rule looks ────────────────────────────

/** Programs that run the rest of their words as a command. */
const COMMAND_WRAPPERS = new Set(["env", "command", "exec", "nohup", "time", "sudo", "xargs"]);
const STRING_SHELLS = new Set(["sh", "bash", "zsh"]);

/**
 * Every place a command could start, normalised — for DENY and ASK rules only.
 *
 * Deliberately permissive (quotes are ignored when splitting): over-matching a
 * deny costs a prompt, under-matching it runs the thing the user forbade. Leading
 * `VAR=value` words and COMMAND_WRAPPERS (with their flags) are skipped, and the
 * string given to `sh|bash|zsh -c` or `eval` is read as a command too. Best
 * effort — a command deny rule guards against mistakes, it is not a sandbox.
 */
export function commandPositions(cmd: string): string[] {
  const out: string[] = [];
  for (const piece of cmd.split(/&&|\|\||\$\(|[;&|\n`(){}]/)) {
    let words = piece.trim().replace(/^["']+|["']+$/g, "").split(/\s+/).filter(Boolean);
    for (;;) {
      while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words = words.slice(1);
      if (words.length > 0 && COMMAND_WRAPPERS.has(words[0])) {
        words = words.slice(1);
        while (words.length > 0 && words[0].startsWith("-")) words = words.slice(1);
        continue;
      }
      break;
    }
    if (words.length === 0) continue;
    out.push(words.join(" "));
    const inner = words[0] === "eval" ? words.slice(1) : STRING_SHELLS.has(words[0]) && words[1] === "-c" ? words.slice(2) : null;
    if (inner && inner.length > 0) out.push(...commandPositions(inner.join(" ").replace(/^["']+|["']+$/g, "")));
  }
  return out;
}
