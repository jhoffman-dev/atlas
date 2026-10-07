import { describe, expect, it } from 'vitest';
import { withAnchorAt, type EditorDocument, type EditorNode } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/*
 * Second adversarial pass on P26-01 block ids, over notes as people write
 * them by hand and over documents the editor can make: an id on a paragraph
 * the editor has wrapped in a list, a paragraph whose words end in spaces
 * before its id, and an id given to an item of a hand-written list.
 */

function saved(body: string, change: (doc: EditorDocument) => EditorDocument): string {
  const parsed = parseMarkdownBody(body);
  return serializeMarkdownBody({ originalBody: body, parsed, doc: change(parsed.doc) });
}

/** The document with every top-level block as if typed in: written afresh, not from its bytes. */
const editedEverywhere = (doc: EditorDocument): EditorDocument => ({
  ...doc,
  content: doc.content.map((node) => ({
    ...node,
    attrs: Object.fromEntries(
      Object.entries(node.attrs ?? {}).filter(([key]) => key !== 'blockId'),
    ),
  })),
});

const textOf = (node: EditorNode): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

describe('an id the editor holds on a paragraph inside a list item', () => {
  it('is written to the file, where toggling a list leaves it', () => {
    // What the editor holds after `toggleBulletList` on `Pack the tent ^a1`:
    // the id stays on the paragraph, now inside the item (see the ui test).
    const wrapped: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  attrs: { anchor: 'a1' },
                  content: [{ type: 'text', text: 'Pack the tent' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = serializeMarkdownBody({
      originalBody: '',
      parsed: parseMarkdownBody(''),
      doc: wrapped,
    });
    expect(out).toContain('^a1');
  });
});

describe('an edited block reads back as the editor had it (A21-01)', () => {
  it('keeps the spaces its words end with before its id', () => {
    const body = 'Para  ^a1\n';
    const before = parseMarkdownBody(body).doc.content[0]!;
    const out = saved(body, editedEverywhere);
    const after = parseMarkdownBody(out).doc.content[0]!;
    expect(before.attrs?.['anchor']).toBe('a1');
    expect({ text: textOf(after), id: after.attrs?.['anchor'] }).toEqual({
      text: textOf(before),
      id: 'a1',
    });
  });
});

describe('an id given to a block of a hand-written note changes nothing else', () => {
  it('holds for the first item of a list whose first line is only `- [ ]`', () => {
    const body = '- [ ]\n- [ ] x\n';
    const out = saved(body, (doc) => withAnchorAt(doc, [0, 0], 'zz9'));
    expect(out.replace(' ^zz9', '')).toBe(body);
  });
});
