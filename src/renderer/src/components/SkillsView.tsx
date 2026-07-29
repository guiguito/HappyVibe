import { Section } from "./Section";
import { SkillsSection } from "./SkillsSection";

/** Global skills page (split out of the old combined Skills/MCP/Agents/Tools view). */
export function SkillsView({
  sessionId,
  workspaceId,
}: {
  sessionId: string | null;
  workspaceId: string | null;
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Skills</h1>
        <p className="text-sm text-ink-soft mb-8">Skills the agent can load.</p>

        {/* Skills — global only (workspace skills are managed in each workspace's settings) */}
        <Section
          icon="skills"
          title="Global skills"
          subtitle="Reviewed, gated capability packs the agent can load. Workspace-specific skills are managed in each workspace's settings."
        >
          <SkillsSection workspaceId={workspaceId} sessionId={sessionId} />
        </Section>
      </div>
    </div>
  );
}
