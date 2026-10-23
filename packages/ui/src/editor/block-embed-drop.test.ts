// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { BLOCK_EMBED_NODE } from '@dfai/domain';
import { embedDropOverCode } from './block-embed-drop.ts';
import { blockEmbedTransfer } from './embed-transfer.ts';
import { createReadingExtensions } from './extensions.ts';

let editors: Editor[] = [];
afterEach(() => {
  editors.forEach((editor) => editor.destroy());
  editors = [];
});

function journal(): Editor {
  const editor = new Editor({
    extensions: createReadingExtensions({ loadImage: async () => null }),
    content: '<p>Before</p><pre><code>const ledger = 1;</code></pre><p>After</p>',
  });
  editors.push(editor);
  return editor;
}

/** The position of `text` in the editor's document, plus `offset`. */
function positionOf(editor: Editor, text: string, offset = 1): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text) === true) found = pos + offset;
  });
  return found;
}

const shape = (editor: Editor) => editor.state.doc.content.content.map((node) => node.type.name);

describe('a block embed dropped over code (#507)', () => {
  const html = blockEmbedTransfer({ target: 'The Art of War', id: 'k3x9q2' }).html;

  it('goes after the code block, and leaves the code as written', () => {
    const editor = journal();
    const dropped = embedDropOverCode(editor.state, {
      pos: positionOf(editor, 'ledger'),
      html,
    });
    expect(dropped).not.toBeNull();
    const next = editor.state.apply(dropped!);
    expect(next.doc.content.content.map((node) => node.type.name)).toEqual([
      'paragraph',
      'codeBlock',
      BLOCK_EMBED_NODE,
      'paragraph',
    ]);
    expect(next.doc.child(1).textContent).toBe('const ledger = 1;');
  });

  it('is left to the editor where it is not over code', () => {
    const editor = journal();
    expect(embedDropOverCode(editor.state, { pos: positionOf(editor, 'After'), html })).toBeNull();
  });

  it('leaves dropped HTML that is not a block embed to the editor, over code too', () => {
    const editor = journal();
    const before = shape(editor);
    for (const hostile of [
      '<img src=x onerror=alert(1)>',
      '<p>text</p>',
      '<script>1</script>',
      '',
    ]) {
      const dropped = embedDropOverCode(editor.state, {
        pos: positionOf(editor, 'ledger'),
        html: hostile,
      });
      expect(dropped, hostile).toBeNull();
    }
    expect(shape(editor)).toEqual(before);
  });
});
