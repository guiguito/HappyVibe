import React, { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "./EmptyState";
import { MEMORY_TYPE_LABEL } from "../memoryFact";

/**
 * PRD §33 — the memory list, its inspector, and (global only) import + housekeeping.
 *
 * ONE component, two data sources: the Memory page passes `scope="global"`, each workspace's
 * settings passes `scope="workspace"` with its id. Two copies of this list is how the two
 * surfaces would come to disagree about what a memory looks like.
 */

const TYPE_TONE: Record<string, string> = {
  user: "border-tangerine/40 bg-honey-soft text-tangerine-deep",
  feedback: "border-berry/40 bg-berry-soft text-berry",
  project: "border-leaf/40 bg-leaf/10 text-ink",
  reference: "border-ink/20 bg-ink/5 text-ink-soft",
};

function relative(iso?: string): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function MemorySection({
  scope,
  workspaceId,
}: {
  scope: "global" | "workspace";
  workspaceId: string | null;
}): React.JSX.Element {
  const [list, setList] = useState<HvMemoryList | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [housekeeping, setHousekeeping] = useState<Array<{ key: string; count: number }>>([]);

  const refresh = useCallback(() => {
    void window.hv.memoryList(scope, workspaceId).then(setList);
    if (scope === "global") void window.hv.memoryHousekeeping().then((h) => setHousekeeping(h.folders));
  }, [scope, workspaceId]);

  useEffect(() => {
    refresh();
    return window.hv.onMemoryChanged(refresh);
  }, [refresh]);

  const items = useMemo(() => {
    const all = list?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((m) => `${m.slug} ${m.description} ${m.type}`.toLowerCase().includes(q));
  }, [list, query]);

  if (list && !list.available) {
    return (
      <p className="text-sm text-ink-soft">
        Memory is turned off {scope === "workspace" ? "for this project" : "for this app"}.
      </p>
    );
  }

  return (
    <>
      {/* The cost is the SAME estimate the context panel shows — one number, two surfaces, so
          they can never disagree about what memory costs. */}
      <p className="text-sm text-ink-soft mb-3">
        {list === null ? (
          "Loading…"
        ) : (
          <>
            Costs ≈ <span className="font-bold text-ink">{list.tokens}</span> tokens every turn. Memories open on demand.
            {list.cap ? ` ${list.items.length} of ${list.cap} used.` : ""}
          </>
        )}
      </p>

      {(list?.items.length ?? 0) > 4 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories"
          className="w-full mb-3 rounded-xl border-2 border-line bg-card px-3 py-2 text-sm focus:outline-none focus:border-ink/40"
        />
      )}

      {list === null ? null : items.length === 0 ? (
        query.trim() ? (
          <p className="text-sm text-ink-soft">No matching memories.</p>
        ) : (
          // Two static call sites rather than a ternary inside `copy`: the no-dead-copy test
          // scans for the literal `copy="key"`, which is what stops a key from quietly losing
          // its last caller.
          scope === "workspace" ? <EmptyState copy="memoryWorkspace" /> : <EmptyState copy="memory" />
        )
      ) : (
        <div className="rounded-2xl bg-card border-2 border-line shadow-sticker overflow-hidden">
          {items.map((m) => (
            <button
              key={m.slug}
              type="button"
              onClick={() => setInspecting(m.slug)}
              className="w-full text-left px-4 py-3 border-b border-line last:border-b-0 hover:bg-paper-deep/30 cursor-pointer block"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 shrink-0 ${TYPE_TONE[m.type] ?? TYPE_TONE.reference}`}>
                  {MEMORY_TYPE_LABEL[m.type] ?? m.type}
                </span>
                <span className="font-bold break-words">{m.slug}</span>
                <span className="ml-auto shrink-0 text-xs text-ink-soft" title={m.modified ?? ""}>
                  {relative(m.modified)}
                </span>
                <span className="shrink-0 text-ink-soft">›</span>
              </div>
              <p className="text-sm text-ink-soft mt-1 line-clamp-2">{m.description}</p>
            </button>
          ))}
        </div>
      )}

      {(list?.items.length ?? 0) > 0 && (
        <div className="mt-3">
          {confirmAll ? (
            <div className="rounded-xl border-2 border-berry/50 bg-berry-soft px-3 py-2 text-sm">
              <p className="font-bold text-berry mb-2">
                Forget all {list!.items.length} {scope === "workspace" ? "memories about this project" : "global memories"}? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void window.hv.memoryForgetAll(scope, workspaceId).then(() => {
                      setConfirmAll(false);
                      refresh();
                    });
                  }}
                  className="rounded-lg border-2 border-berry bg-card px-3 py-1 text-xs font-bold text-berry shadow-sticker cursor-pointer"
                >
                  Forget them all
                </button>
                <button type="button" onClick={() => setConfirmAll(false)} className="rounded-lg border-2 border-line bg-card px-3 py-1 text-xs font-bold shadow-sticker cursor-pointer">
                  Keep them
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmAll(true)} className="text-xs font-bold text-ink-soft underline underline-offset-2 cursor-pointer hover:text-berry">
              Forget all…
            </button>
          )}
        </div>
      )}

      {scope === "global" && (
        <>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="rounded-xl border-2 border-ink/80 bg-card px-3 py-1.5 text-sm font-bold shadow-sticker cursor-pointer transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              Import from Claude Code
            </button>
          </div>
          {housekeeping.length > 0 && (
            <div className="mt-4 rounded-xl border-2 border-honey/60 bg-honey-soft px-3 py-2 text-sm">
              <span className="font-bold text-tangerine-deep">
                {housekeeping.length} memory folder{housekeeping.length > 1 ? "s" : ""} belong
                {housekeeping.length > 1 ? "" : "s"} to projects you no longer have open
              </span>
              <span className="text-ink-soft"> ({housekeeping.reduce((a, f) => a + f.count, 0)} memories).</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {housekeeping.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => void window.hv.memoryForgetFolder(f.key).then(refresh)}
                    className="rounded-lg border-2 border-line bg-card px-2 py-0.5 text-xs font-bold shadow-sticker cursor-pointer"
                  >
                    Forget {f.count} from {f.key.slice(0, 6)}…
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {list?.dir && (
        <p className="mt-4 text-xs text-ink-soft break-all">
          These live on this computer, in <span className="font-mono">{list.dir}</span>.
        </p>
      )}

      {inspecting && (
        <MemoryInspector scope={scope} workspaceId={workspaceId} slug={inspecting} onClose={() => setInspecting(null)} onChanged={refresh} />
      )}
      {importing && <ImportModal workspaceId={workspaceId} onClose={() => setImporting(false)} onDone={refresh} />}
    </>
  );
}

/** Row click → the memory in full: body, where it came from, edit, forget. */
function MemoryInspector({
  scope,
  workspaceId,
  slug,
  onClose,
  onChanged,
}: {
  scope: "global" | "workspace";
  workspaceId: string | null;
  slug: string;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [doc, setDoc] = useState<HvMemoryDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void window.hv.memoryRead(scope, workspaceId, slug).then((d) => {
      setDoc(d);
      setBody(d?.body ?? "");
      setDescription(d?.description ?? "");
    });
  }, [scope, workspaceId, slug]);

  // Provenance from the FILE. "edited by you" is the ABSENCE of originSessionId, which is what
  // makes clearing it on a human edit honest rather than decorative.
  const provenance = !doc
    ? ""
    : doc.sessionTitle
      ? `Saved by the agent in “${doc.sessionTitle}”`
      : doc.originSessionId
        ? "Saved by the agent"
        : "Edited by you, or imported";

  return (
    <div className="hv-overlay fixed inset-0 bg-ink/40 flex items-center justify-center p-6" onMouseDown={onClose}>
      <div
        className="hv-dialog w-[min(40rem,calc(100vw-3rem))] max-h-[80vh] overflow-y-auto rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="font-black text-xl break-words">{slug}</h2>
            <p className="text-xs text-ink-soft mt-0.5">
              {provenance}
              {doc?.modified ? ` · ${new Date(doc.modified).toLocaleString()}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto shrink-0 text-ink-soft hover:text-ink cursor-pointer text-lg leading-none" aria-label="Close">
            ✕
          </button>
        </div>

        {doc === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : editing ? (
          <>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1">Summary</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={150}
              className="w-full mb-1 rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm focus:outline-none focus:border-ink/40"
            />
            <p className="text-xs text-ink-soft mb-3">{description.length}/150 — this is the line the agent sees every turn.</p>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft mb-1">What it remembers</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="w-full rounded-xl border-2 border-line bg-paper px-3 py-2 text-sm font-mono focus:outline-none focus:border-ink/40"
            />
            {error && <p className="mt-2 text-sm font-bold text-berry">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  void window.hv.memoryEdit(scope, workspaceId, slug, { description, content: body }).then((r) => {
                    if (r.ok) {
                      setEditing(false);
                      onChanged();
                      void window.hv.memoryRead(scope, workspaceId, slug).then(setDoc);
                    } else setError(r.reason);
                  });
                }}
                className="rounded-xl border-2 border-ink/80 bg-honey px-3 py-1.5 text-sm font-bold shadow-sticker cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setBody(doc.body);
                  setDescription(doc.description);
                  setError(null);
                }}
                className="rounded-xl border-2 border-line bg-card px-3 py-1.5 text-sm font-bold shadow-sticker cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-soft mb-3">{doc.description}</p>
            <pre className="rounded-xl border-2 border-line bg-paper px-4 py-3 text-sm whitespace-pre-wrap break-words">{doc.body}</pre>
            <div className="mt-4 flex gap-2 items-center">
              <button type="button" onClick={() => setEditing(true)} className="rounded-xl border-2 border-ink/80 bg-card px-3 py-1.5 text-sm font-bold shadow-sticker cursor-pointer">
                Edit
              </button>
              {confirming ? (
                <>
                  <span className="text-sm font-bold text-berry">Forget “{slug}”?</span>
                  <button
                    type="button"
                    onClick={() => {
                      void window.hv.memoryForget(scope, workspaceId, slug).then(() => {
                        onChanged();
                        onClose();
                      });
                    }}
                    className="rounded-lg border-2 border-berry bg-card px-3 py-1 text-xs font-bold text-berry shadow-sticker cursor-pointer"
                  >
                    Forget it
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border-2 border-line bg-card px-3 py-1 text-xs font-bold shadow-sticker cursor-pointer">
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className="rounded-xl border-2 border-line bg-card px-3 py-1.5 text-sm font-bold text-berry shadow-sticker cursor-pointer">
                  Forget
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Import from Claude Code — one destination PER FOLDER, pre-selected by the folder's guessed
 * path. Per-row destinations were considered and left for later, and the picker says so.
 */
function ImportModal({
  workspaceId,
  onClose,
  onDone,
}: {
  workspaceId: string | null;
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [scan, setScan] = useState<HvMemoryImportScan | null>(null);
  const [chosen, setChosen] = useState<Record<string, Set<string>>>({});
  const [dest, setDest] = useState<Record<string, "global" | "workspace">>({});
  const [result, setResult] = useState<HvMemoryImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.hv.memoryImportScan().then((s) => {
      setScan(s);
      const c: Record<string, Set<string>> = {};
      const d: Record<string, "global" | "workspace"> = {};
      for (const p of s.projects) {
        c[p.key] = new Set(p.memories.map((m) => m.file));
        // Pre-select this workspace only when its path is the one the folder name guesses at.
        d[p.key] = workspaceId && p.guessedPath === workspaceId ? "workspace" : "global";
      }
      setChosen(c);
      setDest(d);
    });
  }, [workspaceId]);

  const run = (): void => {
    if (!scan) return;
    setBusy(true);
    void (async () => {
      const all: HvMemoryImportResult = { imported: [], skipped: [] };
      for (const p of scan.projects) {
        const files = [...(chosen[p.key] ?? [])];
        if (files.length === 0) continue;
        const to = dest[p.key] ?? "global";
        const r = await window.hv.memoryImport(files, to, to === "workspace" ? workspaceId : null);
        all.imported.push(...r.imported);
        all.skipped.push(...r.skipped);
      }
      setResult(all);
      setBusy(false);
      onDone();
    })();
  };

  return (
    <div className="hv-overlay fixed inset-0 bg-ink/40 flex items-center justify-center p-6" onMouseDown={onClose}>
      <div
        className="hv-dialog w-[min(44rem,calc(100vw-3rem))] max-h-[80vh] overflow-y-auto rounded-2xl bg-card border-2 border-ink/80 shadow-pop p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="font-black text-xl mb-1">Import from Claude Code</h2>
        <p className="text-sm text-ink-soft mb-4">
          Memories are copied in, never linked. Anything already here with the same name is skipped and named.
        </p>

        {scan === null ? (
          <p className="text-sm text-ink-soft">Looking…</p>
        ) : result ? (
          <div className="text-sm">
            <p className="font-bold mb-2">Imported {result.imported.length}.</p>
            {result.skipped.length > 0 && (
              <>
                <p className="font-bold mb-1">Skipped {result.skipped.length}:</p>
                <ul className="list-disc pl-5 text-ink-soft">
                  {result.skipped.map((s) => (
                    <li key={s.file}>
                      <span className="font-mono">{s.file}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button type="button" onClick={onClose} className="mt-4 rounded-xl border-2 border-ink/80 bg-honey px-3 py-1.5 text-sm font-bold shadow-sticker cursor-pointer">
              Done
            </button>
          </div>
        ) : scan.projects.length === 0 ? (
          <p className="text-sm text-ink-soft">No Claude Code memories found on this computer.</p>
        ) : (
          <>
            {scan.projects.map((p) => (
              <div key={p.key} className="mb-4 rounded-xl border-2 border-line bg-paper p-3">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="font-bold break-all">{p.guessedPath}</span>
                  <span className="text-xs text-ink-soft">{p.memories.length} memories</span>
                  <select
                    value={dest[p.key] ?? "global"}
                    onChange={(e) => setDest((d) => ({ ...d, [p.key]: e.target.value as "global" | "workspace" }))}
                    className="ml-auto rounded-lg border-2 border-line bg-card px-2 py-1 text-xs font-bold cursor-pointer"
                  >
                    <option value="global">Into global memory</option>
                    {workspaceId && <option value="workspace">Into this project</option>}
                  </select>
                </div>
                {p.memories.map((m) => (
                  <label key={m.file} className="flex items-start gap-2 py-1 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chosen[p.key]?.has(m.file) ?? false}
                      onChange={(e) =>
                        setChosen((c) => {
                          const next = new Set(c[p.key] ?? []);
                          if (e.target.checked) next.add(m.file);
                          else next.delete(m.file);
                          return { ...c, [p.key]: next };
                        })
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="font-bold">{m.slug}</span>
                      <span className="text-ink-soft"> — {m.description}</span>
                    </span>
                  </label>
                ))}
                {p.skipped.length > 0 && (
                  <p className="mt-2 text-xs text-ink-soft">
                    Skipped: {p.skipped.map((s) => `${s.file} (${s.reason})`).join(", ")}
                  </p>
                )}
              </div>
            ))}
            <p className="text-xs text-ink-soft mb-3">The destination applies to a whole folder.</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={run}
                className="rounded-xl border-2 border-ink/80 bg-honey px-3 py-1.5 text-sm font-bold shadow-sticker cursor-pointer disabled:opacity-50"
              >
                {busy ? "Importing…" : "Import selected"}
              </button>
              <button type="button" onClick={onClose} className="rounded-xl border-2 border-line bg-card px-3 py-1.5 text-sm font-bold shadow-sticker cursor-pointer">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
