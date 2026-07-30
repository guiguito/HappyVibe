import { describe, expect, it } from "vitest";
import { stripSkillFrontMatter } from "../src/renderer/src/skillMd";

describe("stripSkillFrontMatter", () => {
  it("strips the front-matter block and the blank lines after it", () => {
    const md = `---\nname: brand-guidelines\ndescription: Applies brand colors.\nlicense: see LICENSE.txt\n---\n\n# Anthropic Brand Styling\n\nBody.`;
    expect(stripSkillFrontMatter(md)).toBe("# Anthropic Brand Styling\n\nBody.");
  });

  it("leaves a file with no front-matter untouched", () => {
    const md = "# Just a heading\n\nBody.";
    expect(stripSkillFrontMatter(md)).toBe(md);
  });

  it("does NOT eat content when the body contains a horizontal rule", () => {
    const md = "# Heading\n\nIntro\n\n---\n\nAfter the rule.";
    expect(stripSkillFrontMatter(md)).toBe(md);
  });

  it("keeps a body `---` when front-matter was also present", () => {
    const md = `---\nname: x\ndescription: y\n---\n\n# H\n\nA\n\n---\n\nB`;
    expect(stripSkillFrontMatter(md)).toBe("# H\n\nA\n\n---\n\nB");
  });

  it("handles CRLF line endings", () => {
    const md = "---\r\nname: x\r\ndescription: y\r\n---\r\n\r\n# H";
    expect(stripSkillFrontMatter(md)).toBe("# H");
  });

  it("tolerates a file that is nothing but front-matter", () => {
    expect(stripSkillFrontMatter("---\nname: x\ndescription: y\n---\n")).toBe("");
  });

  it("does not strip when the opening fence is not the first content", () => {
    const md = "Preamble\n\n---\nname: x\n---\n\n# H";
    expect(stripSkillFrontMatter(md)).toBe(md);
  });
});
