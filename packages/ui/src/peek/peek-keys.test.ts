// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { peekKeyAction, peekKeyPlace, steppedIndex, type PeekKeyPress } from './peek-keys.ts';

const press = (key: string, held: Partial<Omit<PeekKeyPress, 'key'>> = {}): PeekKeyPress => ({
  key,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...held,
});

describe('peekKeyAction (Q6)', () => {
  it('steps rows on a plain ↑ or ↓ only from the chrome', () => {
    expect(peekKeyAction(press('ArrowUp'), 'chrome')).toEqual({ kind: 'step', by: -1 });
    expect(peekKeyAction(press('ArrowDown'), 'chrome')).toEqual({ kind: 'step', by: 1 });
  });

  it('leaves a plain ↑ or ↓ to the body, where it moves the caret, and to a field', () => {
    expect(peekKeyAction(press('ArrowDown'), 'body')).toBeNull();
    expect(peekKeyAction(press('ArrowUp'), 'field')).toBeNull();
  });

  it.each(['chrome', 'field', 'body'] as const)('steps rows on ⌥↑ and ⌥↓ from the %s', (place) => {
    expect(peekKeyAction(press('ArrowUp', { altKey: true }), place)).toEqual({
      kind: 'step',
      by: -1,
    });
    expect(peekKeyAction(press('ArrowDown', { altKey: true }), place)).toEqual({
      kind: 'step',
      by: 1,
    });
  });

  it('leaves ⌘↑, ⇧↑ and ⌃↑ alone: start of document, selection, the system', () => {
    expect(peekKeyAction(press('ArrowUp', { metaKey: true }), 'chrome')).toBeNull();
    expect(peekKeyAction(press('ArrowUp', { shiftKey: true }), 'chrome')).toBeNull();
    expect(peekKeyAction(press('ArrowDown', { ctrlKey: true }), 'chrome')).toBeNull();
    expect(peekKeyAction(press('ArrowDown', { altKey: true, shiftKey: true }), 'body')).toBeNull();
  });

  it('opens in a tab on ⌘↵ and in a split on ⌘⇧↵ outside the body', () => {
    expect(peekKeyAction(press('Enter', { metaKey: true }), 'chrome')).toEqual({
      kind: 'open',
      how: 'tab',
    });
    expect(peekKeyAction(press('Enter', { metaKey: true, shiftKey: true }), 'field')).toEqual({
      kind: 'open',
      how: 'split',
    });
  });

  it('leaves ⌘↵ and ⌘⇧↵ to the editor, which owns them (open a link, make a line a task)', () => {
    expect(peekKeyAction(press('Enter', { metaKey: true }), 'body')).toBeNull();
    expect(peekKeyAction(press('Enter', { metaKey: true, shiftKey: true }), 'body')).toBeNull();
  });

  it('answers nothing else, ⌘K above all: search opens above the peek', () => {
    expect(peekKeyAction(press('k', { metaKey: true }), 'chrome')).toBeNull();
    expect(peekKeyAction(press('Enter'), 'chrome')).toBeNull();
    expect(peekKeyAction(press('j'), 'chrome')).toBeNull();
  });
});

describe('peekKeyPlace', () => {
  it('names the editable text the body, a form control a field, and the rest chrome', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(editable);
    expect(peekKeyPlace(editable)).toBe('body');
    expect(peekKeyPlace(document.createElement('input'))).toBe('field');
    expect(peekKeyPlace(document.createElement('select'))).toBe('field');
    expect(peekKeyPlace(document.createElement('textarea'))).toBe('field');
    expect(peekKeyPlace(document.createElement('button'))).toBe('chrome');
    expect(peekKeyPlace(null)).toBe('chrome');
    editable.remove();
  });

  it('counts a combobox as a field, whose arrows move its choice', () => {
    const box = document.createElement('div');
    box.setAttribute('role', 'combobox');
    expect(peekKeyPlace(box)).toBe('field');
  });
});

describe('steppedIndex', () => {
  it('moves one row either way', () => {
    expect(steppedIndex({ index: 2, count: 186 }, 1)).toBe(3);
    expect(steppedIndex({ index: 2, count: 186 }, -1)).toBe(1);
  });

  it('goes nowhere past either end', () => {
    expect(steppedIndex({ index: 0, count: 186 }, -1)).toBeNull();
    expect(steppedIndex({ index: 185, count: 186 }, 1)).toBeNull();
    expect(steppedIndex({ index: 0, count: 1 }, 1)).toBeNull();
  });
});
