import { expect, test } from "vitest";
import { parseForgeUrl } from "../src/main/skills/gitImport";

test("GitHub → codeload tar.gz, HEAD default", () => {
  const a = parseForgeUrl("https://github.com/anthropics/skills");
  expect(a).toMatchObject({ host: "github.com", owner: "anthropics", repo: "skills", ref: "HEAD" });
  expect(a!.archiveUrl).toBe("https://codeload.github.com/anthropics/skills/tar.gz/HEAD");
});

test("GitHub /tree/<ref> pins the ref", () => {
  const a = parseForgeUrl("https://github.com/anthropics/skills/tree/1f630fd");
  expect(a!.ref).toBe("1f630fd");
  expect(a!.archiveUrl).toBe("https://codeload.github.com/anthropics/skills/tar.gz/1f630fd");
});

test(".git suffix stripped", () => {
  expect(parseForgeUrl("https://github.com/o/r.git")!.repo).toBe("r");
});

test("GitLab archive endpoint", () => {
  const a = parseForgeUrl("https://gitlab.com/o/r");
  expect(a!.archiveUrl).toBe("https://gitlab.com/o/r/-/archive/main/r-main.tar.gz");
});

test("Bitbucket + Codeberg endpoints", () => {
  expect(parseForgeUrl("https://bitbucket.org/o/r")!.archiveUrl).toBe("https://bitbucket.org/o/r/get/main.tar.gz");
  expect(parseForgeUrl("https://codeberg.org/o/r")!.archiveUrl).toBe("https://codeberg.org/o/r/archive/main.tar.gz");
});

test("unsupported host / malformed → null", () => {
  expect(parseForgeUrl("https://example.com/o/r")).toBeNull();
  expect(parseForgeUrl("not a url")).toBeNull();
  expect(parseForgeUrl("https://github.com/onlyowner")).toBeNull();
  expect(parseForgeUrl("ssh://git@github.com/o/r")).toBeNull();
});
