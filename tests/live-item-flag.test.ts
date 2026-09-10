import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { toTranscriptItems } from "../src/renderer/src/restoreMap";

/**
 * A7 (Animations round, 2026-09-10) — only items that arrive LIVE rise in.
 *
 * The first design gated this on an id floor ("animate anything newer than the
 * highest id at first paint"). That is wrong here and would have shipped
 * looking right: `idCounter` is ONE monotonic counter for the whole app, and
 * `loadEarlier` mints FRESH, HIGHER ids for the messages it prepends — so the
 * one path that must never animate (up to hundreds of nodes at once) is exactly
 * the path an id floor lets through.
 *
 * The flag is therefore stamped by `appendItem`, which is the single function
 * that means "this arrived now".
 */
const R = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const APP = R("src/renderer/src/App.tsx");
const TX = R("src/renderer/src/components/Transcript.tsx");

/** The body of a `const <name> = …` arrow function, up to the next top-level `const`. */
const fnBody = (src: string, name: string): string => {
  const start = src.indexOf(`const ${name} = `);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.indexOf("\n  const ", start + 10);
  return src.slice(start, next === -1 ? start + 2000 : next);
};

describe("only live transcript items animate in (A7)", () => {
  it("appendItem stamps live:true — it is the one path that means 'arrived now'", () => {
    expect(fnBody(APP, "appendItem")).toContain("live: true");
  });

  it("loadEarlier does NOT stamp it — it mints fresh, higher ids, so an id floor would animate it", () => {
    expect(fnBody(APP, "loadEarlier")).not.toContain("live: true");
  });

  it("restore never produces a live item", () => {
    let n = 0;
    const items = toTranscriptItems(
      [
        { kind: "user", text: "hi" },
        { kind: "assistant", text: "hello" },
      ] as never,
      { sessionId: "s1", workspaceId: null },
      () => ++n,
    );
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect((it as { live?: boolean }).live).toBeUndefined();
  });

  it("Transcript reads the flag, never an id comparison", () => {
    expect(TX).toContain("data-live={");
    expect(TX).not.toContain("liveFloorId");
  });
});
