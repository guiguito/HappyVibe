import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting, HighlightStyle, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";

/**
 * W2.2 — the CodeMirror 6 editor. This module is the HEAVY chunk: FileTab
 * loads it with React.lazy(() => import(...)) so the chat path never pays
 * for CodeMirror. Theme is hand-rolled from the warm-workshop tokens in
 * styles.css (no themes package).
 */

// ── language by extension ────────────────────────────────────────────
const STATIC_LANGS: Record<string, () => LanguageSupport> = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  py: () => python(),
  md: () => markdown({ codeLanguages: languages }),
  markdown: () => markdown({ codeLanguages: languages }),
  json: () => json(),
  html: () => html(),
  htm: () => html(),
  css: () => css(),
};

const ext = (path: string): string => path.split(".").pop()?.toLowerCase() ?? "";

// ── warm-workshop theme (tokens mirror styles.css @theme) ────────────
const hvTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "#fffcf5", // card
    color: "#33251a", // ink
  },
  ".cm-content": {
    fontFamily: '"JetBrains Mono Variable", ui-monospace, "SF Mono", monospace',
    caretColor: "#ee5a24", // tangerine
    padding: "10px 0",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ee5a24", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "#f5a62355", // honey
  },
  ".cm-activeLine": { backgroundColor: "#f2e7d266" }, // paper-deep
  ".cm-gutters": {
    backgroundColor: "#faf4e8", // paper
    color: "#8d7a63", // ink-soft
    border: "none",
    borderRight: "2px solid #e3d3b8", // line
    fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
  },
  ".cm-activeLineGutter": { backgroundColor: "#f2e7d2", color: "#33251a" },
  ".cm-matchingBracket": { backgroundColor: "#f5a62344", outline: "1px solid #cbb693" },
  ".cm-scroller": { overflow: "auto" },
  // v5.1: style the built-in search panel to the warm-workshop look.
  ".cm-panels": { backgroundColor: "#faf4e8", color: "#33251a" }, // paper / ink
  ".cm-panels.cm-panels-top": { borderBottom: "2px solid #e3d3b8" }, // line
  ".cm-panel.cm-search": { padding: "8px 10px", fontFamily: '"Gabarito Variable", ui-sans-serif, system-ui, sans-serif' },
  ".cm-panel.cm-search label": { fontSize: "12px", color: "#8d7a63", display: "inline-flex", alignItems: "center", gap: "3px" },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "#ee5a24" },
  ".cm-textfield": {
    backgroundColor: "#fffcf5", // card
    border: "2px solid #e3d3b8", // line
    borderRadius: "8px",
    padding: "3px 8px",
    color: "#33251a",
    fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
    fontSize: "12px",
  },
  ".cm-textfield:focus": { outline: "none", borderColor: "#ee5a24" }, // tangerine
  ".cm-button": {
    backgroundColor: "#fffcf5",
    backgroundImage: "none",
    border: "2px solid #e3d3b8",
    borderRadius: "8px",
    padding: "2px 10px",
    color: "#33251a",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
  ".cm-button:hover": { backgroundColor: "#f2e7d2" }, // paper-deep
  ".cm-button:active": { backgroundColor: "#e3d3b8" },
  ".cm-panel.cm-search [name=close]": { color: "#8d7a63", fontSize: "18px", cursor: "pointer" },
  ".cm-panel.cm-search [name=close]:hover": { color: "#ee5a24" },
  ".cm-searchMatch": { backgroundColor: "#f5a62355" }, // honey
  ".cm-searchMatch-selected": { backgroundColor: "#ee5a2455" }, // tangerine
});

const hvHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#cf4413", fontWeight: "600" }, // tangerine-deep
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: "#cf4413", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "#4c9a4f" }, // leaf
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#b3671f" },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: "#8d7a63", fontStyle: "italic" }, // ink-soft
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#4f83c2" }, // sky
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#8a5fb0" },
  { tag: [tags.propertyName, tags.attributeName], color: "#a2681c" },
  { tag: [tags.tagName], color: "#cf4413" },
  { tag: [tags.operator, tags.punctuation], color: "#6b5a45" },
  { tag: tags.heading, color: "#cf4413", fontWeight: "700" },
  { tag: tags.link, color: "#4f83c2", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: [tags.definition(tags.variableName)], color: "#33251a", fontWeight: "600" },
  { tag: tags.invalid, color: "#cf3f2e" }, // berry
]);

export default function CodeEditor({
  path,
  doc,
  docVersion,
  onChange,
  onSave,
  onSelectionChange,
  saveKey,
  searchKey,
}: {
  path: string;
  /** Buffer content at `docVersion` — NOT pushed per keystroke (uncontrolled between versions). */
  doc: string;
  /** Bump to replace the whole document (external reload). */
  docVersion: number;
  onChange: (text: string) => void;
  onSave: () => void;
  /**
   * Round 11: the current selection, for "Send to chat". null when nothing is
   * selected — the action must be unavailable rather than silently sending the
   * whole file (`@file` is what does that).
   */
  onSelectionChange?: (sel: { text: string; startLine: number; endLine: number } | null) => void;
  /** Round 8: resolved bindings from the shortcut registry (canonical CM form). */
  saveKey: string;
  searchKey: string;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  // Round 8: the keymap is compartmented so a rebind applies to tabs that are
  // ALREADY open — an editor tab stays mounted for the life of the app, so
  // waiting for a remount would mean waiting for a restart.
  const keysCompartment = useRef(new Compartment());
  // Fresh callbacks without rebuilding the view.
  const cbs = useRef({ onChange, onSave, onSelectionChange });
  const keymapFor = (save: string, find: string) =>
    keymap.of([
      { key: save, preventDefault: true, run: () => (cbs.current.onSave(), true) },
      { key: find, preventDefault: true, run: openSearchPanel },
      indentWithTab,
      // Drop CM's own Mod-f so a rebound search key is the only one that opens it.
      ...searchKeymap.filter((b) => b.key !== "Mod-f"),
      ...defaultKeymap,
      ...historyKeymap,
    ]);
  useEffect(() => {
    cbs.current = { onChange, onSave, onSelectionChange };
  });

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          // v5.1: ⌘F search in the editor (built-in CM panel + match highlight).
          search({ top: true }),
          highlightSelectionMatches(),
          hvTheme,
          syntaxHighlighting(hvHighlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          langCompartment.current.of([]),
          keysCompartment.current.of(keymapFor(saveKey, searchKey)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cbs.current.onChange(u.state.doc.toString());
            // Round 11: report the selection so FileTab can offer "Send to chat".
            if (u.selectionSet || u.docChanged) {
              const r = u.state.selection.main;
              cbs.current.onSelectionChange?.(
                r.empty
                  ? null
                  : {
                      text: u.state.sliceDoc(r.from, r.to),
                      startLine: u.state.doc.lineAt(r.from).number,
                      endLine: u.state.doc.lineAt(r.to).number,
                    },
              );
            }
          }),
        ],
      }),
      parent: host.current,
    });
    view.current = v;
    // Language: static support for common extensions, language-data for the rest.
    const e = ext(path);
    const staticLang = STATIC_LANGS[e];
    if (staticLang) {
      v.dispatch({ effects: langCompartment.current.reconfigure(staticLang()) });
    } else {
      const desc = languages.find((l) => l.extensions.includes(e));
      void desc?.load().then((support) => {
        if (view.current === v) v.dispatch({ effects: langCompartment.current.reconfigure(support) });
      });
    }
    return () => {
      view.current = null;
      v.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Round 8: a rebind applies live to this already-mounted view.
  useEffect(() => {
    view.current?.dispatch({ effects: keysCompartment.current.reconfigure(keymapFor(saveKey, searchKey)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveKey, searchKey]);

  // External reload — replace the whole document, keep the view.
  const lastVersion = useRef(docVersion);
  useEffect(() => {
    if (docVersion === lastVersion.current) return;
    lastVersion.current = docVersion;
    const v = view.current;
    if (v && v.state.doc.toString() !== doc) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc } });
    }
  }, [docVersion, doc]);

  return <div ref={host} className="h-full min-h-0" />;
}
