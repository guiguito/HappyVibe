import type { APIRoute } from "astro";
import { orderedPages, SITE } from "../lib/pages";

/** llmstxt.org: a title, a one-line summary, then every page as a link to its Markdown copy. */
export const GET: APIRoute = async () => {
  const [home, ...rest] = await orderedPages();
  let out = `# HappyVibe\n\n> ${home.page.data.description}\n`;
  let section = "";
  for (const { section: s, page } of rest) {
    if (s !== section) out += `\n## ${(section = s)}\n\n`;
    out += `- [${page.data.title}](${SITE}/${page.id}.md): ${page.data.description}\n`;
  }
  return new Response(out);
};
