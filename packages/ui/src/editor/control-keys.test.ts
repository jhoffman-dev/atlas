// @vitest-environment jsdom
/**
 * A link or button drawn inside a block the editor does not let you type in —
 * "Open in PDF" in a highlight's block (#506) — takes keys as a control does.
 * Verification (PR #522 after 54f53fc3) found ⌘↩ and ⇧↩ on it reaching the
 * editor's hard-break keys, which replaced the selected block: the note was
 * saved without its highlight. No key pressed on such a control edits the note.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { BLOCK_ANCHOR_ATTR } from '@dfai/domain';
import { createEditorExtensions } from './extensions.ts';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const HIGHLIGHT = '> The last lamp was lit\n> <!-- atlas:highlight {"v":1} -->';

function literatureNote() {
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
      readerLinks: { labelFor: (id) => (id === 'lamp03' ? 'Open in PDF' : null) },
    }),
    content: {
      type: 'doc',
      content: [
        { type: 'rawBlock', attrs: { markdown: HIGHLIGHT, [BLOCK_ANCHOR_ATTR]: 'lamp03' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'After the lamp.' }] },
      ],
    },
  });
  editor = instance;
  // Selected whole, as the block is when the note opens on it.
  instance.view.dispatch(
    instance.state.tr.setSelection(NodeSelection.create(instance.state.doc, 0)),
  );
  return instance;
}

const openInPdf = (instance: Editor): HTMLElement => {
  const link = instance.view.dom.querySelector<HTMLElement>('[role="link"][data-wikilink]');
  if (link === null) throw new Error('the block offers no "Open in PDF"');
  return link;
};

const KEY_CODES: Record<string, number> = { Enter: 13, Backspace: 8, Delete: 46, x: 88, ' ': 32 };

function press(target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) {
  const init = { key, keyCode: KEY_CODES[key], bubbles: true, cancelable: true, ...modifiers };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(
    new KeyboardEvent('keypress', { ...init, charCode: key.length === 1 ? key.charCodeAt(0) : 0 }),
  );
}

const PRESSES: readonly [string, KeyboardEventInit][] = [
  ['Enter', {}],
  ['Enter', { metaKey: true }],
  ['Enter', { shiftKey: true }],
  ['Enter', { ctrlKey: true }],
  ['Backspace', {}],
  ['Delete', {}],
  ['x', {}],
  [' ', {}],
];

describe('a key pressed on "Open in PDF" in a selected highlight block', () => {
  for (const [key, modifiers] of PRESSES) {
    const named = [...Object.keys(modifiers).map((name) => name.replace('Key', '')), key].join('+');
    it(`${named} leaves the note as it was`, () => {
      const instance = literatureNote();
      const before = instance.state.doc;
      press(openInPdf(instance), key, modifiers);
      expect(instance.state.doc.eq(before)).toBe(true);
    });
  }

  it('leaves Enter to the note to follow the link: it is not taken by the editor first', () => {
    const instance = literatureNote();
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    });
    openInPdf(instance).dispatchEvent(event);
    // ProseMirror prevents every key it answers; one it never looked at is left as pressed.
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('a key pressed in the text', () => {
  it('still edits it, as before', () => {
    const instance = literatureNote();
    const before = instance.state.doc;
    // The selected block, deleted from the keyboard where the focus is the editor's own.
    press(instance.view.dom, 'Backspace');
    expect(instance.state.doc.eq(before)).toBe(false);
  });
});
