/**
 * A Notion page id, dashed (`a1000000-0000-4000-…`) or not, anywhere in a file
 * name, a relative link or a notion.so address. The last one in the text is
 * the page's: a path names its folders' pages first.
 */
const PAGE_ID =
  /(?<![0-9a-f])[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?![0-9a-f])/gi;

/** The page id in the text, as the vault's `notion_id` holds it: 32 hex digits, lower case, no dashes. */
export function notionIdIn(text: string): string | null {
  // `%20` before an id would run its hex digits into the id's: no escape is part of one.
  const last = [...text.replace(/%[0-9a-f]{2}/gi, ' ').matchAll(PAGE_ID)].at(-1)?.[0];
  return last === undefined ? null : last.replace(/-/g, '').toLowerCase();
}

/** A `notion_id` as some note wrote it, or null when it is not one. */
export function notionIdOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = notionIdIn(value.trim());
  return id !== null && id.length === value.trim().replace(/-/g, '').length ? id : null;
}

/** One page a relation cell names: its title, and its id when the cell links it. */
export interface RelationEntry {
  readonly title: string;
  readonly id: string | null;
}

/** A link in brackets after a title: no spaces (Notion writes them `%20`), a page id inside. */
const LINKED =
  /\s*\(([^()\s]*[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}[^()\s]*)\)/gi;

/**
 * The pages a relation cell names. Notion writes each as `Title (link)` —
 * a path to the page's file, or its notion.so address — separated by commas,
 * which a title may also hold; a cell with no links is titles separated by
 * commas, which is the best that can be read from it.
 */
export function readRelation(cell: string): RelationEntry[] {
  const links = [...cell.matchAll(LINKED)];
  if (links.length === 0) {
    return cell
      .split(',')
      .map((title) => title.trim())
      .filter((title) => title !== '')
      .map((title) => ({ title, id: null }));
  }
  let from = 0;
  return links.map((link) => {
    const title = cell.slice(from, link.index).replace(/^\s*,/, '').trim();
    from = link.index + link[0].length;
    return { title, id: notionIdIn(link[1] ?? '') };
  });
}

/** A multi-select cell's options: Notion separates them with commas. */
export const readOptions = (cell: string): string[] =>
  cell
    .split(',')
    .map((option) => option.trim())
    .filter((option) => option !== '');
