import { getCollection, type CollectionEntry } from "astro:content";
import sidebar from "../../sidebar.json";

export const SITE = "https://happyvibe.dev/docs";
export type Page = CollectionEntry<"docs">;
type Item = string | { label: string; items: string[] };

/** Every page with the sidebar section it sits in: the docs home first, then sidebar order. */
export async function orderedPages(): Promise<Array<{ section: string; page: Page }>> {
  const byId = new Map((await getCollection("docs")).map((p) => [p.id, p]));
  const out: Array<{ section: string; page: Page }> = [{ section: "", page: byId.get("index")! }];
  for (const item of sidebar as Item[]) {
    const [section, ids] = typeof item === "string" ? [byId.get(item)!.data.title, [item]] : [item.label, item.items];
    for (const id of ids) out.push({ section, page: byId.get(id)! });
  }
  return out;
}

/** What an agent reads: the page's own Markdown, under its title, without HTML comments (media TODOs). */
export const markdown = (p: Page): string =>
  `# ${p.data.title}\n\n${(p.body ?? "").replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n?/gm, "").trim()}\n`;
