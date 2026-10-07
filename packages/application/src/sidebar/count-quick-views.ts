import {
  compileViewQuery,
  parseSavedView,
  queryRowLimit,
  splitFrontmatter,
  type QuickView,
  type QuickViewId,
  type ViewQuery,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * How many notes each quick view holds right now, for the count beside it.
 *
 * Each view is read from its file rather than from what the catalogue kept:
 * the index only hands back a view's marks, and counting a view without its
 * filters would count the wrong thing. A view that cannot be read or run gets
 * no count — the row still opens it, which is where its error belongs.
 *
 * The index counts, rather than handing back every row to be counted here, and
 * the count stops at the view's limit: the number beside a view is how many it
 * shows when opened.
 */
export async function countQuickViews({
  fs,
  markdown,
  index,
  quick,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  quick: readonly QuickView[];
}): Promise<ReadonlyMap<QuickViewId, number>> {
  if (quick.length === 0) return new Map();

  let files;
  try {
    files = await fs.readNotes(quick.map((view) => view.entry.path));
  } catch {
    // Unreadable right now — mid-rename, say. No counts is the honest answer.
    return new Map();
  }
  const textOf = new Map(files.map((file) => [file.path, file.text]));

  const counted = await Promise.all(
    quick.map(async ({ id, entry }) => {
      const text = textOf.get(entry.path);
      const query =
        text === undefined
          ? null
          : parseSavedView(markdown.frontmatterProperties(splitFrontmatter(text).frontmatter));
      if (query === null) return null;
      try {
        return [id, await countView(index, query)] as const;
      } catch {
        // The view's own page reports why it cannot run; the count just stays off.
        return null;
      }
    }),
  );

  return new Map(counted.filter((pair) => pair !== null));
}

async function countView(index: IndexPort, query: ViewQuery): Promise<number> {
  const { sql, parameters } = compileViewQuery(query, {
    aggregate: { kind: 'count', column: null },
  });
  const result = await index.query(sql, parameters);
  const counted = Number(result.rows[0]?.[0] ?? 0);
  return Math.min(counted, queryRowLimit(query.limit));
}
