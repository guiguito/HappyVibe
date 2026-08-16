import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isSessionEmpty, type SessionMeta } from "../src/main/store";

/**
 * Round 15 — a session with no content deletes itself when its last tab closes.
 *
 * "No content" is decided here, and the definition is the whole feature: a
 * session Pi merely BOOTED already has a file full of bookkeeping entries, so
 * "the file exists" and "the file is non-empty" both answer yes to a session
 * that never saw a prompt. The question has to be asked of the entries.
 */

let dir: string;

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "s1",
  title: "New session",
  workspaceId: "/ws",
  createdAt: "2026-08-16T12:00:00.000Z",
  updatedAt: "2026-08-16T12:00:00.000Z",
  archived: false,
  titleSource: "fallback",
  ...over,
});

const write = (name: string, entries: unknown[]): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  return file;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-empty-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("isSessionEmpty", () => {
  it("a session that was never spawned is empty", () => {
    expect(isSessionEmpty(meta({ piSessionFile: undefined }), dir)).toBe(true);
  });

  it("a session file that does not exist is empty", () => {
    expect(isSessionEmpty(meta({ piSessionFile: path.join(dir, "gone.jsonl") }), dir)).toBe(true);
  });

  it("a BOOTED session with only bookkeeping entries is empty", () => {
    // This is the case the naive "does the file exist / is it non-empty" test
    // gets wrong — Pi writes these the moment a child starts.
    const file = write("boot.jsonl", [
      { type: "session", id: "s", data: { cwd: "/ws" } },
      { type: "model-change", id: "m", data: { model: "deepseek-v4-flash" } },
      { type: "session-info", id: "i" },
    ]);
    expect(isSessionEmpty(meta({ piSessionFile: file }), dir)).toBe(true);
  });

  it("one user message makes it non-empty", () => {
    const file = write("used.jsonl", [
      { type: "session", id: "s" },
      { type: "message", id: "a", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    ]);
    expect(isSessionEmpty(meta({ piSessionFile: file }), dir)).toBe(false);
  });

  it("an ASSISTANT message alone does not count — the agent talking to itself is not content", () => {
    const file = write("asst.jsonl", [
      { type: "message", id: "a", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
    ]);
    expect(isSessionEmpty(meta({ piSessionFile: file }), dir)).toBe(true);
  });

  it("a user-renamed session is never empty, whatever the file says", () => {
    // Naming a thing is a statement that you want it.
    expect(isSessionEmpty(meta({ titleSource: "user", piSessionFile: undefined }), dir)).toBe(false);
  });

  it("a torn last line does not hide the prompt above it", () => {
    const file = path.join(dir, "torn.jsonl");
    fs.writeFileSync(
      file,
      JSON.stringify({ type: "message", id: "a", message: { role: "user", content: "hi" } }) + '\n{"type":"mess',
    );
    expect(isSessionEmpty(meta({ piSessionFile: file }), dir)).toBe(false);
  });

  it("refuses to read outside the session dir, and calls that empty", () => {
    // piSessionFile is Pi-reported and treated as untrusted, exactly as
    // deleteSessionFile treats it. Answering "empty" here is safe: the only
    // consequence is deleting an index entry we would not have read anyway.
    const outside = path.join(os.tmpdir(), "hv-outside.jsonl");
    fs.writeFileSync(outside, JSON.stringify({ type: "message", message: { role: "user", content: "x" } }));
    expect(isSessionEmpty(meta({ piSessionFile: outside }), dir)).toBe(true);
    fs.rmSync(outside, { force: true });
  });
});
