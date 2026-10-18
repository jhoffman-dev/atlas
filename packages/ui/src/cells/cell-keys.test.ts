import { describe, expect, it } from 'vitest';
import {
  acceptsNumberDraft,
  editorKeyAction,
  isIsoDay,
  neighbourCell,
  numberOf,
  optionPickedByNumber,
} from './cell-keys.ts';

const plain = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

describe('editorKeyAction', () => {
  it('reads ↵ as commit, Esc as cancel, Tab as next and ⇧Tab as previous', () => {
    expect(editorKeyAction({ ...plain, key: 'Enter' })).toBe('commit');
    expect(editorKeyAction({ ...plain, key: 'Escape' })).toBe('cancel');
    expect(editorKeyAction({ ...plain, key: 'Tab' })).toBe('next');
    expect(editorKeyAction({ ...plain, key: 'Tab', shiftKey: true })).toBe('previous');
  });

  it('leaves a chord, ⇧↵, and any other key to the field', () => {
    expect(editorKeyAction({ ...plain, key: 'Enter', metaKey: true })).toBeNull();
    expect(editorKeyAction({ ...plain, key: 'Tab', ctrlKey: true })).toBeNull();
    expect(editorKeyAction({ ...plain, key: 'Enter', shiftKey: true })).toBeNull();
    expect(editorKeyAction({ ...plain, key: 'a' })).toBeNull();
    expect(editorKeyAction({ ...plain, key: 'ArrowDown' })).toBeNull();
  });
});

describe('neighbourCell', () => {
  const paths = ['a.md', 'b.md', 'c.md'];
  const columns = ['status', 'due', 'owner'];

  it('steps to the next column of the row', () => {
    expect(
      neighbourCell({ paths, columns, at: { path: 'a.md', column: 'status' }, step: 1 }),
    ).toEqual({ path: 'a.md', column: 'due' });
  });

  it('wraps from the last column to the first column of the next row, and back', () => {
    expect(
      neighbourCell({ paths, columns, at: { path: 'a.md', column: 'owner' }, step: 1 }),
    ).toEqual({ path: 'b.md', column: 'status' });
    expect(
      neighbourCell({ paths, columns, at: { path: 'b.md', column: 'status' }, step: -1 }),
    ).toEqual({ path: 'a.md', column: 'owner' });
  });

  it('has nowhere to go past the last cell of the last row, or before the first', () => {
    expect(
      neighbourCell({ paths, columns, at: { path: 'c.md', column: 'owner' }, step: 1 }),
    ).toBeNull();
    expect(
      neighbourCell({ paths, columns, at: { path: 'a.md', column: 'status' }, step: -1 }),
    ).toBeNull();
  });

  it('goes nowhere from a row or column the table no longer shows', () => {
    expect(
      neighbourCell({ paths, columns, at: { path: 'gone.md', column: 'due' }, step: 1 }),
    ).toBeNull();
    expect(
      neighbourCell({ paths, columns, at: { path: 'a.md', column: 'title' }, step: 1 }),
    ).toBeNull();
  });
});

describe('optionPickedByNumber', () => {
  it('picks the nth option by its number key, 1 to 8', () => {
    expect(optionPickedByNumber({ key: '1', filter: '', count: 8 })).toBe(0);
    expect(optionPickedByNumber({ key: '3', filter: 'do', count: 8 })).toBe(2);
    expect(optionPickedByNumber({ key: '8', filter: '', count: 8 })).toBe(7);
  });

  it('lets the filter win once it starts with a digit', () => {
    expect(optionPickedByNumber({ key: '3', filter: '2', count: 8 })).toBeNull();
    expect(optionPickedByNumber({ key: '3', filter: '2nd', count: 8 })).toBeNull();
  });

  it('picks nothing for a key past the options, 0, 9 or a letter', () => {
    expect(optionPickedByNumber({ key: '4', filter: '', count: 3 })).toBeNull();
    expect(optionPickedByNumber({ key: '0', filter: '', count: 8 })).toBeNull();
    expect(optionPickedByNumber({ key: '9', filter: '', count: 9 })).toBeNull();
    expect(optionPickedByNumber({ key: 'a', filter: '', count: 8 })).toBeNull();
  });
});

describe('a number cell', () => {
  it('takes digits, a minus and a point on the way to a number, never a letter', () => {
    for (const text of ['', '-', '12', '-12', '3.', '3.25', '.5']) {
      expect(acceptsNumberDraft(text), text).toBe(true);
    }
    for (const text of ['12a', 'e', '1.2.3', '--1', '1-', ' 1']) {
      expect(acceptsNumberDraft(text), text).toBe(false);
    }
  });

  it('holds a number, or null once nothing is left of one', () => {
    expect(numberOf('12')).toBe(12);
    expect(numberOf('-3.5')).toBe(-3.5);
    expect(numberOf('')).toBeNull();
    expect(numberOf('-')).toBeNull();
    expect(numberOf('.')).toBeNull();
  });
});

describe('a date cell', () => {
  it('commits a day written YYYY-MM-DD and nothing else', () => {
    expect(isIsoDay('2026-10-18')).toBe(true);
    expect(isIsoDay('2026-1-8')).toBe(false);
    expect(isIsoDay('18/10/2026')).toBe(false);
    expect(isIsoDay('2026-10-18T10:00')).toBe(false);
  });
});
