/** Icon-titled section, matching the Settings page style. Shared by the four
    pages split out of the old combined "Skills, MCP, Agents & Tools" view
    (Skills / MCP / Agents / All Tools) so it isn't copy-pasted four times. */
const SECTION_ICONS: Record<string, React.JSX.Element> = {
  mcp: (
    <>
      <path d="M4 12l8-8 8 8-8 8z" />
      <path d="M8 12l4-4 4 4-4 4z" />
    </>
  ),
  skills: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
  tools: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.6-.6-2.5z" />,
  agents: (
    <>
      <rect x="5" y="8" width="14" height="10" rx="2" />
      <path d="M12 4v4M9 13h.01M15 13h.01M2 12h3M19 12h3" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </>
  ),
};

export function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg p-6 mb-6">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="size-8 rounded-lg bg-paper-deep border-2 border-line flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {SECTION_ICONS[icon]}
          </svg>
        </div>
        <h2 className="font-bold text-lg">{title}</h2>
      </div>
      <p className="text-sm text-ink-soft mb-4">{subtitle}</p>
      {children}
    </section>
  );
}
