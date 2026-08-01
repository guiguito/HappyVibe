/**
 * Live-Pi tests drive a real (small, cheap) model and then assert on the tool
 * call it made. It complies most of the time and sometimes just answers in
 * prose — which fails the test for a reason that has nothing to do with the
 * code under test. That was the bulk of the "flaky live suite".
 *
 * The fix is to RE-ASK, not to widen the timeout: a longer wait does not make a
 * model that already finished its turn produce a tool call. Assertions stay
 * exactly as strict — this only insists on actually getting the call the test
 * is about.
 *
 * Not a vitest retry: a whole-test retry would re-spawn Pi (~5–15 s) and redo
 * the setup, and it would paper over real failures too. This re-asks the one
 * prompt and leaves every assertion to fail normally.
 */
export async function askUntil(
  prompt: () => Promise<unknown>,
  satisfied: () => boolean,
  { attempts = 3, waitMs = 45_000, pollMs = 250 }: { attempts?: number; waitMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (satisfied()) return true;
    await prompt();
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (satisfied()) return true;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  return satisfied();
}
