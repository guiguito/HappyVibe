import { expect, test } from "vitest";
import path from "node:path";
import { resolvePiSpawn } from "../src/main/pi/spawn";

const runtime = path.join(process.cwd(), "pi-runtime");

test("passes one --prompt-template per approved command, and always --no-prompt-templates", () => {
  const { args } = resolvePiSpawn("/ws", "/sessions", runtime, { commands: ["/a/x.md", "/b/y.md"] });
  expect(args).toContain("--no-prompt-templates");
  expect(args.join(" ")).toContain("--prompt-template /a/x.md");
  expect(args.join(" ")).toContain("--prompt-template /b/y.md");
  // --no-prompt-templates must precede the additions, like --no-skills does.
  expect(args.indexOf("--no-prompt-templates")).toBeLessThan(args.indexOf("--prompt-template"));
});

test("still passes --no-prompt-templates when no command is approved", () => {
  const { args } = resolvePiSpawn("/ws", "/sessions", runtime);
  expect(args).toContain("--no-prompt-templates");
  expect(args).not.toContain("--prompt-template");
});
