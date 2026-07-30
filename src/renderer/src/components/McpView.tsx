import { Section } from "./Section";
import { McpServersSection } from "./McpServersSection";

/** MCP servers page (split out of the old combined Skills/MCP/Agents/Tools view). */
export function McpView({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">MCP</h1>
        <p className="text-sm text-ink-soft mb-8">External MCP servers.</p>

        <Section icon="mcp" title="MCP" subtitle="Connected Model Context Protocol servers, and adding more.">
          <McpServersSection workspaceId={workspaceId} embedded />
        </Section>
      </div>
    </div>
  );
}
