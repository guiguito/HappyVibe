/**
 * The sub-agent boundary module — the shared definition of "what a child may
 * reach", used by the approval prompt, the ceiling and the plan clamp.
 *
 * Pure and key-free, so it runs in CI. The half that measures upstream's
 * behaviour under a ceiling lives in tests/subagent-adversarial.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  boundaryRuleName,
  isReadOnlyBoundary,
  isWiderThanReadOnly,
  READ_ONLY_CHILD_TOOLS,
  widenBoundary,
  writeCapableIn,
  WRITE_CAPABLE_TOOLS,
} from "../pi-runtime/extensions/hv-subagent-boundary";

const bridgeSrc = (): string =>
  readFileSync(path.join(__dirname, "..", "pi-runtime", "extensions", "happyvibe-bridge.ts"), "utf8");

describe("the read-only set", () => {
  it("is exactly Pi's four read-only builtins", () => {
    expect([...READ_ONLY_CHILD_TOOLS].sort()).toEqual(["find", "grep", "ls", "read"]);
  });

  it("names nothing Pi does not register — an unknown name fails the whole child run", () => {
    // pi-subagents >=0.40 rejects a child asking for a tool that does not exist,
    // and Pi 0.83+ has no `glob` and no `list`. Both bundled agents shipped asking
    // for them once; that is why this is pinned rather than trusted.
    expect(READ_ONLY_CHILD_TOOLS.has("glob")).toBe(false);
    expect(READ_ONLY_CHILD_TOOLS.has("list")).toBe(false);
  });

  it("contains nothing write-capable", () => {
    for (const t of READ_ONLY_CHILD_TOOLS) expect(WRITE_CAPABLE_TOOLS.has(t)).toBe(false);
  });
});

describe("boundaryRuleName", () => {
  it("gates per agent, so one grant cannot leak to another agent", () => {
    expect(boundaryRuleName("code-explorer")).toBe("subagent:code-explorer");
    expect(boundaryRuleName("agents-md-maker")).toBe("subagent:agents-md-maker");
  });

  it("is never the bare tool name — that is the bug it exists to fix", () => {
    expect(boundaryRuleName("code-explorer")).not.toBe("subagent");
  });

  it("matches the mcp:/browser: virtual-name shape the rule engine already parses", () => {
    expect(boundaryRuleName("x")).toMatch(/^subagent:[^:]+$/);
  });
});

describe("isReadOnlyBoundary", () => {
  it("accepts the read-only set and any subset of it", () => {
    expect(isReadOnlyBoundary([...READ_ONLY_CHILD_TOOLS])).toBe(true);
    expect(isReadOnlyBoundary(["read", "grep"])).toBe(true);
    expect(isReadOnlyBoundary([])).toBe(true);
  });

  it("rejects a boundary with any write-capable tool", () => {
    expect(isReadOnlyBoundary(["read", "bash"])).toBe(false);
    expect(isReadOnlyBoundary(["write"])).toBe(false);
  });

  it("rejects an UNKNOWN tool rather than assuming it is harmless", () => {
    // A tool we have never heard of (an extension tool, a future builtin) is not
    // read-only by default. Plan mode leans on this: unknown must not read as safe.
    expect(isReadOnlyBoundary(["read", "some_extension_tool"])).toBe(false);
  });

  it("treats fan-out as NOT read-only — a child that can delegate can reach further", () => {
    expect(isReadOnlyBoundary(["read", "subagent"])).toBe(false);
  });
});

describe("writeCapableIn", () => {
  it("calls out every write-capable tool by name, sorted and deduped", () => {
    expect(writeCapableIn(["read", "bash", "write"])).toEqual(["bash", "write"]);
    expect(writeCapableIn(["write", "write", "edit"])).toEqual(["edit", "write"]);
  });

  it("is empty for a read-only boundary", () => {
    expect(writeCapableIn([...READ_ONLY_CHILD_TOOLS])).toEqual([]);
  });

  it("does not report subagent — fan-out is a separate line in the prompt", () => {
    expect(writeCapableIn(["read", "subagent"])).toEqual([]);
    expect(WRITE_CAPABLE_TOOLS.has("subagent")).toBe(false);
  });
});

describe("widenBoundary / isWiderThanReadOnly", () => {
  it("widening always keeps the read-only floor", () => {
    expect(widenBoundary(["bash"])).toEqual(["bash", "find", "grep", "ls", "read"]);
  });

  it("widening is idempotent and order-independent", () => {
    expect(widenBoundary(["bash", "write"])).toEqual(widenBoundary(["write", "bash", "bash"]));
  });

  it("a read-only approval does not widen anything", () => {
    expect(widenBoundary(["read"])).toEqual([...READ_ONLY_CHILD_TOOLS].sort());
    expect(isWiderThanReadOnly(widenBoundary(["read"]))).toBe(false);
  });

  it("detects a widened ceiling, which is what gates an undeclared agent", () => {
    expect(isWiderThanReadOnly([...READ_ONLY_CHILD_TOOLS])).toBe(false);
    expect(isWiderThanReadOnly(widenBoundary(["bash"]))).toBe(true);
  });
});

/**
 * Source scans, the tests/modal-layer.test.ts pattern: the renderer and bridge
 * have no DOM here, and an ABSENCE is exactly what a behavioural test does not
 * fail on.
 */
describe("the bridge uses the module rather than re-deriving it", () => {
  it("gates a delegation under the virtual name", () => {
    expect(bridgeSrc()).toContain("boundaryRuleName(");
  });

  it("registers the ceiling with denyExtensions, which closes the ambient-load hole", () => {
    const src = bridgeSrc();
    expect(src).toContain("registerSubagentCapabilityCeiling");
    expect(src).toContain("denyExtensions");
  });

  it("imports the ceiling by its PUBLIC subpath, not a deep relative path", () => {
    // capability-ceiling IS in pi-subagents' exports map, unlike listAsyncRuns and
    // ASYNC_DIR — so the bare specifier is correct here and a relative reach would
    // be gratuitous fragility.
    expect(bridgeSrc()).toMatch(/from "pi-subagents\/capability-ceiling"/);
  });

  it("never hardcodes a read-only tool list of its own", () => {
    // One definition of read-only, or the prompt and the ceiling can disagree —
    // which would mean approving one thing and enforcing another.
    const src = bridgeSrc();
    expect(src).not.toMatch(/\["find",\s*"grep",\s*"ls",\s*"read"\]/);
    expect(src).toContain("READ_ONLY_CHILD_TOOLS");
  });
});
