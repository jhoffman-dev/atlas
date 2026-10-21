import { outsideArchiveSql } from '../archive/archive.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { userSpaceNoteSql } from '../vault/vault-visibility.ts';

/** What every {@link compileLinkHintsQuery} statement starts with, so a log or a stand-in index can tell it apart. */
export const LINK_HINTS_QUERY_MARK = '/* link hints';

/** The frontmatter keys a note's other names are written under, as Obsidian writes them. */
export const ALIAS_KEYS = ['aliases', 'alias'] as const;

/**
 * The rows one statement asks for: the host answers at most this many (its
 * row cap), so a read pages at this size until a page comes back short.
 */
export const LINK_HINTS_PAGE_SIZE = 5000;

/**
 * The three things a link field's suggestions read beyond a relation's own
 * notes (#465), each its own statement, read a page at a time:
 *
 * - `notes` — every note of the vault's own and not archived, by `path` and
 *   `text` (its title): what `[[` in a plain text field offers, there being no type to
 *   keep to;
 * - `aliases` — each alias a note gives itself, as `text`;
 * - `uses` — for each note a relation links, how many links point at it
 *   (`uses`) and when the latest note holding one last changed (`last`),
 *   counting only links from the vault's own notes: none from a template,
 *   a hidden folder or the Archive.
 *
 * Each is ordered by something unique, so the pages neither skip nor repeat a
 * row. Read from the index's own tables, so they are what the files say.
 */
export type LinkHintsPart = 'notes' | 'aliases' | 'uses';

/**
 * The columns every part comes back as, in order — the same for each, so one
 * reader takes them all: what the row is (`kind`: `note`, `alias` or `use`),
 * the note's `path`, its title or alias (`text`), and for a use its `uses`
 * and `last`; NULL where a part has nothing to say.
 */
export const LINK_HINTS_QUERY_COLUMNS = ['kind', 'path', 'text', 'uses', 'last'] as const;

/** The `kind` each part's rows carry. */
export const LINK_HINTS_KIND: Readonly<Record<LinkHintsPart, string>> = {
  notes: 'note',
  aliases: 'alias',
  uses: 'use',
};

const STATEMENTS: Readonly<Record<LinkHintsPart, string>> = {
  notes: [
    `${LINK_HINTS_QUERY_MARK}:notes */ SELECT 'note' AS "kind", files.path AS "path",`,
    `  files.title AS "text", NULL AS "uses", NULL AS "last"`,
    `FROM files WHERE ${userSpaceNoteSql('files.path')} AND ${outsideArchiveSql('files.path')}`,
    `ORDER BY files.path LIMIT ? OFFSET ?`,
  ].join('\n'),
  aliases: [
    `${LINK_HINTS_QUERY_MARK}:aliases */ SELECT 'alias' AS "kind", props.path AS "path",`,
    `  props.value_text AS "text", NULL AS "uses", NULL AS "last"`,
    `FROM props WHERE props.key IN (${ALIAS_KEYS.map(() => '?').join(', ')})`,
    `  AND props.value_text IS NOT NULL AND props.value_text <> ''`,
    `ORDER BY props.path, props.key, props.idx LIMIT ? OFFSET ?`,
  ].join('\n'),
  uses: [
    `${LINK_HINTS_QUERY_MARK}:uses */ SELECT 'use' AS "kind", relations.dst AS "path",`,
    `  NULL AS "text", COUNT(*) AS "uses", MAX(files.modified) AS "last"`,
    `FROM relations JOIN files ON files.path = relations.src`,
    `WHERE relations.dst IS NOT NULL`,
    `  AND ${userSpaceNoteSql('relations.src')} AND ${outsideArchiveSql('relations.src')}`,
    `GROUP BY relations.dst ORDER BY relations.dst LIMIT ? OFFSET ?`,
  ].join('\n'),
};

const BOUND: Readonly<Record<LinkHintsPart, readonly string[]>> = {
  notes: [],
  aliases: [...ALIAS_KEYS],
  uses: [],
};

/** One page of one part of what link suggestions read (#465). */
export function compileLinkHintsQuery(part: LinkHintsPart, page: number): CompiledQuery {
  return {
    sql: STATEMENTS[part],
    parameters: [...BOUND[part], LINK_HINTS_PAGE_SIZE, page * LINK_HINTS_PAGE_SIZE],
  };
}
