import { describe, expect, it } from 'vitest';
import { homeFolderOf } from '../home-folders/home-folder.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  isSourceNote,
  readSourceNote,
  SOURCE_NOTE_TYPE,
  sourceNotePath,
  sourceNoteText,
} from './source-note.ts';
import { highlightRows, mayHoldHighlights } from './highlight-rows.ts';
import { appendHighlights } from './edit-highlights.ts';

describe('a source note', () => {
  it('is a note whose type is source, whatever its case and spacing', () => {
    expect(isSourceNote({ type: 'source' })).toBe(true);
    expect(isSourceNote({ type: ' Source ' })).toBe(true);
    expect(isSourceNote({ type: 'sources' })).toBe(false);
    expect(isSourceNote({ type: ['source'] })).toBe(false);
    expect(isSourceNote({ atlas: 'source' })).toBe(false);
  });

  it('says its kind, title, author and file', () => {
    expect(
      readSourceNote({
        type: 'source',
        kind: 'epub',
        title: 'Moby Dick',
        author: 'Herman Melville',
        file: '[[Sources/Moby Dick.epub]]',
      }),
    ).toEqual({
      kind: 'epub',
      title: 'Moby Dick',
      author: 'Herman Melville',
      file: createVaultPath('Sources/Moby Dick.epub'),
    });
  });

  it('reads its file from a link with an alias or a heading, or from a bare path', () => {
    const fileOf = (file: unknown) =>
      readSourceNote({ type: 'source', kind: 'pdf', title: 'T', file })?.file ?? null;
    expect(fileOf('[[Sources/T.pdf|the book]]')).toBe(createVaultPath('Sources/T.pdf'));
    expect(fileOf('[[Sources/T.pdf#page=3]]')).toBe(createVaultPath('Sources/T.pdf'));
    expect(fileOf('Sources/T.pdf')).toBe(createVaultPath('Sources/T.pdf'));
    expect(fileOf('[[ ]]')).toBeNull();
    expect(fileOf('/etc/passwd')).toBeNull();
    expect(fileOf(undefined)).toBeNull();
  });

  it('has no author or file when it says none, and a number as a title is words', () => {
    expect(readSourceNote({ type: 'source', kind: 'kindle', title: 1984, author: '  ' })).toEqual({
      kind: 'kindle',
      title: '1984',
      author: null,
      file: null,
    });
  });

  it.each([
    ['not a source', { type: 'book', kind: 'pdf', title: 'T' }],
    ['an unknown kind', { type: 'source', kind: 'scroll', title: 'T' }],
    ['no title', { type: 'source', kind: 'pdf', title: ' ' }],
    ['a title that is a list', { type: 'source', kind: 'pdf', title: ['T'] }],
  ])('is not read from %s', (_label, frontmatter) => {
    expect(readSourceNote(frontmatter)).toBeNull();
  });

  it("is written as frontmatter alone, every value quoted, Kindle's with no file", () => {
    expect(
      sourceNoteText({
        kind: 'pdf',
        title: 'The Art of War: "Annotated"',
        author: 'Sun Tzu',
        file: createVaultPath('Sources/The Art of War.pdf'),
      }),
    ).toBe(
      [
        '---',
        'type: source',
        'kind: pdf',
        'title: "The Art of War: \\"Annotated\\""',
        'author: "Sun Tzu"',
        'file: "[[Sources/The Art of War.pdf]]"',
        '---',
        '',
      ].join('\n'),
    );
    expect(sourceNoteText({ kind: 'kindle', title: 'Emma', author: null, file: null })).toBe(
      '---\ntype: source\nkind: kindle\ntitle: "Emma"\n---\n',
    );
  });

  it('lives in Sources unless a folder is given, named for its title', () => {
    expect(sourceNotePath('Moby Dick: or, The Whale')).toBe(
      createVaultPath('Sources/Moby Dick or, The Whale.md'),
    );
    expect(sourceNotePath('Emma', createVaultPath('Reading'))).toBe(
      createVaultPath('Reading/Emma.md'),
    );
  });

  it("has Sources as its type's home folder (ADR-0038)", () => {
    expect(
      homeFolderOf({ properties: { type: SOURCE_NOTE_TYPE }, types: [], today: '2026-10-21' }),
    ).toBe(createVaultPath('Sources'));
  });
});

describe("a source note's index rows", () => {
  it('is a row per highlight: its id, kind, plain quote, comment, style and marker JSON', () => {
    const { text, highlights } = appendHighlights({
      text: sourceNoteText({ kind: 'kindle', title: 'Emma', author: null, file: null }),
      highlights: [
        {
          quote: 'A *mind* lively.',
          comment: 'Emma, **again**.',
          style: { mark: 'underline', color: 'orange' },
          anchor: { kind: 'kindle', location: { start: 12, end: 14 }, annotationId: 'AMZ-9' },
        },
      ],
      random: () => 0.5,
    });
    expect(highlightRows(text)).toEqual([
      {
        id: highlights[0]?.id,
        kind: 'kindle',
        quote: 'A *mind* lively.',
        comment: 'Emma, **again**.',
        mark: 'underline',
        color: 'orange',
        anchor:
          '{"v":1,"mark":"underline","color":"orange","kind":"kindle","location":12,"locationEnd":14,"annotationId":"AMZ-9"}',
      },
    ]);
  });

  it('is nothing for a note that could hold no highlight', () => {
    expect(mayHoldHighlights('> Quote.\n\n^abc123\n')).toBe(false);
    expect(highlightRows('> Quote.\n\n^abc123\n')).toEqual([]);
  });
});
