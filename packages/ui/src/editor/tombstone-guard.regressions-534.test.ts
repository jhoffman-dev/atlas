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

/*
 * Verification pass 2 on ba80bef2: a selection copied or cut across a hidden
 * tombstone put the tombstone on the clipboard with the person's words. Pasted
 * back, the note held it twice; pasted into another note, that note held a
 * removed highlight's tombstone it never had.
 */
interface Clipboard {
  readonly held: Map<string, string>;
  readonly event: Event;
}

function clipboardEvent(type: 'copy' | 'cut' | 'paste', held = new Map<string, string>()) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => held.clear(),
      setData: (kind: string, value: string) => void held.set(kind, value),
      getData: (kind: string) => held.get(kind) ?? '',
      types: [...held.keys()],
      files: [],
      items: [],
    },
  });
  return { held, event } satisfies Clipboard;
}

function copyFromAboveToBelow(instance: Editor, type: 'copy' | 'cut'): Map<string, string> {
  selectFromAboveToBelow(instance);
  const { held, event } = clipboardEvent(type);
  instance.view.dom.dispatchEvent(event);
  return held;
}

function pasteAtEnd(instance: Editor, held: Map<string, string>): void {
  const end = instance.state.doc.content.size - 1;
  instance.view.dispatch(
    instance.state.tr.setSelection(TextSelection.create(instance.state.doc, end)),
  );
  instance.view.dom.dispatchEvent(clipboardEvent('paste', new Map(held)).event);
}

describe('a hidden tombstone, when the words around it are copied or cut', () => {
  it('is not put on the clipboard by a copy across it', () => {
    const instance = noteWithTombstone();
    const held = copyFromAboveToBelow(instance, 'copy');
    expect(held.get('text/html')).toContain('Below.');
    expect(held.get('text/html')).not.toContain('highlight-removed');
    expect(held.get('text/plain')).not.toContain('highlight-removed');
  });

  it('is not put on the clipboard by a cut across it, and stays in the note', () => {
    const instance = noteWithTombstone();
    const held = copyFromAboveToBelow(instance, 'cut');
    expect(held.get('text/html')).not.toContain('highlight-removed');
    expect(tombstonesAnywhere(instance)).toBe(1);
  });

  it('is not doubled by pasting back what was copied across it', () => {
    const instance = noteWithTombstone();
    const held = copyFromAboveToBelow(instance, 'copy');
    pasteAtEnd(instance, held);
    expect(words(instance)).toContain('Below.Above.');
    expect(tombstonesAnywhere(instance)).toBe(1);
    // Nor left as an empty raw block where it was pasted: that is written to the file too.
    let rawBlocks = 0;
    instance.state.doc.descendants((node) => {
      if (node.type.name === 'rawBlock') rawBlocks += 1;
    });
    expect(rawBlocks).toBe(1);
  });

  it('is never pasted in, even when the clipboard holds one', () => {
    const instance = noteWithTombstone();
    const html = `<p>Pasted.</p><pre data-raw-block="">${TOMBSTONE.replace(/</g, '&lt;')}</pre>`;
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelector('pre')).not.toBeNull();
    pasteAtEnd(instance, new Map([['text/html', html]]));
    expect(tombstonesAnywhere(instance)).toBe(1);
  });
});

/*
 * Verification pass 2 on ba80bef2: a numbered list made across a hidden
 * tombstone is split around it as the tombstone is lifted back out, and both
 * halves started at 1: the saved note read "1. Above." then "1. Below.".
 * The markdown writer numbers a list from its `start` (editor-to-mdast.ts).
 */
describe('a numbered list made across a hidden tombstone', () => {
  const lists = (instance: Editor) => {
    const found: { start: unknown; items: number }[] = [];
    instance.state.doc.forEach((node) => {
      if (node.type.name === 'orderedList') {
        found.push({ start: node.attrs['start'], items: node.childCount });
      }
    });
    return found;
  };

  it('numbers its second half on from the first', () => {
    const instance = noteWithTombstone();
    selectFromAboveToBelow(instance);
    expect(instance.commands.toggleOrderedList()).toBe(true);
    expect(topLevelTombstones(instance)).toBe(1);
    expect(lists(instance)).toEqual([
      { start: 1, items: 1 },
      { start: 2, items: 1 },
    ]);
  });

  it('numbers on from where the first half started, several items in', () => {
    const instance = noteWithTombstone();
    instance.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Above.' }] },
        { type: 'rawBlock', attrs: { markdown: TOMBSTONE } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Below.' }] },
      ],
    });
    instance.commands.selectAll();
    expect(instance.commands.toggleOrderedList()).toBe(true);
    expect(lists(instance)).toEqual([
      { start: 1, items: 2 },
      { start: 3, items: 1 },
    ]);
  });
});
