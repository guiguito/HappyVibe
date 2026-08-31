import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * §30 round 18 — the passive dot is deleted.
 *
 * A source scan, not a render test: this suite has no DOM, and every
 * assertion here is an ABSENCE, which is exactly what a render test cannot
 * fail on. The chain existed only for the dot, so a survivor is dead code —
 * the `proposeAgentsMd` shape this repo has shipped before.
 */
const R = path.join(import.meta.dirname, "..", "src");
const read = (p: string): string => fs.readFileSync(path.join(R, p), "utf8");

describe("the unread dot is gone from the sidebar", () => {
  const SRC = read("renderer/src/components/Sidebar.tsx");

  it("has no UnreadDot component and no render site", () => {
    expect(SRC).not.toContain("UnreadDot");
  });

  it("takes no changelogUnread prop", () => {
    expect(SRC).not.toContain("changelogUnread");
  });
});

describe("the last-seen-version chain is gone end to end", () => {
  const FILES = [
    "renderer/src/App.tsx",
    "renderer/src/components/ChangelogView.tsx",
    "renderer/src/hv.d.ts",
    "preload/index.ts",
    "main/ipc.ts",
    "main/config.ts",
  ];

  for (const f of FILES) {
    it(`${f} does not mention lastSeenVersion`, () => {
      expect(read(f).toLowerCase()).not.toContain("lastseenversion");
    });
  }

  it("the IPC channel itself is unregistered", () => {
    const ipc = read("main/ipc.ts");
    expect(ipc).not.toContain("hv:get-last-seen-version");
    expect(ipc).not.toContain("hv:set-last-seen-version");
  });

  it("ChangelogView takes no props", () => {
    const src = read("renderer/src/components/ChangelogView.tsx");
    expect(src).toContain("export function ChangelogView()");
    expect(src).not.toContain("onSeen");
  });
});

describe("what the page still does is unchanged", () => {
  it("still reports the running version and the runtime pins", () => {
    const src = read("renderer/src/components/ChangelogView.tsx");
    expect(src).toContain("__APP_VERSION__");
    expect(src).toContain("__RUNTIME_PINS__");
  });
});
