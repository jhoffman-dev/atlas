import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from './editor-node.ts';
import { outlineOf } from './heading-outline.ts';
import { nodeAt } from './block-outline.ts';

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (value: string): EditorNode => ({ type: 'paragraph', content: [text(value)] });
const heading = (level: unknown, ...content: EditorNode[]): EditorNode => ({
  type: 'heading',
  attrs: { level },
  content,
});
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

describe('outlineOf (attack #353)', () => {
  it('passes over headings with no content, no text, or whitespace and breaks alone', () => {
    const note = doc(
      { type: 'heading', attrs: { level: 1 } },
      heading(2),
      heading(2, text('   ')),
      heading(3, { type: 'hardBreak' }, text('\t')),
      heading(2, text('Kept')),
    );
    expect(outlineOf(note)).toEqual([{ text: 'Kept', level: 2, at: [4] }]);
  });

  it('keeps a skipped level as written: h1 then h4', () => {
    const note = doc(heading(1, text('Top')), heading(4, text('Deep')));
    expect(outlineOf(note).map((each) => each.level)).toEqual([1, 4]);
  });

  it('joins a heading broken across lines with one space', () => {
    const note = doc(heading(2, text('First'), { type: 'hardBreak' }, text('second')));
    expect(outlineOf(note)[0]!.text).toBe('First second');
  });

  it('keeps very long heading text whole', () => {
    const long = 'Larkspur '.repeat(500).trim();
    expect(outlineOf(doc(heading(2, text(long))))[0]!.text).toBe(long);
  });

  it('lists a thousand headings in order, each at its own top-level path', () => {
    const blocks = Array.from({ length: 1000 }, (_, at) =>
      at % 2 === 0 ? heading((at % 6) + 1, text(`H${at}`)) : paragraph(`p${at}`),
    );
    const outline = outlineOf(doc(...blocks));
    expect(outline).toHaveLength(500);
    expect(outline.map((each) => each.at[0])).toEqual(
      Array.from({ length: 500 }, (_, at) => at * 2),
    );
  });

  it('gives a path nodeAt reads back as the very heading listed', () => {
    const note = doc(
      paragraph('intro'),
      heading(2, text('Goal')),
      paragraph('x'),
      heading(3, text('Step')),
    );
    for (const each of outlineOf(note)) {
      const node = nodeAt(note, each.at);
      expect(node?.type).toBe('heading');
    }
  });

  it('keeps every level inside the six a heading can have, whatever the attrs say', () => {
    const note = doc(
      heading(0, text('Zero')),
      heading(9, text('Nine')),
      heading(Number.NaN, text('NaN')),
    );
    for (const each of outlineOf(note)) {
      expect(each.level).toBeGreaterThanOrEqual(1);
      expect(each.level).toBeLessThanOrEqual(6);
    }
  });

  it('leaves out headings inside a quote or a callout, as blockOutline does', () => {
    const quoted: EditorNode = { type: 'blockquote', content: [heading(2, text('Quoted'))] };
    const callout: EditorNode = {
      type: 'callout',
      attrs: { kind: 'note' },
      content: [heading(2, text('In callout'))],
    };
    expect(outlineOf(doc(quoted, callout, heading(2, text('Top'))))).toEqual([
      { text: 'Top', level: 2, at: [2] },
    ]);
  });
});
