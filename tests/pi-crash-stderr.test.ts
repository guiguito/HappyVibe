/**
 * Round 12 — a crashed Pi child must say WHY.
 *
 * The child's stderr went to `console.error` and nowhere else, so a Pi that
 * died during module load left the user with "The session crashed (code 1)"
 * and a Restart button, while the sentence explaining it sat in a terminal
 * nobody was watching. That is the same class of dishonesty as an unlabelled
 * token estimate: the app knew, and showed a number.
 *
 * The motivating case was a launcher whose Electron embedded Node 20.9.0, which
 * cannot parse Pi's `import … with { type: "json" }` — a perfectly clear
 * SyntaxError that never reached the window.
 */
import { describe, expect, it } from "vitest";
import { PiClient, stderrTail } from "../src/main/pi/PiClient";

describe("stderrTail", () => {
  it("keeps the last lines, which is where a stack ends up", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const out = stderrTail(lines, 3);
    expect(out).toBe("line 17\nline 18\nline 19");
  });

  it("drops blank lines so the cap buys content, not spacing", () => {
    // Real node crash output is full of them.
    const out = stderrTail(["", "SyntaxError: boom", "", "   ", "  at foo (x:1:1)", ""], 8);
    expect(out).toBe("SyntaxError: boom\n  at foo (x:1:1)");
  });

  it("caps the total and marks that it was cut", () => {
    const out = stderrTail([("x".repeat(500)), ("y".repeat(500))], 8, 100);
    expect(out.length).toBe(101); // 100 + the ellipsis
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("y")).toBe(true); // the END is kept — that is the point
  });

  it("is empty for a child that said nothing, so the UI shows no empty box", () => {
    expect(stderrTail([])).toBe("");
    expect(stderrTail(["", "  "])).toBe("");
  });

  it("keeps the line that names the failure in a REAL node crash dump", () => {
    // Verbatim shape of the launcher failure this was built for.
    const dump = [
      "file:///x/pi-ai/dist/providers/all.js:11",
      'import modelDataManifest from "./data/.manifest.json" with { type: "json" };',
      "                                                      ^^^^",
      "",
      "SyntaxError: Unexpected token 'with'",
      "    at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:118:18)",
      "    at callTranslator (node:internal/modules/esm/loader:273:14)",
      "    at ModuleLoader.moduleProvider (node:internal/modules/esm/loader:278:30)",
      "",
      "Node.js v20.9.0",
    ];
    const out = stderrTail(dump);
    expect(out, "the diagnosis must survive the tail cut").toContain("SyntaxError: Unexpected token 'with'");
    expect(out, "and the runtime that could not parse it").toContain("Node.js v20.9.0");
  });
});

describe("PiClient carries the tail on exit", () => {
  it("a child that dies reports its stderr, not just a code", async () => {
    // A REAL child, so this cannot pass against a client that never wires the
    // stream. node -e is enough: write to stderr, then exit non-zero.
    const client = new PiClient({
      execPath: process.execPath,
      args: ["-e", 'console.error("BOOM: the child explained itself"); process.exit(3);'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } as Record<string, string>,
      cwd: process.cwd(),
    });
    const exit = new Promise<{ code: number | null; stderr?: string }>((resolve) =>
      client.on("exit", resolve as (i: unknown) => void),
    );
    await client.start();
    const info = await exit;
    expect(info.code).toBe(3);
    expect(info.stderr).toContain("BOOM: the child explained itself");
  }, 20_000);

  it("a quiet child reports no stderr, so a clean stop shows no empty block", async () => {
    const client = new PiClient({
      execPath: process.execPath,
      args: ["-e", "process.exit(0);"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } as Record<string, string>,
      cwd: process.cwd(),
    });
    const exit = new Promise<{ code: number | null; stderr?: string }>((resolve) =>
      client.on("exit", resolve as (i: unknown) => void),
    );
    await client.start();
    const info = await exit;
    expect(info.code).toBe(0);
    expect(info.stderr).toBe("");
  }, 20_000);
});
