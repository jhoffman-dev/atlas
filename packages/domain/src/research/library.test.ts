import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  DEFAULT_LIBRARY_SORT,
  filterLibrary,
  libraryChoices,
  libraryCover,
  libraryShown,
  NO_LIBRARY_FILTER,
  projectKey,
  sortLibrary,
  type LibraryEntry,
} from './library.ts';

const ART = createVaultPath('Projects/Art of War.md');

function entry(name: string, rest: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    path: createVaultPath(`Library/${name}.md`),
    title: name,
    author: null,
    kind: 'pdf',
    highlights: 0,
    modified: 0,
    tags: [],
    projects: [],
    cover: null,
    ...rest,
  };
}

const titles = (entries: readonly LibraryEntry[]) => entries.map((each) => each.title);

describe('filterLibrary', () => {
  const sources = [
    entry('The Art of War', { kind: 'pdf', author: 'Sun Tzu', tags: ['strategy'] }),
    entry('Meditations', {
      kind: 'kindle',
      author: 'Marcus Aurelius',
      tags: ['stoic', 'strategy'],
      projects: [{ path: ART, name: 'Art of War' }],
    }),
    entry('Le Petit Prince', { kind: 'epub', author: 'Antoine de Saint-Exupéry' }),
    entry('Unknown shape', { kind: null, projects: [{ path: null, name: 'Reading  List' }] }),
  ];

  it('shows every source with no filter, in the order given', () => {
    expect(titles(filterLibrary(sources, NO_LIBRARY_FILTER))).toEqual(titles(sources));
  });

  it('shows only the kinds asked for, and a kind this build does not know under none of them', () => {
    const kinds = (asked: LibraryEntry['kind'][]) =>
      titles(
        filterLibrary(sources, {
          ...NO_LIBRARY_FILTER,
          kinds: asked.flatMap((k) => (k === null ? [] : [k])),
        }),
      );
    expect(kinds(['pdf'])).toEqual(['The Art of War']);
    expect(kinds(['kindle', 'epub'])).toEqual(['Meditations', 'Le Petit Prince']);
  });

  it('shows the sources with a tag, by its key', () => {
    expect(titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, tag: 'stoic' }))).toEqual([
      'Meditations',
    ]);
    expect(titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, tag: 'strategy' }))).toEqual([
      'The Art of War',
      'Meditations',
    ]);
  });

  it('shows the sources filed under a project, by the note it resolves to or by its folded name', () => {
    expect(titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, project: ART }))).toEqual([
      'Meditations',
    ]);
    expect(
      titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, project: 'name:reading list' })),
    ).toEqual(['Unknown shape']);
  });

  it('matches every word of a search in the title or the author, accents and case aside', () => {
    const search = (words: string) =>
      titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, search: words }));
    expect(search('exupery')).toEqual(['Le Petit Prince']);
    expect(search('  ART  tzu ')).toEqual(['The Art of War']);
    expect(search('art aurelius')).toEqual([]);
    expect(search('   ')).toEqual(titles(sources));
  });

  it('holds every filter at once', () => {
    expect(
      titles(
        filterLibrary(sources, {
          kinds: ['kindle'],
          tag: 'strategy',
          project: ART,
          search: 'medit',
        }),
      ),
    ).toEqual(['Meditations']);
    expect(
      titles(filterLibrary(sources, { kinds: ['pdf'], tag: 'stoic', project: null, search: '' })),
    ).toEqual([]);
  });
});

describe('sortLibrary', () => {
  const sources = [
    entry('Part 10', { author: 'Briar Ansel', highlights: 3, modified: 30 }),
    entry('part 2', { author: null, highlights: 9, modified: 10 }),
    entry('Zeal', { author: 'ansel briar', highlights: 3, modified: 20 }),
  ];

  it('orders by title as a person reads it: case aside, numbers by value', () => {
    expect(titles(sortLibrary(sources, { key: 'title', descending: false }))).toEqual([
      'part 2',
      'Part 10',
      'Zeal',
    ]);
    expect(titles(sortLibrary(sources, { key: 'title', descending: true }))).toEqual([
      'Zeal',
      'Part 10',
      'part 2',
    ]);
  });

  it('orders by author, a source without one last either way', () => {
    expect(titles(sortLibrary(sources, { key: 'author', descending: false }))).toEqual([
      'Zeal',
      'Part 10',
      'part 2',
    ]);
    expect(titles(sortLibrary(sources, { key: 'author', descending: true }))).toEqual([
      'Part 10',
      'Zeal',
      'part 2',
    ]);
  });

  it('orders by when the note changed, newest first by default', () => {
    expect(DEFAULT_LIBRARY_SORT).toEqual({ key: 'modified', descending: true });
    expect(titles(sortLibrary(sources, DEFAULT_LIBRARY_SORT))).toEqual([
      'Part 10',
      'Zeal',
      'part 2',
    ]);
  });

  it('orders by how many highlights, a tie by title', () => {
    expect(titles(sortLibrary(sources, { key: 'highlights', descending: true }))).toEqual([
      'part 2',
      'Part 10',
      'Zeal',
    ]);
    expect(titles(sortLibrary(sources, { key: 'highlights', descending: false }))).toEqual([
      'Part 10',
      'Zeal',
      'part 2',
    ]);
  });

  it('breaks a tie of titles by path, so two reads give one order', () => {
    const twins = [
      { ...entry('Same'), path: createVaultPath('Library/b/Same.md') },
      { ...entry('Same'), path: createVaultPath('Library/a/Same.md') },
    ];
    expect(
      sortLibrary(twins, { key: 'title', descending: false }).map((each) => each.path),
    ).toEqual(['Library/a/Same.md', 'Library/b/Same.md']);
  });

  it('leaves what it is handed as it was', () => {
    const before = titles(sources);
    sortLibrary(sources, { key: 'title', descending: false });
    expect(titles(sources)).toEqual(before);
  });
});

describe('libraryShown', () => {
  it('filters, then sorts', () => {
    const sources = [
      entry('B', { kind: 'pdf', modified: 1 }),
      entry('A', { kind: 'pdf', modified: 2 }),
      entry('C', { kind: 'epub', modified: 3 }),
    ];
    expect(
      titles(
        libraryShown(sources, {
          filter: { ...NO_LIBRARY_FILTER, kinds: ['pdf'] },
          sort: { key: 'title', descending: false },
        }),
      ),
    ).toEqual(['A', 'B']);
  });
});

describe('libraryChoices', () => {
  it('offers each kind present in its own order, and each tag and project by name, with counts', () => {
    const choices = libraryChoices([
      entry('One', {
        kind: 'kindle',
        tags: ['stoic', 'b'],
        projects: [{ path: ART, name: 'Zed' }],
      }),
      entry('Two', { kind: 'pdf', tags: ['stoic'], projects: [{ path: null, name: 'Alpha' }] }),
      entry('Three', {
        kind: null,
        tags: ['stoic', 'stoic'],
        projects: [{ path: ART, name: 'Zed' }],
      }),
    ]);
    expect(choices.kinds).toEqual([
      { value: 'pdf', label: 'PDF', count: 1 },
      { value: 'kindle', label: 'Kindle', count: 1 },
    ]);
    expect(choices.tags).toEqual([
      { value: 'b', label: '#b', count: 1 },
      { value: 'stoic', label: '#stoic', count: 3 },
    ]);
    expect(choices.projects).toEqual([
      { value: 'name:alpha', label: 'Alpha', count: 1 },
      { value: ART, label: 'Zed', count: 2 },
    ]);
  });

  it('offers nothing for an empty Library', () => {
    expect(libraryChoices([])).toEqual({ kinds: [], tags: [], projects: [] });
  });
});

describe('projectKey', () => {
  it('is the note a project resolves to, else its name folded', () => {
    expect(projectKey({ path: ART, name: 'Art' })).toBe(ART);
    expect(projectKey({ path: null, name: ' Résumé  Drive ' })).toBe('name:resume drive');
  });
});

describe('libraryCover', () => {
  it('reads a path, an embed or a link to a picture in the vault', () => {
    expect(libraryCover('Library/covers/art.jpg')).toBe('Library/covers/art.jpg');
    expect(libraryCover('![[art.jpg]]')).toBe('art.jpg');
    expect(libraryCover(' [[covers/art.png|The cover]] ')).toBe('covers/art.png');
  });

  it('has none for nothing written, and never one off the vault', () => {
    expect(libraryCover(null)).toBeNull();
    expect(libraryCover('  ')).toBeNull();
    expect(libraryCover('[[]]')).toBeNull();
    expect(libraryCover('https://example.com/art.jpg')).toBeNull();
    expect(libraryCover('data:image/png;base64,AAAA')).toBeNull();
    expect(libraryCover('//example.com/art.jpg')).toBeNull();
    expect(libraryCover('![[https://example.com/art.jpg]]')).toBeNull();
  });
});
