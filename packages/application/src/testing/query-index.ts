import { DatabaseSync } from 'node:sqlite';
import {
  createVaultPath,
  indexablePropertiesOf,
  noteTags,
  relationsOf,
  resolveWikiLinkTarget,
  splitFrontmatter,
  TAGS_KEY,
} from '@atlas/domain';
import type { IndexPort, QueryResult } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';

/**
 * The index tables an Atlas query reads — `files`, `props`, `relations`,
 * `tags` — filled from notes the way refreshing the index fills them, so a
 * compiled query runs for real. Titles are the note's name without its folder
 * and `.md`; a note's frontmatter `title:` renames it, as the index's does.
 * Test support only.
 */
export function atlasQueryIndex({
  files,
  markdown,
  modified = {},
}: {
  files: Readonly<Record<string, string>>;
  markdown: MarkdownPort;
  /** When each note last changed, in milliseconds; 1 for a note not named. */
  modified?: Readonly<Record<string, number>>;
}): IndexPort['query'] {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                        modified INTEGER NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
                        value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
                            target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);
    CREATE TABLE tags (path TEXT NOT NULL, idx INTEGER NOT NULL, tag TEXT NOT NULL, name TEXT NOT NULL);`);
  const paths = Object.keys(files).map(createVaultPath);
  for (const [path, text] of Object.entries(files)) {
    addNote(database, {
      path,
      text,
      modified: modified[path] ?? 1,
      markdown,
      resolve: (target) => resolveWikiLinkTarget(target, paths),
    });
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

function addNote(
  database: DatabaseSync,
  {
    path,
    text,
    modified,
    markdown,
    resolve,
  }: {
    path: string;
    text: string;
    modified: number;
    markdown: MarkdownPort;
    resolve: (target: string) => string | null;
  },
): void {
  const document = splitFrontmatter(text);
  const properties = markdown.frontmatterProperties(document.frontmatter);
  const named = typeof properties['title'] === 'string' ? properties['title'] : null;
  const title = named ?? path.replace(/^.*\//, '').replace(/\.md$/i, '');
  database.prepare('INSERT INTO files VALUES (?, ?, ?, ?, 1)').run(path, title, '', modified);
  for (const row of indexablePropertiesOf(properties)) {
    database
      .prepare('INSERT INTO props VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(path, row.key, row.index, row.text, row.number, row.date, row.json);
  }
  for (const row of relationsOf(properties, resolve)) {
    database
      .prepare('INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?)')
      .run(path, row.key, row.index, row.target, row.name, row.path);
  }
  const tags = noteTags({
    tagsProperty: properties[TAGS_KEY],
    body: document.body,
    ranges: markdown.textRanges(document.body),
  });
  tags.forEach((tag, at) =>
    database.prepare('INSERT INTO tags VALUES (?, ?, ?, ?)').run(path, at, tag.key, tag.name),
  );
}
