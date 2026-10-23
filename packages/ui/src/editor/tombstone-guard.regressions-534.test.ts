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
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Slice } from '@tiptap/pm/model';
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

/*
 * Regression (#534): a highlight block copied and pasted — in its own note or
 * another — was a second block holding the same marker: a second live
 * highlight of one passage, the same id or none. Pasted, it is a plain quote,
 * its words and comment kept, its marker and its id dropped.
 */
describe('a highlight, when it is copied and pasted', () => {
  const MARKER =
    '<!-- atlas:highlight {"v":1,"mark":"underline","color":"pink","kind":"kindle","location":41} -->';
  const HIGHLIGHT = ['> The tide keeps its hours.', `> ${MARKER}`, '>', '> Lit by Mara.'].join(
    '\n',
  );
  const QUOTE = ['> The tide keeps its hours.', '>', '> Lit by Mara.'].join('\n');

  function note(content: object[]): Editor {
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
      content: { type: 'doc', content },
    });
    return instance;
  }
  const literatureNote = () =>
    note([
      { type: 'paragraph', content: [{ type: 'text', text: 'My own paragraph.' }] },
      { type: 'rawBlock', attrs: { markdown: HIGHLIGHT, anchor: 'kd0041' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
    ]);

  /** The highlight block as the clipboard carries it: copied, its slice as pasting reads it. */
  function copiedHighlight(from: Editor): Slice {
    let at = -1;
    from.state.doc.forEach((node, offset) => {
      if (node.type.name === 'rawBlock') at = offset;
    });
    const node = from.state.doc.nodeAt(at);
    if (node === null) throw new Error('No highlight to copy.');
    return from.state.doc.slice(at, at + node.nodeSize);
  }

  /**
   * Pastes `slice` at the end of `into`, through every plugin's paste
   * transform, as a paste does: read again in `into`'s schema, as the
   * clipboard is.
   */
  function pasteAtEnd(into: Editor, slice: Slice): void {
    let pasted = Slice.fromJSON(into.schema, slice.toJSON());
    into.view.someProp('transformPasted', (transform) => {
      pasted = transform(pasted, into.view, false);
    });
    const end = into.state.doc.content.size;
    into.view.dispatch(into.state.tr.replaceRange(end, end, pasted));
  }

  const rawBlocks = (instance: Editor) => {
    const found: { markdown: string; anchor: unknown }[] = [];
    instance.state.doc.descendants((node) => {
      if (node.type.name === 'rawBlock') {
        found.push({ markdown: String(node.attrs['markdown']), anchor: node.attrs['anchor'] });
      }
    });
    return found;
  };
  const liveHighlights = (instance: Editor) =>
    rawBlocks(instance).filter(({ markdown }) => markdown.includes('atlas:highlight '));

  afterEach(() => {
    other?.destroy();
    other = null;
  });
  let other: Editor | null = null;

  it('pasted in its own note, is a plain quote; the original stays the one highlight', () => {
    const instance = literatureNote();
    editor = instance;
    pasteAtEnd(instance, copiedHighlight(instance));
    expect(liveHighlights(instance)).toEqual([{ markdown: HIGHLIGHT, anchor: 'kd0041' }]);
    expect(rawBlocks(instance).at(-1)).toEqual({ markdown: QUOTE, anchor: null });
  });

  it('pasted in another note, is a plain quote with no id', () => {
    const from = literatureNote();
    editor = from;
    other = note([{ type: 'paragraph', content: [{ type: 'text', text: 'Elsewhere.' }] }]);
    pasteAtEnd(other, copiedHighlight(from));
    expect(liveHighlights(other)).toEqual([]);
    expect(rawBlocks(other)).toEqual([{ markdown: QUOTE, anchor: null }]);
    expect(liveHighlights(from)).toHaveLength(1);
  });
});

/*
 * Regression (#534, fourth pass): the paste transform asks the drag whether it
 * moves (`view.dragging.move`), decided as the drag began; ProseMirror decides
 * again at the drop, from the copy key held then. A drag begun plain and
 * dropped holding the copy key copies, and the copy kept its marker and id: a
 * second live highlight. Begun holding it and dropped plain, the highlight is
 * moved — taken from where it was — and lands as a plain quote: no highlight left.
 */
describe('a highlight dragged within its note, the copy key changed mid-drag', () => {
  const MARKER =
    '<!-- atlas:highlight {"v":1,"mark":"underline","color":"pink","kind":"kindle","location":41} -->';
  const HIGHLIGHT = ['> The tide keeps its hours.', `> ${MARKER}`, '>', '> Lit by Mara.'].join(
    '\n',
  );

  function literatureNote(): Editor {
    return new Editor({
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
          { type: 'paragraph', content: [{ type: 'text', text: 'My own paragraph.' }] },
          { type: 'rawBlock', attrs: { markdown: HIGHLIGHT, anchor: 'kd0041' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
        ],
      },
    });
  }

  /**
   * Drags the highlight block to the note's end through ProseMirror's own drop
   * handler: the drag begun with `moveAtStart`, the drop made holding the copy
   * key or not. jsdom lays nothing out, so the drop point is given.
   */
  function dragHighlightToEnd(
    instance: Editor,
    { moveAtStart, copyKeyAtDrop }: { moveAtStart: boolean; copyKeyAtDrop: boolean },
  ): void {
    let at = -1;
    instance.state.doc.forEach((node, offset) => {
      if (node.type.name === 'rawBlock') at = offset;
    });
    const node = instance.state.doc.nodeAt(at);
    if (node === null) throw new Error('No highlight to drag.');
    const { view } = instance;
    const selection = NodeSelection.create(instance.state.doc, at);
    view.dispatch(instance.state.tr.setSelection(selection));
    const end = instance.state.doc.content.size;
    view.posAtCoords = () => ({ pos: end, inside: -1 });
    (view as unknown as { dragging: unknown }).dragging = {
      slice: selection.content(),
      move: moveAtStart,
      node: selection,
    };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, {
      clientX: 0,
      clientY: 0,
      // The copy key is Alt on a Mac, Ctrl elsewhere: jsdom is "elsewhere", so both are held.
      altKey: copyKeyAtDrop,
      ctrlKey: copyKeyAtDrop,
      dataTransfer: { getData: () => '', types: [], files: [] },
    });
    view.dom.dispatchEvent(drop);
  }

  const liveHighlights = (instance: Editor) => {
    const found: { markdown: string; anchor: unknown }[] = [];
    instance.state.doc.descendants((node) => {
      if (
        node.type.name === 'rawBlock' &&
        String(node.attrs['markdown']).includes('atlas:highlight ')
      ) {
        found.push({ markdown: String(node.attrs['markdown']), anchor: node.attrs['anchor'] });
      }
    });
    return found;
  };

  it('dragged plain throughout, is moved and stays the one highlight (the drag as this file drives it)', () => {
    const instance = literatureNote();
    editor = instance;
    dragHighlightToEnd(instance, { moveAtStart: true, copyKeyAtDrop: false });
    const order: string[] = [];
    instance.state.doc.forEach((node) => order.push(node.type.name));
    expect(order.slice(0, 3)).toEqual(['paragraph', 'paragraph', 'rawBlock']);
    expect(liveHighlights(instance)).toHaveLength(1);
  });

  it('begun plain and dropped holding the copy key, leaves one live highlight, not two', () => {
    const instance = literatureNote();
    editor = instance;
    dragHighlightToEnd(instance, { moveAtStart: true, copyKeyAtDrop: true });
    expect(liveHighlights(instance)).toEqual([{ markdown: HIGHLIGHT, anchor: 'kd0041' }]);
  });

  it('begun holding the copy key and dropped plain, is moved and still a highlight', () => {
    const instance = literatureNote();
    editor = instance;
    dragHighlightToEnd(instance, { moveAtStart: false, copyKeyAtDrop: false });
    expect(liveHighlights(instance)).toEqual([{ markdown: HIGHLIGHT, anchor: 'kd0041' }]);
  });
});
