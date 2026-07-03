export interface UiRequest { id: string; title: string; options: string[] }

export function PermissionModal({ req, onChoice }: { req: UiRequest; onChoice: (c: string) => void }): React.JSX.Element {
  let tool = "", summary = req.title;
  try {
    const p = JSON.parse(req.title);
    if (p.kind === "hv.permission") { tool = p.tool; summary = p.summary; }
  } catch { /* plain-title prompt from another extension: render as-is */ }
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>🔐 Permission required{tool && `: ${tool}`}</h2>
        <pre>{summary}</pre>
        {req.options.map((o) => (
          <button key={o} className={o === "Deny" ? "danger" : ""} onClick={() => onChoice(o)}>{o}</button>
        ))}
      </div>
    </div>
  );
}
