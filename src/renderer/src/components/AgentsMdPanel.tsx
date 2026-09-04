import * as Dialog from "@radix-ui/react-dialog";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type AgentInfo } from "../agents";
import { EmptyState } from "./EmptyState";
import { HowItWorks } from "./HowItWorks";
import { CodeGlyph, EyeGlyph } from "./FileTab";

// Code-split: CodeMirror lives in its own chunk, exactly as it does for file tabs.
const CodeEditor = lazy(() => import("./EditorPane"));

/**
 * Editor for <workspace>/AGENTS.md. Pi loads context files at session start
 * only, so edits apply to new or restarted sessions — the note below says so.
 *
 * W2.3 missing-file flow: offer a confined CLAUDE.md copy, and a draft via the
 * bundled agents-md-maker subagent — a NORMAL delegation on this session's
 * client (the user sees the W1.2 floating run card). Round 4 #6: the finished
 * draft is auto-saved to AGENTS.md (editable afterwards); manual edits still
 * save explicitly.
 */
export function AgentsMdPanel({
  workspace,
  relPath = "AGENTS.md",
  sessionId,
  agents,
  onClose,
  saveKey,
  searchKey,
}: {
  workspace: string;
  /** WS7: which AGENTS.md — root by default, or any nested one opened from the tree. */
  relPath?: string;
  sessionId: string | null;
  /** PRD §15 (2026-08-30): the Agents page's own inventory — the draft is a
      delegation, so that page decides whether it can run. null = not loaded. */
  agents?: AgentInfo[] | null;
  onClose: () => void;
  /** §15 round 21: resolved bindings from the shortcut registry, forwarded to
      the CodeMirror keymap — the same ones a file tab gets. */
  saveKey: string;
  searchKey: string;
}): React.JSX.Element {
  /**
   * PRD §15 (2026-08-30): drafting is a delegation to ONE agent, and that agent
   * has a switch on the Agents page. With it off the delegation used to be
   * offered anyway, cost a whole turn, and fail with "No draft was produced this
   * turn" — which names neither the cause nor the cure. Say both instead.
   *
   * Only once the inventory has actually loaded: an undefined or empty list is
   * "we do not know yet", and hiding the button on that would be the inverse
   * mistake.
   */
  const maker = agents?.find((a) => a.name === "agents-md-maker");
  const makerOff = !!agents?.length && (!maker || maker.enabled === false);
  // Root AGENTS.md keeps the missing-file affordances (CLAUDE.md copy, draft);
  // a nested one is a plain confined read/write via the generic fs API.
  const isRoot = relPath === "AGENTS.md";
  const [content, setContent] = useState<string | null>(null); // null = loading
  const [missing, setMissing] = useState(false);
  const [claudeMd, setClaudeMd] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState(false); // #6: auto-save acknowledgement
  const [savedFiles, setSavedFiles] = useState<string[]>([]); // WS5: root + nested written
  // The editor is uncontrolled between versions, so a drafted file must bump
  // this or CodeMirror keeps showing the buffer it already had.
  const [docVersion, setDocVersion] = useState(0);
  /**
   * §15 round 21: the same source/preview switch a `.md` file tab has.
   *
   * Preview is the default for a file that already EXISTS; a missing or
   * freshly-drafted one opens on source, because there is nothing to preview
   * and something to write. Seeded once `missing` is known, which is why this
   * is set in the load effect rather than in the initializer.
   */
  const [view, setView] = useState<"rendered" | "raw">("raw");
  // Live pi-event listener for the in-flight draft (unsubscribed on capture/close).
  const offDraft = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (isRoot) {
      window.hv
        .readAgentsMd(workspace)
        .then((c) => {
          setMissing(c === null);
          setContent(c ?? "");
          setView(c === null ? "raw" : "rendered");
        })
        .catch((e) => setError(String(e)));
      window.hv.hasClaudeMd(workspace).then(setClaudeMd).catch(() => setClaudeMd(false));
    } else {
      window.hv
        .fsRead(workspace, relPath)
        .then((r) => {
          setContent(r.kind === "text" ? r.content : "");
          setView("rendered"); // a nested file opened from the tree always exists
        })
        .catch((e) => setError(String(e)));
    }
    return () => offDraft.current?.();
  }, [workspace, relPath, isRoot]);

  const save = async (): Promise<void> => {
    if (content === null) return;
    try {
      if (isRoot) await window.hv.writeAgentsMd(workspace, content);
      else await window.hv.fsWrite(workspace, relPath, content);
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

  /**
   * §15 round 21: main writes the draft; this only waits for it.
   *
   * The old listener watched `tool_execution_end` for a BLOCKING delegation's
   * results. Delegations are async by default, so that event carries a dispatch
   * receipt with no results — nothing ever matched, `agent_end` then fired, and
   * the user got "No draft was produced this turn" while the run was still
   * going. Waiting for the WRITE is correct on both paths and needs no
   * knowledge of how the delegation was dispatched.
   *
   * There is deliberately no timeout: an async delegation has no bounded end,
   * and a timeout would claim failure while a run is still working. The run
   * rail is where a live delegation is watched and stopped.
   */
  const draft = (): void => {
    if (!sessionId) return; // draft needs a live session to delegate on
    setDrafting(true);
    setError(null);
    offDraft.current?.();
    offDraft.current = window.hv.onAgentsMdWritten(({ workspaceId, files }) => {
      if (workspaceId !== workspace) return;
      offDraft.current?.();
      offDraft.current = null;
      setDrafting(false);
      setSavedFiles(files);
      setJustCreated(true);
      setError(null);
      // Reload from disk rather than trusting an echo: main is the writer, so
      // the file is the truth about what was written.
      void window.hv.readAgentsMd(workspace).then((c) => {
        setMissing(c === null);
        setContent(c ?? "");
        setDocVersion((v) => v + 1); // replace the editor's whole document
        setDirty(false);
      });
    });
    void window.hv
      .promptSession(
        sessionId,
        'Use the subagent tool to delegate to the "agents-md-maker" agent with the task: ' +
          '"Explore this project and draft its AGENTS.md (plus a nested AGENTS.md for any large subproject). ' +
          'Return them in the structured json agents-md block as instructed." ' +
          "Do not create or modify any files yourself. When it finishes, reply with one short sentence " +
          "confirming the draft is ready — do not repeat its output.",
      )
      .catch((e) => {
        offDraft.current?.();
        offDraft.current = null;
        setDrafting(false);
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
              <Dialog.Title className="font-bold text-lg leading-tight">{isRoot ? "AGENTS.md" : relPath}</Dialog.Title>
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
              {missing && !dirty && <EmptyState copy="agentsMd" className="mb-3" />}
              <HowItWorks copy="instructionFiles" />
              {/* The switcher LEADS, as a two-icon pill with the current view
                  lit — the file tab's exact control, reused rather than
                  restyled. A single button labelled with the OTHER state
                  ("Source" while showing source) is a riddle; a switch is not. */}
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center rounded-lg border-2 border-line-strong overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setView("raw")}
                    aria-pressed={view === "raw"}
                    aria-label="Edit source"
                    title="Edit source"
                    className={`flex items-center px-2 py-1 cursor-pointer ${
                      view === "raw" ? "bg-tangerine text-paper" : "text-ink-soft hover:bg-paper-deep/40"
                    }`}
                  >
                    <CodeGlyph />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("rendered")}
                    aria-pressed={view === "rendered"}
                    aria-label="Preview rendered"
                    title="Preview rendered"
                    className={`flex items-center px-2 py-1 cursor-pointer border-l-2 border-line-strong ${
                      view === "rendered" ? "bg-tangerine text-paper" : "text-ink-soft hover:bg-paper-deep/40"
                    }`}
                  >
                    <EyeGlyph />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-64 rounded-xl border-2 border-line-strong bg-paper overflow-hidden">
                {view === "rendered" ? (
                  <div className="h-full overflow-y-auto px-6 py-4">
                    <div className="md max-w-3xl mx-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <Suspense
                    fallback={<div className="h-full flex items-center justify-center text-sm text-ink-soft">Opening editor…</div>}
                  >
                    <CodeEditor
                      path={relPath}
                      doc={content}
                      docVersion={docVersion}
                      onChange={(t) => { setContent(t); setDirty(true); setJustCreated(false); }}
                      onSave={() => void save()}
                      saveKey={saveKey}
                      searchKey={searchKey}
                    />
                  </Suspense>
                )}
              </div>
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
                    {makerOff ? (
                      <p className="text-sm text-ink-soft">
                        Drafting is turned off — switch <span className="font-bold">agents-md-maker</span> back on in
                        Settings → Agents.
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={draft}
                        disabled={drafting || !sessionId}
                        title={sessionId ? undefined : "Open a session to generate a draft"}
                        className="rounded-xl bg-honey text-ink font-bold text-sm px-4 py-2 border-2 border-ink/80 shadow-sticker enabled:hover:brightness-105 enabled:cursor-pointer disabled:opacity-50"
                      >
                        {drafting ? "Drafting…" : "Draft with agents-md-maker"}
                      </button>
                    )}
                  </>
                )}
                {justCreated && (
                  <span className="text-sm font-bold text-leaf" title={savedFiles.join("\n")}>
                    ✓ {savedFiles.length > 1 ? `${savedFiles.length} AGENTS.md files created` : "AGENTS.md created"}
                  </span>
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
