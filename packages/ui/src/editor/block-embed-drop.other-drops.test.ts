// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { blockEmbedDrop } from './block-embed-drop.ts';
import { blockEmbedTransfer } from './embed-transfer.ts';
import { createReadingExtensions } from './extensions.ts';

/*
 * Regression, found verifying PR #525: the drop plugin is meant for a highlight dragged
 * from All highlights. Any other drop over code is ProseMirror's own to make
 * (before this PR it wrote the dropped text into the code). The plugin picks
 * its drops by the substring `data-block-embed` anywhere in the HTML, so a
 * drop that merely mentions it, or holds an embed among other blocks, is
 * swallowed: handled, default prevented, and nothing written.
 */

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

function positionInCode(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes('ledger') === true) found = pos + 1;
  });
  return found;
}

/** Whether the plugin takes the drop of `html` over the code block (true: the editor's own drop never runs). */
function pluginTakes(editor: Editor, html: string): boolean {
  const plugin = blockEmbedDrop();
  const view = {
    state: editor.state,
    posAtCoords: () => ({ pos: positionInCode(editor), inside: -1 }),
    dispatch: () => {},
  } as unknown as EditorView;
  const event = {
    dataTransfer: { getData: (kind: string) => (kind === 'text/html' ? html : '') },
    clientX: 0,
    clientY: 0,
    preventDefault: () => {},
  } as unknown as DragEvent;
  return plugin.props.handleDrop?.call(plugin, view, event, Slice.empty, false) === true;
}

describe('a drop over code that is not only block embeds (PR #525 regression)', () => {
  it('is left to the editor when the HTML only mentions data-block-embed in its text', () => {
    const editor = journal();
    expect(
      pluginTakes(editor, '<p>The attribute <code>data-block-embed</code> names the note.</p>'),
    ).toBe(false);
  });

  it('is left to the editor when an embed is dragged together with other blocks', () => {
    const editor = journal();
    const embed = blockEmbedTransfer({ target: 'The Art of War', id: 'k3x9q2' }).html;
    expect(pluginTakes(editor, `<p>Mara Quill's reading notes</p>${embed}`)).toBe(false);
  });
});
