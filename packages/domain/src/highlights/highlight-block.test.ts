import { describe, expect, it } from 'vitest';
import { highlightBlockText, lineEndingOf, readHighlights } from './highlight-block.ts';
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
    const [first, second] = readHighlights(NOTE);
    expect(readHighlights(NOTE)).toHaveLength(2);
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
    const [first, second] = readHighlights(NOTE);
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
    expect(readHighlights(text).map((block) => [block.id, block.start, block.end])).toEqual([
      ['abc123', 0, text.length],
    ]);
  });

  it('reads a quote line with no space after `>`, and spaces after the id', () => {
    expect(readHighlights(`>Words.\n>${MARKER}\n>\n>Comment.\n\n^abc123  \n`)).toMatchObject([
      { id: 'abc123', quote: 'Words.', comment: 'Comment.' },
    ]);
  });

  it('reads a note saved on Windows', () => {
    const text = NOTE.replace(/\n/g, '\r\n');
    expect(readHighlights(text).map(({ id, quote, comment }) => ({ id, quote, comment }))).toEqual(
      readHighlights(NOTE).map(({ id, quote, comment }) => ({ id, quote, comment })),
    );
    expect(lineEndingOf(text)).toBe('\r\n');
    expect(lineEndingOf(NOTE)).toBe('\n');
  });

  it.each([
    ['no blank line before the quote', `Words.\n> Quote.\n> ${MARKER}\n\n^abc123\n`],
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
    ['an indented quote', `  > Quote.\n  > ${MARKER}\n\n^abc123\n`],
    ['a quote in a list', `- > Quote.\n  > ${MARKER}\n\n^abc123\n`],
    ['a quote in a code fence', `\`\`\`\n> Quote.\n> ${MARKER}\n\n^abc123\n\`\`\`\n`],
    ['a quote in a tilde fence', `~~~md\n> Quote.\n> ${MARKER}\n\n^abc123\n~~~\n`],
  ])('reads no highlight from %s', (_label, text) => {
    expect(readHighlights(text)).toEqual([]);
  });

  it('reads a highlight again once a fence has closed, and not until then', () => {
    const block = `> Quote.\n> ${MARKER}\n\n^abc123\n`;
    expect(readHighlights(`\`\`\`\`\n\`\`\`\n\n${block}\`\`\`\`\n\n${block}`)).toHaveLength(1);
    expect(readHighlights(`~~~\n\`\`\`\n~~~\n\n${block}`)).toHaveLength(1);
  });

  it('reads nothing in the frontmatter', () => {
    expect(
      readHighlights(`---\nnote: |\n\n  x\n---\n> Quote.\n> ${MARKER}\n\n^abc123\n`),
    ).toHaveLength(1);
    const inFrontmatter = `---\n\n> Quote.\n> ${MARKER}\n\n^abc123\n---\nBody.\n`;
    expect(readHighlights(inFrontmatter)).toEqual([]);
  });

  it('reads on past a quote that is not a highlight', () => {
    const text = `> Just a quote.\n\n> Quote.\n> ${MARKER}\n\n^abc123\n`;
    expect(readHighlights(text).map((block) => block.id)).toEqual(['abc123']);
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
    expect(readHighlights(text)).toMatchObject([
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
