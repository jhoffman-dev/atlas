import {
  compileMadeItemsQuery,
  createVaultPath,
  MEETING_ITEM_KEY,
  noteTitle,
  splitFrontmatter,
  type MadeItem,
  type VaultPath,
} from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What reading the made tasks needs: the index to find them, the files to confirm them. */
export interface MadeItemsPorts {
  readonly index: Pick<IndexPort, 'query'>;
  readonly fs: Pick<VaultFsPort, 'readNotes'>;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
}

/** A task made from an item, and where it is: what a meeting's `tasks` may still have to join (#185). */
export interface MadeTaskItem extends MadeItem {
  readonly path: VaultPath;
}

/** A row of the made-items query: the task's file and the `atlas_item` the index holds for it. */
interface IndexedMade extends MadeItem {
  readonly path: string;
}

/**
 * Every task made from a meeting's item, in the vault and the Archive, that
 * is still there: the index finds them, and each is kept only while its file
 * exists and still carries that `atlas_item`, since the index can hold a task
 * a moment after it was trashed or edited. The index can also lag a write
 * made a moment ago: the declared step reads the meeting's own linked tasks
 * for that.
 */
export async function readMadeItems(ports: MadeItemsPorts): Promise<MadeTaskItem[]> {
  const indexed = await queryMadeItems(ports.index);
  if (indexed.length === 0) return [];
  const files = await ports.fs.readNotes([...new Set(indexed.map(({ path }) => path))]);
  const keysOn = new Map(files.map((file) => [file.path, itemKeysIn(ports.markdown, file.text)]));
  return indexed
    .filter(({ path, key }) => keysOn.get(path)?.has(key) === true)
    .map(({ key, title, path }) => ({ key, title, path: createVaultPath(path) }));
}

async function queryMadeItems(index: Pick<IndexPort, 'query'>): Promise<IndexedMade[]> {
  const { sql, parameters } = compileMadeItemsQuery();
  const result = await index.query(sql, parameters);
  const [path, key, title] = ['path', 'key', 'title'].map((name) => result.columns.indexOf(name));
  return result.rows.flatMap((row) => {
    const item = row[key!];
    const at = row[path!];
    if (typeof item !== 'string' || typeof at !== 'string') return [];
    const kept = row[title!];
    return [
      {
        path: at,
        key: item,
        title: typeof kept === 'string' ? kept : noteTitle(createVaultPath(at)),
      },
    ];
  });
}

/** The `atlas_item` keys a task's file carries now. */
function itemKeysIn(
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>,
  text: string,
): Set<string> {
  const value = markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)[
    MEETING_ITEM_KEY
  ];
  const values: unknown[] = Array.isArray(value) ? value : [value];
  return new Set(values.filter((each): each is string => typeof each === 'string'));
}
