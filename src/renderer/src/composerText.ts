/**
 * §27/§3.4. How new text joins what is already typed — ONE definition, so
 * dictation and the editor's "Send to chat" can never drift apart.
 *
 * Appends at the END, separated by a blank line. Deliberately NOT caret-aware:
 * the original voice proposal specced insert-at-the-cursor, but `composerInsert`
 * has always appended and ignored the selection, and two insertion paths landing
 * in different places is worse for a user than either rule on its own.
 */
export function appendToComposer(prev: string, text: string): string {
  return (prev.trim() ? `${prev.replace(/\s*$/, "")}\n\n` : "") + text;
}
