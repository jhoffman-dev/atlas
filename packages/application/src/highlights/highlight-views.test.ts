import { describe, expect, it } from 'vitest';
import { highlightMarker } from '@dfai/domain';
import { lineNoteBlocks } from '@dfai/domain/testing';
import { literatureHighlightReader } from './highlight-views.ts';

/*
 * Which blocks of an open note the editor draws as highlights (#523): only a
 * literature note's, only those the note reads as highlights where they
 * stand, and each drawn from its own bytes.
 */

const markdown = { noteBlocks: lineNoteBlocks };
const MARKER = highlightMarker({
  style: { mark: 'underline', color: 'green' },
  anchor: { kind: 'kindle', location: { start: 41, end: 44 }, annotationId: null },
});
const BLOCK = `> The last lamp.\n> ${MARKER}\n>\n> Lit by [[Mara Quill]].`;
const TEXT = `---\ntype: literature\n---\n${BLOCK}\n\n^k3x9q2\n`;
const LITERATURE = { type: 'literature', kind: 'kindle', title: 'The Lantern Keepers' };

const reader = (properties: Record<string, unknown> = LITERATURE, text = TEXT) =>
  literatureHighlightReader(markdown, { properties, text });

describe('literatureHighlightReader', () => {
  it('reads nothing as a highlight in a note that is no literature note', () => {
    expect(reader({ type: 'meeting' })).toBeNull();
  });

  it('draws a highlight of the note as its words, comment and mark, its marker left out', () => {
    expect(reader()?.({ markdown: BLOCK, id: 'k3x9q2' })).toEqual({
      id: 'k3x9q2',
      words: 'The last lamp.',
      picture: null,
      comment: 'Lit by [[Mara Quill]].',
      mark: 'underline',
      color: 'green',
    });
  });

  it('draws a block from its own bytes, not from what the note last read', () => {
    const edited = BLOCK.replace('Lit by [[Mara Quill]].', 'Changed.');
    expect(reader()?.({ markdown: edited, id: 'k3x9q2' })?.comment).toBe('Changed.');
  });

  it('reads a block written with Windows line endings', () => {
    const crlf = BLOCK.replace(/\n/g, '\r\n');
    expect(reader()?.({ markdown: crlf, id: 'k3x9q2' })?.words).toBe('The last lamp.');
  });

  it.each([
    ['an id the note holds no highlight for', BLOCK, 'zz9zz9'],
    ['a quote with no marker', '> The last lamp.', 'k3x9q2'],
    ['a quote with two markers', `${BLOCK}\n> ${MARKER}`, 'k3x9q2'],
  ])('draws %s as its source', (_label, block, id) => {
    expect(reader()?.({ markdown: block, id })).toBeNull();
  });
});
