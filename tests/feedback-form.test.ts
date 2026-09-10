import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  answersFor,
  emailError,
  pageComplete,
  pageIndexOf,
  pulseShape,
  textError,
  unknownRequired,
} from "../src/renderer/src/feedbackForm";

/**
 * The fixtures are the REAL published definitions, captured from the API rather
 * than hand-written — the same rule as tests/git-parse.test.ts. A hand-written
 * form would agree with whatever the code happens to do.
 */
const general = JSON.parse(fs.readFileSync("tests/fixtures/inlet-general-v2.json", "utf8")) as HvFormDefinition;
const session = JSON.parse(fs.readFileSync("tests/fixtures/inlet-session-v1.json", "utf8")) as HvFormDefinition;

describe("pageComplete", () => {
  it("a required single choice gates Next until picked", () => {
    expect(pageComplete(general.pages[0], {}, () => 0)).toBe(false);
    expect(pageComplete(general.pages[0], { el_szbmd4ddzewt: "op_7484gpbkt32d" }, () => 0)).toBe(true);
  });

  it("whitespace never satisfies a required text", () => {
    expect(pageComplete(general.pages[1], { el_5evwc8vfj3yc: "   " }, () => 0)).toBe(false);
    expect(pageComplete(general.pages[1], { el_5evwc8vfj3yc: "it broke" }, () => 0)).toBe(true);
  });

  it("optional pages are always complete", () => {
    expect(pageComplete(general.pages[2], {}, () => 0)).toBe(true);
    expect(pageComplete(general.pages[3], {}, () => 0)).toBe(true);
    expect(pageComplete(general.pages[4], {}, () => 0)).toBe(true);
  });

  it("an invalid email blocks Next even though the question is optional", () => {
    expect(pageComplete(general.pages[4], { el_86jj3z6wcjh6: "nope" }, () => 0)).toBe(false);
    expect(pageComplete(general.pages[4], { el_86jj3z6wcjh6: "a@b.co" }, () => 0)).toBe(true);
  });

  it("a required screenshot counts images", () => {
    const page = { id: "p", elements: [{ ...general.pages[3].elements[0], required: true }] } as HvFormPage;
    expect(pageComplete(page, {}, () => 0)).toBe(false);
    expect(pageComplete(page, {}, () => 1)).toBe(true);
  });
});

describe("textError / emailError", () => {
  const single = { id: "x", type: "text", label: "l", required: false, multiline: false, maxLength: 5 } as const;

  it("refuses a newline in a single-line text and an over-long value", () => {
    // Inlet refuses both server-side; saying so before the click is cheaper
    // than a round trip that loses nothing but the user's patience.
    expect(textError(single, "a\nb")).toMatch(/one line/i);
    expect(textError(single, "abcdef")).toMatch(/5/);
    expect(textError(single, "abc")).toBeNull();
    expect(textError({ ...single, multiline: true }, "a\nb")).toBeNull();
  });

  it("email is validated only when non-empty", () => {
    expect(emailError("")).toBeNull();
    expect(emailError("nope")).toMatch(/email/i);
    expect(emailError("a@b.co")).toBeNull();
  });
});

describe("answersFor", () => {
  it("emits Inlet's shapes, omits blanks, and never emits a screenshot key", () => {
    const a = answersFor(general, {
      el_szbmd4ddzewt: "op_7484gpbkt32d",
      el_5evwc8vfj3yc: " it broke ",
      el_fppmeabbfspe: undefined,
      el_86jj3z6wcjh6: "",
    });
    expect(a).toEqual({ el_szbmd4ddzewt: { optionId: "op_7484gpbkt32d" }, el_5evwc8vfj3yc: { value: "it broke" } });
  });

  it("a multi-select emits optionIds", () => {
    const multi = {
      pages: [
        {
          id: "p",
          elements: [
            {
              id: "q",
              type: "choice",
              label: "l",
              required: false,
              optionKind: "text",
              selection: "multi",
              orientation: "vertical",
              options: [
                { id: "a", label: "A" },
                { id: "b", label: "B" },
              ],
            },
          ],
        },
      ],
    } as unknown as HvFormDefinition;
    expect(answersFor(multi, { q: ["a", "b"] })).toEqual({ q: { optionIds: ["a", "b"] } });
    expect(answersFor(multi, { q: [] })).toEqual({});
  });

  it("never emits a key for a question that is not in the definition", () => {
    expect(answersFor(general, { el_notinform: "x" })).toEqual({});
  });
});

describe("unknownRequired / pageIndexOf / pulseShape", () => {
  it("an unknown required element is reported; an unknown optional one is not", () => {
    const f = {
      pages: [
        {
          id: "p",
          elements: [
            { id: "u1", type: "rating", label: "r", required: true },
            { id: "u2", type: "rating", label: "r", required: false },
          ],
        },
      ],
    } as unknown as HvFormDefinition;
    expect(unknownRequired(f).map((e) => e.id)).toEqual(["u1"]);
    expect(unknownRequired(general)).toEqual([]);
  });

  it("finds the page of a question for the 400 jump", () => {
    expect(pageIndexOf(general, "el_86jj3z6wcjh6")).toBe(4);
    expect(pageIndexOf(general, "nope")).toBe(-1);
  });

  it("the Session form is pulse-shaped; the General form is not", () => {
    expect(pulseShape(session)?.options.map((o) => o.emoji)).toEqual(["😖", "😕", "😐", "🙂", "😄"]);
    expect(pulseShape(session)?.questionId).toBe("el_m1jnhejwr94k");
    expect(pulseShape(general)).toBeNull();
  });

  it("a second question, a second page or a text choice all refuse the inline shape", () => {
    const one = session.pages[0].elements[0];
    const twoQuestions = { pages: [{ id: "p", elements: [one, { ...one, id: "el_two" }] }] } as unknown as HvFormDefinition;
    const twoPages = { pages: [session.pages[0], { id: "p2", elements: [] }] } as unknown as HvFormDefinition;
    const textKind = { pages: [{ id: "p", elements: [{ ...one, optionKind: "text" }] }] } as unknown as HvFormDefinition;
    const multi = { pages: [{ id: "p", elements: [{ ...one, selection: "multi" }] }] } as unknown as HvFormDefinition;
    for (const f of [twoQuestions, twoPages, textKind, multi]) expect(pulseShape(f)).toBeNull();
  });
});
