import { describe, expect, it } from "vitest";
import {
  activeMentionQuery, completeMention, extractMentions, filterEntries, mentionLabel,
  splitMentionSegments, stripInjectedBlocks, type MentionEntry,
} from "../src/renderer/src/mentions";

const entries: MentionEntry[] = [
  { rel: "src/a/toto.md", kind: "file" },
  { rel: "src/b/toto.md", kind: "file" },
  { rel: "src/app.ts", kind: "file" },
  { rel: "docs", kind: "dir" },
];

describe("activeMentionQuery", () => {
  it("detects the token under the caret", () => {
    expect(activeMentionQuery("hey @to", 7)).toEqual({ start: 4, query: "to" });
  });
  it("fires at the start of the text and right after @", () => {
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });
  it("ignores an @ not preceded by whitespace (e.g. an email)", () => {
    expect(activeMentionQuery("foo@bar", 7)).toBeNull();
  });
  it("returns null when the caret sits past a completed token", () => {
    expect(activeMentionQuery("@toto.md done", 13)).toBeNull();
  });
});

describe("filterEntries", () => {
  it("substring-matches on basename, prefix matches first", () => {
    const r = filterEntries(entries, "app");
    expect(r[0].rel).toBe("src/app.ts");
  });
  it("empty query returns everything (capped)", () => {
    expect(filterEntries(entries, "").length).toBe(entries.length);
  });
});

describe("mentionLabel + collision", () => {
  it("uses the basename, then the full path when a basename collides", () => {
    const map = new Map<string, string>();
    const l1 = mentionLabel("src/a/toto.md", map);
    expect(l1).toBe("toto.md");
    map.set(l1, "src/a/toto.md");
    expect(mentionLabel("src/b/toto.md", map)).toBe("src/b/toto.md");
  });
});

describe("completeMention", () => {
  it("replaces the @query with @label plus a trailing space", () => {
    const r = completeMention("see @to now", 4, 7, "toto.md");
    expect(r.text).toBe("see @toto.md  now");
    expect(r.caret).toBe(13); // right after "@toto.md "
  });
});

describe("extractMentions", () => {
  it("returns relPaths for tokens still present, deduped and in order", () => {
    const map = new Map([["toto.md", "src/a/toto.md"], ["app.ts", "src/app.ts"]]);
    expect(extractMentions("look at @toto.md and @app.ts and @toto.md", map)).toEqual([
      "src/a/toto.md", "src/app.ts",
    ]);
  });
  it("drops tokens the user deleted (no longer in the text)", () => {
    const map = new Map([["toto.md", "src/a/toto.md"]]);
    expect(extractMentions("nothing here", map)).toEqual([]);
  });
});

describe("stripInjectedBlocks", () => {
  it("cuts from the first injected block marker", () => {
    const msg = 'explain @a.ts\n\n<file path="src/a.ts">\ncode\n</file>';
    expect(stripInjectedBlocks(msg)).toBe("explain @a.ts");
  });
  it("also cuts at a file-listing marker when it comes first", () => {
    const msg = 'see @docs\n\n<file-listing path="docs">\ndocs/x.md\n</file-listing>';
    expect(stripInjectedBlocks(msg)).toBe("see @docs");
  });
  it("leaves a plain message untouched", () => {
    expect(stripInjectedBlocks("just words")).toBe("just words");
  });
});

describe("splitMentionSegments", () => {
  it("splits text and @mention segments; emails are not mentions", () => {
    expect(splitMentionSegments("hi @a.ts see foo@bar.com")).toEqual([
      { kind: "text", value: "hi " },
      { kind: "mention", value: "@a.ts" },
      { kind: "text", value: " see foo@bar.com" },
    ]);
  });
});
