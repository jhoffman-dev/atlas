// @vitest-environment jsdom
/**
 * Regression tests for PR #534 (#523): a removed highlight's tombstone is now
 * hidden (`display: none`), but it is still an atom of the document. Kindle
 * sync reads it to know a passage was removed (ADR-0043 §5); lose it and the
 * next sync brings the removed highlight back. A key the person presses next
 * to something they cannot see must not delete it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
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

/** The editor's position of the block (not its content) that reads `text`. */
function blockAt(instance: Editor, text: string): number {
  let at = -1;
  instance.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === text) at = pos;
  });
  return at;
}

const paragraphs = (instance: Editor): string[] => {
  const found: string[] = [];
  instance.state.doc.forEach((node) => {
    // The editor keeps an empty paragraph after a last atom to type in.
    if (node.isTextblock && node.textContent !== '') found.push(node.textContent);
  });
  return found;
};

describe('a hidden tombstone, under every way a person can delete', () => {
  it('stays when Backspace joins the paragraph after it to the one before', () => {
    const instance = noteWithTombstone();
    caretIn(instance, 'Below.', 0);
    instance.commands.keyboardShortcut('Backspace');
    expect(paragraphs(instance)).toEqual(['Above.Below.']);
    expect(tombstones(instance)).toBe(1);
  });

  it('stays when Delete joins the paragraph before it to the one after', () => {
    const instance = noteWithTombstone();
    caretIn(instance, 'Above.', 'Above.'.length);
    instance.commands.keyboardShortcut('Delete');
    expect(paragraphs(instance)).toEqual(['Above.Below.']);
    expect(tombstones(instance)).toBe(1);
  });

  it('is not selected by Backspace, which the person could not see', () => {
    const instance = noteWithTombstone();
    caretIn(instance, 'Below.', 0);
    instance.commands.keyboardShortcut('Backspace');
    expect(instance.state.selection instanceof NodeSelection).toBe(false);
  });

  it('stays when the selection across it is cut', () => {
    const instance = noteWithTombstone();
    const from = blockAt(instance, 'Above.') + 1 + 3;
    const to = blockAt(instance, 'Below.') + 1 + 2;
    instance.view.dispatch(
      instance.state.tr.setSelection(TextSelection.create(instance.state.doc, from, to)),
    );
    // What Cmd+X leaves behind in the document: the selection deleted.
    instance.view.dispatch(instance.state.tr.deleteSelection());
    expect(instance.state.doc.textContent).toContain('Abolow.');
    expect(tombstones(instance)).toBe(1);
  });

  it('stays when pasted over', () => {
    const instance = noteWithTombstone();
    const from = blockAt(instance, 'Above.') + 1 + 3;
    const to = blockAt(instance, 'Below.') + 1 + 2;
    instance.view.dispatch(instance.state.tr.insertText('Pasted.', from, to));
    expect(instance.state.doc.textContent).toContain('AboPasted.low.');
    expect(tombstones(instance)).toBe(1);
  });

  it('stays when the block selected in its place is replaced, as a drop on it would', () => {
    const instance = noteWithTombstone();
    let at = -1;
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === 'rawBlock') at = pos;
    });
    const selected = instance.state.tr.setSelection(NodeSelection.create(instance.state.doc, at));
    instance.view.dispatch(
      selected.replaceSelectionWith(
        instance.schema.nodes['paragraph']!.create(null, instance.schema.text('Dropped.')),
      ),
    );
    expect(paragraphs(instance)).toContain('Dropped.');
    expect(tombstones(instance)).toBe(1);
  });

  it('stays when a block is dragged from one side of it to the other', () => {
    const instance = noteWithTombstone();
    const above = blockAt(instance, 'Above.');
    const moved = instance.state.doc.nodeAt(above)!;
    const tr = instance.state.tr.delete(above, above + moved.nodeSize);
    tr.insert(tr.doc.content.size, moved);
    instance.view.dispatch(tr);
    expect(paragraphs(instance)).toEqual(['Below.', 'Above.']);
    expect(tombstones(instance)).toBe(1);
  });

  it('is taken by a note read again from its file, which says it was removed', async () => {
    const instance = noteWithTombstone();
    const { showAsRead } = await import('./block-anchor.ts');
    showAsRead(instance, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Only.' }] }],
    });
    expect(tombstones(instance)).toBe(0);
  });

  it('is put back in the same undo step, so one undo does not leave it twice', () => {
    const instance = noteWithTombstone();
    caretIn(instance, 'Below.', 0);
    instance.commands.keyboardShortcut('Backspace');
    instance.commands.undo();
    expect(paragraphs(instance)).toEqual(['Above.', 'Below.']);
    expect(tombstones(instance)).toBe(1);
  });
});
