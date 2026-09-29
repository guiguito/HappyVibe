import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** docs-round #30 — pinned as source scans: the renderer suite has no DOM, and ipc.ts reaches electron. */
const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const chat = read("src/renderer/src/components/ChatView.tsx");
const ipc = read("src/main/ipc.ts");

describe("docs-round #30: the / menu footer", () => {
  it("says what Enter does while the menu is open (it completes, §7 round 24)", () => {
    expect(chat).not.toContain("Enter to send");
    expect(chat).toContain("Tab or Enter to complete");
  });
});

describe("docs-round #30: the no-model notice", () => {
  it("links to the Models page, which exists, instead of naming one that doesn't", () => {
    expect(chat).not.toContain("Settings → Models");
    const at = chat.indexOf("{noModel && (");
    expect(chat.slice(at, at + 400)).toContain('<GoTo view="models" />');
    expect(chat).toContain('import { GoTo } from "./GoTo";');
  });
});

describe("docs-round #30: Enter and Send answer one question", () => {
  it("one canSend: a model, and text, a picked element or a document (§31)", () => {
    expect(chat).toContain(
      "const canSend = !noModel && (!!input.trim() || (pageRefs?.length ?? 0) > 0 || documents.length > 0);",
    );
  });

  it("submit refuses exactly when Send is disabled", () => {
    const at = chat.indexOf("const submit = (behavior?");
    expect(chat.slice(at, at + 900)).toContain("if (!canSend) return;");
    expect(chat).toContain("disabled={!canSend}");
    expect(chat).not.toMatch(/disabled=\{noModel \|\|/);
  });
});

describe("docs-round #30: the model chip's way back", () => {
  it("offers a clear row while this session has its own model, named after the tier it falls back to", () => {
    const at = chat.indexOf("<ModelSelect");
    const chip = chat.slice(at, chat.indexOf("renderTrigger", at));
    expect(chip).toContain("onClear={sessionModel ? () => void clearModel() : undefined}");
    expect(chip).toContain('clearLabel={`Use the ${TIER_LABEL[workspaceModel ? "workspace" : "global"]}`}');
    expect(chat).toContain("window.hv.setSessionModel(sessionId, null)");
  });

  it("main applies what a respawn would pick to the running session", () => {
    const h = ipc.slice(ipc.indexOf('"hv:set-session-model"'), ipc.indexOf("§16 round 16 — the session tier"));
    expect(h).toContain("const target = model ?? resolveSpawnModel(index.get(sessionId)?.workspaceId, sessionId);");
    expect(h).toContain("if (!client || !target) return { live: false };");
    expect(h).toContain("provider: target.provider, modelId: target.modelId");
  });
});
