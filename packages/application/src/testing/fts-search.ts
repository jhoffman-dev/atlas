import { splitFrontmatter } from '@dfai/domain';
import type { IndexPort, SearchHit } from '../index/ports.ts';
import { DatabaseSync } from './node-sqlite.ts';

/**
 * The index's full-text search, as the host runs it: an FTS5 table over each
 * note's path, title and body, tokenized as the host's is, ranked by bm25,
 * with the scope's prefix left out. Bodies are the text after the
 * frontmatter, markup and all. Test support only.
 */
export function ftsSearch(files: Readonly<Record<string, string>>): IndexPort['search'] {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "CREATE VIRTUAL TABLE fts USING fts5(path, title, body, tokenize = 'unicode61 remove_diacritics 2')",
  );
  const insert = database.prepare('INSERT INTO fts (path, title, body) VALUES (?, ?, ?)');
  for (const [path, text] of Object.entries(files)) {
    insert.run(path, path.replace(/^.*\//, '').replace(/\.md$/i, ''), splitFrontmatter(text).body);
  }
  const search = database.prepare(
    `SELECT path, title, snippet(fts, 2, '<<', '>>', '…', 12) AS snippet FROM fts
     WHERE fts MATCH ? AND lower(substr(path, 1, length(?))) <> lower(?)
     ORDER BY bm25(fts), path LIMIT ?`,
  );
  return async (query, limit, scope = {}) => {
    const skip = scope.skipPrefix ?? '\u0000';
    return search.all(query, skip, skip, limit) as unknown as SearchHit[];
  };
}
