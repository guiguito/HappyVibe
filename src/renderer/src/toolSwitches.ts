import { coreToolNames } from "../../../pi-runtime/extensions/hv-builtins";

/**
 * §13 round 26 — every tool the agent has can be switched off. The family switches live on
 * Built-in tools AND at the top of their own page (Memory's "one source, two surfaces"), so
 * their copy lives here, once. There is deliberately no Prompts entry: templates register no
 * tool and cost no tokens, so a master switch would change nothing the agent can do.
 */
export type Family = "mcp" | "subagents" | "skills";

export const FAMILY_SWITCHES: Record<Family, { label: string; on: string; off: string }> = {
  mcp: {
    label: "MCP",
    on: "Lets the agent use the tools of your MCP servers.",
    off: "MCP is off — no server starts in any session. Your servers are kept.",
  },
  subagents: {
    label: "Sub-agents — 4 tools",
    on: "Lets the agent delegate work to the agents on the Agents page.",
    off: "Sub-agents are off — the agent can't delegate.",
  },
  skills: {
    label: "Skills",
    on: "Lets the agent load the skills you turned on.",
    off: "Skills are off — no skill loads in any session.",
  },
};

/** Minor 3: same phrase used in the Plan-off confirm modal and in the live
    hv:session-reloading notice (App.tsx) — reused verbatim so every control
    that triggers the respawn discloses it the same way, not a bespoke one-off. */
export const RESPAWN_NOTE = "Live sessions respawn to apply this — permission grants and dangerous mode reset to safe defaults for those sessions.";

export const ALL_OFF_COPY = "The agent can only chat — it has no tools.";

/** The switches that decide whether any tool is left. `intent` is a label, not a tool. */
export interface ToolSwitchState {
  plan: boolean;
  askUser: boolean;
  terminal: boolean;
  browser: boolean;
  web: boolean;
  document: boolean;
  memory: boolean;
  schedules: boolean;
  mcp: boolean;
  subagents: boolean;
  skills: boolean;
  coreOff: string[];
}

/** The Core tools row's click: the shell is one switch, so turning it on clears both names. */
export function toggleCore(off: string[], name: string): string[] {
  const shells = ["bash", "powershell"];
  if (!off.includes(name)) return [...off, name];
  return off.filter((t) => t !== name && !(shells.includes(name) && shells.includes(t)));
}

/** True when the session would start with no tool at all — every family off, every core tool off. */
export function allToolsOff(b: ToolSwitchState, shell: "bash" | "powershell"): boolean {
  const families = [b.plan, b.askUser, b.terminal, b.browser, b.web, b.document, b.memory, b.schedules, b.mcp, b.subagents, b.skills];
  return families.every((on) => !on) && coreToolNames(shell).every((t) => b.coreOff.includes(t));
}
