import { BuiltinToolsBlock } from "./BuiltinToolsBlock";
import { GoTo } from "./GoTo";

/**
 * §13 round 18 — split out of the old "All Tools" page.
 *
 * That page was two unrelated things under one heading: global ON/OFF switches
 * for HappyVibe's own agent features (turning one off UNREGISTERS tools and
 * respawns live sessions), and a read-only inventory of every tool with its
 * permission state. One is destructive configuration, the other is a list you
 * consult — and "Everything the agent can call" described only the second.
 *
 * This half is a CAPABILITY page, so it sits under Abilities beside Skills,
 * MCP and Agents: these are the things HappyVibe itself gives the agent. The
 * inventory stays on `AllToolsView` as "Agent tools", under Control, beside
 * the rules that gate it.
 *
 * The name is the app's own: the block's section already reads "Built-in
 * Custom Tools — App-provided tools implemented as ordinary tool calls, not
 * part of Pi core."
 */
export function BuiltinToolsView({
  onPlanBuiltinChange,
}: {
  /** Lets App keep the composer's plan chip in sync without a navigation. */
  onPlanBuiltinChange?: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Built-in tools</h1>
        <p className="text-sm text-ink-soft mb-8">
          Abilities HappyVibe gives the agent itself, on by default. Turning one off takes its tools
          away from every session. To see every tool the agent can call and whether it is allowed,
          open <GoTo view="tools" />.
        </p>

        <BuiltinToolsBlock onPlanChange={onPlanBuiltinChange} />
      </div>
    </div>
  );
}
