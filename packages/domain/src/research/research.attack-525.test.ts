/**
 * Attack tests for PR #525 (#507, Library and All highlights): what the
 * domain's filters, sort and cover reading were not written for. Failing
 * tests are findings; passing ones pin what held.
 */
import { describe, expect, it } from 'vitest';
import { imageSourceCandidates, resolveImageSource } from '../markdown/image-source.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  filterHighlights,
  highlightChoices,
  highlightColor,
  highlightPlace,
  joinHighlights,
  NO_HIGHLIGHT_FILTER,
  type HighlightEntry,
  type ListedHighlight,
} from './highlight-list.ts';
import {
  filterLibrary,
  libraryChoices,
  libraryCover,
  NO_LIBRARY_FILTER,
  sortLibrary,
  type LibraryEntry,
} from './library.ts';

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

describe('libraryCover: every way a cover is written (attack #525)', () => {
  it('reads a markdown image cover `![](covers/art.jpg)` as its path', () => {
    expect(libraryCover('![](covers/art.jpg)')).toBe('covers/art.jpg');
  });

  it('never names a URL written as a markdown image', () => {
    expect(libraryCover('![Cover](https://example.test/art.jpg)')).toBeNull();
  });

  it.each([
    'https://example.test/a.jpg',
    'HTTP://example.test/a.jpg',
    '  https://example.test/a.jpg  ',
    'data:image/png;base64,AAAA',
    'file:///etc/a.png',
    'asset://localhost/a.png',
    'javascript:alert(1)',
    '//example.test/a.jpg',
    '[[https://example.test/a.jpg]]',
    '![[//example.test/a.jpg]]',
    '[[data:image/png;base64,AAAA|Cover]]',
    '',
    '   ',
    '[[]]',
    '![[|Cover]]',
  ])('names nothing off the vault for %j', (cover) => {
    expect(libraryCover(cover)).toBeNull();
  });

  it.each([
    ['![[covers/art.jpg]]', 'covers/art.jpg'],
    ['[[covers/art.jpg|Cover]]', 'covers/art.jpg'],
    ['[[covers/art.jpg#part]]', 'covers/art.jpg'],
    ['covers/art.jpg', 'covers/art.jpg'],
  ])('reads %j as %j', (cover, path) => {
    expect(libraryCover(cover)).toBe(path);
  });

  it.each(['../../../etc/a.png', '/../../a.png', '../../a.png'])(
    'what it names is never read from outside the vault, nor fetched (%j)',
    (cover) => {
      const notePath = createVaultPath('Library/The Art of War.md');
      const src = libraryCover(cover);
      if (src === null) return;
      expect(resolveImageSource({ src, notePath }).kind).not.toBe('external');
      for (const candidate of imageSourceCandidates({ src, notePath })) {
        expect(candidate.startsWith('..')).toBe(false);
      }
    },
  );
});

describe('filterLibrary edges (attack #525)', () => {
  it('a nested tag is under its parent: filtering by #reading keeps #reading/fiction', () => {
    const sources = [entry('Dune', { tags: ['reading/fiction'] }), entry('Other', { tags: [] })];
    expect(titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, tag: 'reading' }))).toEqual([
      'Dune',
    ]);
  });

  it('folds letters that have no combining mark: "soren" finds Søren, "lodz" finds Łódź', () => {
    const sources = [
      entry('Fear and Trembling', { author: 'Søren Kierkegaard' }),
      entry('Łódź Diaries'),
    ];
    expect(titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, search: 'soren' }))).toEqual([
      'Fear and Trembling',
    ]);
    expect(titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, search: 'lodz' }))).toEqual([
      'Łódź Diaries',
    ]);
  });

  it('matches across case and composed/decomposed accents both ways', () => {
    const sources = [entry('Café Society'), entry('CAFÉ NOIR')];
    expect(titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, search: 'café' }))).toEqual([
      'Café Society',
      'CAFÉ NOIR',
    ]);
  });

  it('a source of an unknown kind is listed with no kind chosen, and hidden by any kind chip', () => {
    const sources = [entry('Odd', { kind: null }), entry('Known', { kind: 'epub' })];
    expect(titles(filterLibrary(sources, NO_LIBRARY_FILTER))).toEqual(['Odd', 'Known']);
    expect(titles(filterLibrary(sources, { ...NO_LIBRARY_FILTER, kinds: ['epub'] }))).toEqual([
      'Known',
    ]);
    expect(libraryChoices(sources).kinds.map((choice) => choice.value)).toEqual(['epub']);
  });
});

describe('sortLibrary edges (attack #525)', () => {
  it('is a total order: two notes told apart only by an accent sort the same in any input order', () => {
    // `Resume.md` and `Résumé.md` are two files on APFS; the collator reads them as one name.
    const sources = [
      entry('Resume', { author: 'Ann', modified: 5, highlights: 2 }),
      entry('Résumé', { author: 'Ann', modified: 5, highlights: 2 }),
      entry('', { author: null, modified: Number.NaN, highlights: 0 }),
      entry('Part 10', { author: 'Émile', modified: 5 }),
      entry('Part 2', { author: 'Emile', modified: 5 }),
    ];
    for (const key of ['title', 'author', 'modified', 'highlights'] as const) {
      for (const descending of [false, true]) {
        const forwards = sortLibrary(sources, { key, descending }).map((each) => each.path);
        const backwards = sortLibrary([...sources].reverse(), { key, descending }).map(
          (each) => each.path,
        );
        expect(backwards, `${key} ${String(descending)}`).toEqual(forwards);
      }
    }
  });
});

const highlight = (rest: Partial<HighlightEntry> = {}): HighlightEntry => ({
  path: createVaultPath('Library/A.md'),
  source: 'A',
  modified: 0,
  id: 'a1',
  kind: 'pdf',
  quote: 'q',
  comment: '',
  mark: 'highlight',
  color: 'yellow',
  page: null,
  location: null,
  tags: [],
  ...rest,
});

describe('All highlights edges (attack #525)', () => {
  const listed = (path: string, index: number, id: string): ListedHighlight => ({
    path: createVaultPath(path),
    index,
    id,
    kind: 'pdf',
    quote: id,
    comment: '',
    mark: 'highlight',
    color: 'yellow',
    page: null,
    location: null,
  });

  it('lists no highlight of a note that is no longer a source, and keeps duplicate ids in order', () => {
    const joined = joinHighlights(
      [
        listed('Library/A.md', 1, 'dup'),
        listed('Notes/Gone.md', 0, 'gone'),
        listed('Library/A.md', 0, 'dup'),
      ],
      [entry('A')],
    );
    expect(joined.map((each) => [each.id, each.quote])).toEqual([
      ['dup', 'dup'],
      ['dup', 'dup'],
    ]);
    expect(joined.every((each) => each.path === 'Library/A.md')).toBe(true);
  });

  it.each(['', 'Green', 'teal', ' green'])('an unknown colour %j is yellow', (color) => {
    expect(highlightColor(color)).toBe('yellow');
    expect(highlightChoices([highlight({ color })]).colors.map((each) => each.value)).toEqual([
      'yellow',
    ]);
  });

  it('says a Kindle location over its page, and a page 0 or location 0 as written', () => {
    expect(highlightPlace({ page: 4, location: 77 })).toBe('Location 77');
    expect(highlightPlace({ page: 0, location: null })).toBe('Page 0');
    expect(highlightPlace({ page: null, location: 0 })).toBe('Location 0');
  });

  it('"changed this week" keeps a note changed exactly a week ago and drops one a millisecond older', () => {
    const now = Date.UTC(2026, 10, 1, 9, 0); // the Sunday US clocks go back
    const week = 7 * 86_400_000;
    const shown = filterHighlights(
      [
        highlight({ id: 'edge', modified: now - week }),
        highlight({ id: 'older', modified: now - week - 1 }),
        highlight({ id: 'ahead', modified: now + 1 }),
        highlight({ id: 'nan', modified: Number.NaN }),
      ],
      { ...NO_HIGHLIGHT_FILTER, changed: 'week' },
      now,
    );
    expect(shown.map((each) => each.id)).toEqual(['edge', 'ahead']);
  });

  it('a nested tag is under its parent in All highlights too', () => {
    const shown = filterHighlights(
      [highlight({ id: 'nested', tags: ['reading/fiction'] })],
      { ...NO_HIGHLIGHT_FILTER, tag: 'reading' },
      0,
    );
    expect(shown.map((each) => each.id)).toEqual(['nested']);
  });
});
