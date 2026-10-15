import { compileMadeItemsQuery, createVaultPath, noteTitle, type MadeItem } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

/**
 * Every task made from a meeting's item, in the vault and the Archive, as the
 * index holds them now. The index can lag a write made a moment ago: the
 * declared step also reads the meeting's own linked tasks for that.
 */
export async function readMadeItems(index: Pick<IndexPort, 'query'>): Promise<MadeItem[]> {
  const { sql, parameters } = compileMadeItemsQuery();
  const result = await index.query(sql, parameters);
  const [path, key, title] = ['path', 'key', 'title'].map((name) => result.columns.indexOf(name));
  return result.rows.flatMap((row) => {
    const item = row[key!];
    const at = row[path!];
    if (typeof item !== 'string' || typeof at !== 'string') return [];
    const kept = row[title!];
    return [{ key: item, title: typeof kept === 'string' ? kept : noteTitle(createVaultPath(at)) }];
  });
}
