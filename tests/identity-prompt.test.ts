import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { resolvePiSpawn } from "../src/main/pi/spawn";
import { buildIdentity } from "../src/main/appendSystem";

/** What spawn passes when nothing overrides the built-in tools (intent defaults on). */
const IDENTITY = buildIdentity({ intent: true });

/**
 * PRD §16 round 21 — the agent says it is HappyVibe.
 *
 * Pi's base prompt opens "You are an expert coding assistant operating inside
 * pi, a coding agent harness", so with nothing appended the agent introduces
 * itself as pi. We append one paragraph rather than replacing the base prompt.
 *
 * The last two tests are a PIN-BUMP GATE on two upstream behaviours that each
 * fail silently: the flag replaces discovery rather than adding to it, and a
 * non-path input is used verbatim.
 */

const runtime = path.join(process.cwd(), "pi-runtime");
const spawnArgs = (opts = {}): string[] =>
  resolvePiSpawn("/tmp/ws", "/tmp/sessions", runtime, opts).args;

/** Every `--append-system-prompt` VALUE, in argv order. */
const appends = (args: string[]): string[] =>
  args.flatMap((a, i) => (a === "--append-system-prompt" ? [args[i + 1]] : []));

test("the identity paragraph is appended, and it names HappyVibe", () => {
  const got = appends(spawnArgs());
  expect(got).toEqual([IDENTITY]);
  expect(IDENTITY).toMatch(/HappyVibe/);
});

/**
 * X1 (2026-09-10): the `intent` convention is explained HERE, once, instead of
 * thirty times in tool schemas — which means the paragraph has to follow the
 * §13 round-12 switch. A prompt that describes a parameter the model does not
 * have is worse than one that says nothing.
 */
test("the identity explains intent only while the switch is on", () => {
  expect(buildIdentity({ intent: true })).toMatch(/`intent`/);
  expect(buildIdentity({ intent: true })).toMatch(/Looking for the failing order/);
  expect(buildIdentity({ intent: false })).not.toMatch(/intent/);
  // Both arms keep the identity and the after-a-denial mental model.
  for (const on of [true, false]) {
    expect(buildIdentity({ intent: on })).toMatch(/HappyVibe/);
    expect(buildIdentity({ intent: on })).toMatch(/blocked call comes back with a reason/);
  }
});

test("spawn follows the switch — intent off means the paragraph never mentions it", () => {
  const off = { builtinTools: { plan: true, askUser: true, planAppend: "", terminal: true, intent: false, browser: true, web: true, document: true, memory: true, memoryAppend: "" } };
  expect(appends(spawnArgs(off))).toEqual([buildIdentity({ intent: false })]);
});

test("the user's own APPEND_SYSTEM.md is passed too, and AFTER the identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-append-"));
  const file = path.join(dir, "APPEND_SYSTEM.md");
  fs.writeFileSync(file, "always answer in haiku", "utf8");
  // Pi joins the sources with "\n\n" in argv order, so LAST wins on conflict —
  // the user's own words must be last.
  expect(appends(spawnArgs({ appendFile: file }))).toEqual([IDENTITY, file]);
});

test("a MISSING APPEND_SYSTEM.md is NOT passed — a missing path is appended as literal text", () => {
  // resource-loader.js resolvePromptInput: a non-existent input is returned
  // VERBATIM, so passing the path would put "/…/APPEND_SYSTEM.md" in the prompt.
  const missing = path.join(os.tmpdir(), "hv-does-not-exist", "APPEND_SYSTEM.md");
  expect(appends(spawnArgs({ appendFile: missing }))).toEqual([IDENTITY]);
});

test("upstream contract: --append-system-prompt REPLACES discovery, it does not add to it", () => {
  // The whole reason we pass the file explicitly. If a pin bump made the flag
  // additive, passing it twice would double the user's additions — and this
  // test is where you find out.
  const loader = fs.readFileSync(
    path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js"),
    "utf8",
  );
  expect(loader).toMatch(/if \(!appendSources\) \{/);
  expect(loader).toMatch(/discoverAppendSystemPromptFile\(\)/);
});

test("upstream contract: a non-path append input is used verbatim", () => {
  const loader = fs.readFileSync(
    path.join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js"),
    "utf8",
  );
  // resolvePromptInput: existsSync ? readFileSync : return input
  expect(loader).toMatch(/function resolvePromptInput\(input, description\) \{/);
});

test("the base prompt is NOT replaced — no --system-prompt is ever passed", () => {
  expect(spawnArgs()).not.toContain("--system-prompt");
  expect(spawnArgs({ appendFile: "/tmp/x" })).not.toContain("--system-prompt");
});
