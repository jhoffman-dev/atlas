// @vitest-environment jsdom
/**
 * Verification pass on PR #534 after its fix round: the tombstone guard
 * (tombstone-guard.ts) counts only top-level tombstones, so a step that moves a
 * hidden tombstone into a container — wrapping the blocks around it in a quote —
 * reads as a deletion, and the guard "puts back" a second one.
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

/** Every tombstone in the note, at any depth: each is a line in the saved file. */
const tombstonesAnywhere = (instance: Editor): number => {
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

function selectFromAboveToBelow(instance: Editor): void {
  let from = -1;
  let to = -1;
  instance.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === 'Above.') from = pos + 1;
    if (node.isTextblock && node.textContent === 'Below.') to = pos + 1 + 'Below.'.length;
  });
  instance.view.dispatch(
    instance.state.tr.setSelection(TextSelection.create(instance.state.doc, from, to)),
  );
}

describe('a hidden tombstone, when the blocks around it are wrapped', () => {
  it('stays one tombstone when the selection across it is made a quote', () => {
    const instance = noteWithTombstone();
    selectFromAboveToBelow(instance);
    instance.commands.setBlockquote();
    expect(instance.state.doc.firstChild?.type.name).toBe('blockquote');
    expect(tombstonesAnywhere(instance)).toBe(1);
  });

  it('stays one tombstone when the whole note is wrapped in a quote', () => {
    const instance = noteWithTombstone();
    instance.commands.selectAll();
    expect(instance.commands.wrapIn('blockquote')).toBe(true);
    expect(tombstonesAnywhere(instance)).toBe(1);
  });

  it('stays one tombstone when the selection across it is made a bullet list', () => {
    const instance = noteWithTombstone();
    selectFromAboveToBelow(instance);
    expect(instance.commands.toggleBulletList()).toBe(true);
    expect(instance.state.doc.firstChild?.type.name).toBe('bulletList');
    expect(tombstonesAnywhere(instance)).toBe(1);
  });
});
