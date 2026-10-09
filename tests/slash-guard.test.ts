import { describe, expect, test } from "vitest";
import fs from "node:fs";
import { slashRefusal } from "../src/main/slashGuard";

describe("slashRefusal", () => {
  test.each([
    ["/mcp logout github", "/mcp is managed from the MCP page."],
    ["/mcp", "/mcp is managed from the MCP page."],
    ["/agents", "/agents is managed from the Agents page."],
    ["/hv-logout openai", "Sign-ins are managed from Models."],
    ["/hv-login anthropic", "Sign-ins are managed from Models."],
    ["/hv-dangerous on", "Bypass is turned on in Settings, with Bypass ALL permissions."],
    ["/hv-dangerous", "Bypass is turned on in Settings, with Bypass ALL permissions."],
    ["/hv-dangerous  off", "Bypass is turned on in Settings, with Bypass ALL permissions."],
    ["/hv-plan", "/hv-plan is internal to HappyVibe and can't be typed."],
  ])("refuses %j", (text, reason) => expect(slashRefusal(text)).toBe(reason));

  test.each(["/hv-dangerous off", "  /hv-dangerous off  ", "/skill:skill-creator", "/mcpfoo", "please run /mcp logout", "/MCP", "hello", ""])(
    "allows %j",
    (text) => expect(slashRefusal(text)).toBeNull(),
  );
});

test("promptSession refuses BEFORE it wakes a hibernated session", () => {
  const ipc = fs.readFileSync("src/main/ipc.ts", "utf8");
  const body = ipc.slice(ipc.indexOf("const promptSession = async ("), ipc.indexOf('"hv:prompt-session"'));
  expect(body.indexOf("slashRefusal(msg)")).toBeGreaterThan(-1);
  expect(body.indexOf("slashRefusal(msg)")).toBeLessThan(body.indexOf("startClient("));
});
