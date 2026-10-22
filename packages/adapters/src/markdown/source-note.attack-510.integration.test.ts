/**
 * Attack on PR #510 (#503, ADR-0043), through the real markdown reader: a
 * source note DFAI writes reads back as the same source, and its highlights
 * reach the index, whatever the title or the note's encoding.
 */
import { describe, expect, it } from 'vitest';
import {
  appendHighlights,
  createVaultPath,
  readSourceNote,
  sourceNoteText,
  splitFrontmatter,
  type SourceNote,
} from '@dfai/domain';
import { toIndexedNote } from '@dfai/application';
import { remarkMarkdown } from './markdown-port.ts';

const readBack = (source: SourceNote) => {
  const text = sourceNoteText(source);
  return readSourceNote(remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter));
};

function steps(): () => number {
  let at = 0;
  return () => ((at++ * 11) % 36) / 36;
}

const indexedHighlights = (text: string) =>
  toIndexedNote({
    file: { path: 'Sources/Emma.md', text, modified: 1, size: text.length },
    notePaths: [createVaultPath('Sources/Emma.md')],
    markdown: remarkMarkdown,
  }).highlights;

describe('a source note DFAI writes reads back as the same source (attack on #510)', () => {
  const titles = [
    'He said "no", then: yes',
    'C:\\Books\\War & Peace',
    'Leading space and # hash',
    'Ünïcödé — 📚 «guillemets»',
    'Line\u2028separated',
    '- looks like a list',
    "It's 'quoted'",
  ];

  it.each(titles)('keeps the title %j', (title) => {
    expect(readBack({ kind: 'kindle', title, author: 'Mara Quill', file: null })?.title).toBe(
      title.trim(),
    );
  });

  it('keeps the file of a PDF whose name holds `#`', () => {
    const file = createVaultPath('Sources/F# for Fun.pdf');
    expect(readBack({ kind: 'pdf', title: 'F# for Fun', author: null, file })?.file).toBe(file);
  });
});

describe('a source note saved by another editor (attack on #510)', () => {
  const highlight = {
    quote: 'Emma Woodhouse, handsome, clever, and rich',
    anchor: { kind: 'kindle' as const, location: { start: 12, end: null }, annotationId: 'AMZ-1' },
  };

  it('indexes the highlight added to a note that starts with a byte-order mark and uses CRLF', () => {
    const note =
      `\uFEFF${sourceNoteText({ kind: 'kindle', title: 'Emma', author: null, file: null })}`.replace(
        /\n/g,
        '\r\n',
      );
    const { text } = appendHighlights({ text: note, highlights: [highlight], random: steps() });
    expect(indexedHighlights(text).map((row) => row.quote)).toEqual([highlight.quote]);
  });
});
