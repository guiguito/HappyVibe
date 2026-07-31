import { useState } from "react";
import { Section } from "./Section";
import { McpServersSection } from "./McpServersSection";
import { McpCatalogSection } from "./McpCatalogSection";

/** MCP servers page (split out of the old combined Skills/MCP/Agents/Tools view). */
export function McpView({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
  // The two sections show the same fact — which servers exist — so each has to
  // tell the other when it changes it. Two one-directional ticks rather than one
  // shared counter, so neither can retrigger the other into a loop.
  const [installedTick, setInstalledTick] = useState(0); // catalog installed → remount the list
  const [serversTick, setServersTick] = useState(0);     // list add/removed → catalog re-derives badges

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">MCP</h1>
        <p className="text-sm text-ink-soft mb-8">External MCP servers.</p>

        <Section
          icon="mcp"
          title="Add a server"
          subtitle="Recognised Model Context Protocol servers, ready to install."
        >
          <McpCatalogSection
            workspaceId={workspaceId}
            refreshKey={serversTick}
            onInstalled={() => setInstalledTick((n) => n + 1)}
          />
        </Section>

        <Section
          icon="mcp"
          title="Your servers"
          subtitle="Connected Model Context Protocol servers, and adding more."
        >
          <McpServersSection
            key={installedTick}
            workspaceId={workspaceId}
            embedded
            onServersChanged={() => setServersTick((n) => n + 1)}
          />
        </Section>
      </div>
    </div>
  );
}
