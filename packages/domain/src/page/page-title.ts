/** Where the title on a note's page came from, which is also where an edit to it goes. */
export type PageTitleSource = 'property' | 'file';

export interface PageTitle {
  readonly text: string;
  readonly source: PageTitleSource;
}

/** The frontmatter key a note can name itself with, apart from its filename. */
export const TITLE_KEY = 'title';

/**
 * The title a note's page shows — and the one it is listed under everywhere
 * else: search, the sidebar, a type's table, views, tabs. One rule, so the
 * name typed at the top of a page is the name every list shows (U-09). A
 * heading in the body is never the name: the page head does not show it.
 *
 * A note that gives itself a `title` is headed by it — a task filed as
 * `A15-03.md` is read as what it is about, not by its id. Otherwise the
 * filename is the title. Either way, editing the title changes the same thing
 * that supplied it.
 */
export function pageTitle({
  fileTitle,
  properties,
}: {
  fileTitle: string;
  properties: Readonly<Record<string, unknown>>;
}): PageTitle {
  const declared = properties[TITLE_KEY];
  if (typeof declared === 'string' && declared.trim() !== '') {
    return { text: declared.trim(), source: 'property' };
  }
  return { text: fileTitle, source: 'file' };
}

/**
 * Whether a property row would only repeat the page's title. The `title`
 * property is hidden when it is what heads the page — it is edited there, and
 * a second copy below it is noise.
 */
export function duplicatesTitle({
  key,
  value,
  title,
}: {
  key: string;
  value: unknown;
  title: string;
}): boolean {
  return key === TITLE_KEY && typeof value === 'string' && value.trim() === title.trim();
}
