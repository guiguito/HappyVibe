/**
 * §20 round 17 — the deleted Help page, dissolved in place.
 *
 * Round 8 removed the Help nav entry on purpose: a four-step checklist did not
 * earn a permanent seat. The audit agreed, and found five concepts with no home
 * at any depth. So each one lives as a collapsed native `<details>` inside the
 * section it explains — the McpCatalogSection precedent, no disclosure state to
 * manage. Never a modal, never a tour, never a nav entry.
 *
 * Principle 11 governs this file: guidance that describes a gate is DERIVED
 * from that gate. `tests/how-it-works.test.ts` asserts the plan-mode text
 * against `BLOCKED_PLAN_TOOLS` and the instruction-file order against Pi's own
 * `resource-loader.js`, because the alternative is finding 13 — a sentence that
 * was true when written, false for months after, and failing nothing.
 */
export const HOWTO_COPY = {
  planMode: {
    title: "How plan mode works",
    body:
      "Plan mode makes the whole session read-only. The agent can read, search and explore; edits, writes, installs, commits and anything that changes your project are blocked. Read-only wins over everything else — over a permission rule that says allow, and over Bypass all permissions too. Handing work to a sub-agent still works, because reading a large codebase is exactly what planning is for; it asks you to approve that sub-agent's boundary first. The plan is a real markdown file in your project under .agents/plans/, so you can read it, edit it, and keep it after the session ends. Only you can implement it or leave plan mode — the agent has no button for either. Tip: planning loves your smartest model.",
  },
  rules: {
    title: "How rules combine",
    body:
      "Three layers answer every tool call: your global rules, this workspace's rules, and any grants you have given the running session. The most restrictive answer wins — deny beats ask, ask beats allow — so a workspace rule can tighten a global allow, but it can never loosen a global deny. When no rule matches, the app asks you; nothing is ever allowed by silence. “Allow for this session” lives in memory only, so it is gone when the session restarts — which also happens when you change MCP configuration.",
  },
  mcpBadge: {
    title: "What the badge means",
    body:
      "This badge is HappyVibe's own probe: the app connects to the server itself, checks that it answers, and lists its tools. Your agent's connection is a different one, made when a session starts. So a red badge does not mean the running session lost those tools, and a green one is not proof that it has them. Changing a server restarts your sessions so they pick it up.",
  },
  contextNumbers: {
    title: "How these numbers are measured",
    body:
      "Two kinds of number live here. The gauge is measured — it is what the model itself reported for the last turn. Everything in the breakdown is estimated, at roughly one token per four characters, because nothing reports a per-item cost. Right after the conversation is compacted there is no measured figure at all, so the gauge says “measuring…” rather than showing you a zero it would have made up.",
  },
  worktrees: {
    title: "What a worktree is",
    body:
      "A worktree is a second copy of this project's files, on its own branch, in its own folder — so an agent can work there without touching what you have open here. Its settings are the project's: the same model, the same permissions, the same memory. Its files are its own. HappyVibe keeps the ones it makes in its own data folder rather than inside your project, so they never show up as changes to save. Make one from the branch menu in Changes, and finish it from the same panel: merge it back, open a pull request, or remove it.",
  },
  crashReports: {
    title: "What a crash report contains",
    body:
      "A report says what kind of failure it was, the error\u2019s type, where in HappyVibe\u2019s own code it happened, your version and your operating system.\n\nIt never contains your prompts, your files, your file names, your paths or your keys. Error messages are redacted before they leave.\n\nNative crashes leave a snapshot on your computer. Nothing uploads it \u2014 Reveal shows you the folder.\n\nEvery send is listed in your Audit log. Turning this off stops reporting immediately and drops anything still queued.",
  },
  webTools: {
    title: "How web tools work",
    body:
      "Four tools let the agent use the public web as text. Search finds pages, Read returns one page as clean markdown, Site map lists a site's URLs, and Read a site reads up to 30 pages in one go. Long pages come back in pieces, and the card tells you how much of the page you got. The pages are fetched by a web service, not by your computer, so sites see the service's address rather than yours. With the default service that is a server HappyVibe operates, which can see the URLs and the searches the agent sends — point the app at your own service below if that matters to you. Reading a new site asks you first, using the same rules as the agent's browser: “Allow for this session”, or a rule for that site, covers both from then on. The Allow button on a blocked browser page is narrower — it clears that one page's site for that browser pane only. Everything a page returns is marked as untrusted, so words on a web page can never pose as instructions from you. What these tools cannot do: take screenshots, click anything, or open pages that need you to be signed in — the agent's browser does all three. And there is no way to ask for recent results only.",
  },
  memory: {
    title: "How memory works",
    body:
      "The agent keeps two sets of notes: global ones about you, which apply in every project, and workspace ones about a single project. " +
      "Every turn it is shown a one-line summary of each note — that is all the notes cost until it opens one, which it does only when the summary looks relevant. " +
      "Saving a memory and forgetting one both ask you first, and the question shows the note itself rather than raw data; if it is replacing a note you already have, you see what changes. " +
      "Opening a note never asks, because you can read every one of them on this page anyway. " +
      "Notes are hints, not facts: the agent is told to check anything that might have changed before acting on it. " +
      "It will not save anything that looks like a password, a key or a token — that is refused with a reason rather than trusted to good manners. " +
      "Each set holds at most 100 notes, so when one fills up the agent has to merge or drop before it can add. " +
      "They are ordinary text files kept on this computer, and nothing is sent anywhere or shared with anyone you work with — use AGENTS.md for what a team should know.",
  },
  instructionFiles: {
    title: "How instruction files combine",
    body:
      "They all get read, in a fixed order, and stack up: first the one in your global agent folder, then every folder from the top of your filesystem down to your project — so the closest file is read last. Inside each folder only one file counts. Pi takes the first that exists of AGENTS.override.md, AGENTS.md, AGENTS.MD, CLAUDE.md, CLAUDE.MD and ignores the others, which is why a CLAUDE.md sitting beside an AGENTS.md is never read. HappyVibe adds one thing on top: a nested AGENTS.md deeper in your project is supplied for the turns where a tool touches that subtree. All of them are read once, when a session starts — so an edit applies to new or restarted sessions, not the one you are in.",
  },
} as const;

export function HowItWorks({ copy }: { copy: keyof typeof HOWTO_COPY }): React.JSX.Element {
  const { title, body } = HOWTO_COPY[copy];
  return (
    /* ponytail: native <details> — no disclosure state to manage. */
    <details className="mt-3 group [&[open]>summary]:mb-2">
      <summary className="cursor-pointer select-none text-xs font-bold text-ink-soft hover:text-ink">
        {title}
      </summary>
      {/* A blank line starts a new paragraph. Every entry written before this
          was one block and still renders as one, but a wall of small grey text
          reads as a justification rather than an explanation — which is the
          note §37's copy came back with. */}
      {body.split("\n\n").map((para) => (
        <p key={para.slice(0, 24)} className="text-xs leading-relaxed text-ink-soft mb-2 last:mb-0">
          {para}
        </p>
      ))}
    </details>
  );
}
