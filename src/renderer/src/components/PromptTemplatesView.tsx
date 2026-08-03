import { Section } from "./Section";
import { PromptTemplatesSection } from "./PromptTemplatesSection";

/** §24 global commands page — the sibling of SkillsView, one tier down the
 *  resource ladder (skills → commands). Workspace commands live in each
 *  workspace's settings. */
export function PromptTemplatesView({
  workspaceId,
}: {
  /** Accepted so the route can pass the same pair as SkillsView, but unused:
   *  there is no guided command creator, and nothing here is session-scoped. */
  sessionId?: string | null;
  workspaceId: string | null;
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">Commands</h1>
        <p className="text-sm text-ink-soft mb-8">Slash commands you can type in the composer.</p>

        {/* Global only — a project's own commands are managed in its workspace
            settings. "sysprompt" is the terminal-prompt glyph; no separate
            commands icon is worth a new entry in Section.tsx. */}
        <Section
          icon="sysprompt"
          title="Global commands"
          subtitle="Reviewed, gated prompt templates. Typing /name expands the file into your message — nothing runs on its own. Project commands are managed in each workspace's settings."
        >
          <PromptTemplatesSection workspaceId={workspaceId} />
        </Section>
      </div>
    </div>
  );
}

export default PromptTemplatesView;
