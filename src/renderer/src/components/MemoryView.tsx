import React from "react";
import { GoTo } from "./GoTo";
import { HowItWorks } from "./HowItWorks";
import { MemorySection } from "./MemorySection";
import { Section } from "./Section";

/**
 * PRD §33 — the global Memory page.
 *
 * Sits second in the sidebar's *Abilities* group, directly after Built-in tools, on the same
 * argument that put Built-in tools first: it is on by default and costs nothing to reach.
 */
export function MemoryView({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Memory</h1>
        <p className="text-sm text-ink-soft mb-8">What the agent remembers about you, across every workspace.</p>

        <Section icon="memory" title="Global memories" subtitle="These apply in every project.">
          <MemorySection scope="global" workspaceId={workspaceId} />
          {/* The pointer carries the WORKSPACE, not just the view: App's navigate() selects the
              workspace before switching, and without it the link lands on whatever was last
              open. Found in the GUI — the link rendered, was clickable, and went nowhere.
              With no workspace in play there is no destination to name, so it says so instead
              of offering a dead link (§20 round 17: a dead pointer is worse than none). */}
          {workspaceId ? (
            <p className="mt-4 text-sm text-ink-soft">
              Memories about one project live in{" "}
              <GoTo view="workspace" workspace={workspaceId} label="that project's settings" />.
            </p>
          ) : (
            <p className="mt-4 text-sm text-ink-soft">
              Memories about one project live in that project&apos;s own settings — open a project to see them.
            </p>
          )}
        </Section>

        <HowItWorks copy="memory" />
      </div>
    </div>
  );
}
