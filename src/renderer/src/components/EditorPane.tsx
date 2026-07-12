import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
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
}: {
  path: string;
  /** Buffer content at `docVersion` — NOT pushed per keystroke (uncontrolled between versions). */
  doc: string;
  /** Bump to replace the whole document (external reload). */
  docVersion: number;
  onChange: (text: string) => void;
  onSave: () => void;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  // Fresh callbacks without rebuilding the view.
  const cbs = useRef({ onChange, onSave });
  useEffect(() => {
    cbs.current = { onChange, onSave };
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
          hvTheme,
          syntaxHighlighting(hvHighlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          langCompartment.current.of([]),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (cbs.current.onSave(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cbs.current.onChange(u.state.doc.toString());
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
