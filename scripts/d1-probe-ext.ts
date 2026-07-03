import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    // Fire confirm asynchronously so session_start returns immediately.
    // During rebindSession(), the JSONL stdin reader is not yet attached.
    // By detaching the async work, rebindSession() completes and the JSONL
    // reader is set up before confirm() emits extension_ui_request.
    void (async () => {
      // Small delay to ensure rebindSession() has returned and the JSONL reader is attached.
      await new Promise((r) => setTimeout(r, 50));
      const ok = await ctx.ui.confirm("D1-PROBE", "Reply to prove ui-over-rpc works");
      // stderr, NOT stdout — stdout is the RPC protocol channel
      console.error(`D1-PROBE-RESULT: ${ok}`);
    })();
    // Return synchronously so rebindSession() can complete
  });
}
