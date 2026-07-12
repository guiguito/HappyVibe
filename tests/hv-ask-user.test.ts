import { describe, expect, test } from "vitest";
import {
  answersMarkdown,
  DISMISSED_RESULT,
  HEADER_MAX,
  normalizeQuestions,
  parseAnswers,
  type AskAnswer,
} from "../pi-runtime/extensions/hv-ask-user";

const q = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  question: "Which auth method?",
  header: "Auth",
  multiSelect: false,
  options: [
    { label: "OAuth (Recommended)", description: "Standards-based" },
    { label: "API key", description: "Simpler" },
  ],
  ...over,
});

describe("normalizeQuestions — clamp, never throw", () => {
  test("valid input passes through untouched, no notes", () => {
    const { questions, notes } = normalizeQuestions([q()]);
    expect(notes).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0].header).toBe("Auth");
    expect(questions[0].options).toHaveLength(2);
  });

  test("headers longer than 12 chars are truncated with a note", () => {
    const { questions, notes } = normalizeQuestions([q({ header: "A very long header indeed" })]);
    expect(questions[0].header).toHaveLength(HEADER_MAX);
    expect(notes.join(" ")).toMatch(/truncated/);
  });

  test(">4 questions clamped with a note", () => {
    const { questions, notes } = normalizeQuestions([q(), q(), q(), q(), q(), q()]);
    expect(questions).toHaveLength(4);
    expect(notes.join(" ")).toMatch(/first 4 of 6/);
  });

  test(">4 options clamped with a note", () => {
    const opts = Array.from({ length: 6 }, (_, i) => ({ label: `Opt ${i}`, description: "" }));
    const { questions, notes } = normalizeQuestions([q({ options: opts })]);
    expect(questions[0].options).toHaveLength(4);
    expect(notes.join(" ")).toMatch(/first 4 options/);
  });

  test("previews are dropped on multiSelect questions (single-select keeps them)", () => {
    const opts = [
      { label: "A", description: "", preview: "code A" },
      { label: "B", description: "" },
    ];
    const multi = normalizeQuestions([q({ multiSelect: true, options: opts })]);
    expect(multi.questions[0].options[0].preview).toBeUndefined();
    expect(multi.notes.join(" ")).toMatch(/single-select only/);
    const single = normalizeQuestions([q({ options: opts })]);
    expect(single.questions[0].options[0].preview).toBe("code A");
  });

  test("garbage degrades: non-array, empty text, label-less options", () => {
    expect(normalizeQuestions("nope").questions).toEqual([]);
    expect(normalizeQuestions(undefined).questions).toEqual([]);
    const { questions, notes } = normalizeQuestions([
      q({ question: "  " }), // dropped
      q({ options: [{ label: "", description: "x" }, { label: "Only", description: "" }] }),
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0].options).toEqual([{ label: "Only", description: "" }]);
    expect(notes.join(" ")).toMatch(/dropped/);
    expect(notes.join(" ")).toMatch(/fewer than 2/);
  });

  test("missing header falls back to Qn", () => {
    const { questions } = normalizeQuestions([q({ header: "" })]);
    expect(questions[0].header).toBe("Q1");
  });
});

describe("answers round-trip: renderer JSON → parseAnswers → markdown", () => {
  const answers: AskAnswer[] = [
    { question: "Which auth method?", header: "Auth", answers: ["OAuth (Recommended)"] },
    { question: "Which library?", header: "Library", answers: ["styled-components"], note: "team standard" },
  ];

  test("bare array and {answers} wrapper both parse", () => {
    expect(parseAnswers(JSON.stringify(answers))).toEqual(answers);
    expect(parseAnswers(JSON.stringify({ answers }))).toEqual(answers);
  });

  test("non-JSON / wrong shapes → null", () => {
    expect(parseAnswers("not json")).toBeNull();
    expect(parseAnswers(JSON.stringify({ nope: 1 }))).toBeNull();
  });

  test("empty answers arrays and non-string entries are tolerated", () => {
    const parsed = parseAnswers(JSON.stringify([{ question: "x", header: "H", answers: [1, "ok", ""] }]));
    expect(parsed).toEqual([{ question: "x", header: "H", answers: ["ok"] }]);
  });

  test("markdown result reads coherently for the model", () => {
    const md = answersMarkdown(answers);
    expect(md).toContain("The user answered:");
    expect(md).toContain("**Auth** — Which auth method?: OAuth (Recommended)");
    expect(md).toContain("_(note: team standard)_");
  });

  test("dismissal constant tells the model to proceed", () => {
    expect(DISMISSED_RESULT).toMatch(/proceed/i);
  });
});
