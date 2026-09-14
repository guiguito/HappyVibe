import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listPlanProgress, writePlanFile, PLAN_DIR } from "../src/main/plans";

/**
 * §23: the "Implementing n/m" badge is driven entirely by these payloads. It used
 * to freeze at whatever the count was when the session opened, because nothing
 * re-parsed the plan file unless the file drawer was open — so the interesting
 * case here is re-reading a file whose checkboxes changed underneath us.
 */

let ws: string;
const NOW = "2026-08-01T12:00:00.000Z";
const plansDir = (): string => path.join(ws, PLAN_DIR);

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-plan-progress-"));
});
afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("listPlanProgress", () => {
  test("reports status + n/m for every plan file", async () => {
    const a = await writePlanFile([ws], ws, "# Add auth\n## Tasks\n- [ ] one\n- [ ] two\n", NOW);
    await writePlanFile([ws], ws, "# Ship it\n## Tasks\n- [x] only\n", NOW);

    const got = listPlanProgress([ws], ws).sort((x, y) => x.path.localeCompare(y.path));
    expect(got).toEqual([
      { path: `${PLAN_DIR}/001-add-auth.md`, status: "draft", done: 0, total: 2 },
      { path: `${PLAN_DIR}/002-ship-it.md`, status: "draft", done: 1, total: 1 },
    ]);
    expect(a).toBe(`${PLAN_DIR}/001-add-auth.md`);
  });

  test("re-reads boxes ticked after the file was last pushed", async () => {
    const rel = await writePlanFile([ws], ws, "# Work\n## Tasks\n- [ ] a\n- [ ] b\n- [ ] c\n", NOW);
    expect(listPlanProgress([ws], ws)).toMatchObject([{ done: 0, total: 3 }]);

    // What the agent does mid-implementation, with nobody watching.
    const abs = path.join(ws, rel);
    fs.writeFileSync(abs, fs.readFileSync(abs, "utf8").replace("- [ ] a", "- [x] a").replace("- [ ] b", "- [x] b"));

    expect(listPlanProgress([ws], ws)).toMatchObject([{ path: rel, done: 2, total: 3 }]);
  });

  test("ignores non-markdown entries and subdirectories", async () => {
    await writePlanFile([ws], ws, "# Real\n## Tasks\n- [ ] x\n", NOW);
    fs.writeFileSync(path.join(plansDir(), "notes.txt"), "- [x] not a plan\n");
    fs.mkdirSync(path.join(plansDir(), "archive"));
    fs.writeFileSync(path.join(plansDir(), "archive", "old.md"), "## Tasks\n- [x] old\n");

    expect(listPlanProgress([ws], ws).map((p) => p.path)).toEqual([`${PLAN_DIR}/001-real.md`]);
  });

  test("empty when the workspace has no plans dir", () => {
    expect(listPlanProgress([ws], ws)).toEqual([]);
  });

  test("refuses a workspace that is not registered", () => {
    expect(() => listPlanProgress([], ws)).toThrow();
  });
});
