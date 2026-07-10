/** B7 wow-flow (PRD §22). A dismissible, skippable checklist layered over the
 * REAL app — it points at the live agent trace + context gauge that ARE the
 * product. It never blocks or fakes the UI. Shown once (persisted via
 * hv.setOnboardingSeen), re-openable from the Help affordance. */

const STEPS: Array<{ n: string; title: string; body: string }> = [
  { n: "①", title: "Open a project", body: "Add a workspace folder in the sidebar, then start a session inside it." },
  { n: "②", title: "Ask the agent to explore it", body: 'Try “Give me a tour of this codebase” and send it.' },
  { n: "③", title: "Watch the live trace", body: "Each tool the agent runs shows up as a card — read, grep, bash — as it happens." },
  { n: "④", title: "See what's in the model's window", body: "Open the context gauge (top of the chat) to see exactly what the model is holding — and prune it." },
];

export function OnboardingOverlay({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end p-6 pointer-events-none">
      <div className="hv-dialog pointer-events-auto w-80 rounded-2xl bg-card border-2 border-ink/70 shadow-pop p-5">
        <div className="flex items-start gap-2 mb-3">
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-tangerine">Welcome to HappyVibe</div>
            <h2 className="font-black text-lg tracking-tight leading-tight">Get to the good part</h2>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            title="Dismiss"
            className="text-ink-soft hover:text-ink cursor-pointer font-black text-lg leading-none -mt-0.5"
          >
            ×
          </button>
        </div>
        <ol className="flex flex-col gap-2.5">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-2.5">
              <span className="text-tangerine font-black shrink-0">{s.n}</span>
              <div>
                <div className="font-bold text-sm leading-tight">{s.title}</div>
                <div className="text-xs text-ink-soft leading-snug">{s.body}</div>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 w-full rounded-xl bg-tangerine text-paper font-bold text-sm py-2 border-2 border-ink/70 shadow-sticker hover:bg-tangerine-deep cursor-pointer"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
