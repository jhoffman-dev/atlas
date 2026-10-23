// @vitest-environment jsdom
/**
 * Regressions found in PR #534 (verification pass on 510eced0): the tombstone
 * guard (tombstone-guard.ts) counted only top-level tombstones, so a step that
 * moved a hidden tombstone into a container — wrapping the blocks around it in
 * a quote or a list — read as a deletion, and the guard "put back" a second
 * one. A tombstone is a top-level HTML block (ADR-0043): one moved into a quote
 * would be written `> <!-- … -->`, the person's words and no tombstone, so it
 * is taken back out to the top level where the wrap left it.
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

/** The tombstones that are blocks of the note itself, as ADR-0043 writes them. */
const topLevelTombstones = (instance: Editor): number => {
  let count = 0;
  instance.state.doc.forEach((node) => {
    if (
      node.type.name === 'rawBlock' &&
      String(node.attrs['markdown']).includes('highlight-removed')
    ) {
      count += 1;
    }
  });
  return count;
};

const words = (instance: Editor): string => instance.state.doc.textContent;

/** Takes off each `container` in turn, the caret in its first line, as a person would. */
function takeOffEvery(instance: Editor, container: string, takeOff: () => boolean): void {
  for (let guard = 0; guard < 10; guard += 1) {
    let inside = -1;
    instance.state.doc.descendants((node, pos, parent) => {
      if (inside === -1 && node.isTextblock && parent?.type.name !== 'doc') inside = pos + 1;
      return inside === -1;
    });
    let any = false;
    instance.state.doc.forEach((node) => {
      if (node.type.name === container) any = true;
    });
    if (!any || inside === -1) return;
    instance.view.dispatch(
      instance.state.tr.setSelection(TextSelection.create(instance.state.doc, inside)),
    );
    expect(takeOff()).toBe(true);
  }
}

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

  it('is a block of the note itself after the wrap, not a line of the quote', () => {
    const instance = noteWithTombstone();
    selectFromAboveToBelow(instance);
    instance.commands.setBlockquote();
    expect(topLevelTombstones(instance)).toBe(1);
    expect(words(instance)).toBe('Above.Below.');
  });

  it('stays one tombstone when the quote is taken off again', () => {
    const instance = noteWithTombstone();
    selectFromAboveToBelow(instance);
    instance.commands.setBlockquote();
    takeOffEvery(instance, 'blockquote', () => instance.commands.lift('blockquote'));
    expect(instance.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(tombstonesAnywhere(instance)).toBe(1);
    expect(topLevelTombstones(instance)).toBe(1);
  });

  it('stays one tombstone when the list is taken off again', () => {
    const instance = noteWithTombstone();
    selectFromAboveToBelow(instance);
    instance.commands.toggleBulletList();
    takeOffEvery(instance, 'bulletList', () => instance.commands.liftListItem('listItem'));
    expect(instance.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(tombstonesAnywhere(instance)).toBe(1);
    expect(topLevelTombstones(instance)).toBe(1);
  });

  it('one undo puts the note back as it was, the tombstone once', () => {
    const instance = noteWithTombstone();
    const before = instance.state.doc.toJSON();
    selectFromAboveToBelow(instance);
    instance.commands.setBlockquote();
    instance.commands.undo();
    expect(instance.state.doc.toJSON()).toEqual(before);
  });
});
