import { describe, expect, test } from "vitest";
import { commandGrantLine, parsePermission, persistentChoices } from "../src/renderer/src/permission";

const req = (p: Record<string, unknown>) => ({ id: "1", method: "select", title: JSON.stringify({ kind: "hv.permission", tool: "bash", summary: "x", ...p }) });

describe("one-click command grants on a shell prompt (round 29)", () => {
  test("the envelope's commandGrant survives parsing, array or null", () => {
    expect(parsePermission(req({ commandGrant: ["npm run *"] }) as never)?.commandGrant).toEqual(["npm run *"]);
    expect(parsePermission(req({ commandGrant: null }) as never)?.commandGrant).toBeNull();
    expect(parsePermission(req({}) as never)?.commandGrant).toBeUndefined();
  });
  test("no safe pattern → the persistent buttons are absent", () => {
    const info = parsePermission(req({ commandGrant: null }) as never)!;
    expect(persistentChoices(info)).toEqual(["Allow", "Allow for session", "Deny"]);
    expect(persistentChoices(parsePermission(req({ commandGrant: [] }) as never)!)).toEqual(["Allow", "Allow for session", "Deny"]);
  });
  test("a pattern → all five choices", () => {
    const info = parsePermission(req({ commandGrant: ["npm run *"] }) as never)!;
    expect(persistentChoices(info)).toContain("Always allow");
    expect(persistentChoices(info)).toContain("Allow for workspace");
  });
  test("the line the prompt shows", () => {
    expect(commandGrantLine(["npm run *"])).toBe("“Allow for workspace” and “Always allow” save: npm run *");
  });
});
