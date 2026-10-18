import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from './editor-node.ts';
import { outlineOf } from './heading-outline.ts';

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (value: string): EditorNode => ({ type: 'paragraph', content: [text(value)] });
const heading = (level: number, ...content: EditorNode[]): EditorNode => ({
  type: 'heading',
  attrs: { level },
  content,
});
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

describe('outlineOf', () => {
  it('lists the headings in the note’s order, nested ones by their level', () => {
    const note = doc(
      heading(1, text('Plans')),
      paragraph('The summer, roughly.'),
      heading(2, text('June')),
      heading(3, text('Larkspur launch')),
      heading(2, text('July')),
    );
    expect(outlineOf(note)).toEqual([
      { text: 'Plans', level: 1, at: [0] },
      { text: 'June', level: 2, at: [2] },
      { text: 'Larkspur launch', level: 3, at: [3] },
      { text: 'July', level: 2, at: [4] },
    ]);
  });

  it('is empty for a note with no headings', () => {
    expect(outlineOf(doc(paragraph('Just words.'), paragraph('More words.')))).toEqual([]);
    expect(outlineOf(doc())).toEqual([]);
  });

  it('passes over a heading with no words, and squeezes the words of one that has', () => {
    const note = doc(heading(2), heading(2, text('   ')), heading(1, text('  Two \n words  ')));
    expect(outlineOf(note)).toEqual([{ text: 'Two words', level: 1, at: [2] }]);
  });

  it('reads a heading without a level as the top one', () => {
    const note = doc({ type: 'heading', content: [text('Loose')] });
    expect(outlineOf(note)).toEqual([{ text: 'Loose', level: 1, at: [0] }]);
  });

  it('reads the words through the marks a heading carries', () => {
    const note = doc(
      heading(1, { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] }, text('plan')),
    );
    expect(outlineOf(note)).toEqual([{ text: 'Bold plan', level: 1, at: [0] }]);
  });
});
