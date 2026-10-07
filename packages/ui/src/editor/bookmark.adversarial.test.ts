// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { createReadingExtensions } from './extensions.ts';

/**
 * Adversarial probes of the bookmark node (P22-01, ADR-0020): what the
 * editor's schema lets a bookmark become, beyond the switch commands.
 */

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const editorWith = (content: JSONContent | string) => {
  editor = new Editor({
    extensions: createReadingExtensions({ loadImage: async () => null }),
    content,
  });
  return editor;
};

const ROME = { target: 'Rome', heading: '#Days', alias: 'the days' };

describe('a bookmark copied and pasted', () => {
  // ProseMirror copies a slice as the schema's HTML and parses it back on
  // paste — within one note too — so a cut-and-paste to move a card goes
  // through renderHTML and parseHTML.
  it('keeps the note, heading and alias it links to', () => {
    const copied = editorWith({
      type: 'doc',
      content: [{ type: 'bookmark', attrs: ROME }],
    }).getHTML();
    const pasted = editorWith(copied).getJSON().content?.[0];
    expect(pasted?.type).toBe('bookmark');
    expect(pasted?.attrs).toMatchObject(ROME);
  });
});

describe('where the schema lets a bookmark go', () => {
  // ADR-0020: a bookmark is a top-level block only; a card in a list, quote
  // or table is not offered — and the writer cannot save one there as itself.
  it.each([
    ['a quote', 'blockquote', false],
    ['a callout', 'callout', false],
    ['a table cell', 'tableCell', false],
    ['a list item, after its first paragraph', 'listItem', true],
  ])('does not admit one inside %s', (_where, container, needsParagraph) => {
    const { schema } = editorWith({ type: 'doc', content: [{ type: 'paragraph' }] });
    const card = schema.nodes['bookmark']!.create(ROME);
    const children = needsParagraph ? [schema.nodes['paragraph']!.create(), card] : [card];
    expect(schema.nodes[container]!.validContent(Fragment.from(children))).toBe(false);
  });
});
