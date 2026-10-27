import { describe, expect, it } from "vitest";
import { isSafeCommand as planIsSafe, PLAN_SAFE_SUBCOMMANDS } from "../pi-runtime/extensions/hv-plan";
import { isSafeCommand as shellIsSafe, READONLY_SUBCOMMANDS } from "../pi-runtime/extensions/hv-shell";

describe("hv-shell", () => {
  it("plan mode and hv-shell share ONE classifier", () => {
    expect(planIsSafe).toBe(shellIsSafe);
    expect(PLAN_SAFE_SUBCOMMANDS).toBe(READONLY_SUBCOMMANDS);
  });
});

import { isReadOnlyShellCommand, READ_ONLY_SHELL_SUMMARY } from "../pi-runtime/extensions/hv-shell";

describe("isReadOnlyShellCommand (round 29)", () => {
  const ro = (c: string): boolean => isReadOnlyShellCommand(c, "/ws");
  it.each([
    "ls", "git status", "git log --oneline -5", "grep -rn foo src 2>/dev/null | head -20",
    "cd /ws/src && cat a.ts", "cd src && wc -l a.ts", "sed -n '120,160p' src/a.ts", "rg foo",
  ])("runs without asking: %s", (c) => expect(ro(c)).toBe(true));

  it.each([
    "npm test 2>&1 | tail -5", "cat ~/.ssh/id_rsa", "cat /etc/passwd", "cd /tmp && ls", "cd src && cat ../../x",
    "printenv", "printenv AWS_SECRET_ACCESS_KEY", "sed -i s/a/b/ x", "find . -delete", "rg --pre sh foo",
    "ls > out.txt", 'cat "$HOME/x"', "echo $(whoami)", "grep -f /etc/x foo", "grep --file=/etc/x foo",
    "ls src/*.ts", "curl https://x", "npm run lint", "vitest run", "pytest -q", "cargo test",
  ])("asks: %s", (c) => expect(ro(c)).toBe(false));

  it("windows workspace, case-insensitive", () => {
    expect(isReadOnlyShellCommand("cat c:/WS/src/a.ts", "C:\\ws", true)).toBe(true);
    expect(isReadOnlyShellCommand("cat C:\\other\\a.ts", "C:\\ws", true)).toBe(false);
  });

  it("the displayed list is derived and never lists printenv", () => {
    expect(READ_ONLY_SHELL_SUMMARY).toContain("ls");
    expect(READ_ONLY_SHELL_SUMMARY).toContain("git status");
    expect(READ_ONLY_SHELL_SUMMARY).not.toContain("printenv");
  });
});
