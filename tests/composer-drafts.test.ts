import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adoptDraft,
  appliedInsert,
  carryDraft,
  dropDraft,
  isEmptyDraft,
  noteInsertApplied,
  readDraft,
  saveDraft,
  type ComposerDraft,
} from "../src/renderer/src/composerDrafts";

/**
 * A message started and not sent survives a workspace switch. App mounts a
 * ChatView only for the ACTIVE workspace's chat tabs, so leaving a workspace
 * unmounts its composers — the store is what outlives them. No DOM in this
 * suite: the store is asserted as data, its wiring by source scan. Every test
 * uses its own session ids: the store is module state.
 */
const draft = (over: Partial<ComposerDraft> = {}): ComposerDraft => ({ text: "", images: [], documents: [], mentions: [], ...over });
const EMPTY = draft();

describe("composer drafts — the store", () => {
  it("keeps a session's unsent message until it is read back", () => {
    saveDraft("keep-1", draft({ text: "half a thought", mentions: [["@a.ts", "src/a.ts"]] }));
    expect(readDraft("keep-1")).toEqual(draft({ text: "half a thought", mentions: [["@a.ts", "src/a.ts"]] }));
    expect(readDraft("keep-2")).toEqual(EMPTY);
  });

  it("an empty read is a fresh object every time — composer state is never shared", () => {
    const a = readDraft("fresh-1");
    a.images.push({ name: "x.png", mimeType: "image/png", data: "AA==" });
    expect(readDraft("fresh-2").images).toEqual([]);
  });

  it("an emptied composer forgets the draft — sending clears it", () => {
    saveDraft("empty-1", draft({ text: "to send" }));
    saveDraft("empty-1", draft({ text: "  \n" }));
    expect(readDraft("empty-1")).toEqual(EMPTY);
  });

  it("a picture or a document with no text is still a message worth keeping", () => {
    expect(isEmptyDraft(draft({ images: [{ name: "a.png", mimeType: "image/png", data: "AA==" }] }))).toBe(false);
    expect(isEmptyDraft(draft({ documents: [{ path: "/d.pdf", name: "d.pdf", format: "pdf", lines: 1, bytes: 1 }] as ComposerDraft["documents"] }))).toBe(false);
  });

  it("no session, nothing stored", () => {
    saveDraft(null, draft({ text: "x" }));
    expect(readDraft(null)).toEqual(EMPTY);
  });

  it("deleting the session drops its draft", () => {
    saveDraft("del-1", draft({ text: "gone with it" }));
    noteInsertApplied("del-1", 4);
    dropDraft("del-1");
    expect(readDraft("del-1")).toEqual(EMPTY);
    expect(appliedInsert("del-1")).toBe(0);
  });

  it("a draft crosses to another window whole, and nothing malformed is adopted", () => {
    const d = draft({ text: "moving", images: [{ name: "a.png", mimeType: "image/png", data: "AA==" }], mentions: [["@b", "b.ts"]] });
    saveDraft("move-1", d);
    const carried = carryDraft("move-1");
    expect(carried).toBeTypeOf("string");
    adoptDraft("move-2", carried!);
    expect(readDraft("move-2")).toEqual(d);
    expect(carryDraft("move-empty")).toBeUndefined();
    adoptDraft("move-3", "not json");
    adoptDraft("move-4", JSON.stringify({ text: 3, images: "no" }));
    expect(readDraft("move-3")).toEqual(EMPTY);
    expect(readDraft("move-4")).toEqual(EMPTY);
  });

  it("remembers which composer insert each session applied, so a remount does not apply it twice", () => {
    expect(appliedInsert("ins-1")).toBe(0);
    noteInsertApplied("ins-1", 7);
    expect(appliedInsert("ins-1")).toBe(7);
    expect(appliedInsert("ins-2")).toBe(0);
  });
});

describe("composer drafts — wiring", () => {
  const chat = readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
  const app = readFileSync("src/renderer/src/App.tsx", "utf8");

  it("the composer starts from the session's draft, not from nothing", () => {
    expect(chat).toMatch(/const \[input, setInput\] = useState\(\(\) => readDraft\(sessionId\)\.text\)/);
    expect(chat).toMatch(/useState<ImageAttachment\[\]>\(\(\) => readDraft\(sessionId\)\.images\)/);
    expect(chat).toMatch(/useState<DocumentAttachment\[\]>\(\(\) => readDraft\(sessionId\)\.documents\)/);
    expect(chat).toMatch(/saveDraft\(sessionId, \{ text: input,/);
  });

  it("the mount effect restores the mentions but never overwrites the content an insert just put there", () => {
    const i = chat.indexOf("mentionMap.current = new Map(d.mentions);");
    expect(i).toBeGreaterThan(-1);
    const start = chat.lastIndexOf("useEffect(() => {", i);
    const effect = chat.slice(start, chat.indexOf("}, [sessionId]);", i));
    expect(effect).not.toMatch(/setInput\(|setAttachments\(|setDocuments\(/);
    // …and it runs after the workspace effect that empties mentionMap.
    expect(chat.indexOf("mentionMap.current = new Map();")).toBeLessThan(i);
  });

  it("an insert lands exactly once per session, across remounts", () => {
    expect(chat).toMatch(/const lastInsert = useRef\(appliedInsert\(sessionId\)\);/);
    expect(chat).toMatch(/lastInsert\.current = n;\s*noteInsertApplied\(sessionId, n\);/);
  });

  it("App carries a chat tab's draft between windows and drops it with a deleted session", () => {
    expect(app).toMatch(/if \(isChatTab\(tab\)\) return carryDraft\(sessionOf\(tab\)\);/);
    expect(app).toMatch(/if \(draft !== undefined && isChatTab\(tab\)\) adoptDraft\(sessionOf\(tab\), draft\);/);
    expect(app).toMatch(/if \(bootDraft && isChatTab\(bootDraft\.tab\)\) adoptDraft\(sessionOf\(bootDraft\.tab\), bootDraft\.draft\);/);
    expect(app).toMatch(/if \(isChatTab\(tab\)\) dropDraft\(sessionOf\(tab\)\);/);
    expect(app).toMatch(/await window\.hv\.deleteSession\(id, decision \?\? undefined\);[^\n]*\n\s*dropDraft\(id\);/);
  });
});
