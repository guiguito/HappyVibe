/**
 * PRD §12 decision 7 (2026-09-26): a workflow prompt is approved as CODE — it parses with
 * its script and agents, and the modal never expands it (or a sub-agent's own ask) into
 * the five-choice set: "Allow for session", "Allow for workspace" and "Always allow" are
 * absent. The absence is pinned by source, the renderer suite having no DOM.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parsePermission } from "../src/renderer/src/permission";

const title = (extra: Record<string, unknown>) => JSON.stringify({ kind: "hv.permission", tool: "workflow", summary: "review", ...extra });

describe("a workflow prompt", () => {
  it("parses with its script, origin and agents", () => {
    const info = parsePermission({
      id: "1", method: "select", options: ["Allow", "Deny"],
      title: title({ workflow: { script: "S", origin: "path", agents: [{ type: "worker", known: true, tools: ["bash", "read"], writeCapable: ["bash"] }, { nope: 1 }], unparsed: true } }),
    })!;
    expect(info.workflow).toEqual({ script: "S", origin: "path", agents: [{ type: "worker", known: true, tools: ["bash", "read"], writeCapable: ["bash"] }], unparsed: true });
  });

  it("a malformed workflow block degrades to a plain prompt, never a lost one", () => {
    const info = parsePermission({ id: "1", method: "select", options: ["Allow", "Deny"], title: title({ workflow: { script: 42 } }) })!;
    expect(info.tool).toBe("workflow");
    expect(info.workflow).toBeUndefined();
  });

  it("the modal shows exactly the bridge's choices for a workflow or a child ask", () => {
    const src = fs.readFileSync("src/renderer/src/components/PermissionModal.tsx", "utf8");
    expect(src).toMatch(/const shown = info\.workflow \|\| info\.child \? \(wire as PermissionChoice\[\]\)/);
    expect(src).toMatch(/info\.workflow\.script/);
  });
});
