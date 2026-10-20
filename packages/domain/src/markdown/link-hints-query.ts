import type { CompiledQuery } from '../query/view-query.ts';
import { userSpaceNoteSql } from '../vault/vault-visibility.ts';

/** What {@link compileLinkHintsQuery}'s statement starts with, so a log or a stand-in index can tell it apart. */
export const LINK_HINTS_QUERY_MARK = '/* link hints */';

/** The columns {@link compileLinkHintsQuery} comes back as, in order. */
export const LINK_HINTS_QUERY_COLUMNS = ['kind', 'path', 'text', 'uses', 'last'] as const;

/** The frontmatter keys a note's other names are written under, as Obsidian writes them. */
export const ALIAS_KEYS = ['aliases', 'alias'] as const;

/**
 * What a link field's suggestions read beyond a relation's own notes (#465),
 * in one statement, a row each:
 *
 * - `note` — every note of the vault's own, by `path` and `text` (its title):
 *   what `[[` in a plain text field offers, there being no type to keep to;
 * - `alias` — each alias a note gives itself, as `text`;
 * - `use` — for each note a relation links, how many links point at it
 *   (`uses`) and when the latest note holding one last changed (`last`).
 *
 * The aliases and uses are read from the index's own tables, so they are what
 * the files say: nothing is kept here that is not already in them.
 */
export function compileLinkHintsQuery(): CompiledQuery {
  return {
    sql: [
      `${LINK_HINTS_QUERY_MARK} SELECT 'note' AS "kind", files.path AS "path", files.title AS "text",`,
      `  NULL AS "uses", NULL AS "last"`,
      `FROM files WHERE ${userSpaceNoteSql('files.path')}`,
      `UNION ALL`,
      `SELECT 'alias', props.path, props.value_text, NULL, NULL FROM props`,
      `WHERE props.key IN (${ALIAS_KEYS.map(() => '?').join(', ')})`,
      `  AND props.value_text IS NOT NULL AND props.value_text <> ''`,
      `UNION ALL`,
      `SELECT 'use', relations.dst, NULL, COUNT(*), MAX(files.modified)`,
      `FROM relations JOIN files ON files.path = relations.src`,
      `WHERE relations.dst IS NOT NULL GROUP BY relations.dst`,
    ].join('\n'),
    parameters: [...ALIAS_KEYS],
  };
}
