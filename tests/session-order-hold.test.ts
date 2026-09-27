/**
 * 2026-09-27: selecting a session re-sorts the list, which moved the row under the
 * pointer — the next click deleted the running session instead of the one below it.
 * While the pointer is over the sidebar the order is held (holdOrder).
 */
import { expect, it } from "vitest";
import fs from "node:fs";
import { bySidebarOrder, holdOrder } from "../src/renderer/src/sessionOrder";

const s = (id: string, lastUsedAt: string) => ({ id, updatedAt: lastUsedAt, lastUsedAt });

it("the incident: clicking the lower row would swap the two — held, it cannot", () => {
  const running = s("maze", "2026-09-27T12:20:00Z");
  const below = s("other", "2026-09-27T09:47:00Z");
  const live = new Set(["maze", "other"]);
  const before = [running, below].sort(bySidebarOrder(live));
  const frozen = before.map((x) => x.id);
  // The click on `other` touches it: it is now the most recently used.
  const after = [running, { ...below, lastUsedAt: "2026-09-27T12:23:10Z" }].sort(bySidebarOrder(live));
  expect(after.map((x) => x.id)).toEqual(["other", "maze"]); // what used to render under the pointer
  expect(holdOrder(after, frozen).map((x) => x.id)).toEqual(["maze", "other"]); // what renders now
  expect(holdOrder(after, null).map((x) => x.id)).toEqual(["other", "maze"]); // and once the pointer leaves
});

it("a session created meanwhile goes first; a deleted one drops out", () => {
  const list = [s("new", "2026-09-27T13:00:00Z"), s("b", "2026-09-27T12:00:00Z")];
  expect(holdOrder(list, ["a", "b"]).map((x) => x.id)).toEqual(["new", "b"]);
});

it("the sidebar routes both session lists through the hold", () => {
  const src = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
  expect(src).not.toMatch(/\.sort\(bySidebarOrder\(live\)\);/);
  expect(src.match(/holdOrder\(/g)?.length).toBeGreaterThanOrEqual(2);
});

it("the delete dialog leads with the session's title and warns when it is running", async () => {
  const { RUNNING_DELETE_WARNING } = await import("../src/renderer/src/components/Sidebar");
  expect(RUNNING_DELETE_WARNING).toMatch(/running.*stops the agent/i);
  const src = fs.readFileSync("src/renderer/src/components/Sidebar.tsx", "utf8");
  const dialog = src.slice(src.indexOf("{confirmDelete && ("), src.indexOf("Delete permanently\n"));
  expect(dialog).toMatch(/<h2[^>]*>&ldquo;\{confirmDelete\.title\}&rdquo;<\/h2>/);
  expect(dialog).toMatch(/busy\[confirmDelete\.id\] && \([\s\S]{0,300}RUNNING_DELETE_WARNING/);
});
