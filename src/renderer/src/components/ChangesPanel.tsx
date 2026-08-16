import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiffView, StatusGlyph } from "./DiffView";
import { groupByDir, primaryAction, summarise } from "../gitui";

/**
 * §29 — the Changes panel.
 *
 * **One panel, two altitudes, one vocabulary.** The top speaks a closed human
 * verb set — Save a version · Sync · Undo — and everything below it is real git
 * in git's own words: staged, stash, amend, merge-base. No third vocabulary is
 * invented, and which is which is never hidden. Every action prints the command
 * it ran in mono, the same honesty rule the tool cards follow.
 *
 * Every write goes through main, which owns the idle gate; a refusal comes back
 * as `{ok:false, busy:[…]}` and is shown as an inline notice, never a dialog.
 */

type Baseline = "head" | "base";

interface Confirm {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  /**
   * A second, non-destructive way out. Some questions are not "do it or don't":
   * a pull request from a dirty tree can reasonably be committed first OR opened
   * as-is, and forcing that into Cancel would hide one of the two answers.
   */
  secondary?: { label: string; onPick: () => void | Promise<void> };
}

export function ChangesPanel({
  workspace,
  onOpenFile,
}: {
  workspace: string;
  onOpenFile: (relPath: string) => void;
}): React.JSX.Element {
  const [payload, setPayload] = useState<HvGitStatusPayload | null>(null);
  const [baseline, setBaseline] = useState<Baseline>("head");
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busyNotice, setBusyNotice] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HvLogEntry[]>([]);
  const [stashesOpen, setStashesOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState<HvFileDiff[]>([]);
  const [branchMenu, setBranchMenu] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const [branchError, setBranchError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  // §29 §7: null while unknown or when there is nothing to open.
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [openingPr, setOpeningPr] = useState(false);
  const [canDraft, setCanDraft] = useState(false);
  const [working, setWorking] = useState(false);
  const [initPreview, setInitPreview] = useState<{ refused: string | null; branch: string; gitignore: string } | null>(null);
  const [switchChoice, setSwitchChoice] = useState<{ branch: string; conflict: boolean } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const state = payload?.state;
  const files = useMemo(() => payload?.status?.files ?? [], [payload]);
  const branch = payload?.status?.branch;
  const stats = useMemo(() => summarise(files), [files]);

  const refresh = useCallback(() => {
    void window.hv.gitStatus(workspace).then(setPayload).catch(() => {});
  }, [workspace]);

  useEffect(() => {
    refresh();
    const off = window.hv.onGitChanged(({ workspaceId }) => {
      if (workspaceId === workspace) refresh();
    });
    return off;
  }, [workspace, refresh]);

  useEffect(() => {
    void window.hv.gitDefaultBranch(workspace).then(setDefaultBranch).catch(() => setDefaultBranch(null));
    // §2b: the button exists only when a draft could actually be produced —
    // "don't show what cannot work". A configured provider is the precondition;
    // beyond that, failure is quiet and the button hides itself (see the catch
    // on gitDraftMessage below), never an error surface.
    void window.hv
      .getProviders()
      .then((p) => setCanDraft(p.byok.some((b) => b.source !== null) || !!p.defaultModel))
      .catch(() => setCanDraft(false));
  }, [workspace]);

  /**
   * Is a pull request even possible here? Asked of MAIN, which knows the remote,
   * the base branch and whether the forge is one we can build a link for — the
   * renderer must not re-derive any of that.
   *
   * `draft: false` keeps this cheap: no model call, no diff. It re-runs on every
   * status change because PUBLISHING a branch is what makes the button appear,
   * and that arrives as a status push.
   */
  useEffect(() => {
    let alive = true;
    void window.hv
      .gitPrUrl(workspace, false)
      .then((r) => { if (alive) setPrUrl(r?.url ?? null); })
      .catch(() => { if (alive) setPrUrl(null); });
    return () => { alive = false; };
  }, [workspace, payload]);

  useEffect(() => {
    if (!historyOpen) return;
    void window.hv.gitHistory(workspace, 20).then(setHistory).catch(() => setHistory([]));
  }, [historyOpen, workspace, payload]);

  const flash = (text: string): void => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4_000);
  };

  /** Every write funnels through here: one place to show the command, catch the
   *  idle gate's refusal, and refresh. */
  const act = useCallback(
    async <T extends HvGitWrite>(command: string, run: () => Promise<T>, onOk?: (r: T) => void): Promise<T | null> => {
      setWorking(true);
      setBusyNotice(null);
      try {
        const r = await run();
        setLastCommand(command);
        if (!r.ok) {
          if (r.busy?.length) {
            setBusyNotice(
              `${r.busy.length === 1 ? "A session is" : `${r.busy.length} sessions are`} working in this project — ` +
                `${r.busy.join(", ")}. Anything that changes files waits until it finishes.`
            );
          } else if (r.error) {
            flash(r.error);
          }
          return r;
        }
        onOk?.(r);
        refresh();
        return r;
      } finally {
        setWorking(false);
      }
    },
    [refresh]
  );

  // ── §5a/§5e: states where the panel cannot do its job ──────────────────
  if (!state) return <Shell><div className="p-4 text-xs text-ink-soft">Reading this project…</div></Shell>;

  if (state.kind === "no-git") {
    // Should be unreachable — App hides the tab entirely — but a panel that
    // renders nothing is worse than one that says why.
    return (
      <Shell>
        <div className="p-4 text-xs text-ink-soft">Version control needs git, which isn’t installed. See workspace settings.</div>
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell>
        <div className="p-3 flex flex-col gap-2">
          <div className="text-xs font-bold">git couldn’t read this project.</div>
          {/* git's OWN message, verbatim: paraphrasing it would leave the user
              searching for a sentence that exists nowhere. */}
          <pre className="rounded-xl border-2 border-line bg-card p-2 text-[11px] font-mono whitespace-pre-wrap">{state.message}</pre>
          {state.fix && (
            <div className="flex flex-col gap-1">
              <div className="text-[11px] text-ink-soft">Run this yourself to fix it:</div>
              <div className="flex items-center gap-1">
                <code className="flex-1 rounded-lg border-2 border-line bg-paper px-2 py-1 text-[11px] font-mono break-all">{state.fix}</code>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(state.fix!); flash("Command copied."); }}
                  className="rounded-lg border-2 border-line bg-card px-2 py-1 text-[10px] font-bold cursor-pointer hover:border-tangerine"
                >
                  Copy
                </button>
              </div>
              {/* We do NOT run it: safe.directory is a global security setting,
                  and an interrupted rebase is not a Changes panel's business. */}
              <div className="text-[10px] text-ink-soft">HappyVibe won’t run this for you — it changes settings outside this project.</div>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ── §5b: the on-ramp ───────────────────────────────────────────────────
  if (state.kind === "no-repo") {
    return (
      <Shell>
        <div className="p-4 flex flex-col gap-3">
          <div className="text-sm font-bold">This project isn’t tracking versions yet</div>
          <div className="text-xs text-ink-soft">
            Tracking versions lets you save a snapshot of your work and go back to it later.
          </div>
          {!initPreview ? (
            <button
              type="button"
              onClick={() => void window.hv.gitInitPreview(workspace).then(setInitPreview)}
              className="self-start rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine shadow-sticker cursor-pointer hover:brightness-105"
            >
              Start tracking
            </button>
          ) : initPreview.refused ? (
            <div className="rounded-xl border-2 border-berry bg-berry-soft p-3 text-xs">
              <div className="font-bold mb-1">HappyVibe won’t start tracking here.</div>
              {/* `git init ~` is not something a beginner recovers from. */}
              <div>{initPreview.refused} Pick a project folder instead.</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Previews before it writes — and the .gitignore is editable,
                  because we are guessing about their project, not theirs. */}
              <div className="text-[11px] text-ink-soft">This will run:</div>
              <code className="rounded-lg border-2 border-line bg-paper px-2 py-1 text-[11px] font-mono">
                git init -b {initPreview.branch}
              </code>
              <label className="text-[11px] text-ink-soft mt-1">
                And write this <span className="font-mono">.gitignore</span> — edit it if you like:
              </label>
              <textarea
                value={initPreview.gitignore}
                onChange={(e) => setInitPreview({ ...initPreview, gitignore: e.target.value })}
                rows={5}
                spellCheck={false}
                className="rounded-xl border-2 border-line bg-card p-2 text-[11px] font-mono resize-y focus:outline-none focus:border-tangerine"
              />
              <div className="text-[10px] text-ink-soft">
                Nothing is saved yet — your first “Save a version” will be your first save.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    void act("git init", () => window.hv.gitInit(workspace, initPreview.gitignore), () => {
                      setInitPreview(null);
                      flash("This project is now tracking versions.");
                    })
                  }
                  className="rounded-xl bg-tangerine text-paper font-bold text-sm px-4 py-2 border-2 border-tangerine shadow-sticker cursor-pointer hover:brightness-105 disabled:opacity-50"
                >
                  Start tracking
                </button>
                <button
                  type="button"
                  onClick={() => setInitPreview(null)}
                  className="rounded-xl bg-card text-ink font-bold text-sm px-3 py-2 border-2 border-line cursor-pointer hover:bg-paper-deep"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {busyNotice && <Notice text={busyNotice} />}
        </div>
      </Shell>
    );
  }

  // ── the repo case ──────────────────────────────────────────────────────
  const primary = primaryAction({
    files,
    stagedCount: stats.staged,
    upstream: branch?.upstream ?? null,
    ahead: branch?.ahead ?? 0,
    behind: branch?.behind ?? 0,
    hasCommits: !state.unborn,
  });
  const stagedOnly = stats.staged > 0 && stats.staged < files.length;
  const groups = groupByDir(files);
  const stashes = payload?.stashes ?? [];

  const doSave = async (opts: { amend?: boolean; onSaved?: () => void } = {}): Promise<void> => {
    const text = message.trim();
    if (!text) return;
    // §2: refuse to sweep junk SILENTLY. Declining still saves — it is their repo.
    const junk = await window.hv.gitDetectJunk(workspace);
    const commit = (): void => {
      void act(
        `git ${opts.amend ? "commit --amend" : "add -A && git commit"} -m "${text}"`,
        () => window.hv.gitCommit(workspace, text, { stagedOnly, amend: !!opts.amend }),
        () => {
          setMessage("");
          flash(state.unborn ? "Saved your first version 🎉" : "Version saved.");
          // Threaded through the junk-guard detour too, since that path also
          // ends here — otherwise "save then open the PR" would silently stop
          // whenever the guard fired.
          opts.onSaved?.();
        }
      );
    };
    if (junk.length && !stagedOnly) {
      setConfirm({
        title: "This save includes files you probably didn’t mean to keep",
        body: (
          <>
            <div className="mb-2">
              It would save everything inside {junk.map((j) => <code key={j} className="font-mono">{j}</code>).reduce((a, b) => <>{a}, {b}</>)}.
              That’s usually generated, and it makes the project huge.
            </div>
            <div className="text-ink-soft">Adding it to .gitignore keeps it out of this and every future save.</div>
          </>
        ),
        confirmLabel: "Add to .gitignore and save",
        onConfirm: async () => {
          await window.hv.gitAddGitignore(workspace, junk);
          setConfirm(null);
          commit();
        },
      });
      return;
    }
    commit();
  };

  const doSwitch = async (target: string, mode: "take" | "stash", create = false): Promise<void> => {
    setBranchError(null);
    const r = await act(
      `git switch ${create ? "-c " : ""}${target}`,
      () => window.hv.gitSwitch(workspace, target, { create, mode }),
      () => {
        setBranchMenu(false);
        setSwitchChoice(null);
        // Leaving the typed name behind made the next Add re-run `switch -c` on
        // a branch that now existed, which failed into a toast behind the open
        // menu and read as "the button does nothing".
        setNewBranch("");
        void window.hv.gitBranches(workspace).then(setBranches);
        flash(create ? `Created and switched to ${target}.` : `Switched to ${target}.`);
      }
    );
    // A failure here belongs IN the menu: it is the only surface the user is
    // looking at, and a toast at the panel's foot sits behind it.
    if (r && !r.ok && !r.busy?.length && !r.wouldConflict) {
      setBranchError(r.error?.split("\n")[0] ?? "Could not switch branch.");
      void window.hv.gitBranches(workspace).then(setBranches);
    }
    // §1: not git's refusal — a first-class choice, because this is the most
    // common beginner state arriving at the moment of most confusion.
    if (r && !r.ok && r.wouldConflict) setSwitchChoice({ branch: target, conflict: true });
  };

  /**
   * The typed name already being a branch is the common case, not an error: you
   * made it a minute ago and came back. So the control switches to it instead of
   * running `switch -c` and failing — the button says "Go" rather than "Add" so
   * it is never a lie about what is about to happen.
   */
  const branchExists = branches.includes(newBranch.trim());
  const submitNewBranch = (): void => {
    const name = newBranch.trim();
    if (!name) return;
    if (name === branch?.branch) {
      setBranchError("You are already on that branch.");
      return;
    }
    void doSwitch(name, "take", !branches.includes(name));
  };

  /** Draft and open the forge's prefilled form. Shared by the button and the
   *  "save first, then open" path, so both behave identically. */
  const openPr = (): void => {
    if (openingPr) return; // the draft is a 2-4s call; a second press = a second tab
    setOpeningPr(true);
    void window.hv
      .gitPrUrl(workspace, true)
      .then(async (r) => {
        // Fall back to the eligibility URL the panel already has: the drafting
        // call can come back null (no provider, a model timeout) and that is not
        // a reason to do nothing.
        const url = r?.url ?? prUrl;
        if (!url) {
          flash("Nothing to open a pull request for — publish the branch first.");
          return;
        }
        setLastCommand(url);
        // NOT fire-and-forget. shell.openExternal rejects when the OS refuses,
        // and swallowing that is what made this read as "the button did
        // something and then nothing happened".
        await window.hv.openExternal(url);
        flash(r?.drafted ? "Opened a pull request draft in your browser." : "Opened your browser — described from the commits.");
      })
      .catch((e: unknown) => {
        flash(`Could not open the pull request: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => setOpeningPr(false));
  };

  const openDiff = async (path: string, status: HvGitFileChange["status"]): Promise<void> => {
    if (status === "deleted") {
      // A deleted file has no tab to open, so its diff expands inline.
      if (expanded === path) {
        setExpanded(null);
        return;
      }
      const d = await window.hv.gitDiff(workspace, baseline, { path });
      setExpanded(path);
      setExpandedDiff(d);
      return;
    }
    onOpenFile(path);
  };

  return (
    <Shell>
      <div className="flex flex-col min-h-0 h-full">
        {/* 1. Branch bar */}
        <div className="px-2.5 py-2 border-b-2 border-line flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setBranchMenu((o) => !o);
                // Always refetch: this list goes stale the moment anyone makes
                // a branch — including us, one row below. Guarding on
                // `!branches.length` meant a branch you had just created was
                // missing from the menu forever.
                setBranchError(null);
                void window.hv.gitBranches(workspace).then(setBranches);
              }}
              className="flex items-center gap-1 min-w-0 rounded-lg border-2 border-line bg-card px-2 py-1 text-[11px] font-bold cursor-pointer hover:border-tangerine"
              title="Switch branch, or make a new one"
            >
              <span aria-hidden>⎇</span>
              <span className="truncate">{branch?.branch ?? "detached"}</span>
            </button>
            <div className="flex-1" />
            <button
              type="button"
              disabled={working}
              onClick={() => void act("git fetch --prune", () => window.hv.gitFetch(workspace), () => flash("Checked the remote."))}
              className="rounded-lg border-2 border-line bg-card px-2 py-1 text-[10px] font-bold cursor-pointer hover:border-tangerine disabled:opacity-50"
              title="Check the remote for new work, without changing your files"
            >
              <span className="flex items-center gap-1"><DownloadGlyph />Fetch</span>
            </button>
          </div>
          {/* §5c: the workspace is BELOW the repo root — say so, because branch
              switching and push act above the workspace and cannot be scoped. */}
          {state.subdir && (
            <div className="text-[10px] text-ink-soft truncate" title={`${state.root} — showing ${state.subdir}`}>
              repo at {shortPath(state.root)} · showing {state.subdir}
            </div>
          )}
        </div>

        {branchMenu && (
          <>
            {/* Click-catcher dismissal, the idiom every other menu here uses —
                NOT onBlur, which loses the click that opened the item. */}
            <div className="fixed inset-0 z-40" onClick={() => setBranchMenu(false)} />
            <div className="absolute left-2 top-14 z-50 w-56 rounded-xl border-2 border-line bg-card shadow-sticker-lg p-1.5 flex flex-col gap-1 max-h-72 overflow-y-auto">
              {branches.map((b) => (
                <button
                  key={b}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); void doSwitch(b, "take"); }}
                  className={`text-left rounded-lg px-2 py-1 text-[11px] font-mono cursor-pointer hover:bg-paper-deep ${b === branch?.branch ? "font-bold" : ""}`}
                >
                  {b === branch?.branch ? "● " : "○ "}{b}
                </button>
              ))}
              <div className="border-t-2 border-line mt-1 pt-1 flex gap-1">
                <input
                  value={newBranch}
                  onChange={(e) => { setNewBranch(e.target.value); setBranchError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNewBranch(); }}
                  placeholder="New branch…"
                  className="flex-1 min-w-0 rounded-lg border-2 border-line bg-paper px-2 py-1 text-[11px] focus:outline-none focus:border-tangerine"
                />
                <button
                  type="button"
                  disabled={!newBranch.trim()}
                  onMouseDown={(e) => { e.preventDefault(); submitNewBranch(); }}
                  className="rounded-lg border-2 border-line bg-card px-2 text-[10px] font-bold cursor-pointer hover:border-tangerine disabled:opacity-40"
                >
                  {branchExists ? "Go" : "Add"}
                </button>
              </div>
              {branchError && (
                <div className="px-1 pt-1 text-[10px] text-berry">{branchError}</div>
              )}
            </div>
          </>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* 2. Message box + the primary action, in the human verb set */}
          <div className="p-2.5 flex flex-col gap-2 border-b-2 border-line">
            {primary.kind === "save" && (
              <>
                {/* §5b: the on-ramp ends HERE, at a first commit the user makes
                    themselves — so it is named rather than sharing the generic
                    label. This is the beginner's win moment. */}
                {state.unborn && (
                  <div className="text-[11px] font-bold text-tangerine-deep">Save your first version ✨</div>
                )}
                {/* One row: the message box, and a narrow column beside it —
                    draft on top, save (with its git-verb dropdown) below. The
                    box is sized to the stacked pair so the row reads as one
                    block rather than three floating controls. */}
                <div className="flex items-stretch gap-1.5">
                  <textarea
                    ref={messageRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What did you change?"
                    className="flex-1 min-w-0 min-h-[5.25rem] rounded-xl border-2 border-line bg-card p-2 text-xs resize-y focus:outline-none focus:border-tangerine"
                  />
                  <div className="shrink-0 flex flex-col gap-1.5 w-[4.75rem]">
                    {canDraft && (
                      <button
                        type="button"
                        disabled={drafting}
                        onClick={() => {
                          setDrafting(true);
                          void window.hv
                            .gitDraftMessage(workspace, stagedOnly)
                            .then((m) => { if (m) setMessage(m); else flash("Couldn’t draft a message this time."); })
                            .catch(() => setCanDraft(false))
                            .finally(() => setDrafting(false));
                        }}
                        // The tooltip carries the cost disclosure, which is the
                        // load-bearing part: this call is a one-shot outside any
                        // session, so it never reaches the cost ledger (§2b).
                        title="Write it for me — drafts a message from your changes using a small, cheap model (about $0.001 per draft). Not counted in session costs."
                        aria-label="Write it for me"
                        className="flex items-center justify-center rounded-xl border-2 border-line bg-card py-1.5 cursor-pointer hover:border-tangerine disabled:opacity-50"
                      >
                        <WandGlyph spinning={drafting} />
                      </button>
                    )}
                    {/* Not `flex-1`: the save button stays SMALL and the box is
                        a little taller than the pair, rather than the button
                        stretching to fill whatever height the box has. */}
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={!message.trim() || working}
                        onClick={() => void doSave()}
                        // Icon-only. The human verb moves to the tooltip and the
                        // accessible name rather than disappearing: it is what
                        // §0's two-altitude rule teaches, so it has to survive
                        // somewhere. The staged count still shows, because
                        // "which files am I about to save" is not something a
                        // floppy disk can say.
                        title={primary.count ? `${primary.label} (staged only)` : "Save a version"}
                        aria-label={primary.label}
                        className="flex-1 min-w-0 flex items-center justify-center gap-1 rounded-xl bg-tangerine text-paper font-bold text-xs px-1.5 py-1.5 border-2 border-tangerine shadow-sticker cursor-pointer hover:brightness-105 disabled:opacity-50"
                      >
                        <UploadGlyph />
                        {primary.count && (
                          <span className="text-[10px] tabular-nums">{primary.count[0]}/{primary.count[1]}</span>
                        )}
                      </button>
                      <SaveMenu
                        disabled={working}
                        onAmend={() => void doSave({ amend: true })}
                        canAmend={!!message.trim() && !state.unborn}
                        onStash={() =>
                          void act("git stash push -u", () => window.hv.gitStash(workspace, "save"), () => flash("Changes stashed."))
                        }
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
            {primary.kind === "publish" && (
              <button
                type="button"
                disabled={working}
                onClick={() => void act(`git push -u origin ${branch?.branch ?? ""}`, () => window.hv.gitPublish(workspace), () => flash("Branch published."))}
                className="rounded-xl bg-tangerine text-paper font-bold text-sm px-3 py-2 border-2 border-tangerine shadow-sticker cursor-pointer hover:brightness-105 disabled:opacity-50"
              >
                {primary.label}
              </button>
            )}
            {primary.kind === "sync" && (
              <button
                type="button"
                disabled={working}
                onClick={() =>
                  void act("git fetch && git pull --ff-only && git push", () => window.hv.gitSync(workspace), () => flash("Synced with the remote.")).then((r) => {
                    // §1: ff-only. A non-fast-forward says so and STOPS — this
                    // panel ships no conflict UI, and a beginner mid-conflict is
                    // the worst state it could produce.
                    if (r && !r.ok && r.nonFF) {
                      flash("The remote has changes that can’t be combined automatically. Nothing was merged.");
                    }
                  })
                }
                // ahead/behind is git-speak: it lives here, not in the bar.
                title={`${branch?.ahead ?? 0} to send, ${branch?.behind ?? 0} to receive`}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-tangerine text-paper font-bold text-sm px-3 py-2 border-2 border-tangerine shadow-sticker cursor-pointer hover:brightness-105 disabled:opacity-50"
              >
                <SyncGlyph />
                {primary.label}
              </button>
            )}
            {primary.kind === "none" && (
              <div className="py-3 text-center">
                <div className="text-sm font-bold">All saved ✨</div>
                <div className="text-[11px] text-ink-soft mt-0.5">
                  {state.unborn ? "Nothing here yet — add a file to get started." : "Everything is saved and up to date."}
                </div>
              </div>
            )}
            {/* §29 §7: only when a PR is actually possible — a recognised forge,
                a pushed branch, and not the default branch. On `main` or before
                publishing it is simply absent, and the panel is already offering
                Publish branch in that state. */}
            {prUrl !== null && (
              <button
                type="button"
                disabled={openingPr}
                onClick={() => {
                  if (openingPr) return;
                  // §29 §7: a pull request describes COMMITTED work. Opening one
                  // from a dirty tree silently leaves those files out of it, and
                  // the user finds out on the forge, after the fact.
                  if (files.length > 0) {
                    setConfirm({
                      title: "You have changes that aren’t saved yet",
                      body: (
                        <>
                          <div className="mb-2">
                            {files.length === 1 ? "1 file is" : `${files.length} files are`} not in any version yet, so
                            {" "}{files.length === 1 ? "it won’t" : "they won’t"} be part of this pull request.
                          </div>
                          <div className="text-ink-soft">
                            {message.trim()
                              ? "Saving a version first includes them."
                              : "Write a message in the box and save a version first to include them."}
                          </div>
                        </>
                      ),
                      confirmLabel: message.trim() ? "Save a version, then open" : "Let me write a message",
                      onConfirm: () => {
                        setConfirm(null);
                        // No message means we cannot commit for them, and we
                        // will not invent one — put the cursor where the answer
                        // goes instead.
                        if (!message.trim()) {
                          messageRef.current?.focus();
                          return;
                        }
                        void doSave({ onSaved: openPr });
                      },
                      secondary: {
                        label: "Open it anyway",
                        onPick: () => { setConfirm(null); openPr(); },
                      },
                    });
                    return;
                  }
                  openPr();
                }}
                // (the open itself lives in openPr, above)

                // It opens a FORM. HappyVibe creates nothing and stores no
                // credential — you press Create on the forge yourself.
                title="Opens your browser at the forge's new-pull-request page, with the title and description filled in. Nothing is created until you press Create there."
                className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-line bg-card px-3 py-1.5 text-xs font-bold cursor-pointer hover:border-tangerine disabled:opacity-50"
              >
                <PrGlyph />
                {openingPr ? "Writing it up…" : "Open a pull request"}
              </button>
            )}
            {busyNotice && <Notice text={busyNotice} />}
          </div>

          {/* 3. Baseline selector */}
          {files.length > 0 && state.unborn && (
            <div className="px-2.5 py-1.5 border-b-2 border-line text-[10px] text-ink-soft">
              {stats.files} {stats.files === 1 ? "file" : "files"} · nothing saved yet
            </div>
          )}
          {files.length > 0 && !state.unborn && (
            <div className="px-2.5 py-1.5 border-b-2 border-line flex items-center gap-1.5">
              <select
                value={baseline}
                onChange={(e) => setBaseline(e.target.value as Baseline)}
                className="rounded-lg border-2 border-line bg-card px-1.5 py-1 text-[10px] font-bold cursor-pointer focus:outline-none focus:border-tangerine"
              >
                <option value="head">Since your last save</option>
                {/* Absent on an unborn HEAD — there are no branches to compare to. */}
                {defaultBranch && <option value="base">Against {defaultBranch}</option>}
              </select>
              <span className="text-[10px] text-ink-soft">
                {stats.files} {stats.files === 1 ? "file" : "files"} · +{stats.additions} −{stats.deletions}
              </span>
            </div>
          )}

          {/* 4. File list, grouped by directory */}
          {groups.map((g) => {
            const untrackedGroup = g.files.every((f) => f.status === "untracked");
            return (
              <div key={g.dir || "·root"}>
                <div className="px-2.5 py-1 text-[10px] font-bold text-ink-soft bg-paper-deep border-b border-line truncate">
                  {g.dir || "project root"}{untrackedGroup ? " · new" : ""}
                </div>
                {g.files.map((f) => (
                  <div key={f.path}>
                    <div className="group flex items-center gap-1.5 px-2.5 py-1 hover:bg-paper-deep">
                      <StatusGlyph status={f.status} />
                      <button
                        type="button"
                        onClick={() => void openDiff(f.path, f.status)}
                        className="flex-1 min-w-0 text-left font-mono text-[11px] truncate cursor-pointer hover:underline"
                        title={f.path}
                      >
                        {f.path.slice(g.dir ? g.dir.length + 1 : 0)}
                      </button>
                      <span className="text-[10px] text-ink-soft shrink-0 tabular-nums">
                        {f.additions > 0 && <span className="text-leaf">+{f.additions}</span>}{" "}
                        {f.deletions > 0 && <span className="text-berry">−{f.deletions}</span>}
                      </span>
                      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                        {f.status !== "untracked" && (
                          <button
                            type="button"
                            onClick={() => void act(
                              `git ${f.staged ? "restore --staged" : "add"} -- ${f.path}`,
                              () => window.hv.gitStage(workspace, f.path, !f.staged)
                            )}
                            className="rounded border border-line bg-card px-1 text-[9px] font-bold cursor-pointer hover:border-tangerine"
                            title={f.staged ? "Unstage this file" : "Stage this file"}
                          >
                            {f.staged ? "unstage" : "stage"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setConfirm(
                              f.status === "untracked"
                                ? {
                                    title: "Discard this new file?",
                                    body: <>It will be deleted from your project. This can’t be undone.</>,
                                    confirmLabel: "Discard file",
                                    danger: true,
                                    onConfirm: () => {
                                      setConfirm(null);
                                      void act(`rm ${f.path}`, () => window.hv.gitDiscardUntracked(workspace, f.path), () => flash(`Discarded ${f.path}.`));
                                    },
                                  }
                                : {
                                    title: "Undo every change in this file?",
                                    body: <><code className="font-mono">{f.path}</code> goes back to how it was at your last save.</>,
                                    confirmLabel: "Undo file",
                                    danger: true,
                                    onConfirm: () => {
                                      setConfirm(null);
                                      void act(`git restore -- ${f.path}`, () => window.hv.gitUndoFile(workspace, f.path), () => flash(`Undid changes in ${f.path}.`));
                                    },
                                  }
                            )
                          }
                          className="rounded border border-line bg-card px-1 text-[9px] font-bold cursor-pointer hover:border-berry"
                          title={f.status === "untracked" ? "Delete this new file" : "Undo this file"}
                        >
                          {f.status === "untracked" ? "discard" : "undo"}
                        </button>
                      </div>
                    </div>
                    {expanded === f.path && (
                      <div className="px-2 pb-2">
                        <DiffView files={expandedDiff} emptyLabel="Nothing to show for this file." />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {/* 5. Stashes — shown only when any exist. A stash with no visible way
              back is data loss with extra steps for exactly this audience. */}
          {stashes.length > 0 && (
            <div className="border-t-2 border-line">
              <button
                type="button"
                onClick={() => setStashesOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold cursor-pointer hover:bg-paper-deep"
              >
                <Chevron open={stashesOpen} />
                Stashed ({stashes.length})
              </button>
              {stashesOpen && stashes.map((s) => (
                <div key={s.index} className="flex items-center gap-1.5 px-2.5 py-1 text-[11px]">
                  <span className="flex-1 min-w-0 truncate text-ink-soft" title={s.message}>{s.message}</span>
                  <button
                    type="button"
                    onClick={() => void act(`git stash pop stash@{${s.index}}`, () => window.hv.gitStash(workspace, "pop", s.index), () => flash("Stash restored."))}
                    className="rounded border border-line bg-card px-1.5 text-[9px] font-bold cursor-pointer hover:border-tangerine"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm({
                      title: "Delete this stash?",
                      body: <>The changes in it are gone for good.</>,
                      confirmLabel: "Delete stash",
                      danger: true,
                      onConfirm: () => {
                        setConfirm(null);
                        void act(`git stash drop stash@{${s.index}}`, () => window.hv.gitStash(workspace, "drop", s.index), () => flash("Stash deleted."));
                      },
                    })}
                    className="rounded border border-line bg-card px-1.5 text-[9px] font-bold cursor-pointer hover:border-berry"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 6. History — collapsed by default: "full-ish" for the experienced
              user at zero cost to the beginner. */}
          {!state.unborn && (
            <div className="border-t-2 border-line">
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold cursor-pointer hover:bg-paper-deep"
              >
                <Chevron open={historyOpen} />
                History
              </button>
              {historyOpen && (
                <div className="pb-2">
                  {history.map((h) => (
                    <button
                      key={h.sha}
                      type="button"
                      onClick={() => void window.hv.gitShow(workspace, h.sha).then((d) => { setExpanded(h.sha); setExpandedDiff(d); })}
                      className="w-full text-left px-2.5 py-1 hover:bg-paper-deep cursor-pointer"
                    >
                      <div className="text-[11px] truncate">{h.subject}</div>
                      <div className="text-[10px] text-ink-soft font-mono">{h.sha.slice(0, 7)} · {h.authorDate.slice(0, 10)}</div>
                    </button>
                  ))}
                  {expanded && history.some((h) => h.sha === expanded) && (
                    <div className="px-2 pt-2">
                      <DiffView files={expandedDiff} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* The mono command line — every action shows what it ran (§0). */}
        {lastCommand && (
          <div className="shrink-0 border-t-2 border-line px-2.5 py-1 bg-paper-deep">
            <code className="text-[10px] font-mono text-ink-soft break-all">$ {lastCommand}</code>
          </div>
        )}
      </div>

      {toast && (
        <div className="absolute bottom-2 left-2 right-2 rounded-xl border-2 border-line bg-card px-2.5 py-1.5 text-[11px] shadow-sticker-lg">
          {toast}
        </div>
      )}

      {switchChoice && (
        <ConfirmDialog
          c={{
            title: `Switch to ${switchChoice.branch}?`,
            body: (
              <>
                <div className="mb-2">You have changes that aren’t saved yet, and this branch has its own version of those files.</div>
                <div className="text-ink-soft">Save them first, or park them somewhere you can get them back.</div>
              </>
            ),
            confirmLabel: "Stash them and switch",
            onConfirm: () => void doSwitch(switchChoice.branch, "stash"),
          }}
          onCancel={() => setSwitchChoice(null)}
        />
      )}

      {confirm && <ConfirmDialog c={confirm} onCancel={() => setConfirm(null)} />}
    </Shell>
  );
}

/**
 * No close button: the rail icon that opened this panel closes it, and a second
 * control in the corner was a duplicate of that with less to say — it could not
 * show which panel it belonged to, where the rail icon lights up.
 */
function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="relative h-full min-h-0 flex flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function Notice({ text }: { text: string }): React.JSX.Element {
  return <div className="rounded-xl border-2 border-honey bg-honey-soft px-2 py-1.5 text-[11px]">{text}</div>;
}

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/** The dropdown beside Save — where the git words are allowed to live. */
function SaveMenu({
  disabled,
  canAmend,
  onAmend,
  onStash,
}: {
  disabled: boolean;
  canAmend: boolean;
  onAmend: () => void;
  onStash: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="h-full rounded-xl border-2 border-line bg-card px-2 text-xs font-bold cursor-pointer hover:border-tangerine disabled:opacity-50"
        title="Other ways to save"
        aria-label="More save options"
      >
        ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-full mb-1 z-50 w-44 rounded-xl border-2 border-line bg-card shadow-sticker-lg p-1 flex flex-col">
            <button
              type="button"
              disabled={!canAmend}
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onAmend(); }}
              className="text-left rounded-lg px-2 py-1 text-[11px] cursor-pointer hover:bg-paper-deep disabled:opacity-40"
              title="Replace the last commit instead of adding a new one"
            >
              Amend last commit
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onStash(); }}
              className="text-left rounded-lg px-2 py-1 text-[11px] cursor-pointer hover:bg-paper-deep"
              title="Park these changes and come back to them"
            >
              Stash changes
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ConfirmDialog({ c, onCancel }: { c: Confirm; onCancel: () => void }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-8" onClick={onCancel}>
      <div
        className={`w-full max-w-md rounded-2xl border-2 ${c.danger ? "border-berry" : "border-tangerine"} bg-card p-5 shadow-sticker-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-bold mb-2">{c.title}</div>
        <div className="text-sm mb-4">{c.body}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
          >
            Cancel
          </button>
          {c.secondary && (
            <button
              type="button"
              onClick={() => void c.secondary!.onPick()}
              className="rounded-xl bg-card text-ink font-bold text-sm px-4 py-2 border-2 border-line shadow-sticker cursor-pointer hover:bg-paper-deep"
            >
              {c.secondary.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => void c.onConfirm()}
            className={`rounded-xl ${c.danger ? "bg-berry border-berry" : "bg-tangerine border-tangerine"} text-paper font-bold text-sm px-4 py-2 border-2 shadow-sticker cursor-pointer hover:brightness-105`}
          >
            {c.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function shortPath(p: string): string {
  const home = "/Users/";
  if (!p.startsWith(home)) return p;
  const rest = p.slice(home.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? p : `~${rest.slice(slash)}`;
}

/** §2b: the draft button's glyph — a wand with a sparkle, spinning while it thinks. */
function WandGlyph({ spinning }: { spinning: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-4 ${spinning ? "animate-pulse" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m15 4-1.5 3L10 8.5 13.5 10 15 13l1.5-3L20 8.5 16.5 7z" />
      <path d="M4 20l8-8" />
      <path d="M6 4v3M4.5 5.5h3" />
    </svg>
  );
}

/**
 * §2: the primary save action — an arrow going UP out of a tray.
 *
 * Not a floppy disk. Saving a version SENDS work somewhere it is kept, which is
 * the same gesture as publish and sync one row up; a floppy says "write to this
 * machine", which is the one thing a commit is not.
 */
function UploadGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Fetch: the same tray, arrow coming DOWN — the mirror of save. */
function DownloadGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/** Sync: two arrows chasing each other round a circle — send AND receive. */
function SyncGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.4-3.9" />
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.4 3.9" />
      <path d="M20 3v4h-4" />
      <path d="M4 21v-4h4" />
    </svg>
  );
}

/** §29 §7: a branch merging into another — the pull-request idiom. */
function PrGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v8" />
      <path d="M18 16V9a3 3 0 0 0-3-3h-3" />
      <path d="m13 3-2 3 2 3" />
    </svg>
  );
}
