/**
 * §39 — a tool name → the closed sets usage statistics use. Built from the
 * per-feature constants that already exist, never a second copy of them.
 * Accepts the bridge's virtual rule names too (`mcp:<server>_<tool>`,
 * `browser:<host>`, `subagent:<agent>`), which is what an audit row carries.
 */
import { WEB_TOOLS } from "../../../pi-runtime/extensions/hv-web";
import { BROWSER_TOOLS } from "../../../pi-runtime/extensions/hv-browser";
import { TERMINAL_TOOLS } from "../../../pi-runtime/extensions/hv-terminal";
import { MEMORY_TOOLS } from "../../../pi-runtime/extensions/hv-memory";
import { isDelegationTool } from "../../../pi-runtime/extensions/hv-rules";

const WEB = new Set<string>(WEB_TOOLS);
const BROWSER = new Set<string>(BROWSER_TOOLS);
const MEMORY = new Set<string>(MEMORY_TOOLS);
const SELF = new Set(["bash", "edit", "write", "read"]);

export function toolKind(tool: string): string {
  if (tool === "mcp" || tool.startsWith("mcp:")) return "mcp";
  if (tool.startsWith("browser:") || BROWSER.has(tool)) return "browser";
  if (tool.startsWith("subagent:") || isDelegationTool(tool)) return "subagent";
  if (SELF.has(tool)) return tool;
  if (WEB.has(tool)) return "web";
  if (TERMINAL_TOOLS.has(tool)) return "terminal";
  if (MEMORY.has(tool)) return "memory";
  if (tool.startsWith("schedule_")) return "schedule";
  if (tool === "workflow") return "workflow";
  return "other";
}

export function featureOfTool(tool: string): string | null {
  if (tool === "web_search") return "web_search";
  if (WEB.has(tool)) return "web_read";
  if (BROWSER.has(tool)) return "browser";
  if (TERMINAL_TOOLS.has(tool)) return "agent_terminal";
  if (MEMORY.has(tool)) return "memory";
  if (isDelegationTool(tool)) return "subagent";
  if (tool === "workflow") return "workflow";
  if (tool === "ask_user") return "ask_user";
  if (tool === "use_skill") return "skill";
  if (tool === "document_read") return "document";
  if (tool === "mcp" || tool.startsWith("mcp:")) return "mcp_tool";
  return null;
}
