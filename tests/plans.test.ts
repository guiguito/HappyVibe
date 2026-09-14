import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPlan, setPlanStatus, writePlanFile, PLAN_DIR } from "../src/main/plans";

let ws: string;
const NOW = "2026-07-20T12:00:00.000Z";
const PLAN = "# Add auth\n\n## Tasks\n- [ ] scaffold\n- [ ] tests\n\n## Verification\n- run npm test";

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "hv-plans-"));
});
afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

// A plan's relative path is an IDENTIFIER spelled with forward slashes, not a host
// path: writePlanFile returns it, listPlanProgress rebuilds it and isPlanPath tests
// its prefix, so the three have to agree. These expectations used path.join, which
// spelled it with backslashes on Windows — where a written plan then never matched
// its own listing (PRD §4, Windows round).
describe("writePlanFile", () => {
  test("creates .agents/plans/001-<slug>.md with draft front-matter", async () => {
    const rel = await writePlanFile([ws], ws, PLAN, NOW);
    expect(rel).toBe(`${PLAN_DIR}/001-add-auth.md`);
    const md = fs.readFileSync(path.join(ws, rel), "utf8");
    expect(md).toContain("status: draft");
    expect(md).toContain(`createdAt: ${NOW}`);
    expect(md).toContain("## Tasks");
    expect(readPlan([ws], ws, rel)).toMatchObject({ status: "draft", done: 0, total: 2 });
  });

  test("increments NNN for a fresh plan, revises the same file when given a path", async () => {
    const first = await writePlanFile([ws], ws, PLAN, NOW);
    const second = await writePlanFile([ws], ws, "# Second plan\n## Tasks\n- [ ] x\n## Verification\n- y", NOW);
    expect(second).toBe(`${PLAN_DIR}/002-second-plan.md`);

    // Revision: overwrite the first file, preserving createdAt.
    const later = "2026-07-20T15:00:00.000Z";
    const revised = await writePlanFile([ws], ws, "# Add auth v2\n## Tasks\n- [x] scaffold\n- [ ] tests\n## Verification\n- run", later, first);
    expect(revised).toBe(first);
    const md = fs.readFileSync(path.join(ws, first), "utf8");
    expect(md).toContain(`createdAt: ${NOW}`); // preserved
    expect(md).toContain("Add auth v2");
    expect(readPlan([ws], ws, first)).toMatchObject({ done: 1, total: 2 });
  });

  test("falls back to a fresh file when the given path vanished", async () => {
    const rel = await writePlanFile([ws], ws, PLAN, NOW, `${PLAN_DIR}/999-gone.md`);
    expect(rel).toBe(`${PLAN_DIR}/001-add-auth.md`);
  });

  test("refuses an unknown workspace", async () => {
    await expect(writePlanFile([ws], "/not/registered", PLAN, NOW)).rejects.toThrow(/Unknown workspace/);
  });
});

describe("setPlanStatus", () => {
  test("rewrites status + updatedAt, keeps the body and createdAt", async () => {
    const rel = await writePlanFile([ws], ws, PLAN, NOW);
    const later = "2026-07-20T16:00:00.000Z";
    const parsed = await setPlanStatus([ws], ws, rel, "implemented", later);
    expect(parsed.status).toBe("implemented");
    const md = fs.readFileSync(path.join(ws, rel), "utf8");
    expect(md).toContain("status: implemented");
    expect(md).toContain(`createdAt: ${NOW}`);
    expect(md).toContain(`updatedAt: ${later}`);
    expect(md).toContain("## Tasks");
  });
});

describe("readPlan", () => {
  test("returns null for a missing file", () => {
    expect(readPlan([ws], ws, `${PLAN_DIR}/nope.md`)).toBeNull();
  });
});
