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
 * Highlights per page. The host fails a whole answer past 16 MiB of text
 * (`MAX_QUERY_BYTES`), counted in UTF-8 bytes. A row carries up to
 * {@link HIGHLIGHT_TEXT_LIMIT} characters of quote and of comment at four
 * bytes a character (an emoji, a historic script), a path of up to 1,024
 * bytes, and about 100 bytes of the rest: 5.2 kB. Twenty-five hundred of
 * them are 13 MB, under it with room to spare.
 */
export const HIGHLIGHTS_PAGE_SIZE = 2500;

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

/** `?, ?, …`: one marker for each of `values`, which are bound, never written into the text. */
const placeholders = (values: readonly unknown[]) => values.map(() => '?').join(', ');

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
export function compileLibraryQuery({
  page = 0,
  paths,
}: {
  page?: number;
  /** Only these notes, when a few are read again; every note in use otherwise. */
  paths?: readonly string[];
} = {}): CompiledQuery {
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
      ...(paths === undefined ? [] : [`  AND files.path IN (${placeholders(paths)})`]),
      `ORDER BY files.path LIMIT ? OFFSET ?`,
    ].join('\n'),
    parameters: [...(paths ?? []), LIBRARY_PAGE_SIZE, page * LIBRARY_PAGE_SIZE],
  };
}

/** A number the anchor holds at `field`, or null — and null for an anchor that is not JSON. */
const anchorNumber = (field: string) =>
  `CASE WHEN json_valid(highlights.anchor) THEN json_extract(highlights.anchor, '$.${field}') END`;

/** Where a page of highlights picks up: the last one read, by its note and its place in it. */
export interface HighlightsCursor {
  readonly path: string;
  readonly index: number;
}

/** Before the first highlight of the first note: no path is empty, and no place is below 0. */
export const HIGHLIGHTS_START: HighlightsCursor = { path: '', index: -1 };

/**
 * One page of the highlights in a literature note in use: the note it is in
 * and its place among that note's highlights, its id, kind, the start of its
 * quote and comment, its style, and its page or location. Columns:
 * {@link HIGHLIGHTS_QUERY_COLUMNS}; by note, then in the order it holds them.
 *
 * A page picks up after `after` by key — `highlights_path_idx` walks straight
 * to it — not by an offset, which would read and throw away every row before
 * it: the last page of 150,000 highlights would cost sixty times the first.
 * Which notes are in use is the statement's own (the same test as the
 * Library's); their titles, times and tags are the Library's, matched by the
 * reader.
 */
export function compileHighlightsQuery({
  after = HIGHLIGHTS_START,
  paths,
}: {
  after?: HighlightsCursor;
  /** Only the highlights in these notes, when a few are read again; every note in use otherwise. */
  paths?: readonly string[];
} = {}): CompiledQuery {
  return {
    sql: [
      `${HIGHLIGHTS_QUERY_MARK} SELECT highlights.path AS "path", highlights.idx AS "idx",`,
      `  highlights.id AS "id", highlights.kind AS "kind",`,
      `  substr(highlights.quote, 1, ${HIGHLIGHT_TEXT_LIMIT}) AS "quote",`,
      `  substr(highlights.comment, 1, ${HIGHLIGHT_TEXT_LIMIT}) AS "comment",`,
      `  highlights.mark AS "mark", highlights.color AS "color",`,
      `  ${anchorNumber('page')} AS "page", ${anchorNumber('location')} AS "location"`,
      `FROM highlights WHERE (highlights.path, highlights.idx) > (?, ?)`,
      ...(paths === undefined ? [] : [`  AND highlights.path IN (${placeholders(paths)})`]),
      `  AND highlights.path IN (SELECT files.path FROM files WHERE ${IS_LITERATURE} AND ${IN_USE})`,
      `ORDER BY highlights.path, highlights.idx LIMIT ?`,
    ].join('\n'),
    parameters: [after.path, after.index, ...(paths ?? []), HIGHLIGHTS_PAGE_SIZE],
  };
}
