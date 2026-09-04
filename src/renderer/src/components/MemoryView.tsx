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
          <p className="mt-4 text-sm text-ink-soft">
            Memories about one project live in <GoTo view="workspace" label="that project's settings" />.
          </p>
        </Section>

        <HowItWorks copy="memory" />
      </div>
    </div>
  );
}
