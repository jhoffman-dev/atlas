import { DatabaseSync } from 'node:sqlite';
import { noteTags, splitFrontmatter, TAGS_KEY } from '@atlas/domain';
import type { IndexPort, QueryResult } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';

/**
 * The index's `files` and `tags` tables, filled from notes the way refreshing
 * the index fills them, answering the tag queries with real SQL. Titles are
 * the note's name without its folder and `.md`, as the index's are for a note
 * with no title of its own.
 */
export function tagIndexQuery({
  files,
  markdown,
}: {
  files: Readonly<Record<string, string>>;
  markdown: MarkdownPort;
}): IndexPort['query'] {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                        modified INTEGER NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE tags (path TEXT NOT NULL, idx INTEGER NOT NULL, tag TEXT NOT NULL,
                       name TEXT NOT NULL);`);
  for (const [path, text] of Object.entries(files)) {
    const title = path.replace(/^.*\//, '').replace(/\.md$/i, '');
    database.prepare('INSERT INTO files VALUES (?, ?, ?, 1, 1)').run(path, title, '');
    const document = splitFrontmatter(text);
    const tags = noteTags({
      tagsProperty: markdown.frontmatterProperties(document.frontmatter)[TAGS_KEY],
      body: document.body,
      ranges: markdown.textRanges(document.body),
    });
    tags.forEach((tag, at) =>
      database.prepare('INSERT INTO tags VALUES (?, ?, ?, ?)').run(path, at, tag.key, tag.name),
    );
  }
  return async (sql, parameters): Promise<QueryResult> => {
    const statement = database.prepare(sql);
    const rows = statement.all(...parameters) as Record<string, unknown>[];
    const columns = statement.columns().map((column) => column.name);
    return {
      columns,
      rows: rows.map((row) => columns.map((column) => row[column])),
      truncated: false,
    };
  };
}
