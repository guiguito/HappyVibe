/**
 * PRD §12 (2026-09-26) — the tintinweb PIN-BUMP GATE. Key-free, asserted against the
 * INSTALLED package: every upstream name and shape the bridge, main or the renderer
 * relies on. A bump that renames one fails HERE, by name, instead of as a card that
 * silently never appears. The patch's own hunks are pinned in tintinweb-patch-apply;
 * what each hunk does, in tintinweb-patch-contract and tintinweb-trust.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AGENT_TOOL, RESULT_TOOL, STEER_TOOL, WORKFLOW_TOOL } from "../pi-runtime/extensions/hv-tw-gate";
import { TW_RELPATH } from "../src/main/pi/spawn";

const RT = path.join(__dirname, "..", "pi-runtime");
const PKG = path.join(RT, "node_modules", "@tintinweb", "pi-subagents");
const src = (f: string): string => fs.readFileSync(path.join(PKG, "src", f), "utf8");
const INDEX = src("index.ts");

describe("the package", () => {
  it("is the pinned version, with the entry spawn.ts loads", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
    expect(pkg.version).toBe("0.19.0");
    expect(fs.existsSync(path.join(RT, TW_RELPATH))).toBe(true);
  });

  it("has no exports map — the bridge imports src/custom-agents.ts by relative path", () => {
    // An exports map gates BARE specifiers only, but its arrival is the signal that
    // upstream now has an opinion about which files are public. Re-check the import.
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
    expect(pkg.exports).toBeUndefined();
    expect(src("custom-agents.ts")).toMatch(/export function loadCustomAgents\(cwd: string, strict = false\)/);
  });
});

describe("the four tools the gate, the plan clamp and the cards name", () => {
  it("are registered under exactly the names hv-tw-gate.ts uses", () => {
    const names = src("agent-runner.ts").match(/SUBAGENT_TOOL_NAMES = \{([\s\S]*?)\}/)![1];
    for (const n of [AGENT_TOOL, WORKFLOW_TOOL, RESULT_TOOL, STEER_TOOL]) expect(names, n).toContain(`"${n}"`);
    for (const k of ["AGENT", "WORKFLOW", "GET_RESULT", "STEER"]) expect(INDEX).toContain(`name: SUBAGENT_TOOL_NAMES.${k},`);
  });
});

describe("the lifecycle the relay and the busy gate listen to", () => {
  it("started / completed / failed, emitted for TOP-LEVEL agents only", () => {
    for (const ev of ["subagents:started", "subagents:completed", "subagents:failed"]) expect(INDEX, ev).toContain(`pi.events.emit("${ev}"`);
    // A workflow's children must not raise run cards of their own (they report through the workflow).
    expect(INDEX).toMatch(/new AgentManager\(\(record\) => \{[\s\S]{0,400}if \(!isTopLevelAgent\(record\)\) return;/);
  });

  it("completed carries the FULL result — the delivery repair reads it (decision 4)", () => {
    expect(INDEX).toMatch(/result: record\.result/);
  });

  it("the notification the model reads is `subagent-notification`, truncated with the pointer we match", () => {
    expect(INDEX).toContain('customType: "subagent-notification"');
    expect(INDEX).toContain('"\\n...(truncated, use get_subagent_result for full output)"');
  });

  it("the entry types the session file carries", () => {
    expect(INDEX).toContain('pi.appendEntry("subagents:record"');
    expect(src("workflow/entry.ts")).toContain('WORKFLOW_ENTRY_TYPE = "subagents:workflow"');
  });

  it("the manager registry the relay reads a child's session file from", () => {
    expect(INDEX).toContain('Symbol.for("pi-subagents:manager")');
    expect(INDEX).toMatch(/getRecord: \(id: string\) =>/);
  });

  it("the stop verb STOP drives", () => {
    expect(src("cross-extension-rpc.ts")).toContain('"subagents:rpc:stop", ({ agentId })');
  });
});

describe("Pi still loads an explicit extension path under --no-extensions (P2/P3 rest on it)", () => {
  it("additionalExtensionPaths survive noExtensions", () => {
    const rl = fs.readFileSync(path.join(RT, "node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js"), "utf8");
    // The CLI/explicit list is kept; only DISCOVERED extensions are dropped.
    expect(rl).toMatch(/const extensionPaths = this\.noExtensions\s*\?\s*cliEnabledExtensions\s*:/);
    expect(rl).toContain("this.packageManager.resolveExtensionSources(this.additionalExtensionPaths");
  });
});

// Re-homed from the pre-tintinweb contract test (2026-09-26): these guard the RUNTIME, not the library.
const rtPkg = (...rel: string[]): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(RT, ...rel), "utf8")) as Record<string, unknown>;
const dep = (pkg: Record<string, unknown>, name: string): string | undefined =>
  (pkg.dependencies as Record<string, string> | undefined)?.[name];

describe("the bridge builds tool schemas with the SAME typebox Pi consumes them with", () => {
  // The bridge imports `typebox` BARE, so it gets whatever pi-runtime hoists; the right pin is
  // "what pi-coding-agent declares", because the bridge BUILDS the schemas Pi CONSUMES.
  it("pi-runtime pins typebox to exactly Pi's own dependency, and that copy is installed", () => {
    const pin = dep(rtPkg("package.json"), "typebox");
    expect(pin).toBe(dep(rtPkg("node_modules/@earendil-works/pi-coding-agent/package.json"), "typebox"));
    expect(rtPkg("node_modules/typebox/package.json").version).toBe(pin);
    expect(fs.readFileSync(path.join(RT, "extensions/happyvibe-bridge.ts"), "utf8")).toMatch(/from "typebox"/);
  });
});

describe("pi-tui is an explicit pin — tintinweb imports it and only peer-declares it", () => {
  const TUI = "@earendil-works/pi-tui";
  it("declared, pinned to what Pi declares, and installed", () => {
    const pin = dep(rtPkg("package.json"), TUI);
    expect(pin).toBeDefined();
    expect(`^${pin}`).toBe(dep(rtPkg("node_modules/@earendil-works/pi-coding-agent/package.json"), TUI));
    expect(rtPkg("node_modules/@earendil-works/pi-tui/package.json").version).toBe(pin);
  });
  it("tintinweb still needs it — the reason the pin exists", () => {
    expect(INDEX).toMatch(/from "@earendil-works\/pi-tui"/);
    expect((JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")) as { peerDependencies?: Record<string, string> }).peerDependencies?.[TUI]).toBeDefined();
  });
});

describe("bundled agents ask only for tools that exist", () => {
  // Derived from Pi's OWN registrations: its builtins are bash, edit, find, grep, ls, read,
  // write — no `glob`, no `list` (both bundled agents once shipped asking for those).
  const piBuiltins = (): Set<string> => {
    const dir = path.join(RT, "node_modules/@earendil-works/pi-coding-agent/dist/core/tools");
    const names = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
      for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/^\s*name: "([a-z_]+)"/gm)) names.add(m[1]);
    }
    return names;
  };
  const agents = path.join(RT, "agents");

  it("every `tools:` entry is a Pi builtin", () => {
    const names = piBuiltins();
    for (const t of ["read", "grep", "find", "ls"]) expect(names, `Pi builtin ${t}`).toContain(t);
    const files = fs.readdirSync(agents).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const line = /^tools:\s*(.+)$/m.exec(fs.readFileSync(path.join(agents, file), "utf8"));
      for (const tool of (line?.[1] ?? "").split(",").map((t) => t.trim()).filter(Boolean)) {
        expect(names, `${file} declares "${tool}"`).toContain(tool);
      }
    }
  });

  it("no bundled agent's prompt tells it to use a tool it lacks", () => {
    for (const file of fs.readdirSync(agents).filter((f) => f.endsWith(".md"))) {
      const body = fs.readFileSync(path.join(agents, file), "utf8");
      expect(body, `${file} mentions glob`).not.toMatch(/\bglob\b/i);
      expect(body, `${file} mentions the list tool`).not.toMatch(/\blist\/|\/list\b|`list`/i);
    }
  });
});
