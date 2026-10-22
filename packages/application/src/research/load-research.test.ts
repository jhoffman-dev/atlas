import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHTS_PAGE_SIZE,
  HIGHLIGHTS_QUERY_MARK,
  LIBRARY_PAGE_SIZE,
  LIBRARY_QUERY_MARK,
} from '@dfai/domain';
import type { IndexedHighlightRow, IndexedNote, IndexPort, QueryResult } from '../index/ports.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import { loadAllHighlights, loadLibrary } from './load-research.ts';

function note(path: string, rest: Partial<IndexedNote> = {}): IndexedNote {
  return {
    path,
    title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
    modified: 0,
    size: 0,
    digest: '',
    type: 'literature',
    body: '',
    summary: '',
    properties: [
      { key: 'type', index: 0, text: 'literature', number: null, date: null, json: null },
    ],
    links: [],
    tags: [],
    relations: [],
    blocks: [],
    checks: [],
    progress: null,
    highlights: [],
    ...rest,
  };
}

const property = (key: string, text: string) => ({
  key,
  index: 0,
  text,
  number: null,
  date: null,
  json: null,
});

const mark = (id: string, rest: Partial<IndexedHighlightRow> = {}): IndexedHighlightRow => ({
  id,
  kind: 'pdf',
  quote: `Quote ${id}`,
  comment: '',
  mark: 'highlight',
  color: 'yellow',
  anchor: '{"v":1,"kind":"pdf","page":1}',
  ...rest,
});

const literature = (extra: ReturnType<typeof property>[] = []) => [
  property('type', 'literature'),
  ...extra,
];

describe('loadLibrary', () => {
  it('reads each literature note: title, author, kind, cover, highlights, tags and projects', async () => {
    const index = sqliteIndexPort();
    await index.put([
      note('Projects/Reading.md', { title: 'Reading list', type: 'project', properties: [] }),
      note('Library/Art.md', {
        title: 'The Art of War',
        modified: 50,
        properties: literature([
          property('kind', 'PDF'),
          property('author', ' Sun Tzu '),
          property('cover', '![[covers/art.jpg]]'),
        ]),
        tags: [
          { key: 'war', name: 'War' },
          { key: 'strategy', name: 'strategy' },
        ],
        relations: [
          {
            key: 'project',
            index: 0,
            target: 'Reading',
            name: 'reading',
            path: 'Projects/Reading.md',
          },
          { key: 'project', index: 1, target: 'Someday', name: 'someday', path: null },
        ],
        highlights: [mark('a1'), mark('a2')],
      }),
      note('Library/Odd.md', {
        properties: literature([
          property('kind', 'scroll'),
          property('cover', 'https://example.com/x.png'),
        ]),
      }),
    ]);

    expect(await loadLibrary({ index })).toEqual([
      {
        path: 'Library/Art.md',
        title: 'The Art of War',
        author: 'Sun Tzu',
        kind: 'pdf',
        highlights: 2,
        modified: 50,
        tags: ['strategy', 'war'],
        projects: [
          { path: 'Projects/Reading.md', name: 'Reading list' },
          { path: null, name: 'Someday' },
        ],
        cover: 'covers/art.jpg',
      },
      {
        path: 'Library/Odd.md',
        title: 'Odd',
        author: null,
        kind: null,
        highlights: 0,
        modified: 0,
        tags: [],
        projects: [],
        cover: null,
      },
    ]);
  });

  it('reads nothing from a vault with no literature note', async () => {
    const index = sqliteIndexPort();
    await index.put([note('Notes/Plain.md', { type: null, properties: [] })]);
    expect(await loadLibrary({ index })).toEqual([]);
  });

  it('reads on to the next page while a page comes back full or cut short', async () => {
    const asked: number[] = [];
    const index = pagedIndex(LIBRARY_QUERY_MARK, LIBRARY_PAGE_SIZE, asked, [
      { rows: LIBRARY_PAGE_SIZE, truncated: false },
      { rows: 3, truncated: true },
      { rows: 1, truncated: false },
    ]);
    expect(await loadLibrary({ index })).toHaveLength(LIBRARY_PAGE_SIZE + 4);
    expect(asked).toEqual([0, LIBRARY_PAGE_SIZE, 2 * LIBRARY_PAGE_SIZE]);
  });

  it('lets a failed read fail the load', async () => {
    const index = { query: () => Promise.reject(new Error('index busy')) };
    await expect(loadLibrary({ index })).rejects.toThrow('index busy');
  });
});

describe('loadAllHighlights', () => {
  it('reads every highlight with its source, style, place and tags, newest note first', async () => {
    const index = sqliteIndexPort();
    await index.put([
      note('Library/Old.md', {
        title: 'Old book',
        modified: 1,
        tags: [{ key: 'stoic', name: 'Stoic' }],
        highlights: [
          mark('k1', {
            kind: 'kindle',
            comment: 'Compare.',
            color: 'blue',
            mark: 'underline',
            anchor: '{"v":1,"kind":"kindle","location":77}',
          }),
        ],
      }),
      note('Library/New.md', {
        title: 'New book',
        modified: 9,
        highlights: [mark('n1', { anchor: '{"v":1,"kind":"pdf","page":3}' }), mark('n2')],
      }),
    ]);

    const read = await loadAllHighlights({ index });
    expect(read.map((each) => each.id)).toEqual(['n1', 'n2', 'k1']);
    expect(read[0]).toEqual({
      path: 'Library/New.md',
      source: 'New book',
      modified: 9,
      id: 'n1',
      kind: 'pdf',
      quote: 'Quote n1',
      comment: '',
      mark: 'highlight',
      color: 'yellow',
      page: 3,
      location: null,
      tags: [],
    });
    expect(read[2]).toMatchObject({
      kind: 'kindle',
      comment: 'Compare.',
      color: 'blue',
      mark: 'underline',
      page: null,
      location: 77,
      tags: ['stoic'],
    });
  });

  it('reads the sources, then the highlights page after page until one comes back short', async () => {
    const asked: number[] = [];
    const pages = pagedIndex(HIGHLIGHTS_QUERY_MARK, HIGHLIGHTS_PAGE_SIZE, asked, [
      { rows: HIGHLIGHTS_PAGE_SIZE, truncated: false },
      { rows: HIGHLIGHTS_PAGE_SIZE, truncated: false },
      { rows: 0, truncated: false },
    ]);
    const statements: string[] = [];
    const index: Pick<IndexPort, 'query'> = {
      query: async (sql, parameters) => {
        statements.push(sql.slice(0, sql.indexOf('*/') + 2));
        // Every path the highlights name is a source, but one: its highlight is left out.
        if (!sql.startsWith(LIBRARY_QUERY_MARK)) return pages.query(sql, parameters);
        const paths = Array.from({ length: 2 * HIGHLIGHTS_PAGE_SIZE - 1 }, (_, at) => [
          `Library/${at + 1}.md`,
        ]);
        const [limit, offset] = parameters.map(Number) as [number, number];
        return { columns: ['path'], rows: paths.slice(offset, offset + limit), truncated: false };
      },
    };
    expect(await loadAllHighlights({ index })).toHaveLength(2 * HIGHLIGHTS_PAGE_SIZE - 1);
    expect(statements).toEqual([
      LIBRARY_QUERY_MARK,
      LIBRARY_QUERY_MARK,
      HIGHLIGHTS_QUERY_MARK,
      HIGHLIGHTS_QUERY_MARK,
      HIGHLIGHTS_QUERY_MARK,
    ]);
    expect(asked).toEqual([0, HIGHLIGHTS_PAGE_SIZE, 2 * HIGHLIGHTS_PAGE_SIZE]);
  });
});

/** An index that answers `mark`'s statement with the pages given, noting each offset asked for. */
function pagedIndex(
  mark: string,
  size: number,
  asked: number[],
  pages: readonly { rows: number; truncated: boolean }[],
): Pick<IndexPort, 'query'> {
  return {
    query: async (sql, parameters): Promise<QueryResult> => {
      expect(sql.startsWith(mark)).toBe(true);
      const offset = Number(parameters.at(-1));
      asked.push(offset);
      const page = pages[offset / size] ?? { rows: 0, truncated: false };
      return {
        columns: ['path', 'id'],
        rows: Array.from({ length: page.rows }, (_, at) => [
          `Library/${offset + at}.md`,
          `id${at}`,
        ]),
        truncated: page.truncated,
      };
    },
  };
}
