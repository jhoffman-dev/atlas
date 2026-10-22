import {
  compileHighlightsQuery,
  compileLibraryQuery,
  createVaultPath,
  HIGHLIGHTS_PAGE_SIZE,
  joinHighlights,
  LIBRARY_PAGE_SIZE,
  libraryCover,
  LIST_SEPARATOR,
  PAIR_SEPARATOR,
  SOURCE_KINDS,
  type CompiledQuery,
  type HighlightEntry,
  type LibraryEntry,
  type ListedHighlight,
  type LibraryProject,
} from '@dfai/domain';
import type { IndexPort, QueryResult } from '../index/ports.ts';

type Row = Readonly<Record<string, unknown>>;

function rowsOf(result: QueryResult): Row[] {
  return result.rows.map((values) =>
    Object.fromEntries(result.columns.map((column, at) => [column, values[at]])),
  );
}

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

const textOrNull = (value: unknown): string | null => {
  const read = text(value).trim();
  return read === '' ? null : read;
};

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const listOf = (value: unknown): string[] =>
  text(value) === '' ? [] : text(value).split(LIST_SEPARATOR);

/** Every row a paged statement answers, page after page, until one comes back short. */
async function everyPage(
  index: Pick<IndexPort, 'query'>,
  { compile, size }: { compile: (page: number) => CompiledQuery; size: number },
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; ; page += 1) {
    const { sql, parameters } = compile(page);
    const result = await index.query(sql, parameters);
    const read = rowsOf(result);
    rows.push(...read);
    if (read.length < size && !result.truncated) return rows;
  }
}

function projectsOf(value: unknown): LibraryProject[] {
  return listOf(value).map((pair) => {
    const [path = '', name = ''] = pair.split(PAIR_SEPARATOR);
    return { path: path === '' ? null : createVaultPath(path), name };
  });
}

function libraryEntryOf(row: Row): LibraryEntry {
  const kind = text(row['kind']).trim().toLowerCase();
  return {
    path: createVaultPath(text(row['path'])),
    title: text(row['title']),
    author: textOrNull(row['author']),
    kind: SOURCE_KINDS.find((known) => known === kind) ?? null,
    highlights: Number(row['highlights'] ?? 0),
    modified: Number(row['modified'] ?? 0),
    tags: listOf(row['tags']),
    projects: projectsOf(row['projects']),
    cover: libraryCover(textOrNull(row['cover'])),
  };
}

function listedHighlightOf(row: Row): ListedHighlight {
  return {
    path: createVaultPath(text(row['path'])),
    index: Number(row['idx'] ?? 0),
    id: text(row['id']),
    kind: text(row['kind']),
    quote: text(row['quote']),
    comment: text(row['comment']),
    mark: text(row['mark']),
    color: text(row['color']),
    page: numberOrNull(row['page']),
    location: numberOrNull(row['location']),
  };
}

/**
 * Every literature note in use (#507, ADR-0043), as the Library lists it,
 * read from the index a page at a time. In path order; the Library sorts.
 */
export async function loadLibrary({
  index,
}: {
  index: Pick<IndexPort, 'query'>;
}): Promise<LibraryEntry[]> {
  const rows = await everyPage(index, { compile: compileLibraryQuery, size: LIBRARY_PAGE_SIZE });
  return rows.map(libraryEntryOf);
}

/**
 * Every highlight in a literature note in use (#507), as All highlights
 * lists it: the literature notes, then the highlights a page at a time,
 * matched to them — the most recently changed notes first, each note's in
 * the order it holds them (`joinHighlights`).
 */
export async function loadAllHighlights({
  index,
}: {
  index: Pick<IndexPort, 'query'>;
}): Promise<HighlightEntry[]> {
  const sources = await loadLibrary({ index });
  const rows = await everyPage(index, {
    compile: compileHighlightsQuery,
    size: HIGHLIGHTS_PAGE_SIZE,
  });
  return joinHighlights(rows.map(listedHighlightOf), sources);
}
