import { coreToolNames } from "../../../pi-runtime/extensions/hv-builtins";
import { DOCUMENT_FAMILY_LIST } from "../../../pi-runtime/extensions/hv-document";
import { fmtNum } from "./analytics-format";

/** §13 / §22 (Onboarding kit round, 2026-10-09): Built-in tools' families, in its row order — the kit's order too. */
export type KitFamily = "plan" | "askUser" | "terminal" | "browser" | "web" | "memory" | "schedules" | "document" | "images" | "subagents" | "workflows" | "skills";
export const KIT_FAMILIES: readonly KitFamily[] = ["plan", "askUser", "terminal", "browser", "web", "memory", "schedules", "document", "images", "subagents", "workflows", "skills"];

/**
 * Each family's row title and its first sentence, verbatim — read by the Built-in
 * tools rows AND the first-run kit, so the two can never describe a family differently.
 * A row keeps the rest of its copy after `what`.
 */
/** `short` is the kit tile's one-liner (§22, 2026-10-10); Built-in tools keeps the full `what`. */
export const FAMILY_COPY: Record<KitFamily, { label: string; what: string; short: string }> & Record<"intent" | "mcp" | "core", { label: string; what: string }> = {
  plan: { label: "Plan mode", what: "Lets the agent draft and track a step-by-step plan before acting.", short: "Plans the steps before it acts." },
  askUser: { label: "Ask user", what: "Lets the agent pause mid-turn to ask you a clarifying question.", short: "Asks you when something is unclear." },
  terminal: { label: "Agent terminal — 3 tools", what: "Lets the agent run long-running commands in terminals you can watch, type into and stop.", short: "Runs long commands you can watch." },
  browser: { label: "Agent browser — 10 tools", what: "Lets the agent open a page in a sandboxed browser tab, read it, screenshot it, click and type in it, and watch its console and network traffic.", short: "Opens and uses web pages in a sandbox." },
  web: { label: "Web tools — 4 tools", what: "Lets the agent search the web and read any public page as clean text, list a site's pages, or read a whole section of one.", short: "Searches the web and reads pages." },
  memory: { label: "Memory — 3 tools", what: "Lets the agent remember durable facts about you and about each project, across sessions.", short: "Remembers facts across sessions." },
  schedules: { label: "Schedules — 4 tools", what: "Lets the agent list this workspace's schedules and propose new ones.", short: "Proposes tasks that run on a schedule." },
  document: { label: "Documents — 1 tool", what: `Lets the agent read ${DOCUMENT_FAMILY_LIST} files as Markdown, converted on this machine — nothing is sent anywhere.`, short: "Reads office documents and PDFs." },
  images: { label: "Images — 1 tool", what: "Lets the agent make an image and save it as a new file in your project.", short: "Makes images for your project." },
  subagents: { label: "Sub-agents — 4 tools", what: "Lets the agent delegate work to the agents on the Agents page.", short: "Hands work to specialist agents." },
  workflows: { label: "Workflows — 1 tool", what: "Lets the agent run a scripted workflow of several sub-agents.", short: "Runs scripted teams of sub-agents." },
  skills: { label: "Skills", what: "Lets the agent load the skills you turned on.", short: "Loads expert know-how when it's needed." },
  intent: { label: "Tool intent", what: "The one-line “why” the model writes for each tool card." },
  mcp: { label: "MCP", what: "Lets the agent use the tools of your MCP servers." },
  core: { label: "Core tools", what: "Pi's own tools for reading, searching and changing files and running commands." },
};

/** A family's weight in the app's own number format (chars ÷ 4, from the generated file). */
export function weightLabel(tokens: number): string {
  return `~${fmtNum(tokens)} tokens`;
}

/** Skills and Sub-agents grow with what you add; their measured figure is the shipped set. */
export const BUNDLED_NOTE = "with the bundled ones on";

/**
 * §13 round 26 — every tool the agent has can be switched off. The family switches live on
 * Built-in tools AND at the top of their own page (Memory's "one source, two surfaces"), so
 * their copy lives here, once. There is deliberately no Prompts entry: templates register no
 * tool and cost no tokens, so a master switch would change nothing the agent can do.
 */
export type Family = "mcp" | "subagents" | "skills";

export const FAMILY_SWITCHES: Record<Family, { label: string; on: string; off: string }> = {
  mcp: {
    label: FAMILY_COPY.mcp.label,
    on: FAMILY_COPY.mcp.what,
    off: "MCP is off — no server starts in any session. Your servers are kept.",
  },
  subagents: {
    label: FAMILY_COPY.subagents.label,
    on: FAMILY_COPY.subagents.what,
    off: "Sub-agents are off — the agent can't delegate.",
  },
  skills: {
    label: FAMILY_COPY.skills.label,
    on: FAMILY_COPY.skills.what,
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
  /** §13 round 27: generate_image counts only while it can register (an OpenRouter credential). */
  images?: boolean;
  imagesAvailable?: boolean;
}

/** The Core tools row's click: the shell is one switch, so turning it on clears both names. */
export function toggleCore(off: string[], name: string): string[] {
  const shells = ["bash", "powershell"];
  if (!off.includes(name)) return [...off, name];
  return off.filter((t) => t !== name && !(shells.includes(name) && shells.includes(t)));
}

/** True when the session would start with no tool at all — every family off, every core tool off. */
export function allToolsOff(b: ToolSwitchState, shell: "bash" | "powershell"): boolean {
  const families = [b.plan, b.askUser, b.terminal, b.browser, b.web, b.document, b.memory, b.schedules, b.mcp, b.subagents, b.skills, !!(b.images && b.imagesAvailable)];
  return families.every((on) => !on) && coreToolNames(shell).every((t) => b.coreOff.includes(t));
}
