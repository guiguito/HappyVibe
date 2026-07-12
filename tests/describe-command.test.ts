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
    ["git commit -m 'fix: thing'", "Committing changes"],
    ["git push origin main", "Pushing to remote"],
    ["git pull --rebase", "Pulling from remote"],
    ["git branch -a", "Managing branches"],
    ["git log --oneline -5", "Viewing git history"],
    ["git diff HEAD~1", "Viewing changes"],
  ])("%s → %s", (cmd, label) => {
    expect(describeCommand(cmd).label).toBe(label);
  });
  it("checkout/switch name the target when present", () => {
    expect(describeCommand("git checkout main").label).toBe("Switching to main");
    expect(describeCommand("git checkout -b feature/x").label).toBe("Switching to feature/x");
    expect(describeCommand("git switch dev").label).toBe("Switching to dev");
    expect(describeCommand("git checkout").label).toBe("Switching branches");
  });
  it("unknown git subcommand falls back", () => {
    expect(describeCommand("git rebase -i HEAD~3").label).toBe("Running: git rebase -i HEAD~3");
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
    expect(describeCommand('git commit -m "fix: a && b | c"').label).toBe("Committing changes");
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
    expect(describeCommand('git commit -m "oops').label).toBe("Committing changes");
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
