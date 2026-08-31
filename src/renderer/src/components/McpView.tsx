import { useState } from "react";
import { Section } from "./Section";
import { McpServersSection } from "./McpServersSection";
import { McpCatalogSection } from "./McpCatalogSection";

/**
 * MCP servers page — the GLOBAL tier only.
 *
 * It used to take the workspace of whichever session happened to be selected,
 * which made the scope picker either dead (no session) or ambiguous (writes to
 * an unnamed workspace). Workspace-tier MCP now lives in WorkspaceSettingsModal
 * beside workspace skills and permission rules, where the workspace is named —
 * the same split §14 already locked in for skills.
 */
export function McpView(): React.JSX.Element {
  // The two sections show the same fact — which servers exist — so each tells
  // the other when it changes it. Two one-directional ticks, so neither can
  // retrigger the other into a loop.
  const [installedTick, setInstalledTick] = useState(0); // catalog installed → remount the list
  const [serversTick, setServersTick] = useState(0);     // list add/removed → catalog re-derives badges

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">MCP</h1>
        <p className="text-sm text-ink-soft mb-8">
          External MCP servers, available in every workspace. To add one for a single project
          instead, open that workspace&apos;s own settings.
        </p>

        <Section
          icon="mcp"
          title="Add a server"
          subtitle="Recognised Model Context Protocol servers, ready to install."
        >
          <McpCatalogSection
            workspaceId={null}
            scope="global"
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
            workspaceId={null}
            scope="global"
            embedded
            onServersChanged={() => setServersTick((n) => n + 1)}
          />
        </Section>
      </div>
    </div>
  );
}
