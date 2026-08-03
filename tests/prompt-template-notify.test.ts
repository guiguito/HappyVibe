import { describe, it, expect } from "vitest";
import { parsePromptTemplateNotify, promptTemplateNotifyMessage } from "../src/main/ipc";

/**
 * §24: main re-emits the bridge's pairing envelope to the renderer with `typed`
 * swapped for the user's original message (the bridge can only see main's
 * OUTGOING text, which has had @mentions rewritten to paths).
 *
 * That re-serialization once dropped `kind` — the discriminator the renderer
 * switches on — so every LIVE card silently stopped rendering. It hid because
 * the restore path reads the event log rather than the notify, so reopened
 * sessions still showed their cards and the suite stayed green.
 */
const notify = (payload: unknown): { method: string; message: string } => ({
  method: "notify",
  message: JSON.stringify(payload),
});

const PAYLOAD = { kind: "hv.prompt-template", name: "explain", typed: "/explain src/a.ts", expanded: "Explain `src/a.ts`." };

describe("parsePromptTemplateNotify", () => {
  it("returns the WHOLE payload, so nothing is lost on re-serialization", () => {
    expect(parsePromptTemplateNotify(notify(PAYLOAD))).toMatchObject(PAYLOAD);
  });

  it("ignores other notify kinds and non-notifies", () => {
    expect(parsePromptTemplateNotify(notify({ kind: "hv.skill", name: "x" }))).toBeNull();
    expect(parsePromptTemplateNotify({ method: "select", message: JSON.stringify(PAYLOAD) })).toBeNull();
  });

  it("ignores a malformed payload rather than throwing", () => {
    expect(parsePromptTemplateNotify({ method: "notify", message: "{not json" })).toBeNull();
    expect(parsePromptTemplateNotify(notify({ kind: "hv.prompt-template", typed: 1, expanded: "x" }))).toBeNull();
  });
});

describe("promptTemplateNotifyMessage", () => {
  it("keeps `kind` — without it the renderer never draws the card", () => {
    const out = JSON.parse(promptTemplateNotifyMessage(PAYLOAD, "/explain @a.ts"));
    expect(out.kind).toBe("hv.prompt-template");
  });

  it("substitutes the user's typed text and preserves every other field", () => {
    const out = JSON.parse(promptTemplateNotifyMessage(PAYLOAD, "/explain @a.ts"));
    expect(out).toEqual({ ...PAYLOAD, typed: "/explain @a.ts" });
    expect(out.name).toBe("explain");
    expect(out.expanded).toBe(PAYLOAD.expanded);
  });

  it("round-trips back through parsePromptTemplateNotify", () => {
    const msg = promptTemplateNotifyMessage(PAYLOAD, "/explain @a.ts");
    const reparsed = parsePromptTemplateNotify({ method: "notify", message: msg });
    expect(reparsed?.typed).toBe("/explain @a.ts");
  });
});
