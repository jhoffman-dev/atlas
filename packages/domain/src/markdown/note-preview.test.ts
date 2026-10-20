import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from './editor-node.ts';
import {
  bodyWithoutTitle,
  FEED_EXCERPT_BLOCKS,
  noteCover,
  noteExcerpt,
  previewLines,
} from './note-preview.ts';

const paragraph = (text: string): EditorNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const image = (src: string): EditorNode => ({ type: 'image', attrs: { src } });
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

describe('noteCover', () => {
  it('prefers the cover the note names', () => {
    expect(
      noteCover({
        properties: { cover: ' art/front.png ' },
        doc: doc(paragraph('a'), image('b.png')),
      }),
    ).toBe('art/front.png');
  });

  it('falls back to the first image in the body, however deep', () => {
    const nested = doc(
      paragraph('intro'),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [image('deep.png')] }] },
        ],
      },
      image('later.png'),
    );
    expect(noteCover({ properties: {}, doc: nested })).toBe('deep.png');
  });

  it('is null for a note with neither, or a blank cover and no image', () => {
    expect(noteCover({ properties: {}, doc: doc(paragraph('words')) })).toBeNull();
    expect(noteCover({ properties: { cover: '  ' }, doc: doc() })).toBeNull();
    expect(noteCover({ properties: { cover: 3 }, doc: doc(image('')) })).toBeNull();
  });
});

describe('bodyWithoutTitle', () => {
  const heading = (text: string, level = 1): EditorNode => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  });

  it('drops the opening heading that only repeats the title', () => {
    expect(bodyWithoutTitle(doc(heading('Plan'), paragraph('Body')), 'Plan')).toEqual(
      doc(paragraph('Body')),
    );
  });

  it('keeps a heading that says something else, or is not the first level', () => {
    const other = doc(heading('Context'), paragraph('Body'));
    expect(bodyWithoutTitle(other, 'Plan')).toBe(other);
    const second = doc(heading('Plan', 2), paragraph('Body'));
    expect(bodyWithoutTitle(second, 'Plan')).toBe(second);
  });

  it('keeps a title heading that is not the first block', () => {
    const later = doc(paragraph('Intro'), heading('Plan'));
    expect(bodyWithoutTitle(later, 'Plan')).toBe(later);
    expect(bodyWithoutTitle(doc(), 'Plan')).toEqual(doc());
  });
});

describe('noteExcerpt', () => {
  const blocks = (count: number) =>
    doc(...Array.from({ length: count }, (_, at) => paragraph(`block ${at}`)));

  it('keeps a short note whole', () => {
    const short = blocks(FEED_EXCERPT_BLOCKS);
    expect(noteExcerpt(short)).toEqual({ doc: short, clipped: false });
  });

  it('shows the opening blocks of a longer one, and says there is more', () => {
    const excerpt = noteExcerpt(blocks(FEED_EXCERPT_BLOCKS + 1));
    expect(excerpt.clipped).toBe(true);
    expect(excerpt.doc.content).toHaveLength(FEED_EXCERPT_BLOCKS);
    expect(excerpt.doc.content[0]).toEqual(paragraph('block 0'));
  });

  it('takes a smaller count when asked', () => {
    expect(noteExcerpt(blocks(3), 2).doc.content).toHaveLength(2);
  });
});

describe('previewLines', () => {
  const heading = (text: string): EditorNode => ({
    type: 'heading',
    attrs: { level: 1 },
    content: [{ type: 'text', text }],
  });
  const link = (target: string, alias: string | null = null): EditorNode => ({
    type: 'wikiLink',
    attrs: { target, heading: null, alias },
  });

  it('reads the opening blocks as words, leaving out a heading that repeats the title', () => {
    const body = doc(heading('Plan'), paragraph('First line.'), paragraph('Second line.'));
    expect(previewLines(body, 'Plan')).toBe('First line.\nSecond line.');
  });

  it('reads a wiki link as its alias, else its target, and a list item by item', () => {
    const body = doc(
      { type: 'paragraph', content: [{ type: 'text', text: 'Done in ' }, link('P16-04')] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph('one')] },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [link('Tasks/two', 'Two')] }],
          },
        ],
      },
    );
    expect(previewLines(body, 'Plan')).toBe('Done in P16-04\none\nTwo');
  });

  it('stops at the first few blocks, and skips the empty ones', () => {
    const many = doc(
      paragraph(''),
      ...['a', 'b', 'c', 'd', 'e', 'f'].map(paragraph),
      image('x.png'),
    );
    expect(previewLines(many, 'Plan')).toBe('a\nb\nc\nd');
  });

  it('is null for a note with no words', () => {
    expect(previewLines(doc(heading('Plan'), image('x.png')), 'Plan')).toBeNull();
    expect(previewLines(doc(), 'Plan')).toBeNull();
  });
});
