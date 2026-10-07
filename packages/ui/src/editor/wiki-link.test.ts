// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { createReadingExtensions } from './extensions.ts';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

/** The wiki link nodes of `content`, once it has been through the editor. */
function linksThroughEditor(content: JSONContent): JSONContent[] {
  editor = new Editor({
    extensions: createReadingExtensions({ loadImage: async () => null }),
    content,
  });
  return (editor.getJSON().content?.[0]?.content ?? []).filter((node) => node.type === 'wikiLink');
}

const paragraphWith = (attrs: Record<string, unknown>): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ' },
        { type: 'wikiLink', attrs },
      ],
    },
  ],
});

describe('WikiLink', () => {
  it('keeps an embed an embed, so it is saved as `![[…]]`', () => {
    const [link] = linksThroughEditor(
      paragraphWith({ target: 'chart.png', heading: null, alias: null, embed: true }),
    );
    expect(link?.attrs?.['embed']).toBe(true);
  });

  it('keeps a plain link a link', () => {
    const [link] = linksThroughEditor(
      paragraphWith({ target: 'Plan', heading: null, alias: null }),
    );
    expect(link?.attrs?.['embed']).toBe(false);
  });
});
