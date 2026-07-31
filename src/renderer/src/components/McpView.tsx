import { useState } from "react";
import { Section } from "./Section";
import { McpServersSection } from "./McpServersSection";
import { McpCatalogSection } from "./McpCatalogSection";

/** MCP servers page (split out of the old combined Skills/MCP/Agents/Tools view). */
export function McpView({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
  // Bumped after a catalog install so the configured-servers list refetches —
  // McpServersSection already loads on mount, so remounting is enough.
  const [installedTick, setInstalledTick] = useState(0);

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
            onInstalled={() => setInstalledTick((n) => n + 1)}
          />
        </Section>

        <Section
          icon="mcp"
          title="Your servers"
          subtitle="Connected Model Context Protocol servers, and adding more."
        >
          <McpServersSection key={installedTick} workspaceId={workspaceId} embedded />
        </Section>
      </div>
    </div>
  );
}
