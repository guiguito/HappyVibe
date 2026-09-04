/**
 * PRD §33 — the surfaces, as DATA. The renderer suite has no DOM, so a visual contract is
 * pinned in two halves: the mapping is exported and asserted, and an ABSENCE is a source scan
 * (the tests/modal-layer.test.ts pattern).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { categoryCount, CATEGORY_COLOR, summarizeGroups, type SystemBlock } from "../src/renderer/src/context";
import { memoryText, toAuditRow } from "../src/renderer/src/components/AuditView";
import { toolLabel } from "../src/renderer/src/toolLabel";
import { NAV } from "../src/renderer/src/components/Sidebar";
import { MEMORY_EVENT_TYPES } from "../src/main/ipc";
import { MEMORY_TYPE_LABEL, memoryFactFrom, memoryPromptTitle } from "../src/renderer/src/memoryFact";

const R = path.resolve(import.meta.dirname, "../src/renderer/src");

const sys = (memory?: SystemBlock["memory"]): SystemBlock => ({
  chars: 400,
  estTokens: 100,
  toolCount: 0,
  contextFiles: [],
  memory,
});

describe("context panel — the Memory category", () => {
  it("shows the two scopes and the policy as THREE named rows", () => {
    const rows = summarizeGroups(
      [],
      sys({ global: { count: 2, tokens: 50, items: [{ name: "a", tokens: 25 }, { name: "b", tokens: 25 }] }, workspace: { count: 1, tokens: 20, items: [{ name: "c", tokens: 20 }] }, policy: 242 }),
      new Set(),
    );
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("memory-global");
    expect(keys).toContain("memory-workspace");
    expect(keys).toContain("memory-policy");
    const g = rows.find((r) => r.key === "memory-global")!;
    expect(g.label).toBe("Global memories");
    expect(g.estTokens).toBe(50);
    expect(g.skills).toHaveLength(2); // the drill-in's per-memory detail
  });

  it("an EMPTY scope draws no row — a '0 memories' line is noise on every panel", () => {
    const rows = summarizeGroups([], sys({ global: { count: 0, tokens: 0 }, workspace: { count: 0, tokens: 0 }, policy: 242 }), new Set());
    expect(rows.map((r) => r.key)).not.toContain("memory-global");
    expect(rows.map((r) => r.key)).not.toContain("memory-workspace");
    // …but the policy IS still costing tokens, so it is still priced.
    expect(rows.map((r) => r.key)).toContain("memory-policy");
  });

  it("memory OFF draws NO memory row at all — the 0-cost claim", () => {
    const rows = summarizeGroups([], sys(undefined), new Set());
    expect(rows.filter((r) => String(r.key).startsWith("memory"))).toEqual([]);
  });

  it("counts read as memories, and every row has a colour", () => {
    expect(categoryCount(1, "memory-global")).toBe("1 memory");
    expect(categoryCount(3, "memory-workspace")).toBe("3 memories");
    for (const k of ["memory-global", "memory-workspace", "memory-policy"]) {
      expect(CATEGORY_COLOR[k], k).toBeTruthy();
    }
  });
});

describe("audit log — the six memory events", () => {
  const ev = (type: string, data: Record<string, unknown>) =>
    toAuditRow({ ts: "2026-09-04T10:00:00.000Z", type, data } as never);

  it("every type main writes renders as a memory row, in the app's own words", () => {
    expect(MEMORY_EVENT_TYPES).toHaveLength(6);
    for (const t of MEMORY_EVENT_TYPES) {
      const r = ev(t, { scope: "global", name: "n" });
      expect(r.row, t).toBe("memory");
      expect(memoryText(r as never).length, t).toBeGreaterThan(3);
    }
  });

  it("says what actually happened, and who did it", () => {
    expect(memoryText({ kind: "saved", scope: "global" } as never)).toBe("remembered");
    expect(memoryText({ kind: "saved", scope: "global", replaced: true } as never)).toBe("updated a memory");
    expect(memoryText({ kind: "forgotten", scope: "workspace", who: "human" } as never)).toBe("you forgot a memory (this project)");
    expect(memoryText({ kind: "forgotten", scope: "global", who: "agent" } as never)).toBe("forgot a memory");
    expect(memoryText({ kind: "refused", scope: "global" } as never)).toContain("refused to remember");
    expect(memoryText({ kind: "edited" } as never)).toBe("you edited a memory");
    expect(memoryText({ kind: "imported", count: 4 } as never)).toBe("imported 4 memories from Claude Code");
  });

  it("discriminates on the event TYPE, not on the payload's own kind field", () => {
    // The payload carries `kind` too; reading THAT is the bug toAuditRow was extracted to fix.
    const r = toAuditRow({ ts: "t", type: "permission.decision", data: { kind: "hv.audit", tool: "bash", decision: "allow" } } as never);
    expect(r.row).toBe("decision");
  });
});

describe("tool cards", () => {
  it("the model's intent leads; the memory's name is the fallback", () => {
    expect(toolLabel("memory_save", { intent: "Noting how you like tests run", name: "x" }).label).toBe("Noting how you like tests run");
    expect(toolLabel("memory_save", { name: "tests-run-serially" }).label).toBe("Remembering tests-run-serially");
    expect(toolLabel("memory_recall", { name: "x" }).label).toBe("Recalling x");
    expect(toolLabel("memory_forget", { name: "x" }).label).toBe("Forgetting x");
  });

  it("all three share one icon, and it is not another feature's", () => {
    const icons = ["memory_save", "memory_recall", "memory_forget"].map((t) => toolLabel(t, { name: "x" }).icon);
    expect(new Set(icons)).toEqual(new Set(["memory"]));
    expect(toolLabel("use_skill", { name: "x" }).icon).toBe("book"); // Skills keeps the book
  });

  it("degrades to a sentence rather than a blank when there is no name", () => {
    expect(toolLabel("memory_save", {}).label).toBe("Saving a memory");
  });
});

describe("the nav row", () => {
  it("Memory is the second Abilities row, directly after Built-in tools", () => {
    const abilities = NAV.filter((n) => n.group === "abilities").map((n) => n.view);
    expect(abilities[0]).toBe("builtinTools");
    expect(abilities[1]).toBe("memory");
  });

  it("…and Plugins → Skills · Prompts · MCP is still contiguous behind it", () => {
    const abilities = NAV.filter((n) => n.group === "abilities").map((n) => n.view);
    const i = abilities.indexOf("plugins");
    expect(abilities.slice(i, i + 4)).toEqual(["plugins", "skills", "promptTemplates", "mcp"]);
  });
});

describe("absences a screenshot cannot prove", () => {
  const read = (p: string): string => fs.readFileSync(path.join(R, p), "utf8");

  it("the rewind confirm says NOTHING about memory — the card's Forget is the undo", () => {
    // Decided in the round: memory lives outside the workspace, so rewind never touches it, and
    // a lookup to add one sentence bought nothing the card does not already offer.
    const chat = read("components/ChatView.tsx");
    const rewindBlock = chat.slice(chat.indexOf("rewind"), chat.indexOf("rewind") + 8000);
    expect(rewindBlock.toLowerCase()).not.toContain("memor");
  });

  it("the Memory page never uses the words the UI is not allowed to say", () => {
    const page = read("components/MemoryView.tsx") + read("components/MemorySection.tsx");
    for (const banned of ["auto memory", "topic file"]) {
      expect(page.toLowerCase(), banned).not.toContain(banned);
    }
    // "index" is the model's word for it; the UI says "what the agent sees every turn".
    expect(page).not.toMatch(/\bindex\b/i);
  });

  it("§19's one-use rule for the word AI still holds with a new page in the nav", () => {
    expect(NAV.filter((n) => /\bAI\b/.test(n.label))).toHaveLength(1);
  });
});

/**
 * §33 — the permission summary must stay PARSEABLE.
 *
 * This is the bug the GUI pass found and no unit test could: the bridge's generic `summarize`
 * slices the SERIALIZED JSON at 300 chars, which for a memory save cuts mid-string. The modal
 * then failed to parse it, rendered no memory fact at all, and the prompt read "The agent wants
 * to run something / Saving a memory" — a durable change to every future session, approved
 * against nothing. Every unit test fed well-formed args and passed throughout.
 *
 * Pinned as a SOURCE contract (the bridge is not importable here) plus a behavioural check of
 * the modal's own parser against a realistic, oversized payload.
 */
describe("the permission summary survives a real memory payload", () => {
  const bridge = fs.readFileSync(path.resolve(import.meta.dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");

  it("summarize has a memory arm that caps the FIELD, never the serialized string", () => {
    const arm = bridge.slice(bridge.indexOf('if (toolName.startsWith("memory_"))'), bridge.indexOf("// …and for EVERYTHING else"));
    expect(arm).toContain("factual.content = factual.content.slice(0, 4096)");
    // The give-away: no `.slice(0, 300)` on the stringify in this arm.
    expect(arm).not.toMatch(/JSON\.stringify\(factual\)\.slice/);
    // …and `intent` is still stripped, because §13's rule is absolute.
    expect(arm).toContain("intent: _words");
  });

  it("a 4 KB body still parses back to a renderable fact", () => {
    const payload = {
      scope: "global",
      type: "user",
      name: "test-output-in-french",
      description: "User wants test output written in French.",
      content: "x".repeat(4096),
    };
    const summary = JSON.stringify(payload); // what the memory arm now produces
    const parsed = JSON.parse(summary) as Record<string, unknown>;
    const fact = memoryFactFrom("memory_save", parsed);
    expect(fact).not.toBeNull();
    expect(fact!.name).toBe("test-output-in-french");
    expect(memoryPromptTitle("memory_save", false)).toContain("remember");
  });

  it("…where the OLD 300-char slice produced nothing at all", () => {
    const truncated = JSON.stringify({ scope: "global", type: "user", name: "n", description: "d", content: "x".repeat(500) }).slice(0, 300);
    let parsed: unknown;
    try {
      parsed = JSON.parse(truncated);
    } catch {
      parsed = undefined;
    }
    expect(parsed).toBeUndefined();
    expect(memoryFactFrom("memory_save", parsed)).toBeNull(); // → the generic prompt the GUI showed
  });
});

/**
 * §33 — the card's two pills answer DIFFERENT questions, and must not render the same word.
 * The GUI pass showed "ABOUT YOU · ABOUT YOU" for a global `user` memory: the scope pill said
 * where it applies, the kind pill said what it is, and both landed on the same phrase.
 */
it("the card's scope pill never repeats the kind pill's wording", () => {
  const card = fs.readFileSync(path.join(R, "components/ToolCard.tsx"), "utf8");
  const pill = card.slice(card.indexOf('mem.scope === "workspace"'), card.indexOf('mem.scope === "workspace"') + 90);
  expect(pill).toContain("everywhere");
  expect(pill).not.toContain("about you");
  // …and the kind labels are the other axis, unchanged.
  expect(MEMORY_TYPE_LABEL.user).toBe("About you");
});

/**
 * §33 — the prompt and the record want different lengths, and the round's fix to one silently
 * changed the other.
 *
 * `summarize` capped every tool at 300 chars, so the audit row was bounded by accident. Lifting
 * that cap for memory (the prompt must show and diff the whole memory) made every JSONL audit
 * row carry up to 4 KB. The cap now lives in `audit()` — one choke point, every caller — so the
 * record stays bounded no matter what a future summary does.
 */
it("the audit row's summary is capped at ONE choke point, not per call site", () => {
  const bridge = fs.readFileSync(path.resolve(import.meta.dirname, "../pi-runtime/extensions/happyvibe-bridge.ts"), "utf8");
  const fn = bridge.slice(bridge.indexOf("function audit("), bridge.indexOf("// ── B3 auth"));
  expect(fn).toMatch(/summary: o\.summary\.length > 300 \? `\$\{o\.summary\.slice\(0, 300\)\}…` : o\.summary/);
  // …and the notify sends the capped row, not the raw one.
  expect(fn).toContain('...row }');
  expect(fn).not.toMatch(/kind: "hv\.audit"[^}]*\.\.\.o \}/);
});

/**
 * §33 — the pointer to workspace settings must carry the WORKSPACE.
 *
 * `GoTo` takes `{view, workspace}` and App's navigate() selects the workspace before switching
 * views. The first cut passed only the view: the link rendered, was clickable, and landed on
 * whatever page was last open. A dead pointer is worse than none (§20 round 17), so with no
 * workspace in play the page states the fact instead of offering a link.
 */
it("the workspace pointer passes a workspace, and degrades to prose without one", () => {
  const view = fs.readFileSync(path.join(R, "components/MemoryView.tsx"), "utf8");
  expect(view).toContain('<GoTo view="workspace" workspace={workspaceId}');
  expect(view).toMatch(/workspaceId \? \(/); // the guarded branch exists
  expect(view).toContain("open a project to see them");
});
