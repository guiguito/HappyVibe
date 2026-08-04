import { describe, it, expect } from "vitest";
import { screenSkillText, substitutePluginRoot, countPluginRootRefs } from "../src/main/plugins/screen";

describe("screenSkillText", () => {
  it("hard-rejects a hardcoded ~/.claude/skills path", () => {
    // The real gstack pattern: the failure is SILENT because the call is
    // error-suppressed, so the user gets prose with the machinery dead.
    const r = screenSkillText("run bash ~/.claude/skills/gstack/bin/x 2>/dev/null || true");
    expect(r.verdict).toBe("reject");
    expect(r.reason).toContain(".claude/skills");
  });

  it("hard-rejects the absolute spelling too", () => {
    expect(screenSkillText("cat /Users/me/.claude/skills/a/SKILL.md").verdict).toBe("reject");
  });

  it("passes a clean skill", () => {
    expect(screenSkillText("# Skill\nRun `npm test`.\n").verdict).toBe("ok");
  });

  it("warns on a bare $SKILL_DIR — degrades, does not break", () => {
    const r = screenSkillText("python3 $SKILL_DIR/scripts/go.py");
    expect(r.verdict).toBe("warn");
    expect(r.reason).toContain("SKILL_DIR");
  });

  it("warns on the braced ${SKILL_DIR} spelling", () => {
    expect(screenSkillText("cat ${SKILL_DIR}/refs.md").verdict).toBe("warn");
  });

  it("does NOT reject ${CLAUDE_PLUGIN_ROOT} — it is substituted at install", () => {
    expect(screenSkillText("bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh").verdict).toBe("ok");
  });

  it("does not mistake CLAUDE_PLUGIN_ROOT for SKILL_DIR", () => {
    // The two regexes must not overlap, or every repairable plugin would warn.
    expect(screenSkillText("$CLAUDE_PLUGIN_ROOT/a ${CLAUDE_PLUGIN_ROOT}/b").verdict).toBe("ok");
  });

  it("prefers the hard reject when a file has both problems", () => {
    expect(screenSkillText("$SKILL_DIR/a and ~/.claude/skills/b").verdict).toBe("reject");
  });
});

describe("substitutePluginRoot", () => {
  it("replaces every spelling with the installed root", () => {
    const out = substitutePluginRoot(
      'a ${CLAUDE_PLUGIN_ROOT}/x $CLAUDE_PLUGIN_ROOT/y "${CLAUDE_PLUGIN_ROOT}"',
      "/tmp/p",
    );
    expect(out).toBe('a /tmp/p/x /tmp/p/y "/tmp/p"');
  });

  it("leaves text without refs byte-identical", () => {
    const t = "# nothing to do here\nplain body\n";
    expect(substitutePluginRoot(t, "/tmp/p")).toBe(t);
  });

  it("does not touch a similarly named variable", () => {
    const t = "$CLAUDE_PLUGIN_ROOTED/x";
    expect(substitutePluginRoot(t, "/tmp/p")).toBe(t);
  });
});

describe("countPluginRootRefs", () => {
  it("counts both spellings", () => {
    expect(countPluginRootRefs("${CLAUDE_PLUGIN_ROOT}/a $CLAUDE_PLUGIN_ROOT/b")).toBe(2);
  });

  it("is zero for clean text", () => {
    expect(countPluginRootRefs("none here")).toBe(0);
  });
});
