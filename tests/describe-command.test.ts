import { describe, expect, it } from "vitest";
import { describeCommand } from "../src/renderer/src/describeCommand";

// V2.A — bash smart parser (PRD "Chat experience": parsed explanations,
// destructive operations flagged). Pure; must never throw on any input.

describe("package managers", () => {
  it("install/add → Installing dependencies…", () => {
    expect(describeCommand("npm install").label).toBe("Installing dependencies…");
    expect(describeCommand("npm i").label).toBe("Installing dependencies…");
    expect(describeCommand("npm ci").label).toBe("Installing dependencies…");
    expect(describeCommand("yarn add react").label).toBe("Installing dependencies…");
    expect(describeCommand("pnpm install --frozen-lockfile").label).toBe("Installing dependencies…");
    expect(describeCommand("bun add -d vitest").label).toBe("Installing dependencies…");
    expect(describeCommand("yarn").label).toBe("Installing dependencies…"); // bare yarn installs
  });
  it("remove/uninstall → Removing dependencies", () => {
    expect(describeCommand("npm uninstall lodash").label).toBe("Removing dependencies");
    expect(describeCommand("yarn remove left-pad").label).toBe("Removing dependencies");
    expect(describeCommand("pnpm rm foo").label).toBe("Removing dependencies");
  });
  it("test → Running tests", () => {
    expect(describeCommand("npm test").label).toBe("Running tests");
    expect(describeCommand("npm t").label).toBe("Running tests");
    expect(describeCommand("bun test").label).toBe("Running tests");
  });
  it("run X → Running script X", () => {
    expect(describeCommand("npm run build").label).toBe("Running script build");
    expect(describeCommand("pnpm run typecheck:web").label).toBe("Running script typecheck:web");
    expect(describeCommand("npm run").label).toBe("Running a script");
  });
  it("unknown subcommand falls back honestly", () => {
    expect(describeCommand("npm publish").label).toBe("Running: npm publish");
  });
});

describe("git", () => {
  it.each([
    ["git status", "Checking git status"],
    ["git status -sb", "Checking git status"],
    ["git add -A", "Staging changes"],
    ["git branch -a", "Managing branches"],
    ["git log --oneline -5", "Viewing git history"],
    ["git diff HEAD~1", "Viewing changes"],
    ["git fetch --prune", "Checking the remote"],
    ["git stash push -u", "Stashing changes"],
    ["git stash pop", "Restoring stashed changes"],
    ["git init -b main", "Starting version tracking"],
    ["git clone https://example.com/x.git", "Cloning a repository"],
    ["git merge feature", "Merging feature"],
    ["git rebase -i main", "Rebasing onto main"],
    ["git tag v1.0.0", "Tagging v1.0.0"],
    ["git restore src/a.ts", "Undoing changes in src/a.ts"],
  ])("%s → %s", (cmd, label) => {
    expect(describeCommand(cmd).label).toBe(label);
  });

  /**
   * §29: a git card says more of what happened — but ONLY what the command
   * string can tell us. Built-ins cannot carry an `intent` param, so the text of
   * the call is all there is; branch names and commit messages are in it, file
   * lists are not, and the card must not pretend otherwise.
   */
  it("commit quotes the message the user will recognise", () => {
    expect(describeCommand("git commit -m 'fix: the retry loop'").label).toBe('Saving a version: "fix: the retry loop"');
    expect(describeCommand('git commit -m "feat(ui): add a badge"').label).toBe('Saving a version: "feat(ui): add a badge"');
    expect(describeCommand("git commit --amend -m 'redo'").label).toBe('Amending the last version: "redo"');
    // No -m: git would open an editor, and we have no message to show.
    expect(describeCommand("git commit").label).toBe("Committing changes");
  });

  it("push and pull name the branch when the string carries one", () => {
    expect(describeCommand("git push origin main").label).toBe("Pushing main to origin");
    expect(describeCommand("git push -u origin feature/x").label).toBe("Pushing feature/x to origin");
    expect(describeCommand("git push").label).toBe("Pushing to remote");
    expect(describeCommand("git pull --ff-only origin main").label).toBe("Pulling main from origin");
    expect(describeCommand("git pull --rebase").label).toBe("Pulling from remote");
  });

  it("a force push is called what it is", () => {
    // The one git label that must never read as routine.
    expect(describeCommand("git push --force origin main").label).toBe("FORCE-pushing main to origin");
    expect(describeCommand("git push -f").label).toBe("FORCE-pushing to remote");
  });
  it("checkout/switch name the target when present", () => {
    expect(describeCommand("git checkout main").label).toBe("Switching to main");
    expect(describeCommand("git checkout -b feature/x").label).toBe("Switching to feature/x");
    expect(describeCommand("git switch dev").label).toBe("Switching to dev");
    expect(describeCommand("git checkout").label).toBe("Switching branches");
  });
  it("unknown git subcommand still falls back to the raw text", () => {
    expect(describeCommand("git bisect start").label).toBe("Running: git bisect start");
    expect(describeCommand("git cherry-pick abc123").label).toBe("Running: git cherry-pick abc123");
  });
});

describe("test runners", () => {
  it.each(["vitest run", "jest --coverage", "pytest tests/", "go test ./...", "npx vitest"])(
    "%s → Running tests",
    (cmd) => {
      // npx isn't a recognized wrapper — only the direct runners count.
      if (cmd.startsWith("npx")) expect(describeCommand(cmd).label).toBe("Running: npx vitest");
      else expect(describeCommand(cmd).label).toBe("Running tests");
    }
  );
  it("go without test is not a test run", () => {
    expect(describeCommand("go build ./...").label).toBe("Running: go build ./...");
  });
});

describe("file operations", () => {
  it("mkdir/cp/mv describe the target", () => {
    expect(describeCommand("mkdir -p src/components")).toEqual({ label: "Creating directory src/components" });
    expect(describeCommand("cp a.txt b.txt")).toEqual({ label: "Copying a.txt" });
    expect(describeCommand("mv old.ts new.ts")).toEqual({ label: "Moving old.ts" });
  });
  it("rm/rmdir are destructive", () => {
    expect(describeCommand("rm -rf node_modules")).toEqual({ label: "Deleting node_modules", destructive: true });
    expect(describeCommand("rm file.txt")).toEqual({ label: "Deleting file.txt", destructive: true });
    expect(describeCommand("rmdir empty-dir")).toEqual({ label: "Deleting empty-dir", destructive: true });
    expect(describeCommand("rm -rf")).toEqual({ label: "Deleting files", destructive: true });
  });
  it("cp/mv/mkdir are NOT flagged destructive", () => {
    expect(describeCommand("mv a b").destructive).toBeUndefined();
    expect(describeCommand("mkdir x").destructive).toBeUndefined();
  });
});

describe("searches", () => {
  it("grep/rg → Searching for <pattern> (flags skipped)", () => {
    expect(describeCommand("grep -rn TODO src").label).toBe("Searching for TODO");
    expect(describeCommand('rg --json "async function"').label).toBe("Searching for async function");
    expect(describeCommand("grep").label).toBe("Searching");
  });
  it("find prefers the -name pattern, else the path", () => {
    expect(describeCommand('find . -name "*.test.ts"').label).toBe("Searching for *.test.ts");
    expect(describeCommand("find src -type f -iname readme.md").label).toBe("Searching for readme.md");
    expect(describeCommand("find /tmp").label).toBe("Searching for /tmp");
  });
});

describe("network", () => {
  it("curl/wget → Fetching <url>", () => {
    expect(describeCommand("curl -s https://api.example.com/v1").label).toBe("Fetching https://api.example.com/v1");
    expect(describeCommand("wget https://example.com/file.tgz").label).toBe("Fetching https://example.com/file.tgz");
    expect(describeCommand("curl -sI example.com").label).toBe("Fetching example.com");
    expect(describeCommand("curl").label).toBe("Fetching a URL");
  });
});

describe("interpreters", () => {
  it("node/python/ruby script → Running <script basename>", () => {
    expect(describeCommand("node scripts/build.mjs").label).toBe("Running build.mjs");
    expect(describeCommand("python3 tools/gen.py --fast").label).toBe("Running gen.py");
    expect(describeCommand("ruby deploy.rb").label).toBe("Running deploy.rb");
  });
});

describe("chains and pipes", () => {
  it("cd X && CMD describes CMD", () => {
    expect(describeCommand("cd /tmp/proj && npm install").label).toBe("Installing dependencies…");
    expect(describeCommand("cd sub && git status").label).toBe("Checking git status");
  });
  it("A && B → describe A + more", () => {
    expect(describeCommand("npm install && npm test").label).toBe("Installing dependencies… + more");
    expect(describeCommand("git add -A && git commit -m x").label).toBe("Staging changes + more");
  });
  it("; and || and & also chain", () => {
    expect(describeCommand("npm test; echo done").label).toBe("Running tests + more");
    expect(describeCommand("npm test || echo failed").label).toBe("Running tests + more");
    expect(describeCommand("npm test &").label).toBe("Running tests"); // trailing & — nothing after
  });
  it("pipes describe the first command + | …", () => {
    expect(describeCommand("grep -rn TODO src | head -5").label).toBe("Searching for TODO | …");
    expect(describeCommand("cat file | wc -l").label).toBe("Running: cat file | …");
  });
  it("destructive survives chaining (cd prefix and + more)", () => {
    expect(describeCommand("cd /tmp && rm -rf build")).toEqual({ label: "Deleting build", destructive: true });
    expect(describeCommand("rm -rf dist && npm run build")).toEqual({
      label: "Deleting dist + more",
      destructive: true,
    });
  });
});

describe("quoting edge cases", () => {
  it("separators inside quotes do not split", () => {
    // The message coming back WHOLE — `&&` and `|` intact, not chopped into
    // segments — is exactly what this test is for. (§29 changed the label from
    // the flat "Committing changes" to one that quotes the message; the quoting
    // assertion below is unchanged and is the point.)
    expect(describeCommand('git commit -m "fix: a && b | c"').label).toBe('Saving a version: "fix: a && b | c"');
    expect(describeCommand("echo 'a && b'").label).toBe("Running: echo 'a && b'");
  });
  it("quoted arguments are unwrapped for the label", () => {
    expect(describeCommand('rm -rf "My Folder"')).toEqual({ label: "Deleting My Folder", destructive: true });
    expect(describeCommand("grep 'exact phrase' src").label).toBe("Searching for exact phrase");
  });
  it("escaped characters don't break tokenizing", () => {
    expect(describeCommand("rm My\\ Folder")).toEqual({ label: "Deleting My Folder", destructive: true });
  });
  it("unterminated quote still yields a label (never throws)", () => {
    expect(describeCommand('git commit -m "oops').label).toBe('Saving a version: "oops"');
  });
});

describe("prefixes and paths", () => {
  it("env-var and sudo/env prefixes are skipped", () => {
    expect(describeCommand("NODE_ENV=test npm test").label).toBe("Running tests");
    expect(describeCommand("sudo rm -rf /var/cache")).toEqual({ label: "Deleting /var/cache", destructive: true });
    expect(describeCommand("env FOO=1 git status").label).toBe("Checking git status");
  });
  it("absolute command paths resolve by basename", () => {
    expect(describeCommand("/usr/bin/git status").label).toBe("Checking git status");
  });
});

describe("unknown / garbage input", () => {
  it("unknown commands keep today's Running: <truncated>", () => {
    expect(describeCommand("make -j8").label).toBe("Running: make -j8");
    const long = "x".repeat(200);
    expect(describeCommand(long).label).toBe(`Running: ${"x".repeat(60)}…`);
  });
  it("empty/whitespace/garbage never throws", () => {
    expect(describeCommand("")).toEqual({ label: "Running a command" });
    expect(describeCommand("   \n\t ")).toEqual({ label: "Running a command" });
    expect(describeCommand("&&")).toEqual({ label: "Running a command" });
    expect(describeCommand("|||")).toEqual({ label: "Running a command" });
    expect(describeCommand(";;;")).toEqual({ label: "Running a command" });
    expect(describeCommand(undefined as unknown as string)).toEqual({ label: "Running a command" });
    expect(describeCommand(42 as unknown as string)).toEqual({ label: "Running a command" });
  });
});
