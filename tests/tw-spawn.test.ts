/**
 * PRD §12 (2026-09-26): the two sub-agent stacks coexist behind HV_SUBAGENTS until
 * the switch, and ONE of them boots per Pi process — never both. The tintinweb path
 * also marks the host (HV_HOST, which the owned patch fails closed on) and sends
 * child sessions to a SUBDIRECTORY of the sessions root, so the sidebar never lists
 * them and readChildTrace's confinement still holds.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolvePiSpawn, subagentsLibFromEnv, TW_RELPATH } from "../src/main/pi/spawn";

const rt = "/rt";
const spawnFor = (lib?: "nicobailon" | "tintinweb") =>
  resolvePiSpawn("/ws", "/sessions", rt, { subagentsLib: lib, agentDir: "/agent", sessionId: "s1", childAuditDir: "/audit" });
const extensionsOf = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === "-e" ? [a] : []));

describe("one sub-agent stack per Pi process", () => {
  it("the default is today's stack, untouched", () => {
    const s = spawnFor();
    const e = extensionsOf(s.args);
    expect(e).toContain(path.join(rt, "node_modules/pi-subagents/src/extension/index.ts"));
    expect(e).toContain(path.join(rt, "extensions/hv-owner-seed.ts"));
    expect(e).not.toContain(path.join(rt, TW_RELPATH));
    expect(s.env.PI_SUBAGENT_PI_BINARY).toBeDefined();
    expect(s.env.HV_SUBAGENT_OWNER).toBe("hv-s1");
    expect(s.env.HV_HOST).toBeUndefined();
    expect(s.env.HV_SUBAGENTS_LIB).toBeUndefined();
    expect(s.env.PI_CODING_AGENT_SESSION_DIR).toBeUndefined();
  });

  it("tintinweb: its extension in the same slot, the bridge still LAST", () => {
    const e = extensionsOf(spawnFor("tintinweb").args);
    expect(e).toContain(path.join(rt, TW_RELPATH));
    expect(e.some((p) => p.includes("pi-subagents/src/extension") || p.includes("hv-owner-seed"))).toBe(false);
    expect(e.indexOf(path.join(rt, TW_RELPATH))).toBeLessThan(e.indexOf(path.join(rt, "node_modules/pi-mcp-adapter/index.ts")));
    expect(e.at(-1)).toBe(path.join(rt, "extensions/happyvibe-bridge.ts"));
  });

  it("tintinweb: host flag + child session dir, and none of the child-process plumbing", () => {
    const env = spawnFor("tintinweb").env;
    expect(env.HV_HOST).toBe("1");
    expect(env.HV_SUBAGENTS_LIB).toBe("tintinweb");
    expect(env.PI_CODING_AGENT_SESSION_DIR).toBe(path.join("/sessions", "subagents"));
    for (const k of ["PI_SUBAGENT_PI_BINARY", "HV_SUBAGENT_OWNER", "PI_MODEL_EXCLUSIONS_PATH", "HV_CHILD_AUDIT_DIR", "HV_ARTIFACTS_DIR"]) {
      expect(env[k], k).toBeUndefined();
    }
  });

  it("the toggle is an env var, and anything but 'tintinweb' means today's stack", () => {
    expect(subagentsLibFromEnv({ HV_SUBAGENTS: "tintinweb" })).toBe("tintinweb");
    expect(subagentsLibFromEnv({})).toBe("nicobailon");
    expect(subagentsLibFromEnv({ HV_SUBAGENTS: "yes" })).toBe("nicobailon");
    expect(subagentsLibFromEnv({ HV_SUBAGENTS: "Tintinweb" })).toBe("nicobailon");
  });
});
