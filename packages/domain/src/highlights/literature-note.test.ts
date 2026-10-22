import { describe, expect, it } from 'vitest';
import { lineNoteBlocks as noteBlocks } from '../testing/line-note-blocks.ts';
import { homeFolderOf } from '../home-folders/home-folder.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  isLiteratureNote,
  safeSourceFileName,
  UnsafeSourceFileError,
  readLiteratureNote,
  LITERATURE_NOTE_TYPE,
  literatureNotePath,
  literatureNoteText,
} from './literature-note.ts';
import { highlightRows, mayHoldHighlights } from './highlight-rows.ts';
import { appendHighlights } from './edit-highlights.ts';

describe('a literature note', () => {
  it('is a note whose type is literature, whatever its case and spacing', () => {
    expect(isLiteratureNote({ type: 'literature' })).toBe(true);
    expect(isLiteratureNote({ type: ' Literature ' })).toBe(true);
    expect(isLiteratureNote({ type: 'literatures' })).toBe(false);
    expect(isLiteratureNote({ atlas: 'literature' })).toBe(false);
  });

  it('is one whose type list holds literature, as the index reads a type list (ADR-0043)', () => {
    expect(isLiteratureNote({ type: ['literature'] })).toBe(true);
    expect(isLiteratureNote({ type: ['book', ' Literature '] })).toBe(true);
    expect(isLiteratureNote({ type: ['book', 3, null] })).toBe(false);
    expect(isLiteratureNote({ type: [] })).toBe(false);
    expect(isLiteratureNote({ atlas: 'literature' })).toBe(false);
  });

  it('says its kind, title, author and file', () => {
    expect(
      readLiteratureNote({
        type: 'literature',
        kind: 'epub',
        title: 'Moby Dick',
        author: 'Herman Melville',
        file: '[[Library/Moby Dick.epub]]',
      }),
    ).toEqual({
      kind: 'epub',
      title: 'Moby Dick',
      author: 'Herman Melville',
      file: createVaultPath('Library/Moby Dick.epub'),
      asin: null,
    });
  });

  it('reads its file from a link with an alias or a heading, or from a bare path', () => {
    const fileOf = (file: unknown) =>
      readLiteratureNote({ type: 'literature', kind: 'pdf', title: 'T', file })?.file ?? null;
    expect(fileOf('[[Library/T.pdf|the book]]')).toBe(createVaultPath('Library/T.pdf'));
    expect(fileOf('[[Library/T.pdf#page=3]]')).toBe(createVaultPath('Library/T.pdf'));
    expect(fileOf('Library/T.pdf')).toBe(createVaultPath('Library/T.pdf'));
    expect(fileOf('[[ ]]')).toBeNull();
    expect(fileOf('/etc/passwd')).toBeNull();
    expect(fileOf(undefined)).toBeNull();
  });

  it('has no author or file when it says none, and a number as a title is words', () => {
    expect(
      readLiteratureNote({ type: 'literature', kind: 'kindle', title: 1984, author: '  ' }),
    ).toEqual({
      kind: 'kindle',
      title: '1984',
      author: null,
      file: null,
      asin: null,
    });
  });

  it.each([
    ['not a source', { type: 'book', kind: 'pdf', title: 'T' }],
    ['an unknown kind', { type: 'literature', kind: 'scroll', title: 'T' }],
    ['no title', { type: 'literature', kind: 'pdf', title: ' ' }],
    ['a title that is a list', { type: 'literature', kind: 'pdf', title: ['T'] }],
  ])('is not read from %s', (_label, frontmatter) => {
    expect(readLiteratureNote(frontmatter)).toBeNull();
  });

  it("is written as frontmatter alone, every value quoted, Kindle's with no file", () => {
    expect(
      literatureNoteText({
        kind: 'pdf',
        title: 'The Art of War: "Annotated"',
        author: 'Sun Tzu',
        file: createVaultPath('Library/The Art of War.pdf'),
      }),
    ).toBe(
      [
        '---',
        'type: literature',
        'kind: pdf',
        'title: "The Art of War: \\"Annotated\\""',
        'author: "Sun Tzu"',
        'file: "[[Library/The Art of War.pdf]]"',
        '---',
        '',
      ].join('\n'),
    );
    expect(literatureNoteText({ kind: 'kindle', title: 'Emma', author: null, file: null })).toBe(
      '---\ntype: literature\nkind: kindle\ntitle: "Emma"\n---\n',
    );
  });

  it('lives in Library unless a folder is given, named for its title', () => {
    expect(literatureNotePath('Moby Dick: or, The Whale')).toBe(
      createVaultPath('Library/Moby Dick or, The Whale.md'),
    );
    expect(literatureNotePath('Emma', createVaultPath('Reading'))).toBe(
      createVaultPath('Reading/Emma.md'),
    );
  });

  it("has Library as its type's home folder (ADR-0038)", () => {
    expect(
      homeFolderOf({ properties: { type: LITERATURE_NOTE_TYPE }, types: [], today: '2026-10-21' }),
    ).toBe(createVaultPath('Library'));
  });
});

describe("a literature note's index rows", () => {
  it('is a row per highlight: its id, kind, plain quote, comment, style and marker JSON', () => {
    const { text, highlights } = appendHighlights({
      text: literatureNoteText({ kind: 'kindle', title: 'Emma', author: null, file: null }),
      highlights: [
        {
          quote: 'A *mind* lively.',
          comment: 'Emma, **again**.',
          style: { mark: 'underline', color: 'orange' },
          anchor: { kind: 'kindle', location: { start: 12, end: 14 }, annotationId: 'AMZ-9' },
        },
      ],
      random: () => 0.5,
      noteBlocks,
    });
    expect(highlightRows(text, noteBlocks)).toEqual([
      {
        id: highlights[0]?.id,
        kind: 'kindle',
        quote: 'A *mind* lively.',
        comment: 'Emma, **again**.',
        mark: 'underline',
        color: 'orange',
        anchor:
          '{"v":1,"mark":"underline","color":"orange","kind":"kindle","location":12,"locationEnd":14,"annotationId":"AMZ-9","exact":"A *mind* lively."}',
      },
    ]);
  });

  it('is nothing for a note that could hold no highlight', () => {
    expect(mayHoldHighlights('> Quote.\n\n^abc123\n')).toBe(false);
    expect(highlightRows('> Quote.\n\n^abc123\n', noteBlocks)).toEqual([]);
  });
});

describe('a literature note for a Kindle book', () => {
  it('keeps the ASIN the sync finds the book by, and reads it back', () => {
    const text = literatureNoteText({
      kind: 'kindle',
      title: 'Emma',
      author: 'Jane Austen',
      file: null,
      asin: 'B004TEST01',
    });
    expect(text).toContain('asin: "B004TEST01"');
    expect(
      readLiteratureNote({ type: 'literature', kind: 'kindle', title: 'Emma', asin: 'B004TEST01' })
        ?.asin,
    ).toBe('B004TEST01');
  });

  it('has no ASIN when none is given or it is blank', () => {
    expect(
      literatureNoteText({ kind: 'kindle', title: 'Emma', author: null, file: null }),
    ).not.toContain('asin');
    expect(
      readLiteratureNote({ type: 'literature', kind: 'kindle', title: 'Emma', asin: '  ' })?.asin,
    ).toBeNull();
  });
});

describe('a source file a wiki link can name', () => {
  it.each([
    'Library/C# in Depth.pdf',
    'Library/Notes [draft].pdf',
    'Library/A^b.pdf',
    'Library/A|b.pdf',
  ])('refuses %j, with an error that names the file', (file) => {
    const make = () =>
      literatureNoteText({ kind: 'pdf', title: 'T', author: null, file: createVaultPath(file) });
    expect(make).toThrow(UnsafeSourceFileError);
    expect(make).toThrow(file);
  });

  it('makes a file name safe by replacing what a link cannot hold, and keeps the rest', () => {
    expect(safeSourceFileName('C# in Depth [2nd ed.].pdf')).toBe('C- in Depth -2nd ed.-.pdf');
    expect(safeSourceFileName('A^b|c.epub')).toBe('A-b-c.epub');
    expect(safeSourceFileName('The Art of War.pdf')).toBe('The Art of War.pdf');
  });

  it('gives a name the writer accepts, whatever it was', () => {
    for (const name of ['#.pdf', '[[x]].pdf', '^|.pdf', 'plain.pdf']) {
      const file = createVaultPath(`Library/${safeSourceFileName(name)}`);
      expect(() =>
        literatureNoteText({ kind: 'pdf', title: 'T', author: null, file }),
      ).not.toThrow();
    }
  });
});
