import { outsideArchiveSql } from '../archive/archive.ts';
import { LITERATURE_NOTE_TYPE } from '../highlights/literature-note.ts';
import { outsideAtlasSql, type CompiledQuery } from '../query/view-query.ts';
import { FILED_UNDER_KEY } from '../types/para.ts';

/*
 * What the Library and All highlights read from the index (#507): every
 * literature note (ADR-0043), and every highlight in one, a page at a time.
 * Both read the index's own tables, so they are the same on every Mac and
 * cost one statement per page, however many notes there are.
 */

/** What the Library's statement starts with, so a log or a stand-in index can tell it apart. */
export const LIBRARY_QUERY_MARK = '/* research:library */';

/** What All highlights' statement starts with. */
export const HIGHLIGHTS_QUERY_MARK = '/* research:highlights */';

/** Literature notes per page: the host hands back at most 5,000 rows at once. */
export const LIBRARY_PAGE_SIZE = 5000;

/**
 * Highlights per page. Each row carries up to {@link HIGHLIGHT_TEXT_LIMIT}
 * characters of quote and of comment, which at three bytes a character keeps
 * a page under the host's 16 MB answer.
 */
export const HIGHLIGHTS_PAGE_SIZE = 4000;

/** How much of a quote or a comment the list reads: three lines' worth and more. */
export const HIGHLIGHT_TEXT_LIMIT = 500;

/** Parts a list column is joined with: they cannot be typed in a tag or a title. */
export const LIST_SEPARATOR = '\u001f';
export const PAIR_SEPARATOR = '\u001e';

/** The columns {@link compileLibraryQuery} comes back as, in order. */
export const LIBRARY_QUERY_COLUMNS = [
  'path',
  'title',
  'modified',
  'author',
  'kind',
  'cover',
  'highlights',
  'tags',
  'projects',
] as const;

/** The columns {@link compileHighlightsQuery} comes back as, in order. */
export const HIGHLIGHTS_QUERY_COLUMNS = [
  'path',
  'idx',
  'id',
  'kind',
  'quote',
  'comment',
  'mark',
  'color',
  'page',
  'location',
] as const;

/** A literature note, as `isLiteratureNote` reads its `type`: trimmed, any case. */
const IS_LITERATURE = `EXISTS (SELECT 1 FROM props AS typed WHERE typed.path = files.path
    AND typed.key = 'type' AND lower(trim(typed.value_text)) = '${LITERATURE_NOTE_TYPE}')`;

/** A note's first value for `key`, as text. */
const firstValue = (key: string) =>
  `(SELECT value.value_text FROM props AS value WHERE value.path = files.path AND value.key = '${key}'
    ORDER BY value.idx LIMIT 1)`;

/** A note's tags, each once, by key, joined. */
const TAG_KEYS = `(SELECT group_concat(used.tag, char(31)) FROM
    (SELECT DISTINCT tags.tag AS tag FROM tags WHERE tags.path = files.path ORDER BY tags.tag) AS used)`;

/** In use: never one of DFAI's own files, nor one out of the way in the Archive (U-22). */
const IN_USE = `${outsideAtlasSql('files.path')} AND ${outsideArchiveSql('files.path')}`;

/**
 * One page of every literature note in use: its title, when it last changed,
 * its author, kind and cover as its frontmatter says them, how many
 * highlights it holds, its tags, and the projects it is filed under, each as
 * the note it resolves to and its title (or the link as written, when it
 * resolves to none). Columns: {@link LIBRARY_QUERY_COLUMNS}; in path order.
 */
export function compileLibraryQuery(page: number): CompiledQuery {
  return {
    sql: [
      `${LIBRARY_QUERY_MARK} SELECT files.path AS "path", files.title AS "title",`,
      `  files.modified AS "modified", ${firstValue('author')} AS "author",`,
      `  ${firstValue('kind')} AS "kind", ${firstValue('cover')} AS "cover",`,
      `  (SELECT count(*) FROM highlights WHERE highlights.path = files.path) AS "highlights",`,
      `  ${TAG_KEYS} AS "tags",`,
      `  (SELECT group_concat(coalesce(filed.dst, '') || char(30) || coalesce(project.title, filed.target), char(31))`,
      `    FROM relations AS filed LEFT JOIN files AS project ON project.path = filed.dst`,
      `    WHERE filed.src = files.path AND filed.key = '${FILED_UNDER_KEY}') AS "projects"`,
      `FROM files WHERE ${IS_LITERATURE} AND ${IN_USE}`,
      `ORDER BY files.path LIMIT ? OFFSET ?`,
    ].join('\n'),
    parameters: [LIBRARY_PAGE_SIZE, page * LIBRARY_PAGE_SIZE],
  };
}

/** A number the anchor holds at `field`, or null — and null for an anchor that is not JSON. */
const anchorNumber = (field: string) =>
  `CASE WHEN json_valid(highlights.anchor) THEN json_extract(highlights.anchor, '$.${field}') END`;

/**
 * One page of every highlight the index holds: the note it is in and its
 * place among that note's highlights, its id, kind, the start of its quote
 * and comment, its style, and its page or location. Columns:
 * {@link HIGHLIGHTS_QUERY_COLUMNS}; by note, then in the order it holds them.
 *
 * Only the highlights' own table, read straight down its path index: which
 * of these are in a literature note in use, and their order, are
 * `joinHighlights`'s, over what {@link compileLibraryQuery} read. Asking
 * per row which note each is in, or its tags, cost 20,000 lookups a page.
 */
export function compileHighlightsQuery(page: number): CompiledQuery {
  return {
    sql: [
      `${HIGHLIGHTS_QUERY_MARK} SELECT highlights.path AS "path", highlights.idx AS "idx",`,
      `  highlights.id AS "id", highlights.kind AS "kind",`,
      `  substr(highlights.quote, 1, ${HIGHLIGHT_TEXT_LIMIT}) AS "quote",`,
      `  substr(highlights.comment, 1, ${HIGHLIGHT_TEXT_LIMIT}) AS "comment",`,
      `  highlights.mark AS "mark", highlights.color AS "color",`,
      `  ${anchorNumber('page')} AS "page", ${anchorNumber('location')} AS "location"`,
      `FROM highlights ORDER BY highlights.path, highlights.idx LIMIT ? OFFSET ?`,
    ].join('\n'),
    parameters: [HIGHLIGHTS_PAGE_SIZE, page * HIGHLIGHTS_PAGE_SIZE],
  };
}
