// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  peekKeyAction,
  peekKeyPlace,
  steppedIndex,
  type PeekKeyPlace,
  type PeekKeyPress,
} from './peek-keys.ts';

/** Attack on PR #417 (slice 6a): every key, every modifier set, every place. */

const KEYS = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
  'Tab',
  ' ',
  'Backspace',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'k',
  'K',
  'p',
  'n',
  'Meta',
  'Alt',
  'Shift',
  'Control',
  'Process',
  'Dead',
  'é',
  '',
];
const PLACES: readonly PeekKeyPlace[] = ['chrome', 'body', 'field'];

/** All sixteen sets of ⌥ ⌘ ⌃ ⇧ held with `key`. */
function presses(key: string): PeekKeyPress[] {
  return Array.from({ length: 16 }, (_, bits) => ({
    key,
    altKey: (bits & 1) !== 0,
    metaKey: (bits & 2) !== 0,
    ctrlKey: (bits & 4) !== 0,
    shiftKey: (bits & 8) !== 0,
  }));
}

const everyPress = KEYS.flatMap((key) =>
  presses(key).flatMap((press) => PLACES.map((place) => ({ press, place }))),
);

describe('peekKeyAction attack-417: the whole keyboard', () => {
  it('answers ⌘K, and every letter, with nothing, anywhere', () => {
    const answered = everyPress.filter(
      ({ press, place }) => press.key.length <= 1 && peekKeyAction(press, place) !== null,
    );
    expect(answered).toEqual([]);
  });

  it('answers nothing but ↑ ↓ and ↵', () => {
    const answered = everyPress.filter(
      ({ press, place }) =>
        !['ArrowUp', 'ArrowDown', 'Enter'].includes(press.key) &&
        peekKeyAction(press, place) !== null,
    );
    expect(answered).toEqual([]);
  });

  it('never answers a key held with ⌃', () => {
    const answered = everyPress.filter(
      ({ press, place }) => press.ctrlKey && peekKeyAction(press, place) !== null,
    );
    expect(answered).toEqual([]);
  });

  it("takes nothing from the editor's text but ⌥↑ and ⌥↓", () => {
    const taken = everyPress
      .filter(({ place }) => place === 'body')
      .filter(({ press }) => peekKeyAction(press, 'body') !== null)
      .map(({ press }) => press);
    expect(taken).toEqual([
      { key: 'ArrowUp', altKey: true, metaKey: false, ctrlKey: false, shiftKey: false },
      { key: 'ArrowDown', altKey: true, metaKey: false, ctrlKey: false, shiftKey: false },
    ]);
  });

  it('leaves ⇧↑ ⇧↓ (select a line) and ⌘↑ ⌘↓ (start, end) alone everywhere', () => {
    for (const place of PLACES) {
      for (const key of ['ArrowUp', 'ArrowDown']) {
        for (const press of presses(key).filter((each) => each.shiftKey || each.metaKey)) {
          expect(peekKeyAction(press, place)).toBeNull();
        }
      }
    }
  });
});

describe('peekKeyPlace attack-417: widgets that own their arrows', () => {
  // A segmented control (`role="radio"`, segmented-control.tsx) moves its own
  // choice on ↑ ↓; so do a slider, a spin button, a tab list and an option list.
  it.each([
    ['radiogroup', 'radio'],
    ['group', 'slider'],
    ['group', 'spinbutton'],
    ['tablist', 'tab'],
    ['listbox', 'option'],
  ])(
    'reads a focused role="%s" > role="%s" as a field, so its ↑ ↓ stay its own',
    (outer, inner) => {
      const group = document.createElement('div');
      group.setAttribute('role', outer);
      const widget = document.createElement('button');
      widget.setAttribute('role', inner);
      group.append(widget);
      document.body.append(group);
      expect(peekKeyPlace(widget)).toBe('field');
      group.remove();
    },
  );
});

describe('peekKeyPlace attack-417: guards', () => {
  it('reads a button inside a contenteditable="false" island of the text as the text', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const island = document.createElement('div');
    island.setAttribute('contenteditable', 'false');
    const button = document.createElement('button');
    island.append(button);
    editor.append(island);
    document.body.append(editor);
    expect(peekKeyPlace(button)).toBe('body');
    editor.remove();
  });

  it('reads a checkbox and a date field as fields, and a null target as the chrome', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    const date = document.createElement('input');
    date.type = 'date';
    expect(peekKeyPlace(box)).toBe('field');
    expect(peekKeyPlace(date)).toBe('field');
    expect(peekKeyPlace(null)).toBe('chrome');
  });
});

describe('steppedIndex attack-417: boundaries', () => {
  it('cannot step anywhere in a list of one', () => {
    expect(steppedIndex({ index: 0, count: 1 }, -1)).toBeNull();
    expect(steppedIndex({ index: 0, count: 1 }, 1)).toBeNull();
  });

  it('cannot step at all in an empty list', () => {
    expect(steppedIndex({ index: 0, count: 0 }, 1)).toBeNull();
    expect(steppedIndex({ index: 0, count: 0 }, -1)).toBeNull();
  });

  it('steps back into the list from a row that has fallen off its end (the list shrank)', () => {
    expect(steppedIndex({ index: 5, count: 3 }, -1)).toBe(2);
  });
});
