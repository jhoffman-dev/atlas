import { describe, expect, it } from 'vitest';
import { blockAnchorsOf, withAnchorAt, type EditorDocument, type EditorNode } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/*
 * Adversarial pass on P26-01 block ids, over notes as people write them by
 * hand: blocks with no blank line between them, a fence left open at the end
 * of the file, and a paragraph whose words are `^abc` that ends up next to a
 * block that takes its id on a line after it. The seeded property test only
 * sees notes the app wrote, which always put a blank line between blocks.
 */

/** The note saved with `change` made to its document. */
function saved(body: string, change: (doc: EditorDocument) => EditorDocument): string {
  const parsed = parseMarkdownBody(body);
  return serializeMarkdownBody({ originalBody: body, parsed, doc: change(parsed.doc) });
}

const textOf = (node: EditorNode): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

/** Each block as a reader sees it: its kind, its words, and the ids it carries. */
const reading = (body: string) =>
  parseMarkdownBody(body).doc.content.map((node) => ({
    type: node.type,
    text: textOf(node),
    ids: blockAnchorsOf(node),
  }));

describe('an id added on a line after a block changes nothing else', () => {
  it('keeps the paragraph right after a fence a paragraph of its own', () => {
    const body = '```\nx\n```\nnext\n';
    const out = saved(body, (doc) => withAnchorAt(doc, [0], 'q1'));
    expect(reading(out)).toEqual([
      { type: 'codeBlock', text: 'x', ids: ['q1'] },
      { type: 'paragraph', text: 'next', ids: [null] },
    ]);
  });

  it('keeps the paragraph right after indented code a paragraph of its own', () => {
    const body = '    code\nnext\n';
    const out = saved(body, (doc) => withAnchorAt(doc, [0], 'q1'));
    expect(reading(out)).toEqual([
      { type: 'codeBlock', text: 'code', ids: ['q1'] },
      { type: 'paragraph', text: 'next', ids: [null] },
    ]);
  });

  it('keeps the paragraph right after a link definition a paragraph of its own', () => {
    const body = '[x]: http://a.example\npara\n';
    const out = saved(body, (doc) => withAnchorAt(doc, [0], 'q1'));
    expect(reading(out)).toEqual([
      { type: 'rawBlock', text: '', ids: ['q1'] },
      { type: 'paragraph', text: 'para', ids: [null] },
    ]);
  });

  it('keeps a rule right after a list a rule, not a heading made of the id', () => {
    const body = '- a\n---\n';
    const out = saved(body, (doc) => withAnchorAt(doc, [0], 'q1'));
    expect(reading(out)).toEqual([
      { type: 'bulletList', text: 'a', ids: [null, 'q1'] },
      { type: 'horizontalRule', text: '', ids: [] },
    ]);
  });

  it('keeps a fence left open at the end of the file holding only its own code', () => {
    const body = '```\nx\n';
    const out = saved(body, (doc) => withAnchorAt(doc, [0], 'q1'));
    expect(reading(out)).toEqual([{ type: 'codeBlock', text: 'x', ids: ['q1'] }]);
  });

  it('keeps an unclosed comment holding only its own text', () => {
    // A comment left open runs to the end of the file: no id after it could be
    // read as one, so none is written, rather than one swallowed into the comment.
    const body = '<!-- c\nmore\n';
    const out = saved(body, (doc) => withAnchorAt(doc, [0], 'q1'));
    expect(out).toBe(body);
    expect(reading(out)).toEqual([{ type: 'rawBlock', text: '', ids: [null] }]);
  });
});

describe('a paragraph that reads `^abc` stays a paragraph when its neighbours change', () => {
  it('survives the block between it and a table being deleted', () => {
    const body = '| a |\n| - |\n\nmiddle\n\n^abc\n';
    const out = saved(body, (doc) => ({ ...doc, content: [doc.content[0]!, doc.content[2]!] }));
    expect(reading(out)).toEqual([
      { type: 'table', text: 'a', ids: [null] },
      { type: 'paragraph', text: '^abc', ids: [null] },
    ]);
  });

  it('survives the table before it losing its own id', () => {
    const body = '| a |\n| - |\n\n^x\n\n^y\n';
    const out = saved(body, (doc) => withAnchorAt(doc, [0], null));
    expect(reading(out)).toEqual([
      { type: 'table', text: 'a', ids: [null] },
      { type: 'paragraph', text: '^y', ids: [null] },
    ]);
  });

  it('survives being moved to just after a table', () => {
    const body = '# H\n\n^abc\n\n| a |\n| - |\n';
    const out = saved(body, (doc) => ({
      ...doc,
      content: [doc.content[0]!, doc.content[2]!, doc.content[1]!],
    }));
    expect(reading(out)).toEqual([
      // A heading has a place for an id since A26-01; this one has none.
      { type: 'heading', text: 'H', ids: [null] },
      { type: 'table', text: 'a', ids: [null] },
      { type: 'paragraph', text: '^abc', ids: [null] },
    ]);
  });

  it('survives being moved to just after a list', () => {
    const body = '# H\n\n^abc\n\n- a\n';
    const out = saved(body, (doc) => ({
      ...doc,
      content: [doc.content[0]!, doc.content[2]!, doc.content[1]!],
    }));
    expect(reading(out)).toEqual([
      // A heading has a place for an id since A26-01; this one has none.
      { type: 'heading', text: 'H', ids: [null] },
      { type: 'bulletList', text: 'a', ids: [null, null] },
      { type: 'paragraph', text: '^abc', ids: [null] },
    ]);
  });
});

describe('an id added to a list item reads back on that item', () => {
  it('holds for an item that is a bare `[ ]` in a task list', () => {
    // `- [ ] ` with nothing after is words to GFM, `[ ]`; since A26-01 it is
    // read as the empty task Obsidian draws, whose id follows its box.
    const body = '- [ ] \n- [x] b\n';
    const before = reading(body);
    expect(before[0]).toMatchObject({ type: 'taskList', text: 'b' });
    const out = saved(body, (doc) => withAnchorAt(doc, [0, 0], 'q1'));
    expect(reading(out)).toEqual([{ type: 'taskList', text: 'b', ids: ['q1', null, null] }]);
  });
});

describe('sound: typed text that looks like an id is written as text', () => {
  const paragraph = (text: string): EditorNode => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });

  it('reads a new `^abc` paragraph after a table back as a paragraph', () => {
    const out = saved('| a |\n| - |\n', (doc) => ({
      ...doc,
      content: [doc.content[0]!, paragraph('^abc')],
    }));
    expect(reading(out)).toEqual([
      { type: 'table', text: 'a', ids: [null] },
      { type: 'paragraph', text: '^abc', ids: [null] },
    ]);
  });

  it('reads `mc ^2` typed in a list item back as its words', () => {
    const out = saved('- x\n', (doc) => ({
      ...doc,
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('a ^b')] }] },
      ],
    }));
    expect(reading(out)).toEqual([{ type: 'bulletList', text: 'a ^b', ids: [null, null] }]);
  });
});
