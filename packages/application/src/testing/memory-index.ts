import type { VaultPath } from '@atlas/domain';
import type { IndexedNote, IndexEntry, IndexPort, QueryResult } from '../index/ports.ts';
import { fakeIndexPort } from './fake-ports.ts';

/**
 * An index kept in memory, for a test in a browser-like environment, where
 * `node:sqlite` (`sqliteIndexPort`) cannot load. A sync writes it; the graph's
 * statements and the facet check (`/* index facets *\/`) are answered from
 * what was written, by the columns they read, and so are the tag counts and
 * the relation holders a sync asks; a few others are answered with no rows
 * (`ANSWERED_EMPTY`), and any other statement is refused.
 * Its answers are held to `sqliteIndexPort`'s in memory-index.test.ts.
 * Test support only.
 */
export function memoryIndexPort(): IndexPort {
  const notes = new Map<string, IndexedNote>();
  return fakeIndexPort({
    manifest: async () =>
      [...notes.values()].map(({ path, modified, size, digest, type }): IndexEntry => ({
        path,
        modified,
        size,
        digest,
        type,
      })),
    put: async (written) => {
      for (const note of written) notes.set(note.path, note);
    },
    remove: async (paths: readonly VaultPath[]) => {
      for (const path of paths) notes.delete(path);
    },
    clear: async () => notes.clear(),
    query: async (sql, parameters) => answer(sql, parameters, notes),
    stats: async () => ({ notes: notes.size, properties: 0, links: 0 }),
  });
}

const rows = (columns: string[], found: unknown[][]): QueryResult => ({
  columns,
  rows: found,
  truncated: false,
});

const linkLike = (text: string | null) => text !== null && /^\[\[.*\]\]/s.test(text);

function answer(
  sql: string,
  parameters: readonly unknown[],
  notes: ReadonlyMap<string, IndexedNote>,
): QueryResult {
  const all = [...notes.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  if (sql.startsWith('/* index facets */')) {
    // Bound as each path four times over, around the three names the graph reads.
    const wanted = new Set(parameters.slice(0, (parameters.length - 3) / 4));
    return rows(
      ['facet', 'path', 'part', 'what', 'at', 'value'],
      all.filter((note) => wanted.has(note.path)).flatMap(facetRows),
    );
  }
  const [limit, offset] = parameters.slice(-2).map(Number) as [number, number];
  const page = (found: unknown[][]) => found.slice(offset, offset + limit);
  if (sql.includes('/* graph:notes */')) {
    const typeOf = (note: IndexedNote) =>
      [...note.properties].sort((a, b) => a.index - b.index).find((p) => p.key === 'type')?.text ??
      null;
    return rows(
      ['path', 'title', 'type'],
      page(all.map((note) => [note.path, note.title, typeOf(note)])),
    );
  }
  if (sql.includes('/* graph:links */')) {
    return rows(
      ['source', 'target'],
      page(all.flatMap((note) => wikiLinks(note).map((path) => [note.path, path]))),
    );
  }
  if (sql.includes('/* graph:relations */')) {
    return rows(
      ['source', 'key', 'value'],
      page(
        all.flatMap((note) =>
          note.properties
            .filter((p) => p.key !== 'type' && linkLike(p.text))
            .map((p) => [note.path, p.key, p.text]),
        ),
      ),
    );
  }
  if (sql.startsWith('/* tags:counts */')) return rows(['key', 'name', 'count'], tagCounts(all));
  if (sql.startsWith('SELECT DISTINCT src AS "path" FROM relations WHERE')) {
    return rows(['path'], relationHolders(all, parameters));
  }
  if (ANSWERED_EMPTY.some((marker) => sql.startsWith(marker))) return rows([], []);
  throw new Error(`memoryIndexPort does not answer this statement: ${sql.slice(0, 60)}`);
}

/**
 * What the window asks besides, whose rows no test of this index reads: the
 * sidebar's counts and favourites, PARA's values and an Atlas query. Answered
 * with none; anything not named here is refused, so a new reader is noticed.
 */
const ANSWERED_EMPTY = [
  '/* type counts */',
  '/* PARA values */',
  '/* atlas-query */',
  'SELECT files.path AS "path", props.key AS "key"',
];

/** Each tag, how often it is used, spelt as the first note by path spells it. */
function tagCounts(all: readonly IndexedNote[]): unknown[][] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const note of all) {
    for (const tag of note.tags) {
      const held = counts.get(tag.key) ?? { name: tag.name, count: 0 };
      counts.set(tag.key, { name: held.name, count: held.count + 1 });
    }
  }
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, { name, count }]) => [key, name, count]);
}

/** The notes holding a relation by one of these names, bound three to a name (`compileRelationHoldersQuery`). */
function relationHolders(all: readonly IndexedNote[], parameters: readonly unknown[]): unknown[][] {
  const names = parameters.filter((_, at) => at % 3 === 0).map(String);
  const holds = (name: string) =>
    names.some((wanted) => name === wanted || name.endsWith(`/${wanted}`));
  return all
    .filter((note) => note.relations.some((relation) => holds(relation.name)))
    .map((note) => [note.path]);
}

const wikiLinks = (note: IndexedNote): string[] =>
  note.links.flatMap((link) => (link.kind === 'wikilink' && link.path !== null ? [link.path] : []));

function facetRows(note: IndexedNote): unknown[][] {
  return [
    ['graph', note.path, 'title', note.title, null, null],
    ...note.properties
      .filter((p) => p.key === 'type' || linkLike(p.text))
      .map((p) => ['graph', note.path, 'prop', p.key, p.index, p.text]),
    ...wikiLinks(note).map((path) => ['graph', note.path, 'link', path, null, null]),
    ...note.tags.map((tag, at) => ['tags', note.path, 'tag', tag.key, at, tag.name]),
  ];
}
