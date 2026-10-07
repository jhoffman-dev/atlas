import { describe, expect, it } from 'vitest';
import {
  anchorsIn,
  blockAnchorsOf,
  withAnchorAt,
  type EditorDocument,
  type EditorNode,
  type NodePath,
} from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/*
 * Block ids (P26-01, ADR-0022): read off the text into the editor, kept
 * through edits and moves, and written only where they are — an id added to a
 * block that was not otherwise changed is the only thing in the file that
 * changes.
 */

const parse = (body: string) => parseMarkdownBody(body);

/** The note saved with `change` made to its document. */
function saved(body: string, change: (doc: EditorDocument) => EditorDocument): string {
  const parsed = parse(body);
  return serializeMarkdownBody({ originalBody: body, parsed, doc: change(parsed.doc) });
}

/** The node at `at`, a path from the document. */
function nodeIn(doc: EditorDocument, at: NodePath): EditorNode {
  return at.reduce<EditorNode>(
    (node, index) => node.content?.[index] as EditorNode,
    doc as unknown as EditorNode,
  );
}

const textOf = (node: EditorNode): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

/** Every block's text, with the id each carries: what a reader of the note sees. */
const reading = (body: string) =>
  parse(body).doc.content.map((node) => ({ text: textOf(node), ids: blockAnchorsOf(node) }));

describe('reading block ids', () => {
  it('takes a paragraph’s id off its text', () => {
    const [paragraph] = parse('The plan, roughly. ^f3k9x2\n').doc.content;
    expect(paragraph?.attrs?.['anchor']).toBe('f3k9x2');
    expect(textOf(paragraph!)).toBe('The plan, roughly.');
  });

  it('takes each list item’s id off its own line, nested ones too', () => {
    const { doc } = parse('- Tent ^i1\n  - Pegs ^i2\n- Stove\n');
    const [list] = doc.content;
    expect(blockAnchorsOf(list!)).toEqual(['i1', 'i2', null, null]);
    expect(textOf(list!)).toBe('TentPegsStove');
  });

  it('reads a task’s id and keeps its tick', () => {
    const [list] = parse('- [x] Done ^d1\n').doc.content;
    expect(list?.content?.[0]?.attrs).toMatchObject({ checked: true, anchor: 'd1' });
  });

  it('gives an id on a line of its own to the table, quote, callout or code before it', () => {
    for (const block of [
      '| a | b |\n| - | - |\n| 1 | 2 |',
      '> quoted',
      '> [!note] Title\n> body',
      '```js\nx();\n```',
      '- one\n- two',
    ]) {
      const { doc, blocks } = parse(`${block}\n\n^b1\n\nAfter.\n`);
      expect(doc.content, block).toHaveLength(2);
      expect(doc.content[0]?.attrs?.['anchor'], block).toBe('b1');
      expect(blocks[0]?.source.endsWith('^b1'), block).toBe(true);
    }
  });

  it('leaves an id alone after a paragraph, a heading or nothing as the text it is', () => {
    expect(reading('Text.\n\n^a1\n')).toEqual([
      { text: 'Text.', ids: [null] },
      { text: '^a1', ids: [null] },
    ]);
    expect(reading('^a1\n')).toEqual([{ text: '^a1', ids: [null] }]);
    // A heading's own id, after its words, is read since A26-01 (as Obsidian writes it);
    // one on the line after it is text.
    expect(parse('# Heading\n\n^h1\n').doc.content[0]?.attrs?.['anchor']).toBeUndefined();
  });

  it('reads no id where the caret is escaped, joined to a word, or in code or a link', () => {
    for (const body of [
      'Text \\^a1\n',
      'e = mc^2\n',
      'Text `code ^a1`\n',
      'Text [[Note ^a1]]\n',
      'Text [x ^a1](y)\n',
      'Text &#94;a1\n',
      'Text *em ^a1*\n',
    ]) {
      expect(anchorsIn(parse(body).doc), body).toEqual(new Set());
    }
  });
});

describe('a note saved without edits keeps every byte of its ids', () => {
  it.each([
    'The plan. ^f3k9x2\n',
    'The plan.   ^f3k9x2  \n',
    'Line one\n^f3k9x2\n',
    '* Tent  ^i1\n  *  Pegs ^i2\n* Stove\n',
    '| a | b |\n|---|---|\n| 1 | 2 |\n\n\n^t1\n',
    '> said\r\n\r\n^q1\r\n',
  ])('%j', (body) => {
    expect(saved(body, (doc) => doc)).toBe(body);
  });
});

describe('giving a block an id writes the id and nothing else', () => {
  it('after a paragraph’s text', () => {
    const body = '# Plans\n\nThe  *summer*,\nroughly.\n\nLast.\n';
    expect(saved(body, (doc) => withAnchorAt(doc, [1], 'n1'))).toBe(
      '# Plans\n\nThe  *summer*,\nroughly. ^n1\n\nLast.\n',
    );
  });

  it('after a list item’s own line, in a list written its own way', () => {
    const body = '* Tent\n  *   Pegs\n*  Stove\n\nAfter.\n';
    const list = parse(body).doc.content[0]!;
    expect(list.type).toBe('bulletList');
    expect(saved(body, (doc) => withAnchorAt(doc, [0, 0, 1, 0], 'n1'))).toBe(
      '* Tent\n  *   Pegs ^n1\n*  Stove\n\nAfter.\n',
    );
    expect(saved(body, (doc) => withAnchorAt(doc, [0, 1], 'n2'))).toBe(
      '* Tent\n  *   Pegs\n*  Stove ^n2\n\nAfter.\n',
    );
  });

  it('on a line of its own after a table, in the note’s own line endings', () => {
    const body = '| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\nAfter.\r\n';
    expect(saved(body, (doc) => withAnchorAt(doc, [0], 't1'))).toBe(
      '| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\n^t1\r\n\r\nAfter.\r\n',
    );
  });

  it('as the last block of a note with no line ending at its end', () => {
    expect(saved('Only', (doc) => withAnchorAt(doc, [0], 'n1'))).toBe('Only ^n1');
  });

  it('and takes an id off the same way', () => {
    const body = 'Keep *this*. ^a1\n\n* one ^b1\n';
    expect(saved(body, (doc) => withAnchorAt(doc, [0], null))).toBe('Keep *this*.\n\n* one ^b1\n');
    expect(saved(body, (doc) => withAnchorAt(doc, [1, 0], null))).toBe(
      'Keep *this*. ^a1\n\n* one\n',
    );
  });

  it('reads back as the id it wrote', () => {
    const body = '- Tent\n- Stove\n';
    const written = saved(body, (doc) => withAnchorAt(doc, [0, 1], 'n1'));
    expect(anchorsIn(parse(written).doc)).toEqual(new Set(['n1']));
  });
});

describe('an id stays with its block', () => {
  it('through an edit to the block’s text', () => {
    const written = saved('Old words. ^a1\n', (doc) => {
      const [paragraph] = doc.content;
      return {
        ...doc,
        content: [{ ...paragraph!, content: [{ type: 'text', text: 'New *words*' }] }],
      };
    });
    expect(written).toBe('New \\*words\\* ^a1\n');
    expect(reading(written)).toEqual([{ text: 'New *words*', ids: ['a1'] }]);
  });

  it('through an edit to a list item beside it', () => {
    const written = saved('- one ^a1\n- two\n', (doc) => {
      const list = doc.content[0]!;
      const items = list.content!;
      const second = {
        ...items[1]!,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }],
      };
      return { ...doc, content: [{ ...list, content: [items[0]!, second] }] };
    });
    expect(written).toBe('- one ^a1\n- three\n');
  });

  it('when the block is moved within the note', () => {
    const body = 'First. ^a1\n\nSecond.\n\n| a |\n| - |\n\n^t1\n';
    const written = saved(body, (doc) => ({
      ...doc,
      content: [doc.content[2]!, doc.content[1]!, doc.content[0]!],
    }));
    expect(written).toBe('| a |\n| - |\n\n^t1\n\nSecond.\n\nFirst. ^a1\n');
  });

  it('is not written on a paragraph emptied of its words', () => {
    const written = saved('Gone. ^a1\n\nKept.\n', (doc) => ({
      ...doc,
      content: [{ ...doc.content[0]!, content: [] }, doc.content[1]!],
    }));
    expect(written).toBe('Kept.\n');
  });

  // A26-01: an id is never let go. A quoted paragraph has no place of its own,
  // so its id is the quote's, written on the line after it.
  it('is written as the quote’s when its paragraph is inside a quote', () => {
    const quote: EditorNode = {
      type: 'blockquote',
      content: [
        { type: 'paragraph', attrs: { anchor: 'x1' }, content: [{ type: 'text', text: 'In' }] },
      ],
    };
    const written = saved('', () => ({ type: 'doc', content: [quote] }));
    expect(written).toBe('> In\n\n^x1\n');
  });
});

describe('text that only looks like an id is written so it reads back as text', () => {
  const paragraphOf = (typed: string): EditorNode => ({
    type: 'paragraph',
    content: [{ type: 'text', text: typed }],
  });

  it.each([
    ['a caret and word at the end of a paragraph', paragraphOf('E = mc ^2')],
    [
      'an id typed at the end of a list item',
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraphOf('Pegs ^i1')] }] },
    ],
  ])('%s', (_label, node) => {
    const doc: EditorDocument = { type: 'doc', content: [node] };
    const written = serializeMarkdownBody({ originalBody: '', parsed: parse(''), doc });
    expect(reading(written)).toEqual([{ text: textOf(node), ids: blockAnchorsOf(node) }]);
    expect(anchorsIn(parse(written).doc)).toEqual(new Set());
  });

  it('a paragraph that is only `^id`, after a table', () => {
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        parse('| a |\n| - |\n').doc.content[0]!,
        { type: 'paragraph', content: [{ type: 'text', text: '^a1' }] },
      ],
    };
    const written = serializeMarkdownBody({ originalBody: '', parsed: parse(''), doc });
    const reread = parse(written).doc.content;
    expect(reread).toHaveLength(2);
    expect(textOf(reread[1]!)).toBe('^a1');
    expect(reread[0]?.attrs?.['anchor']).toBeUndefined();
  });

  it('a caret in the middle of a sentence is left bare', () => {
    const doc: EditorDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x ^2 is x squared' }] }],
    };
    expect(serializeMarkdownBody({ originalBody: '', parsed: parse(''), doc })).toBe(
      'x ^2 is x squared\n',
    );
  });
});

describe('shown blocks (P26-03)', () => {
  it('reads an embed of a block or heading alone in its paragraph as a block of its own', () => {
    const { doc } = parse('![[Plans#^f3k9x2]]\n\n![[Plans#Packing|packing]]\n');
    expect(
      doc.content.map((node) => [node.type, node.attrs?.['target'], node.attrs?.['heading']]),
    ).toEqual([
      ['blockEmbed', 'Plans', '#^f3k9x2'],
      ['blockEmbed', 'Plans', '#Packing'],
    ]);
    expect(doc.content[1]?.attrs?.['alias']).toBe('packing');
  });

  it('leaves an embed in a sentence, of a whole note, or in a list, as the link it was', () => {
    for (const body of [
      'See ![[Plans#^a1]].\n',
      '![[Plans]]\n',
      '- ![[Plans#^a1]]\n',
      '[[Plans#^a1]]\n',
    ]) {
      expect(JSON.stringify(parse(body).doc), body).not.toContain('blockEmbed');
    }
  });

  it('writes a new one as its embed, alone in its paragraph', () => {
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
        { type: 'blockEmbed', attrs: { target: 'Plans', heading: '#^f3k9x2', alias: null } },
      ],
    };
    const written = serializeMarkdownBody({ originalBody: '', parsed: parse(''), doc });
    expect(written).toBe('Before.\n\n![[Plans#^f3k9x2]]\n');
    expect(parse(written).doc.content[1]?.type).toBe('blockEmbed');
  });

  it('keeps its bytes when the block beside it is edited', () => {
    const body = 'Before.\n\n![[ Plans #^f3k9x2]]\n';
    const written = saved(body, (doc) => ({
      ...doc,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Changed.' }] },
        doc.content[1]!,
      ],
    }));
    expect(written).toBe('Changed.\n\n![[ Plans #^f3k9x2]]\n');
  });

  it('is written as its link inside a quote, where only a paragraph can stand', () => {
    const quote: EditorNode = {
      type: 'blockquote',
      content: [{ type: 'blockEmbed', attrs: { target: 'Plans', heading: '#^a1', alias: null } }],
    };
    const written = saved('', () => ({ type: 'doc', content: [quote] }));
    expect(written).toBe('> ![[Plans#^a1]]\n');
  });

  it('can itself be named by an id on a line after it — not read as one', () => {
    // An embed takes no id of its own: the id stays text.
    const { doc } = parse('![[Plans#^a1]]\n\n^b1\n');
    expect(doc.content).toHaveLength(2);
    expect(nodeIn(doc, [1]).type).toBe('paragraph');
  });
});
