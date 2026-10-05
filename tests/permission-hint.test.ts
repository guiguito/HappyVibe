/**
 * §13 (2026-10-05): the MCP server's own claim about a tool, on the permission prompt.
 * Pinned as DATA plus a source scan (no DOM in this suite).
 */
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { parsePermission, SERVER_HINT_COPY } from "../src/renderer/src/permission";

const req = (extra: object) => ({ method: "select", title: JSON.stringify({ kind: "hv.permission", tool: "mcp:a_b", summary: "MCP → a: b", ...extra }) });

test("the two hint values parse; anything else is dropped", () => {
  expect(parsePermission(req({ serverHint: "read-only" }) as never)?.serverHint).toBe("read-only");
  expect(parsePermission(req({ serverHint: "may delete data" }) as never)?.serverHint).toBe("may delete data");
  expect(parsePermission(req({ serverHint: "trust me" }) as never)?.serverHint).toBeUndefined();
  expect(parsePermission(req({}) as never)?.serverHint).toBeUndefined();
});

test("the copy says it is the SERVER's claim", () => {
  expect(SERVER_HINT_COPY).toEqual({ "read-only": "Server says: read-only", "may delete data": "Server says: may delete data" });
});

test("the modal renders the hint and no longer special-cases adapter manage rules", () => {
  const src = readFileSync("src/renderer/src/components/PermissionModal.tsx", "utf8");
  expect(src).toContain("SERVER_HINT_COPY[");
  expect(src).not.toContain("isMcpManageRule");
});
