import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

/**
 * Editor for <workspace>/AGENTS.md. Pi loads context files at session start
 * only, so edits apply to new or restarted sessions — the note below says so.
 */
export function AgentsMdPanel({ workspace, onClose }: { workspace: string; onClose: () => void }): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null); // null = loading
  const [missing, setMissing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.hv
      .readAgentsMd(workspace)
      .then((c) => {
        setMissing(c === null);
        setContent(c ?? "");
      })
      .catch((e) => setError(String(e)));
  }, [workspace]);

  const save = async (): Promise<void> => {
    if (content === null) return;
    try {
      await window.hv.writeAgentsMd(workspace, content);
      setMissing(false);
      setDirty(false);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const propose = async (): Promise<void> => {
    setProposing(true);
    setError(null);
    try {
      const draft = await window.hv.proposeAgentsMd(workspace);
      if (draft) {
        setContent(draft);
        setDirty(true);
      } else {
        setError("Draft generation failed — try again or write it by hand.");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setProposing(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="hv-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content className="hv-dialog fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(42rem,calc(100vw-3rem))] rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-6 focus:outline-none flex flex-col max-h-[85vh]">
          <div className="flex items-center gap-3 mb-3">
            <div className="size-10 rounded-xl bg-honey border-2 border-ink/80 flex items-center justify-center -rotate-3 shrink-0">
              <span className="font-black text-xs rotate-3">MD</span>
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-bold text-lg leading-tight">AGENTS.md</Dialog.Title>
              <Dialog.Description className="text-sm text-ink-soft truncate" title={workspace}>
                {workspace.split("/").filter(Boolean).pop()} — applies to new or restarted sessions
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="shrink-0 rounded-lg border-2 border-line px-2.5 py-1 text-xs font-bold text-ink-soft hover:bg-paper-deep/40 cursor-pointer"
              >
                Close
              </button>
            </Dialog.Close>
          </div>

          {error && <div className="mb-2 text-sm font-semibold text-berry">{error}</div>}

          {content === null ? (
            <div className="py-10 text-center text-ink-soft">Loading…</div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                placeholder={missing ? "No AGENTS.md yet. Write one, or let the agent propose a draft." : ""}
                className="flex-1 min-h-64 w-full resize-none rounded-xl border-2 border-line-strong bg-paper px-3.5 py-3 font-mono text-xs focus:outline-none focus:border-tangerine"
              />
              <div className="mt-3 flex items-center gap-2">
                {missing && !dirty && (
                  <button
                    type="button"
                    onClick={propose}
                    disabled={proposing}
                    className="rounded-xl bg-honey text-ink font-bold text-sm px-4 py-2 border-2 border-ink/80 shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-50"
                  >
                    {proposing ? "Drafting…" : "Propose one"}
                  </button>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty}
                  className="rounded-xl bg-tangerine text-paper font-bold text-sm px-5 py-2 border-2 border-tangerine-deep shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
