import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Tools that never need approval in the spike.
const SAFE_TOOLS = new Set(["read", "grep", "glob", "list", "ls"]);
const sessionGrants = new Set<string>();

function summarize(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "bash" && typeof input.command === "string") return input.command.slice(0, 300);
  return JSON.stringify(input).slice(0, 300);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName as string;
    if (SAFE_TOOLS.has(tool) || sessionGrants.has(tool)) return;

    const title = JSON.stringify({
      kind: "hv.permission",
      tool,
      summary: summarize(tool, (event.input ?? {}) as Record<string, unknown>),
    });
    // Surfaces as extension_ui_request over RPC (verified by D1 probe).
    // NO timeout: permission prompts wait indefinitely by design.
    const choice = await ctx.ui.select(title, ["Allow", "Allow for session", "Deny"]);

    if (choice === "Allow for session") { sessionGrants.add(tool); return; }
    if (choice === "Allow") return;
    return { block: true, reason: "User denied this action in HappyVibe" };
  });
}
