import { describe, expect, it } from "vitest";
import { BODY_CAP, humaniseBranch, parseRemote, pullRequestUrl } from "../src/main/gitForge";

/**
 * §29 §7 (amended 2026-08-16) — the prefilled pull-request URL.
 *
 * This is where the risk of the feature actually lives. Nothing here talks to a
 * forge, so a wrong URL fails in the user's browser as a 404 rather than as an
 * exception we could catch — which is exactly why the shapes are pinned.
 */

describe("parseRemote", () => {
  it("reads an https remote", () => {
    expect(parseRemote("https://github.com/guiguito/TestHappyVibeGit.git")).toEqual({
      host: "github.com",
      path: "guiguito/TestHappyVibeGit",
    });
  });

  it("reads an https remote with no .git suffix", () => {
    expect(parseRemote("https://github.com/guiguito/Repo")).toEqual({ host: "github.com", path: "guiguito/Repo" });
  });

  it("reads the scp-like ssh form", () => {
    expect(parseRemote("git@github.com:guiguito/Repo.git")).toEqual({ host: "github.com", path: "guiguito/Repo" });
  });

  it("reads the ssh:// form", () => {
    expect(parseRemote("ssh://git@github.com/guiguito/Repo.git")).toEqual({
      host: "github.com",
      path: "guiguito/Repo",
    });
  });

  it("keeps a GitLab SUBGROUP path intact", () => {
    // Taking only the last two segments would point at a project that does not
    // exist — subgroups nest arbitrarily deep.
    expect(parseRemote("https://gitlab.com/group/sub/deeper/repo.git")).toEqual({
      host: "gitlab.com",
      path: "group/sub/deeper/repo",
    });
  });

  it("drops a port and a trailing slash", () => {
    expect(parseRemote("https://gitlab.com:443/group/repo/")).toEqual({ host: "gitlab.com", path: "group/repo" });
  });

  it("returns null for junk rather than guessing", () => {
    expect(parseRemote("")).toBeNull();
    expect(parseRemote("not a url")).toBeNull();
    expect(parseRemote("https://github.com/")).toBeNull();
    expect(parseRemote("/srv/git/bare.git")).toBeNull();
  });
});

describe("pullRequestUrl", () => {
  const base = { path: "o/r", base: "main", head: "feature/x", title: "A title", body: "A body" };

  it("builds GitHub's compare form", () => {
    const u = new URL(pullRequestUrl({ host: "github.com", ...base })!);
    expect(u.origin + u.pathname).toBe("https://github.com/o/r/compare/main...feature/x");
    expect(u.searchParams.get("quick_pull")).toBe("1");
    expect(u.searchParams.get("title")).toBe("A title");
    expect(u.searchParams.get("body")).toBe("A body");
  });

  it("builds GitLab's merge-request form with its bracketed params", () => {
    const u = new URL(pullRequestUrl({ host: "gitlab.com", ...base })!);
    expect(u.origin + u.pathname).toBe("https://gitlab.com/o/r/-/merge_requests/new");
    expect(u.searchParams.get("merge_request[source_branch]")).toBe("feature/x");
    expect(u.searchParams.get("merge_request[target_branch]")).toBe("main");
    expect(u.searchParams.get("merge_request[title]")).toBe("A title");
    expect(u.searchParams.get("merge_request[description]")).toBe("A body");
  });

  it("builds Bitbucket's form and sends NO description", () => {
    // Bitbucket Cloud has no documented description parameter. Sending one
    // silently drops it; inventing a key that does nothing is worse than
    // omitting it, because the next person assumes it works.
    const u = new URL(pullRequestUrl({ host: "bitbucket.org", ...base })!);
    expect(u.origin + u.pathname).toBe("https://bitbucket.org/o/r/pull-requests/new");
    expect(u.searchParams.get("source")).toBe("feature/x");
    expect(u.searchParams.get("dest")).toBe("main");
    expect(u.searchParams.get("title")).toBe("A title");
    expect([...u.searchParams.keys()]).not.toContain("description");
  });

  it("returns null for a host it does not know — which is what hides the button", () => {
    expect(pullRequestUrl({ host: "git.mycompany.com", ...base })).toBeNull();
    expect(pullRequestUrl({ host: "gitea.example.org", ...base })).toBeNull();
  });

  it("encodes a branch name containing a slash", () => {
    const u = pullRequestUrl({ host: "github.com", ...base, head: "feat/a b" })!;
    // The compare segment must survive the slash; the browser must not read it
    // as another path segment beyond the compare range.
    expect(u).toContain("main...feat/a%20b");
  });

  it("encodes markdown and newlines in the body", () => {
    const u = new URL(pullRequestUrl({ host: "github.com", ...base, body: "- one\n- two & three" })!);
    expect(u.searchParams.get("body")).toBe("- one\n- two & three");
  });

  it("caps a huge body so the URL cannot 414", () => {
    const huge = "x".repeat(50_000);
    const u = pullRequestUrl({ host: "github.com", ...base, body: huge })!;
    const got = new URL(u).searchParams.get("body")!;
    expect(got.length).toBeLessThanOrEqual(BODY_CAP);
    expect(got.endsWith("…")).toBe(true);
    // Still a valid, parseable URL — the whole point of capping.
    expect(() => new URL(u)).not.toThrow();
  });

  it("truncates on a line boundary rather than mid-word where it can", () => {
    const body = `${"line one\n".repeat(600)}TAIL`;
    const got = new URL(pullRequestUrl({ host: "github.com", ...base, body })!).searchParams.get("body")!;
    expect(got.endsWith("…")).toBe(true);
    expect(got).not.toContain("TAIL");
    expect(got.slice(0, -1).endsWith("line one\n") || got.slice(0, -1).endsWith("line one")).toBe(true);
  });

  it("omits an empty body instead of sending a blank parameter", () => {
    const u = new URL(pullRequestUrl({ host: "github.com", ...base, body: "" })!);
    expect([...u.searchParams.keys()]).not.toContain("body");
  });
});

describe("humaniseBranch", () => {
  it("reads the last segment as words", () => {
    expect(humaniseBranch("feature/add-pr-button")).toBe("Add pr button");
    expect(humaniseBranch("fix_the_thing")).toBe("Fix the thing");
    expect(humaniseBranch("guiguito/feat/deep/nested-name")).toBe("Nested name");
  });

  it("falls back to the raw name rather than returning nothing", () => {
    expect(humaniseBranch("---")).toBe("---");
    expect(humaniseBranch("main")).toBe("Main");
  });
});
