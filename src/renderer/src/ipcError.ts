/**
 * What an IPC rejection should say to a person.
 *
 * `ipcRenderer.invoke` wraps whatever main threw in its own preamble —
 * `Error invoking remote method 'hv:create-workspace-folder': Error: A project
 * name can't contain a slash.` — which buries the sentence main wrote for the
 * user behind a channel name they have never heard of.
 *
 * App's `surface()` has stripped it since round 2; this is that same expression,
 * named, so a second call site cannot re-type it slightly differently.
 */
export function ipcMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
