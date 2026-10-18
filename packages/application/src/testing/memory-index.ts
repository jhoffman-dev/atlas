import type { VaultPath } from '@atlas/domain';
import type { IndexedNote, IndexEntry, IndexPort, QueryResult } from '../index/ports.ts';
import { fakeIndexPort } from './fake-ports.ts';

/**
 * An index kept in memory, for a test in a browser-like environment, where
 * `node:sqlite` (`sqliteIndexPort`) cannot load. A sync writes it; the graph's
 * statements and the facet check (`/* index facets *\/`) are answered from
 * what was written, by the columns they read. Any other query answers no rows.
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
    const wanted = new Set(parameters.filter((value) => typeof value === 'string'));
    return rows(
      ['facet', 'path', 'part', 'a', 'b', 'c'],
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
  return rows([], []);
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
