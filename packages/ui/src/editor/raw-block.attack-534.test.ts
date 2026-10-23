// @vitest-environment jsdom
/**
 * Attack tests for PR #534 (#523): a removed highlight's tombstone is now
 * hidden (`display: none`), but it is still an atom of the document. Kindle
 * sync reads it to know a passage was removed (ADR-0043 §5); lose it and the
 * next sync brings the removed highlight back. A key the person presses next
 * to something they cannot see must not delete it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { createEditorExtensions } from './extensions.ts';

const TOMBSTONE =
  '<!-- atlas:highlight-removed {"v":1,"kind":"kindle","location":9,"annotationId":"A9","words":"3f2a"} -->';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function noteWithTombstone(): Editor {
  const instance = new Editor({
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
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Above.' }] },
        { type: 'rawBlock', attrs: { markdown: TOMBSTONE } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Below.' }] },
      ],
    },
  });
  editor = instance;
  return instance;
}

const tombstones = (instance: Editor): number => {
  let count = 0;
  instance.state.doc.descendants((node) => {
    if (
      node.type.name === 'rawBlock' &&
      String(node.attrs['markdown']).includes('highlight-removed')
    ) {
      count += 1;
    }
  });
  return count;
};

/** Puts the caret at `offset` into the paragraph that reads `text`. */
function caretIn(instance: Editor, text: string, offset: number): void {
  let at = -1;
  instance.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === text) at = pos + 1 + offset;
  });
  instance.view.dispatch(
    instance.state.tr.setSelection(TextSelection.create(instance.state.doc, at)),
  );
}

describe('a hidden tombstone, next to the caret', () => {
  it('is drawn hidden (the premise)', () => {
    const instance = noteWithTombstone();
    expect(instance.view.dom.querySelector('pre.raw-block--hidden')).not.toBeNull();
  });

  it('survives Backspace at the start of the block after it', () => {
    const instance = noteWithTombstone();
    caretIn(instance, 'Below.', 0);
    instance.commands.keyboardShortcut('Backspace');
    expect(tombstones(instance)).toBe(1);
  });

  it('survives Delete at the end of the block before it', () => {
    const instance = noteWithTombstone();
    caretIn(instance, 'Above.', 'Above.'.length);
    instance.commands.keyboardShortcut('Delete');
    expect(tombstones(instance)).toBe(1);
  });

  it('survives deleting a selection that spans it, which the person cannot see in it', () => {
    const instance = noteWithTombstone();
    let from = -1;
    let to = -1;
    instance.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === 'Above.') from = pos + 1 + 3;
      if (node.isTextblock && node.textContent === 'Below.') to = pos + 1 + 2;
    });
    instance.view.dispatch(
      instance.state.tr.setSelection(TextSelection.create(instance.state.doc, from, to)),
    );
    instance.commands.keyboardShortcut('Backspace');
    expect(instance.state.doc.textContent).toContain('Abolow.');
    expect(tombstones(instance)).toBe(1);
  });
});
