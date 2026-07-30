import { expect, test } from "vitest";
import path from "node:path";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

test("always passes --no-skills so Pi's own discovery is off", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime);
  expect(spec.args).toContain("--no-skills");
});

test("one --skill flag per approved+active skill, additive to --no-skills", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, {
    skills: ["/managed/skills/pdf", "/ws/.agents/skills/local"],
  });
  const skillArgs = spec.args.filter((_, i) => spec.args[i - 1] === "--skill");
  expect(skillArgs).toEqual(["/managed/skills/pdf", "/ws/.agents/skills/local"]);
  // --no-skills must precede the --skill additions
  expect(spec.args.indexOf("--no-skills")).toBeLessThan(spec.args.indexOf("--skill"));
});

test("no skills → --no-skills with zero --skill flags", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, { skills: [] });
  expect(spec.args).toContain("--no-skills");
  expect(spec.args.filter((a) => a === "--skill")).toHaveLength(0);
});

test("skillsFile → HV_SKILLS_FILE env", () => {
  const spec = resolvePiSpawn("/ws", "/sessions", runtime, { skillsFile: "/tmp/manifest.json" });
  expect(spec.env.HV_SKILLS_FILE).toBe("/tmp/manifest.json");
});
