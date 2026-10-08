import fs from "node:fs";
import { expect, test } from "vitest";
const chat = fs.readFileSync("src/renderer/src/components/ChatView.tsx", "utf8");
test("the queued row offers Take back, and stops claiming Pi can't unqueue", () => {
  expect(chat).toContain(">Take back<");
  expect(chat).toContain("Puts every queued message back in the message box. Images attached to a queued message aren't kept.");
  expect(chat).not.toContain("Pi can't unqueue messages yet");
});
test("chips show what the user typed, not the hidden @file blocks Pi stores with it", () => {
  expect(chat).toMatch(/↪ \{stripInjectedBlocks\(m\)\}/);
});
