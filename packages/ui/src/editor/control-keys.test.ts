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
  const init = { key, keyCode: KEY_CODES[key] ?? 0, bubbles: true, cancelable: true, ...modifiers };
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

  it('keeps Backspace from the browser, which would go Back, yet lets it reach what holds the editor', () => {
    const instance = literatureNote();
    const reached: KeyboardEvent[] = [];
    instance.view.dom.parentElement?.addEventListener('keydown', (event) => reached.push(event));
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      keyCode: 8,
      bubbles: true,
      cancelable: true,
    });
    openInPdf(instance).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(reached).toEqual([event]);
  });

  it('leaves a shortcut to the app: ⌘K is not prevented', () => {
    const instance = literatureNote();
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      keyCode: 75,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    openInPdf(instance).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  // WebKit answers these in editable text itself: ⌘Z's own undo moved the page's selection (PR #522).
  for (const [key, modifiers] of [
    ['z', { metaKey: true }],
    ['Z', { metaKey: true, shiftKey: true }],
    ['y', { ctrlKey: true }],
    ['i', { metaKey: true }],
  ] as const) {
    it(`keeps the browser's own ${key} with ${Object.keys(modifiers).join('+')} from the note`, () => {
      const instance = literatureNote();
      const before = instance.state.doc;
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      openInPdf(instance).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(instance.state.doc.eq(before)).toBe(true);
    });
  }
});

/** A control of `tag` drawn in the highlight's block, beside "Open in PDF". */
function drawnControl(instance: Editor, tag: 'input' | 'button'): HTMLElement {
  const holder = openInPdf(instance).closest('[contenteditable="false"]');
  if (holder === null) throw new Error('the block draws nothing that is not editable');
  const control = document.createElement(tag);
  holder.append(control);
  return control;
}

function keyDownOn(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('a key pressed on a field drawn in the note', () => {
  it("is left to the field: ⌘Z there is the field's own undo, Backspace its own delete", () => {
    const field = drawnControl(literatureNote(), 'input');
    expect(keyDownOn(field, { key: 'z', metaKey: true }).defaultPrevented).toBe(false);
    expect(keyDownOn(field, { key: 'Backspace' }).defaultPrevented).toBe(false);
  });
});

describe('a key pressed on a button drawn in the note', () => {
  it('presses it on Enter and Space, as a button does', () => {
    const button = drawnControl(literatureNote(), 'button');
    expect(keyDownOn(button, { key: 'Enter' }).defaultPrevented).toBe(false);
    expect(keyDownOn(button, { key: ' ' }).defaultPrevented).toBe(false);
  });

  it("keeps Backspace and ⌘Z from the browser, which would go Back or undo the page's selection", () => {
    const button = drawnControl(literatureNote(), 'button');
    expect(keyDownOn(button, { key: 'Backspace' }).defaultPrevented).toBe(true);
    expect(keyDownOn(button, { key: 'z', metaKey: true }).defaultPrevented).toBe(true);
  });
});

describe('keys that are not editing keys, pressed on a control drawn in the note', () => {
  // Moving focus, leaving, scrolling and composing are the browser's own: none is kept from it.
  const MOVING: readonly [string, KeyboardEventInit][] = [
    ['Tab', { key: 'Tab', keyCode: 9 }],
    ['Shift+Tab', { key: 'Tab', keyCode: 9, shiftKey: true }],
    ['Escape', { key: 'Escape', keyCode: 27 }],
    ['ArrowDown', { key: 'ArrowDown', keyCode: 40 }],
    ['ArrowUp', { key: 'ArrowUp', keyCode: 38 }],
    ['an IME composition (Process, 229)', { key: 'Process', keyCode: 229 }],
    ['a dead key', { key: 'Dead', keyCode: 229 }],
  ];
  for (const tag of ['button', 'link'] as const) {
    for (const [name, init] of MOVING) {
      it(`${name} on a focused ${tag} is not prevented`, () => {
        const instance = literatureNote();
        const control = tag === 'link' ? openInPdf(instance) : drawnControl(instance, 'button');
        expect(keyDownOn(control, init).defaultPrevented).toBe(false);
      });
    }
  }
});

describe('the listener on the editor element', () => {
  it('is removed with the editor: Backspace on a former control is no longer prevented', () => {
    const instance = literatureNote();
    const control = drawnControl(instance, 'button');
    expect(keyDownOn(control, { key: 'Backspace' }).defaultPrevented).toBe(true);
    const element = instance.view.dom;
    instance.destroy();
    // Teardown strips the editor's contenteditable; the control is made not editable
    // itself so only a surviving listener could still keep Backspace from the browser.
    control.setAttribute('contenteditable', 'false');
    element.append(control);
    expect(element.contains(control)).toBe(true);
    expect(keyDownOn(control, { key: 'Backspace' }).defaultPrevented).toBe(false);
  });

  it('is back with a new editor: Backspace on its control is prevented again', () => {
    literatureNote().destroy();
    const button = drawnControl(literatureNote(), 'button');
    expect(keyDownOn(button, { key: 'Backspace' }).defaultPrevented).toBe(true);
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
