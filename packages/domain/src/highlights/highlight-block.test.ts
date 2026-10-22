import { describe, expect, it } from 'vitest';
import { lineNoteBlocks as noteBlocks } from '../testing/line-note-blocks.ts';
import {
  highlightBlockText,
  lineEndingOf,
  readHighlights,
  type NoteBlocks,
  type TextSpan,
} from './highlight-block.ts';
import { highlightMarker } from './highlight-marker.ts';

const MARKER = highlightMarker({
  style: { mark: 'highlight', color: 'yellow' },
  anchor: { kind: 'kindle', location: { start: 41, end: 44 }, annotationId: null },
});

/** A literature note as Obsidian or DFAI would hold it: two highlights, words around them. */
const NOTE = [
  '---',
  'type: literature',
  'kind: kindle',
  'title: "Moby Dick"',
  '---',
  '# Moby Dick',
  '',
  '> Call me Ishmael.',
  `> ${MARKER}`,
  '',
  '^ish001',
  '',
  'Some words of my own.',
  '',
  '> It is a damp, drizzly',
  '> November in my soul.',
  '>',
  '> A second paragraph of quote.',
  `> ${MARKER}`,
  '>',
  '> **Mood**: grey.',
  '>',
  '> - wet',
  '',
  '^nov002',
  '',
].join('\n');

describe('reading highlights', () => {
  it('reads each highlight: its id, quote, comment, style and anchor', () => {
    const [first, second] = readHighlights(NOTE, noteBlocks);
    expect(readHighlights(NOTE, noteBlocks)).toHaveLength(2);
    expect(first).toMatchObject({
      id: 'ish001',
      quote: 'Call me Ishmael.',
      comment: '',
      style: { mark: 'highlight', color: 'yellow' },
      anchor: { kind: 'kindle', location: { start: 41, end: 44 }, annotationId: null },
    });
    expect(second).toMatchObject({
      id: 'nov002',
      quote: 'It is a damp, drizzly\nNovember in my soul.\n\nA second paragraph of quote.',
      comment: '**Mood**: grey.\n\n- wet',
    });
  });

  it('says where each part of the block is in the text', () => {
    const [first, second] = readHighlights(NOTE, noteBlocks);
    expect(NOTE.slice(first?.start, first?.end)).toBe(
      `> Call me Ishmael.\n> ${MARKER}\n\n^ish001\n`,
    );
    expect(first?.markerEnd).toBe(first?.quoteEnd);
    expect(NOTE.slice(second?.markerEnd, second?.quoteEnd)).toBe(
      '>\n> **Mood**: grey.\n>\n> - wet\n',
    );
  });

  it('reads a block at the very start of a note with no frontmatter, and one with no final line ending', () => {
    const text = `> Words.\n> ${MARKER}\n\n^abc123`;
    expect(
      readHighlights(text, noteBlocks).map((block) => [block.id, block.start, block.end]),
    ).toEqual([['abc123', 0, text.length]]);
  });

  it('reads a quote line with no space after `>`, and spaces after the id', () => {
    expect(
      readHighlights(`>Words.\n>${MARKER}\n>\n>Comment.\n\n^abc123  \n`, noteBlocks),
    ).toMatchObject([{ id: 'abc123', quote: 'Words.', comment: 'Comment.' }]);
  });

  it('reads a note saved on Windows', () => {
    const text = NOTE.replace(/\n/g, '\r\n');
    expect(
      readHighlights(text, noteBlocks).map(({ id, quote, comment }) => ({ id, quote, comment })),
    ).toEqual(
      readHighlights(NOTE, noteBlocks).map(({ id, quote, comment }) => ({ id, quote, comment })),
    );
    expect(lineEndingOf(text)).toBe('\r\n');
    expect(lineEndingOf(NOTE)).toBe('\n');
  });

  it.each([
    ['no blank line before the id', `> Quote.\n> ${MARKER}\n^abc123\n`],
    ['no id', `> Quote.\n> ${MARKER}\n\nWords.\n`],
    ['nothing after the blank line', `> Quote.\n> ${MARKER}\n\n`],
    ['an id with words before it', `> Quote.\n> ${MARKER}\n\nsee ^abc123\n`],
    ['no marker', '> Quote.\n\n^abc123\n'],
    ['two markers', `> Quote.\n> ${MARKER}\n> ${MARKER}\n\n^abc123\n`],
    ['a marker with no words before it', `> ${MARKER}\n>\n> Comment.\n\n^abc123\n`],
    ['blank quote lines before the marker', `>\n> ${MARKER}\n\n^abc123\n`],
    ['a broken marker', '> Quote.\n> <!-- atlas:highlight {"v":1, -->\n\n^abc123\n'],
    ['a marker inside the words', `> Quote ${MARKER}\n\n^abc123\n`],
  ])('reads no highlight from %s', (_label, text) => {
    expect(readHighlights(text, noteBlocks)).toEqual([]);
  });

  it('reads nothing in the frontmatter', () => {
    expect(
      readHighlights(`---\nnote: |\n\n  x\n---\n> Quote.\n> ${MARKER}\n\n^abc123\n`, noteBlocks),
    ).toHaveLength(1);
    const inFrontmatter = `---\n\n> Quote.\n> ${MARKER}\n\n^abc123\n---\nBody.\n`;
    expect(readHighlights(inFrontmatter, noteBlocks)).toEqual([]);
  });

  it('reads on past a quote that is not a highlight', () => {
    const text = `> Just a quote.\n\n> Quote.\n> ${MARKER}\n\n^abc123\n`;
    expect(readHighlights(text, noteBlocks).map((block) => block.id)).toEqual(['abc123']);
  });
});

describe('reading the blocks the parser found (ADR-0043 §2)', () => {
  const BLOCK = `> Quote.\n> ${MARKER}\n\n^abc123\n`;
  /** The spans of `quote` and `paragraph` in `text`, found by their words: what a parser would say. */
  const spanOf = (text: string, part: string): TextSpan => {
    const start = text.indexOf(part);
    return { start, end: start + part.length };
  };
  const blocks = (
    text: string,
    quote: string,
    paragraph: string | null,
    hidden: TextSpan[] = [],
  ): (() => NoteBlocks) => {
    const found = spanOf(text, quote);
    const after = paragraph === null ? null : spanOf(text, paragraph);
    return () => ({ quotes: [{ ...found, paragraphAfter: after }], hidden });
  };
  const QUOTE = `> Quote.\n> ${MARKER}`;
  const ids = (text: string, given: () => NoteBlocks) =>
    readHighlights(text, given).map((block) => block.id);

  it('reads a highlight from a quote the parser found and the `^id` paragraph after it', () => {
    expect(ids(BLOCK, blocks(BLOCK, QUOTE, '^abc123'))).toEqual(['abc123']);
  });

  it('reads none when the parser found no paragraph after the quote', () => {
    expect(ids(BLOCK, blocks(BLOCK, QUOTE, null))).toEqual([]);
  });

  it('reads none when the paragraph after runs past the id line', () => {
    const text = `${QUOTE}\n\n^abc123\nmore words\n`;
    expect(ids(text, blocks(text, QUOTE, '^abc123\nmore words'))).toEqual([]);
  });

  it('reads none when more than one blank line parts the quote from its id', () => {
    const text = `${QUOTE}\n\n\n^abc123\n`;
    expect(ids(text, blocks(text, QUOTE, '^abc123'))).toEqual([]);
  });

  it('reads none whose first line a `%%` comment hides, and one whose comment only opens it', () => {
    expect(ids(BLOCK, blocks(BLOCK, QUOTE, '^abc123', [{ start: 0, end: BLOCK.length }]))).toEqual(
      [],
    );
    const opened = `> Quote.\n> ${MARKER}\n>\n> A thought %% to hide\n\n^abc123\n`;
    const quote = opened.slice(0, opened.indexOf('\n\n^'));
    const hidden = [{ start: opened.indexOf('%%'), end: opened.length }];
    expect(ids(opened, blocks(opened, quote, '^abc123', hidden))).toEqual(['abc123']);
  });

  it('reads a quote whose `>` is indented, from the start of its line, its indent taken off', () => {
    const text = `  > Quote.\n   > ${MARKER}\n\n^abc123\n`;
    const [block] = readHighlights(text, blocks(text, `> Quote.\n   > ${MARKER}`, '^abc123'));
    expect(block?.start).toBe(0);
    expect(block?.quote).toBe('Quote.');
  });

  it('keeps a line the parser kept in the quote without its `>` as the comment wrote it', () => {
    const text = `> Quote.\n> ${MARKER}\n>\n> A comment,\nwent on here.\n\n^abc123\n`;
    const quote = text.slice(0, text.indexOf('\n\n^'));
    const [block] = readHighlights(text, blocks(text, quote, '^abc123'));
    expect(block?.comment).toBe('A comment,\nwent on here.');
    expect(block?.quoteEnd).toBe(text.indexOf('\n\n^') + 1);
  });

  it('reads offsets into the whole note in a note saved on Windows', () => {
    const text = BLOCK.replace(/\n/g, '\r\n');
    const [block] = readHighlights(text, blocks(text, `> Quote.\r\n> ${MARKER}`, '^abc123'));
    expect(block).toMatchObject({ id: 'abc123', quote: 'Quote.', end: text.length });
    expect(text.slice(block?.markerEnd)).toBe('\r\n^abc123\r\n');
  });
});

describe('writing a highlight block', () => {
  const parts = {
    id: 'k3x9q2',
    quoteLines: ['First paragraph.', 'Second paragraph.'],
    commentLines: ['My **thought**.', '', 'More.'],
    style: { mark: 'highlight', color: 'yellow' } as const,
    anchor: { kind: 'kindle', location: { start: 41, end: 44 }, annotationId: null } as const,
  };

  it('writes the quote, the marker, the comment, then the id after a blank line', () => {
    expect(highlightBlockText(parts, '\n')).toBe(
      [
        '> First paragraph.',
        '>',
        '> Second paragraph.',
        `> ${MARKER}`,
        '>',
        '> My **thought**.',
        '>',
        '> More.',
        '',
        '^k3x9q2',
        '',
      ].join('\n'),
    );
  });

  it('writes no comment lines for no comment', () => {
    expect(highlightBlockText({ ...parts, commentLines: [] }, '\n')).toBe(
      `> First paragraph.\n>\n> Second paragraph.\n> ${MARKER}\n\n^k3x9q2\n`,
    );
  });

  it("writes in the note's line ending, and reads back as what it was written from", () => {
    const text = highlightBlockText(parts, '\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(readHighlights(text, noteBlocks)).toMatchObject([
      {
        id: 'k3x9q2',
        quote: 'First paragraph.\n\nSecond paragraph.',
        comment: 'My **thought**.\n\nMore.',
        style: parts.style,
        anchor: parts.anchor,
        start: 0,
        end: text.length,
      },
    ]);
  });
});
