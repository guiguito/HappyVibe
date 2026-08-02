/**
 * Test fixture: a THIRD-PARTY Pi extension, i.e. one that knows nothing about
 * HappyVibe's hv.* envelope convention. Stands in for pi-yaml-hooks' `confirm`
 * action, @nklisch/pi-plugins' trust review, or any extension we might load.
 *
 * `/probe-confirm` blocks on ctx.ui.confirm with a plain human-readable title —
 * exactly the request that used to hang a HappyVibe session forever, because
 * main only ever answered hv.* payloads. It then reports what the host replied,
 * which is how tests/ui-fallback-bridge.test.ts proves the request was both
 * answered AND answered as a denial.
 *
 * The report rides an hv.* notify purely so the harness can read it off the
 * same ui-request channel; the confirm under test is deliberately NOT hv.*.
 */
export default function foreignUiExtension(pi: {
  registerCommand: (
    name: string,
    spec: {
      description: string;
      handler: (
        args: unknown,
        ctx: {
          ui: {
            confirm: (title: string, message: string) => Promise<boolean | undefined>;
            notify: (message: string, level: string) => void;
          };
        },
      ) => Promise<void>;
    },
  ) => void;
}): void {
  pi.registerCommand("probe-confirm", {
    description: "Test fixture: block on a non-hv.* ctx.ui.confirm",
    handler: async (_args, ctx) => {
      // If the host never responds, this await never settles and the harness
      // times out — which is precisely the bug being regression-tested.
      const answer = await ctx.ui.confirm("Trust probe-extension?", "A foreign extension is asking for consent.");
      ctx.ui.notify(JSON.stringify({ kind: "hv.probe", answered: true, answer: answer ?? null }), "info");
    },
  });
}
