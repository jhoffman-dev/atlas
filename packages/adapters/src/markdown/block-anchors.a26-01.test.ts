import { describe, expect, it } from 'vitest';
import { blockAnchorsOf, withAnchorAt, type EditorDocument, type EditorNode } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/*
 * A26-01 in the file: a heading's id is read and written as Obsidian writes
 * it, an id the editor holds on a block inside another is written where that
 * block's id goes, one with no place left is kept as words rather than lost,
 * and only a note's block is shown in place.
 */

function saved(body: string, change: (doc: EditorDocument) => EditorDocument): string {
  const parsed = parseMarkdownBody(body);
  return serializeMarkdownBody({ originalBody: body, parsed, doc: change(parsed.doc) });
}

const fresh = (doc: EditorDocument): string =>
  serializeMarkdownBody({ originalBody: '', parsed: parseMarkdownBody(''), doc });

const textOf = (node: EditorNode): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (value: string, anchor?: string): EditorNode => ({
  type: 'paragraph',
  ...(anchor !== undefined && { attrs: { anchor } }),
  content: [text(value)],
});

describe('a heading’s id', () => {
  it('is read off the end of its words', () => {
    const [heading] = parseMarkdownBody('## Plans ^h1\n').doc.content;
    expect(heading?.type).toBe('heading');
    expect(heading?.attrs?.['anchor']).toBe('h1');
    expect(textOf(heading!)).toBe('Plans');
  });

  it('is the only thing written when one is given to a heading', () => {
    const body = '# Title\n\n##   Plans\n\nText\n';
    expect(saved(body, (doc) => withAnchorAt(doc, [1], 'zz9'))).toBe(
      '# Title\n\n##   Plans ^zz9\n\nText\n',
    );
  });

  it('is written after the words of a heading written afresh, and reads back', () => {
    const out = fresh({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2, anchor: 'h1' }, content: [text('Plans')] }],
    });
    expect(out).toBe('## Plans ^h1\n');
  });

  it('is not made of a caret typed at the end of a heading’s words', () => {
    const out = fresh({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [text('Plans ^x1')] }],
    });
    const [heading] = parseMarkdownBody(out).doc.content;
    expect(heading?.attrs?.['anchor'] ?? null).toBeNull();
    expect(textOf(heading!)).toBe('Plans ^x1');
  });
});

describe('an id on a block inside another', () => {
  it('is spliced in where its item’s id goes, and nothing else changes', () => {
    const body = '- Pack the tent\n- Book\n';
    const out = saved(body, (doc) => {
      const [list] = doc.content;
      const first = list!.content![0]!;
      const inner = { ...first.content![0]!, attrs: { anchor: 'a1' } };
      const item = { ...first, content: [inner] };
      return { ...doc, content: [{ ...list!, content: [item, list!.content![1]!] }] };
    });
    expect(out).toBe('- Pack the tent ^a1\n- Book\n');
  });

  it('is kept as words when its block already holds another id, never dropped', () => {
    const out = fresh({
      type: 'doc',
      content: [{ type: 'blockquote', content: [paragraph('One', 'a1'), paragraph('Two', 'b2')] }],
    });
    expect(out).toContain('^a1');
    expect(out).toContain('^b2');
    const [quote] = parseMarkdownBody(out).doc.content;
    expect(blockAnchorsOf(quote!)).toEqual(['a1']);
    expect(textOf(quote!)).toBe('OneTwo ^b2');
  });
});

describe('an embed of a file that is not a note', () => {
  it('stays the link it is, alone on its line', () => {
    const [block] = parseMarkdownBody('![[Paper.pdf#page=3]]\n').doc.content;
    expect(block?.type).toBe('paragraph');
    expect(block?.content?.[0]?.type).toBe('wikiLink');
  });
});
