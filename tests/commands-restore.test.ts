import { describe, expect, it } from "vitest";
import { expandedHash, pairCommandItems, restoreItems, type RawMessage } from "../src/main/restore";

/**
 * §24: Pi stores only the EXPANDED prompt, so a reload turns `/review foo.ts`
 * into a wall of text. Main logs `{typed, sha256(expanded)}` per invocation and
 * the restore path re-pairs by HASHING each user message — never by ordinal,
 * because ask-user answers and queued messages are user messages too.
 */
const EXPANDED = "Review src/foo.ts for bugs.";

const msg = (role: string, text: string): RawMessage => ({ role, content: [{ type: "text", text }] });

describe("pairCommandItems", () => {
  it("attaches the typed form to the user message whose text hashes to a logged invocation", () => {
    const items = restoreItems([msg("user", EXPANDED), msg("assistant", "Looks fine.")]);
    const paired = pairCommandItems(items, new Map([[expandedHash(EXPANDED), "/review src/foo.ts"]]));
    expect(paired[0]).toEqual({ kind: "user", text: EXPANDED, command: { typed: "/review src/foo.ts" } });
    expect(paired[1]).toEqual({ kind: "assistant", text: "Looks fine." });
  });

  it("leaves a non-matching user message plain", () => {
    const items = restoreItems([msg("user", "just chatting")]);
    expect(pairCommandItems(items, new Map([[expandedHash(EXPANDED), "/review"]]))).toEqual([
      { kind: "user", text: "just chatting" },
    ]);
  });

  it("pairs by hash, not by position — a later invocation matches wherever it landed", () => {
    const items = restoreItems([msg("user", "hello"), msg("user", EXPANDED)]);
    const paired = pairCommandItems(items, new Map([[expandedHash(EXPANDED), "/review"]]));
    expect(paired.map((i) => (i.kind === "user" ? i.command?.typed ?? null : null))).toEqual([null, "/review"]);
  });

  it("hashes trimmed text, so whitespace at either end cannot break the pairing", () => {
    expect(expandedHash(`  ${EXPANDED}\n`)).toBe(expandedHash(EXPANDED));
  });

  it("is a no-op with no logged invocations", () => {
    const items = restoreItems([msg("user", EXPANDED)]);
    expect(pairCommandItems(items, new Map())).toEqual([{ kind: "user", text: EXPANDED }]);
  });
});
