/**
 * PRD §12 (2026-09-26): the sub-agent stack is tintinweb, loaded in-process. The spawn
 * marks the host (HV_HOST, which the owned patch fails closed on), names the one guard
 * every child loads, and sends child sessions to a SUBDIRECTORY of the sessions root, so
 * the sidebar never lists them and readChildTrace's confinement still holds.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolvePiSpawn, TW_RELPATH } from "../src/main/pi/spawn";

const rt = "/rt";
const spawn = () => resolvePiSpawn("/ws", "/sessions", rt, { agentDir: "/agent", mcp: true });
const extensionsOf = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === "-e" ? [a] : []));

describe("the tintinweb spawn", () => {
  it("loads tintinweb before Pi's MCP, and the bridge LAST", () => {
    const e = extensionsOf(spawn().args);
    expect(e.indexOf(path.join(rt, TW_RELPATH))).toBe(0);
    expect(e.indexOf(path.join(rt, TW_RELPATH))).toBeLessThan(e.indexOf("builtin:mcp"));
    expect(e.at(-1)).toBe(path.join(rt, "extensions/happyvibe-bridge.ts"));
  });

  it("host flag, child guard and child session dir — always, whatever the options", () => {
    for (const env of [spawn().env, resolvePiSpawn("/ws", "/sessions", rt).env, resolvePiSpawn("/ws", "/sessions", rt, { bypass: true }).env]) {
      expect(env.HV_HOST).toBe("1");
      expect(env.PI_CODING_AGENT_SESSION_DIR).toBe(path.join("/sessions", "subagents"));
      expect(env.HV_CHILD_GUARD).toBe(path.join(rt, "extensions/hv-child-guard.ts"));
    }
  });

  it("none of the old child-process plumbing survives", () => {
    const env = spawn().env;
    for (const k of ["PI_SUBAGENT_PI_BINARY", "HV_SUBAGENT_OWNER", "PI_MODEL_EXCLUSIONS_PATH", "HV_CHILD_AUDIT_DIR", "HV_ARTIFACTS_DIR", "HV_SUBAGENTS_LIB"]) {
      expect(env[k], k).toBeUndefined();
    }
    expect(extensionsOf(spawn().args).some((p) => p.includes("hv-owner-seed") || p.includes("node_modules/pi-subagents/"))).toBe(false);
  });
});
