import { useEffect, useState } from "react";
import { ModelSelect } from "./ModelSelect";
import { PromptRow } from "./PromptRow";
import { Section } from "./Section";

/**
 * §19 (2026-08-30) — "On your behalf".
 *
 * HappyVibe makes three model calls the user never asks for by name: it names a
 * session, drafts a commit message, drafts a pull request. Round 15 made them
 * *auditable*; that was half the promise, because a log tells you what already
 * happened. Nothing anywhere told you they EXIST, which model runs them, or
 * what they say. This page is that half.
 *
 * Why its own page rather than a section on Models: Models is about *which*
 * model, this is about *which task*. And not a block on All Tools either —
 * that page's one promise is "what the agent can call", and these are calls the
 * agent never sees.
 *
 * There are THREE rows, not four. The AGENTS.md draft is a delegation to the
 * agents-md-maker sub-agent (PRD §15): it runs on the session's own model,
 * enters the transcript, and the Agents page already shows its system prompt
 * and offers an agent-tier model override. A row here would be a second home
 * for one thing, and two pages that can disagree about its model.
 */

type TaskId = "title" | "commit-message" | "pr-draft";

/** Exported so a test can pin that every row says when it fires and what "off"
    actually does — the two facts no surface stated before this page. */
export const TASK_COPY: Record<TaskId, { title: string; when: string; offMeans: string }> = {
  title: {
    title: "Session title",
    when: "Runs once per session, moments after your first message. It is the only one of the three you never ask for.",
    offMeans: "Off: a session keeps the opening of your first message as its name, and no call is made.",
  },
  "commit-message": {
    title: "Commit message",
    when: "Runs when you press the wand beside the message box in the Changes panel.",
    offMeans: "Off: the wand button is gone from the Changes panel. You write the message yourself.",
  },
  "pr-draft": {
    title: "Pull request description",
    when: "Runs when you press “Open a pull request” in the Changes panel.",
    offMeans:
      "Off: the button still works and still opens your forge — the description falls back to your list of commits, exactly as it does when no model is configured.",
  },
};

const TASK_IDS: TaskId[] = ["title", "commit-message", "pr-draft"];

interface Task {
  enabled: boolean;
  model: { provider: string; modelId: string } | null;
  append: string;
}

export function OnBehalfView(): React.JSX.Element {
  const [tasks, setTasks] = useState<Record<TaskId, Task> | null>(null);
  const [models, setModels] = useState<HvModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [defaultModel, setDefault] = useState<{ provider: string; modelId: string } | null>(null);

  useEffect(() => {
    void window.hv.assistantTasksGet().then(setTasks);
    void window.hv
      .listModels()
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
    // The same probe ChangesPanel uses to decide whether the wand can exist —
    // one source for "is anything configured at all", not a second one here.
    void window.hv
      .getProviders()
      .then((p) => setDefault(p.defaultModel))
      .catch(() => setDefault(null));
  }, []);

  const patch = async (id: TaskId, p: Partial<Task>): Promise<void> => {
    const next = await window.hv.assistantTaskSet(id, p);
    setTasks(next);
  };

  // §16 finding 7: with nothing configured the one-shots return null and simply
  // do not run — correct, and invisible. Here it becomes a stated fact.
  const nothingConfigured = !loadingModels && models.length === 0 && !defaultModel;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-8 py-10">
        <h1 className="font-black text-3xl tracking-tight mb-2">On your behalf</h1>
        <p className="text-sm text-ink-soft mb-8">
          Three things HappyVibe asks a model to do without being told to: naming a session, drafting a commit
          message, drafting a pull request. Each runs on its own, outside every session — nothing enters a transcript
          or a context window. Because there is no session, there is no usage record either, so what they cost appears
          as an <span className="font-bold">estimate</span> in the Audit log and in Stats, never inside a
          session&apos;s own cost.
        </p>

        <Section
          icon="models"
          title="What runs, and when"
          subtitle="Each row shows the exact prompt the model is sent. You can add to it, choose which model runs it, or switch it off."
        >
          {nothingConfigured && (
            <p className="mb-3 rounded-xl border-2 border-dashed border-line px-4 py-3 text-sm text-ink-soft">
              No model is configured, so none of these run at all — a session keeps its fallback name and the draft
              buttons stay away. Add a provider on the Models page and they start working.
            </p>
          )}

          <div className="rounded-xl border-2 border-line bg-card overflow-hidden">
            {tasks &&
              TASK_IDS.map((id) => {
                const t = tasks[id];
                const copy = TASK_COPY[id];
                return (
                  <PromptRow
                    key={id}
                    title={copy.title}
                    subtitle={
                      <>
                        {copy.when} <span className="block mt-0.5">{copy.offMeans}</span>
                      </>
                    }
                    on={t.enabled}
                    onToggle={(next) => void patch(id, { enabled: next })}
                    loadPrompt={() => window.hv.assistantTaskPrompt(id).then((r) => r.text)}
                    promptNote={PROMPT_NOTES[id]}
                    append={t.append}
                    onSaveAppend={(v) => patch(id, { append: v })}
                    right={
                      <div className="shrink-0 w-56">
                        <ModelSelect
                          models={models}
                          value={t.model}
                          loading={loadingModels}
                          onPick={(m) => void patch(id, { model: { provider: m.provider, modelId: m.id } })}
                          onClear={() => void patch(id, { model: null })}
                          clearLabel="Same as your default model"
                          placeholder="Same as your default model"
                          menuWidthClassName="w-72"
                        />
                      </div>
                    }
                  />
                );
              })}
          </div>
          <p className="text-xs text-ink-soft mt-2">
            A row set to “Same as your default model” resolves the way a chat session does: this session&apos;s model,
            else this workspace&apos;s, else your global default.
          </p>
        </Section>
      </div>
    </div>
  );
}

/**
 * What gets substituted into each prompt at call time.
 *
 * Main serves the prompt as a TEMPLATE — a prompt built from an empty diff
 * would be a different string from the one that actually runs, which is exactly
 * the misreport this page exists to end — so the placeholders need explaining.
 * Kept beside the copy above rather than round-tripped through IPC with the
 * text: this is renderer prose, and main already returns its own `note` for
 * anything only main knows.
 */
const PROMPT_NOTES: Record<TaskId, string> = {
  title: "Your first message is inserted where it says so above, trimmed to 500 characters.",
  "commit-message":
    "Your diff and your recent commit subjects are inserted where they say so above. A very large diff degrades to a file list plus the head of each change, so a big commit still drafts something honest.",
  "pr-draft": "Your branch's commits and its diff against the base are inserted where they say so above.",
};
