import type { APIRoute } from "astro";
import { markdown, orderedPages, SITE } from "../lib/pages";

/** Every page's Markdown in one file, in sidebar order, each with its web address. */
export const GET: APIRoute = async () =>
  new Response(
    (await orderedPages())
      .map(({ page }) => `${markdown(page)}\nSource: ${SITE}/${page.id === "index" ? "" : `${page.id}/`}\n`)
      .join("\n---\n\n"),
  );
