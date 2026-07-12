import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { traceFromEnd } from "../agents";

/** Strip an accidental markdown fence around a drafted file. */
const unfence = (s: string): string =>
  s.trim().replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "").trim();

/**
 * Editor for <workspace>/AGENTS.md. Pi loads context files at session start
 * only, so edits apply to new or restarted sessions — the note below says so.
 *
 * W2.3 missing-file flow: offer a confined CLAUDE.md copy, and a draft via the
 * bundled agents-md-maker subagent — a NORMAL delegation on this session's
 * client (the user sees the W1.2 floating run card); the final output lands in
 * this editor for review and is only written when the user hits Save.
 */
export function AgentsMdPanel({
  workspace,
  sessionId,
  onClose,
}: {
  workspace: string;
  sessionId: string;
  onClose: () => void;
}): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null); // null = loading
  const [missing, setMissing] = useState(false);
  const [claudeMd, setClaudeMd] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live pi-event listener for the in-flight draft (unsubscribed on capture/close).
  const offDraft = useRef<(() => void) | null>(null);

  useEffect(() => {
    window.hv
      .readAgentsMd(workspace)
      .then((c) => {
        setMissing(c === null);
        setContent(c ?? "");
      })
      .catch((e) => setError(String(e)));
    window.hv.hasClaudeMd(workspace).then(setClaudeMd).catch(() => setClaudeMd(false));
    return () => offDraft.current?.();
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

  // Explicit user action — the one direct write in the missing-file flow.
  const copyClaude = async (): Promise<void> => {
    try {
      const copied = await window.hv.copyClaudeMd(workspace);
      setContent(copied);
      setMissing(false);
      setDirty(false);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const draft = (): void => {
    setDrafting(true);
    setError(null);
    const stop = (): void => {
      offDraft.current?.();
      offDraft.current = null;
      setDrafting(false);
    };
    offDraft.current = window.hv.onPiEvent((e) => {
      if (e.sessionId !== sessionId) return;
      if (e.type === "tool_execution_end" && e.toolName === "subagent") {
        const run = traceFromEnd(e.result).results.find((r) => r.agent === "agents-md-maker");
        if (!run) return;
        stop();
        const text = unfence(run.finalOutput ?? "");
        if (text) {
          setContent(text);
          setDirty(true); // review + explicit Save — NEVER auto-written
        } else {
          setError("The draft came back empty — try again or write it by hand.");
        }
      } else if (e.type === "agent_end") {
        // Turn finished without a captured draft (model didn't delegate / errored).
        stop();
        setError("No draft was produced this turn — try again or write it by hand.");
      }
    });
    void window.hv
      .promptSession(
        sessionId,
        'Use the subagent tool to delegate to the "agents-md-maker" agent with the task: ' +
          '"Explore this project and draft the content of its AGENTS.md." ' +
          "Do not create or modify any files yourself. When it finishes, reply with one short sentence " +
          "confirming the draft is ready — do not repeat its output.",
      )
      .catch((e) => {
        stop();
        setError(String(e));
      });
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
                placeholder={missing ? "No AGENTS.md yet. Write one, copy your CLAUDE.md, or let agents-md-maker draft it." : ""}
                className="flex-1 min-h-64 w-full resize-none rounded-xl border-2 border-line-strong bg-paper px-3.5 py-3 font-mono text-xs focus:outline-none focus:border-tangerine"
              />
              <div className="mt-3 flex items-center gap-2">
                {missing && !dirty && (
                  <>
                    {claudeMd && (
                      <button
                        type="button"
                        onClick={copyClaude}
                        disabled={drafting}
                        className="rounded-xl bg-paper text-ink font-bold text-sm px-4 py-2 border-2 border-ink/80 shadow-sticker enabled:hover:bg-paper-deep/40 enabled:cursor-pointer disabled:opacity-50"
                      >
                        Copy CLAUDE.md
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={draft}
                      disabled={drafting}
                      className="rounded-xl bg-honey text-ink font-bold text-sm px-4 py-2 border-2 border-ink/80 shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-50"
                    >
                      {drafting ? "Drafting…" : "Draft with agents-md-maker"}
                    </button>
                  </>
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
