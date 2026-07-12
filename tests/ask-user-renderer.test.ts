import { describe, expect, test } from "vitest";
import { answersSummary, parseAskUser } from "../src/renderer/src/askUser";
import { parsePermission } from "../src/renderer/src/permission";

const askTitle = JSON.stringify({
  kind: "hv.ask-user",
  intent: "Choosing an auth method",
  questions: [
    {
      question: "Which auth method?",
      header: "Auth",
      multiSelect: false,
      options: [
        { label: "OAuth (Recommended)", description: "Standards-based" },
        { label: "API key", description: "Simpler" },
      ],
    },
  ],
});

describe("parseAskUser — kind-based routing (V2.B)", () => {
  test("input + hv.ask-user parses", () => {
    const info = parseAskUser({ id: "1", method: "input", title: askTitle });
    expect(info?.intent).toBe("Choosing an auth method");
    expect(info?.questions).toHaveLength(1);
    expect(info?.questions[0].options[0].label).toBe("OAuth (Recommended)");
  });

  test("hv.auth input prompts do NOT route here (auth non-regression)", () => {
    expect(
      parseAskUser({ id: "2", method: "input", title: '{"kind":"hv.auth","stage":"prompt","message":"code?"}' }),
    ).toBeNull();
  });

  test("wrong method / not-JSON / missing questions → null", () => {
    expect(parseAskUser({ id: "3", method: "select", title: askTitle })).toBeNull();
    expect(parseAskUser({ id: "4", method: "notify", title: askTitle })).toBeNull();
    expect(parseAskUser({ id: "5", method: "input", title: "plain text" })).toBeNull();
    expect(parseAskUser({ id: "6", method: "input", title: '{"kind":"hv.ask-user"}' })).toBeNull();
  });

  test("parsePermission ignores hv.ask-user (and vice versa) — no cross-routing", () => {
    expect(parsePermission({ id: "7", method: "input", title: askTitle })).toBeNull();
    expect(
      parseAskUser({ id: "8", method: "input", title: '{"kind":"hv.permission","tool":"bash","summary":"x"}' }),
    ).toBeNull();
  });
});

describe("answersSummary — user-style transcript echo", () => {
  test("headers, joined labels, and notes read coherently", () => {
    expect(
      answersSummary([
        { question: "Which auth method?", header: "Auth", answers: ["OAuth"] },
        { question: "Which library?", header: "Library", answers: ["styled-components"], note: "team standard" },
      ]),
    ).toBe("Answered: Auth → OAuth; Library → styled-components (note: team standard)");
  });
  test("multi-select and empty selections", () => {
    expect(
      answersSummary([{ question: "Pick targets", header: "Targets", answers: ["mac", "linux"] }]),
    ).toBe("Answered: Targets → mac, linux");
    expect(answersSummary([{ question: "Q", header: "", answers: [] }])).toBe("Answered: Q → (no selection)");
  });
});
