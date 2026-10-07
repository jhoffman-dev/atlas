import {
  compileTagCountsQuery,
  compileTaggedNotesQuery,
  compileTagUsesQuery,
  createVaultPath,
  TAG_PAGE_SIZE,
  type TagCount,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort, QueryResult } from '../index/ports.ts';

/** A note using a tag, and how many times. */
export interface TaggedNote {
  readonly path: VaultPath;
  readonly title: string;
  readonly count: number;
}

type Row = Readonly<Record<string, unknown>>;

function rowsOf(result: QueryResult): Row[] {
  return result.rows.map((values) =>
    Object.fromEntries(result.columns.map((column, at) => [column, values[at]])),
  );
}

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

/**
 * Every tag in the vault with how often it is used, read from the index a
 * page at a time. The index is rebuilt from the files, so a tag whose last
 * use was deleted is simply not in it. Uses in archived notes count only
 * when `includeArchived` asks for them.
 */
export async function loadTagCounts({
  index,
  includeArchived = false,
}: {
  index: IndexPort;
  includeArchived?: boolean;
}): Promise<TagCount[]> {
  const counts: TagCount[] = [];
  for (let page = 0; ; page += 1) {
    const { sql, parameters } = compileTagCountsQuery(page, { includeArchived });
    const result = await index.query(sql, parameters);
    const rows = rowsOf(result);
    counts.push(
      ...rows.map((row) => ({
        key: text(row['key']),
        name: text(row['name']),
        count: Number(row['count'] ?? 0),
      })),
    );
    if (rows.length < TAG_PAGE_SIZE && !result.truncated) return counts;
  }
}

/**
 * Every tag used in the notes `includes` accepts, with how often, shown as the
 * first of those notes by path spells it: {@link loadTagCounts} for part of the
 * vault. Archived notes only with `includeArchived`.
 */
export async function loadTagCountsWhere({
  index,
  includes,
  includeArchived = false,
}: {
  index: IndexPort;
  includes: (path: VaultPath) => boolean;
  includeArchived?: boolean;
}): Promise<TagCount[]> {
  const counts = new Map<string, TagCount>();
  for (let page = 0; ; page += 1) {
    const { sql, parameters } = compileTagUsesQuery(page, { includeArchived });
    const result = await index.query(sql, parameters);
    const rows = rowsOf(result);
    for (const row of rows.filter((use) => includes(createVaultPath(text(use['path']))))) {
      const key = text(row['key']);
      const known = counts.get(key);
      const count = (known?.count ?? 0) + Number(row['count'] ?? 0);
      counts.set(key, { key, name: known?.name ?? text(row['name']), count });
    }
    if (rows.length < TAG_PAGE_SIZE && !result.truncated) break;
  }
  return [...counts.values()].sort((left, right) => (left.key < right.key ? -1 : 1));
}

/**
 * The notes using a tag or one nested under it, by title — every one of
 * them, read a page at a time, since a rename planned from a page would
 * leave the rest with the old name. Archived notes only with `includeArchived`.
 */
export async function loadTaggedNotes({
  index,
  key,
  includeArchived = false,
}: {
  index: IndexPort;
  key: string;
  includeArchived?: boolean;
}): Promise<TaggedNote[]> {
  const notes: TaggedNote[] = [];
  for (let page = 0; ; page += 1) {
    const { sql, parameters } = compileTaggedNotesQuery(key, page, { includeArchived });
    const result = await index.query(sql, parameters);
    const rows = rowsOf(result);
    notes.push(
      ...rows.map((row) => ({
        path: createVaultPath(text(row['path'])),
        title: text(row['title']),
        count: Number(row['count'] ?? 0),
      })),
    );
    if (rows.length < TAG_PAGE_SIZE && !result.truncated) return notes;
  }
}
