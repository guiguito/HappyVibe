import { describe, expect, test } from "vitest";
import {
  dropSession,
  headFor,
  parseDangerous,
  parsePermission,
  type QueuedPrompt,
} from "../src/renderer/src/permission";

const prompt = (id: string, sessionId?: string): QueuedPrompt => ({
  kind: "permission",
  req: { id, sessionId, method: "select", title: "{}" },
  info: { tool: "bash", summary: `cmd-${id}` },
});

describe("headFor — cross-session prompt routing", () => {
  const queue = [prompt("a1", "A"), prompt("b1", "B"), prompt("a2", "A")];

  test("focused session surfaces its OLDEST pending prompt", () => {
    expect(headFor(queue, "A")?.req.id).toBe("a1");
    expect(headFor(queue, "B")?.req.id).toBe("b1");
  });
  test("other sessions' prompts stay queued (no modal)", () => {
    expect(headFor(queue, "C")).toBeNull();
    expect(headFor(queue, null)).toBeNull();
  });
  test("answering pops → the next one for that session surfaces", () => {
    const after = queue.filter((q) => q.req.id !== "a1");
    expect(headFor(after, "A")?.req.id).toBe("a2");
  });
  test("utility/session-less prompts always surface", () => {
    expect(headFor([prompt("u1", "__utility__")], "A")?.req.id).toBe("u1");
    expect(headFor([prompt("n1", undefined)], null)?.req.id).toBe("n1");
  });
});

describe("dropSession — crashed Pi leaves nothing unanswerable", () => {
  test("removes only that session's prompts", () => {
    const q = [prompt("a1", "A"), prompt("b1", "B")];
    expect(dropSession(q, "A").map((p) => p.req.id)).toEqual(["b1"]);
  });
});

describe("parseDangerous", () => {
  test("hv.dangerous notify parses to its on flag", () => {
    expect(parseDangerous({ id: "1", method: "notify", message: '{"kind":"hv.dangerous","on":true}' })).toBe(true);
    expect(parseDangerous({ id: "2", method: "notify", message: '{"kind":"hv.dangerous","on":false}' })).toBe(false);
  });
  test("anything else is null (usage errors, other kinds, non-notify)", () => {
    expect(parseDangerous({ id: "3", method: "notify", message: '{"kind":"hv.dangerous","stage":"error"}' })).toBeNull();
    expect(parseDangerous({ id: "4", method: "notify", message: '{"kind":"hv.audit"}' })).toBeNull();
    expect(parseDangerous({ id: "5", method: "select", title: '{"kind":"hv.dangerous","on":true}' })).toBeNull();
    expect(parseDangerous({ id: "6", method: "notify", message: "not json" })).toBeNull();
  });
});

describe("parsePermission stays strict (CRITICAL routing invariant)", () => {
  test("only select + hv.permission opens the modal", () => {
    expect(parsePermission({ id: "1", method: "select", title: '{"kind":"hv.permission","tool":"bash","summary":"x"}' }))
      .toEqual({ tool: "bash", summary: "x" });
    expect(parsePermission({ id: "2", method: "notify", title: '{"kind":"hv.permission"}' })).toBeNull();
    expect(parsePermission({ id: "3", method: "select", title: '{"kind":"hv.auth"}' })).toBeNull();
  });
});
