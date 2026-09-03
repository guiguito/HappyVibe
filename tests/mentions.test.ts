import { parseDocumentHeaders } from "../src/main/documents";
import { describe, expect, it } from "vitest";
import {
  activeMentionQuery, agentMentionItems, completeMention, extractMentions, filterEntries, mentionLabel,
  splitMentionSegments, stripInjectedBlocks, type MentionEntry, parseDocumentChips } from "../src/renderer/src/mentions";

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

// ── @agent in the composer (§12, 2026-08-29 — the fleet round) ──────────────
//
// The agents existed and nothing in the chat FLOW said so; discovery was a
// settings page. `@agent` reuses the file-mention machinery rather than adding
// a second trigger character, so there is one thing to learn, not two.
describe("agentMentionItems", () => {
  const agents = [
    { name: "worker", description: "implements", source: "bundled" },
    { name: "code-explorer", description: "reads", source: "bundled" },
    { name: "agents-md-maker", description: "drafts", source: "bundled" },
  ];

  it("matches on a name substring, case-insensitively", () => {
    expect(agentMentionItems(agents, "work").map((a) => a.name)).toEqual(["worker"]);
    expect(agentMentionItems(agents, "EXPLOR").map((a) => a.name)).toEqual(["code-explorer"]);
  });

  it("returns everything for an empty query, so a bare @ shows the roster", () => {
    expect(agentMentionItems(agents, "")).toHaveLength(3);
  });

  it("caps the list so agent rows never bury the file rows", () => {
    // The `@` menu's primary job is files. An unbounded agent list on a
    // one-character query would push every file off the visible menu.
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `a${i}`, description: "x", source: "bundled" }));
    expect(agentMentionItems(many, "a").length).toBeLessThanOrEqual(5);
  });

  it("no match is an empty list, not the whole roster", () => {
    expect(agentMentionItems(agents, "zzz")).toEqual([]);
  });
});

describe("an agent mention is never resolved as a file", () => {
  it("stays plain text because it is not in the label map", () => {
    // extractMentions resolves labels through the map the composer fills when a
    // FILE is picked. An agent pick deliberately writes nothing there, so a
    // message mentioning @worker attaches no file context — the model already
    // has the roster in its system prompt and reads the token as prose.
    const map = new Map<string, string>([["watch.ts", "src/main/watch.ts"]]);
    expect(extractMentions("ask @worker to fix @watch.ts", map)).toEqual(["src/main/watch.ts"]);
  });
});

describe("agentMentionItems ordering", () => {
  it("groups like the Agents page and the chip, not discovery order", () => {
    // Reported 2026-08-30: the @ menu did not match the other two surfaces.
    const mixed = [
      { name: "scout", source: "builtin" },
      { name: "summarizer", source: "bundled" },
      { name: "my-scout", source: "user" },
    ];
    expect(agentMentionItems(mixed, "s").map((a) => a.name)).toEqual(["my-scout", "scout", "summarizer"]);
  });

  it("sorts BEFORE the cap, so the five kept are the top five", () => {
    // Slicing first would keep five arbitrary agents and then order those.
    const many = [
      ...Array.from({ length: 8 }, (_, i) => ({ name: `z-bundled-${i}`, source: "bundled" })),
      { name: "z-mine", source: "user" },
    ];
    expect(agentMentionItems(many, "z")[0].name).toBe("z-mine");
  });
});

describe("§31 documents in the bubble", () => {
  it("strips a <document> block like a <file> block — the chip is what the user sees", () => {
    const t = 'read this\n\n<document path="/x/a.docx" format="docx">\n# A\nbody\n</document>';
    expect(stripInjectedBlocks(t)).toBe("read this");
  });

  it("strips whichever injected block comes first when several ride along", () => {
    const t = 'hi\n\n<document path="/a.docx" format="docx">\nx\n</document>\n\n<file path="b.ts">\ny\n</file>';
    expect(stripInjectedBlocks(t)).toBe("hi");
    const other = 'hi\n\n<file path="b.ts">\ny\n</file>\n\n<document path="/a.docx" format="docx">\nx\n</document>';
    expect(stripInjectedBlocks(other)).toBe("hi");
  });

  it("reads the chips back off the headers, live and restored alike", () => {
    const t = 'q\n\n<document path="/x/a.docx" format="docx">\n# A\n</document>\n\n<document path="/c.pdf" format="pdf">\nz\n</document>';
    expect(parseDocumentChips(t)).toEqual([
      { path: "/x/a.docx", format: "docx" },
      { path: "/c.pdf", format: "pdf" },
    ]);
    expect(parseDocumentChips("nothing here")).toEqual([]);
    expect(parseDocumentChips("I opened a <document> yesterday")).toEqual([]);
  });

  it("agrees with main's parser — two copies of one regex, pinned together", () => {
    // The renderer cannot import from src/main, so the regex exists twice. This
    // is the assertion that stops them drifting.
    const fixture =
      'x\n\n<document path="/a/b c.docx" format="docx">\nbody\n</document>\n\n' +
      '<document path="/d.odt" format="odt">\nmore\n</document>';
    expect(parseDocumentChips(fixture)).toEqual(parseDocumentHeaders(fixture));
  });
});
