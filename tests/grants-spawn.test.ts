import { describe, expect, test } from "vitest";
import { resolvePiSpawn } from "../src/main/pi/spawn";

describe("HV_GRANTS — a respawn hands the session its grants back (round 29)", () => {
  test("grants travel as a JSON array", () => {
    const s = resolvePiSpawn("/w", "/s", "/rt", { grants: ["bash", "mcp:x_y"] });
    expect(s.env.HV_GRANTS).toBe('["bash","mcp:x_y"]');
  });
  test("no grants, no variable", () => {
    expect("HV_GRANTS" in resolvePiSpawn("/w", "/s", "/rt", {}).env).toBe(false);
    expect("HV_GRANTS" in resolvePiSpawn("/w", "/s", "/rt", { grants: [] }).env).toBe(false);
  });
});
