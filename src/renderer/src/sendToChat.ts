/**
 * Round 11: format an editor SELECTION for the chat composer.
 *
 * Scoped to the selection on purpose. Whole-file reference is already covered by
 * §7's `@file` autocomplete, so a second path to the same thing would be
 * duplication — what the editor can do that `@file` cannot is point at *these
 * twelve lines*.
 */

/** Fence language by extension. Unknown → a bare fence rather than a wrong hint. */
const LANG: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  py: "py", rs: "rs", go: "go", rb: "rb", java: "java", kt: "kt", swift: "swift",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "cs", php: "php",
  json: "json", jsonc: "json", md: "md", markdown: "md", css: "css", scss: "scss",
  html: "html", htm: "html", xml: "xml", yml: "yaml", yaml: "yaml", toml: "toml",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash", sql: "sql",
};

export function formatSelection(relPath: string, startLine: number, endLine: number, text: string): string {
  const where = startLine === endLine ? `${relPath}:${startLine}` : `${relPath}:${startLine}-${endLine}`;
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  const lang = LANG[ext] ?? "";
  // A selection can itself contain a fence (a markdown file, a README snippet),
  // so outrun the longest run of backticks in it rather than assuming three.
  const runs = [...text.matchAll(/`+/g)].map((m) => m[0].length);
  const fence = "`".repeat(Math.max(3, ...runs) + (runs.length ? 1 : 0));
  return `${where}\n${fence}${lang}\n${text}\n${fence}\n`;
}
