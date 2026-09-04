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
  webTools: {
    title: "How web tools work",
    body:
      "Four tools let the agent use the public web as text. Search finds pages, Read returns one page as clean markdown, Site map lists a site's URLs, and Read a site reads up to 30 pages in one go. Long pages come back in pieces, and the card tells you how much of the page you got. The pages are fetched by a web service, not by your computer, so sites see the service's address rather than yours. With the default service that is a server HappyVibe operates, which can see the URLs and the searches the agent sends — point the app at your own service below if that matters to you. Reading a new site asks you first, using the same rules as the agent's browser: “Allow for this session”, or a rule for that site, covers both from then on. The Allow button on a blocked browser page is narrower — it clears that one page's site for that browser pane only. Everything a page returns is marked as untrusted, so words on a web page can never pose as instructions from you. What these tools cannot do: take screenshots, click anything, or open pages that need you to be signed in — the agent's browser does all three. And there is no way to ask for recent results only.",
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
      <p className="text-xs leading-relaxed text-ink-soft">{body}</p>
    </details>
  );
}
