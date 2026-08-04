import { Section } from "./Section";
import { PluginsSection } from "./PluginsSection";

/** §25 plugin marketplaces page — the browse surface for Claude Code plugins,
 *  filtered to the components whose execution funnels through the permission
 *  gate. Installed components then live on their own pages (Skills, Prompts,
 *  MCP), because that is where their trust already lives. */
export function PluginsView(): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Plugins</h1>
        <p className="text-sm text-ink-soft mb-8">
          Install Claude Code plugins. HappyVibe takes their skills, prompts and MCP servers — everything
          that goes through the same permission gate as the agent's own tools.
        </p>

        <Section
          icon="skills"
          title="Marketplace"
          subtitle="Every plugin here was checked against the permission gate before the release, so anything listed installs. Nothing installs on its own — you pick what comes in, and skills arrive switched off."
        >
          <PluginsSection />
        </Section>
      </div>
    </div>
  );
}

export default PluginsView;
