import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { markdown, type Page } from "../lib/pages";

/** /docs/mcp.md beside /docs/mcp/: the page as plain Markdown, for agents. */
export async function getStaticPaths() {
  return (await getCollection("docs")).map((page) => ({ params: { slug: page.id }, props: { page } }));
}

export const GET: APIRoute = ({ props }) => new Response(markdown((props as { page: Page }).page));
