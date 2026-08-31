/**
 * §20 round 17 — the ONE empty state.
 *
 * One visual tier: the dashed box SystemPromptView and OnBehalfView already
 * used. The illustrated card the guidance audit thought it was generalizing
 * never existed anywhere in the app, and a second tier is a second thing to
 * keep consistent — which is the problem this component exists to end.
 *
 * The standing rule (PRD §20, generalized from "No providers configured yet —
 * add one below."): every empty state NAMES THE NEXT STEP. The headline states
 * the fact, `next` states the step, and the optional action is the click.
 *
 * Copy lives here as DATA because the renderer suite has no DOM — tests assert
 * on the prose directly (the TASK_COPY pattern from OnBehalfView).
 *
 * NOT covered here on purpose: search-result empties ("No models match …").
 * Those are a different class — the next step is "change your search", it is
 * already obvious, and the sentence shape does not fit. Nor the sidebar's
 * session list, a narrow tree line whose slot also carries a search variant.
 *
 * Every key here MUST have a call site — tests/empty-state.test.ts fails on an
 * unused one, because unreferenced copy is the drift this component ends.
 */
export const EMPTY_COPY = {
  agents: {
    headline: "No agents yet",
    next: "The bundled ones appear after your first session runs.",
  },
  tools: {
    headline: "No tools yet",
    next: "Start a session and this fills in from the live agent.",
  },
  mcpServers: {
    headline: "No MCP servers yet",
    next: "Install one from the catalog above, or add your own.",
  },
  context: {
    headline: "Nothing in context yet",
    next: "It fills in as soon as you send a message.",
  },
  agentsMd: {
    headline: "No AGENTS.md yet",
    next: "Write the house rules for this project, or let an agent draft them for you.",
  },
  rules: {
    headline: "No rules yet",
    next: "Add one below, or let the agent ask and choose Always.",
  },
  statsSessions: {
    headline: "No sessions yet",
    next: "Start one from a workspace in the sidebar.",
  },
  statsData: {
    headline: "No data yet",
    next: "This fills in once you've run a session.",
  },
  statsPermissions: {
    headline: "No permission decisions yet",
    next: "They appear here once the agent asks for something.",
  },
  costs: {
    headline: "No billed calls yet",
    next: "They appear here as soon as the agent talks to a model.",
  },
} as const;

export type EmptyKey = keyof typeof EMPTY_COPY;

export function EmptyState({
  copy,
  action,
  className = "",
}: {
  copy: EmptyKey;
  action?: { label: string; onClick: () => void };
  className?: string;
}): React.JSX.Element {
  const { headline, next } = EMPTY_COPY[copy];
  return (
    <div
      className={`rounded-xl border-2 border-dashed border-line px-4 py-3 text-sm text-ink-soft ${className}`}
    >
      <span className="font-bold text-ink">{headline}</span> — {next}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="ml-2 rounded-lg border-2 border-line bg-card px-2 py-0.5 text-xs font-bold shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
