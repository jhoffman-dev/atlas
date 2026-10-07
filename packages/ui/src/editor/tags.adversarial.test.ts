// @vitest-environment jsdom
/**
 * Adversarial pass on drawing tags (P20-04): the editor must draw a tag
 * exactly where the grammar, reading the note's source, finds one — which is
 * what the index counts and a click opens.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { findTags } from '@atlas/domain';
import { createEditorExtensions } from './extensions.ts';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function editing(content: JSONContent) {
  editor = new Editor({
    extensions: createEditorExtensions({
      suggest: () => [],
      onView: () => {},
      onSlashView: () => {},
      suggestTags: () => [],
      onTagView: () => {},
      onOpenTag: null,
      offerLink: false,
      loadImage: async () => null,
      embedImage: null,
    }),
    content,
  });
  return editor;
}

const drawnTags = (instance: Editor) =>
  [...instance.view.dom.querySelectorAll('.tag')].map((element) =>
    element.getAttribute('data-tag'),
  );

describe('a # right after a wiki link', () => {
  it('is drawn as a tag only when the note’s source reads one there', () => {
    // `See [[Page]]#heading` as the note holds it: the `#` follows `]]`.
    const source = 'See [[Page]]#heading';
    const instance = editing({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'wikiLink', attrs: { target: 'Page', heading: null, alias: null } },
            { type: 'text', text: '#heading' },
          ],
        },
      ],
    });
    expect(drawnTags(instance)).toEqual(findTags(source).map((tag) => tag.name));
  });
});
