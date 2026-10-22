/**
 * #503 (integration): a literature note's highlights as the index is told them,
 * read by the real markdown reader — a row per highlight, in order, with its
 * plain words, comment and marker — and none for the same text in a note
 * that is not a source, or for a look-alike in code.
 */
import { describe, expect, it } from 'vitest';
import { noteBlocks } from './note-blocks.ts';
import { appendHighlights, createVaultPath, literatureNoteText } from '@dfai/domain';
import { toIndexedNote } from '@dfai/application';
import { remarkMarkdown } from './markdown-port.ts';

function steps(): () => number {
  let at = 0;
  return () => ((at++ * 11) % 36) / 36;
}

const SOURCE = appendHighlights({
  text: `${literatureNoteText({
    kind: 'pdf',
    title: 'The Art of War',
    author: 'Sun Tzu',
    file: createVaultPath('Library/The Art of War.pdf'),
  })}\`\`\`\n> Not one.\n> <!-- atlas:highlight {"v":1,"kind":"kindle","location":3} -->\n\n^fake01\n\`\`\`\n`,
  highlights: [
    {
      quote: 'All warfare is based on *deception*.',
      comment: 'See [[Larkspur Payroll]].',
      anchor: {
        kind: 'pdf',
        page: 3,
        quote: { exact: 'All warfare is based on deception.', prefix: '', suffix: '' },
        rects: [],
      },
    },
    {
      quote: 'Know the enemy.',
      style: { mark: 'underline', color: 'green' },
      anchor: { kind: 'kindle', location: { start: 120, end: null }, annotationId: 'AMZ-7' },
    },
  ],
  random: steps(),
  noteBlocks,
});

const indexed = (path: string, text: string) =>
  toIndexedNote({
    file: { path, text, modified: 1, size: text.length },
    notePaths: [createVaultPath(path)],
    markdown: remarkMarkdown,
  });

describe("a literature note's highlights in the index", () => {
  it('is a row per highlight, in order, the code look-alike left out', () => {
    const note = indexed('Library/The Art of War.md', SOURCE.text);
    expect(note.type).toBe('literature');
    expect(
      note.highlights.map(({ id, kind, quote, comment, mark, color }) => ({
        id,
        kind,
        quote,
        comment,
        mark,
        color,
      })),
    ).toEqual([
      {
        id: SOURCE.highlights[0]?.id,
        kind: 'pdf',
        quote: 'All warfare is based on *deception*.',
        comment: 'See [[Larkspur Payroll]].',
        mark: 'highlight',
        color: 'yellow',
      },
      {
        id: SOURCE.highlights[1]?.id,
        kind: 'kindle',
        quote: 'Know the enemy.',
        comment: '',
        mark: 'underline',
        color: 'green',
      },
    ]);
    expect(JSON.parse(note.highlights[1]?.anchor ?? '')).toMatchObject({
      kind: 'kindle',
      annotationId: 'AMZ-7',
    });
    expect(note.blocks.map((block) => block.id)).toEqual(
      expect.arrayContaining(SOURCE.highlights.map((highlight) => highlight.id)),
    );
    expect(note.links.map((link) => link.target)).toContain('Larkspur Payroll');
    expect(note.body).toContain('Know the enemy');
    expect(note.body).not.toContain('AMZ-7');
  });

  it('is nothing for the same text in a note that is not a source', () => {
    const plain = SOURCE.text.replace('type: literature', 'type: notes');
    expect(indexed('Notes/Copy.md', plain).highlights).toEqual([]);
  });
});
