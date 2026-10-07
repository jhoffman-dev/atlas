import type { CompiledQuery } from '../query/view-query.ts';
import { ARCHIVE_PREFIX, ARCHIVED_FROM_KEY, ARCHIVED_KEY } from './archive.ts';

/** The columns {@link compileArchiveQuery} comes back as, in order. */
export const ARCHIVE_QUERY_COLUMNS = ['path', 'title', 'archived', 'archivedFrom'] as const;

/** How many rows the Archive lists at once; a search narrows it. */
export const ARCHIVE_LIST_LIMIT = 500;

/**
 * How many of a search's words narrow the Archive. Each is bound four times
 * and nested once more in the statement, so an unbounded search — pasted, or
 * sent through the API — would overflow what SQLite binds or nests. Words past
 * this many are not searched for.
 */
export const ARCHIVE_SEARCH_WORD_LIMIT = 16;

/**
 * The Archive's rows, asked of the index: each archived note's title and the
 * two keys archiving wrote, most recently archived first.
 *
 * Every word typed has to appear in the title or the path, in any case and
 * however the disk composed its accents — see {@link caselessGlobs}. The
 * words are bound, the first {@link ARCHIVE_SEARCH_WORD_LIMIT} of them. Undated notes — filed by hand — come after the dated ones,
 * and ties go by title then path so the list never reshuffles. `offset` skips
 * that many rows, for a caller that pages.
 */
export function compileArchiveQuery({
  search,
  limit = ARCHIVE_LIST_LIMIT,
  offset = 0,
}: {
  search: string;
  limit?: number;
  offset?: number;
}): CompiledQuery {
  const patterns = search
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, ARCHIVE_SEARCH_WORD_LIMIT)
    .map((word) => caselessGlobs(word));
  const matching = patterns.map((globs) =>
    globs.map(() => `files.title GLOB ? OR files.path GLOB ?`).join(' OR '),
  );
  return {
    sql: [
      `SELECT files.path AS "path", files.title AS "title",`,
      `  ${propertyText()} AS "archived",`,
      `  ${propertyText()} AS "archivedFrom"`,
      `FROM files`,
      `WHERE lower(substr(files.path, 1, ${ARCHIVE_PREFIX.length})) = '${ARCHIVE_PREFIX}'`,
      ...matching.map((condition) => `  AND (${condition})`),
      `ORDER BY "archived" IS NULL, "archived" DESC, lower(files.title), files.path`,
      `LIMIT ? OFFSET ?`,
    ].join('\n'),
    parameters: [
      ARCHIVED_KEY,
      ARCHIVED_FROM_KEY,
      ...patterns.flatMap((globs) => globs.flatMap((glob) => [glob, glob])),
      Math.max(1, Math.floor(limit)),
      Math.max(0, Math.floor(offset)),
    ],
  };
}

/**
 * `GLOB` patterns that find `word` anywhere in a text, in any case: each
 * letter becomes a class of its spellings — `über` is `*[üÜ][bB][eE][rR]*`.
 *
 * SQLite's `lower` and `NOCASE` fold ASCII only, so `Ü` never meets `ü`
 * there; the folding is done here instead, where JavaScript knows every
 * script's cases. One pattern for the word composed and one decomposed, when
 * they differ, since a Mac may have written the title either way. A `*`, `?`
 * or `[` typed is matched as itself.
 */
export function caselessGlobs(word: string): string[] {
  const forms = new Set([word.normalize('NFC'), word.normalize('NFD')]);
  return [...forms].map((form) => `*${[...form].map(charClass).join('')}*`);
}

function charClass(char: string): string {
  const spellings = new Set(
    [
      char,
      char.toLowerCase(),
      char.toUpperCase(),
      char.toUpperCase().toLowerCase(),
      char.toLowerCase().toUpperCase(),
    ].filter((each) => [...each].length === 1),
  );
  if (spellings.size > 1) return `[${[...spellings].join('')}]`;
  return GLOB_SPECIAL.has(char) ? `[${char}]` : char;
}

const GLOB_SPECIAL = new Set(['*', '?', '[']);

/** The first value a note has for the key bound in its place, as text or as a date. */
function propertyText(): string {
  return `(SELECT COALESCE(props.value_text, props.value_date) FROM props
    WHERE props.path = files.path AND props.key = ? ORDER BY props.idx LIMIT 1)`;
}
