// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { BLOCK_EMBED_NODE } from '@dfai/domain';
import { blockEmbedTransfer } from './embed-transfer.ts';
import { createReadingExtensions } from './extensions.ts';

let editors: Editor[] = [];
afterEach(() => {
  editors.forEach((editor) => editor.destroy());
  editors = [];
});

/** The block embeds the editor makes of `html`, as its paste and drop parse it. */
function embedsParsedFrom(html: string) {
  const editor = new Editor({
    extensions: createReadingExtensions({ loadImage: async () => null }),
    content: html,
  });
  editors.push(editor);
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === BLOCK_EMBED_NODE) found.push(node.attrs);
  });
  return found;
}

describe('blockEmbedTransfer (#507)', () => {
  it("is the embed as text, and HTML the editor reads as the block's embed", () => {
    const transfer = blockEmbedTransfer({ target: 'The Art of War', id: 'k3x9q2' });
    expect(transfer.text).toBe('![[The Art of War#^k3x9q2]]');
    const embeds = embedsParsedFrom(transfer.html);
    expect(embeds).toHaveLength(1);
    expect(embeds[0]).toMatchObject({ target: 'The Art of War', heading: '#^k3x9q2', alias: null });
  });

  it('keeps a target with quotes, ampersands and angle brackets whole', () => {
    const target = 'Library/Tom & "Jerry" <1>';
    const transfer = blockEmbedTransfer({ target, id: 'ab12cd' });
    const embeds = embedsParsedFrom(transfer.html);
    expect(embeds).toHaveLength(1);
    expect(embeds[0]).toMatchObject({ target, heading: '#^ab12cd' });
  });
});
