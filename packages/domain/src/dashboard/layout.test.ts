import { describe, expect, it } from 'vitest';
import {
  clampSpan,
  moveItem,
  placeEntry,
  removeEntry,
  replaceEntry,
  spanAfterDrag,
  stepPlacement,
  widgetEntries,
  withSpan,
} from './layout.ts';

const A = { title: 'A', kind: 'number', type: 'task' };
const B = { title: 'B', kind: 'bar', type: 'task', groupBy: 'status', span: 8 };
const C = { title: 'C', kind: 'list', type: 'task', owner: 'kept' };

describe('widgetEntries', () => {
  it('reads the list as written', () => {
    expect(widgetEntries({ widgets: [A, B] })).toEqual([A, B]);
  });

  it('reads no list as none', () => {
    expect(widgetEntries({ widgets: 'lots' })).toEqual([]);
    expect(widgetEntries({})).toEqual([]);
  });

  it('hands back a copy, so an edit never changes the note it was read from', () => {
    const widgets = [A];
    widgetEntries({ widgets }).push(B);
    expect(widgets).toEqual([A]);
  });
});

describe('clampSpan', () => {
  it('keeps a span the grid can draw', () => {
    expect(clampSpan(6)).toBe(6);
  });

  it('stops at one column and at twelve', () => {
    expect(clampSpan(0)).toBe(1);
    expect(clampSpan(-4)).toBe(1);
    expect(clampSpan(13)).toBe(12);
  });

  it('rounds to a whole column', () => {
    expect(clampSpan(6.6)).toBe(7);
  });

  it('reads nonsense as the narrowest', () => {
    expect(clampSpan(Number.NaN)).toBe(1);
  });
});

describe('moveItem', () => {
  it('moves an item later, the others closing up', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves an item earlier', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('changes nothing for a place that is not there', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });
});

describe('withSpan', () => {
  it('sets the span and keeps every other key', () => {
    expect(withSpan(C, 4)).toEqual({ ...C, span: 4 });
  });

  it('drops the older width, which span overrides', () => {
    expect(withSpan({ ...A, width: 2 }, 5)).toEqual({ ...A, span: 5 });
  });

  it('clamps', () => {
    expect(withSpan(A, 40)).toEqual({ ...A, span: 12 });
  });

  it('leaves an entry that is not a widget alone', () => {
    expect(withSpan('junk', 4)).toBe('junk');
  });
});

describe('placeEntry', () => {
  it('moves an entry to where another stood', () => {
    expect(placeEntry([A, B, C], { from: 2, to: 0, span: null })).toEqual([C, A, B]);
  });

  it('moves and resizes in one change', () => {
    expect(placeEntry([A, B, C], { from: 1, to: 0, span: 6 })).toEqual([{ ...B, span: 6 }, A, C]);
  });

  it('does not write a span it was not given', () => {
    expect(placeEntry([A, B], { from: 0, to: 1, span: null })[1]).toBe(A);
  });

  it('resizes in place when the target is out of range', () => {
    expect(placeEntry([A, B], { from: 1, to: 9, span: 4 })).toEqual([A, { ...B, span: 4 }]);
  });

  it('changes nothing when the entry moved on under the gesture', () => {
    expect(placeEntry([A, B], { from: 7, to: 0, span: 4 })).toEqual([A, B]);
  });
});

describe('removeEntry and replaceEntry', () => {
  it('removes only the one entry', () => {
    expect(removeEntry([A, B, C], 1)).toEqual([A, C]);
  });

  it('replaces only the one entry', () => {
    expect(replaceEntry([A, B], 0, C)).toEqual([C, B]);
  });

  it('replaces nothing out of range', () => {
    expect(replaceEntry([A], 3, C)).toEqual([A]);
  });
});

describe('stepPlacement', () => {
  const held = { index: 1, span: 6 };

  it('moves one place at a time', () => {
    expect(stepPlacement(held, { step: 'earlier', count: 3 })).toEqual({ index: 0, span: 6 });
    expect(stepPlacement(held, { step: 'later', count: 3 })).toEqual({ index: 2, span: 6 });
  });

  it('stops at the ends rather than wrapping', () => {
    expect(stepPlacement({ index: 0, span: 6 }, { step: 'earlier', count: 3 }).index).toBe(0);
    expect(stepPlacement({ index: 2, span: 6 }, { step: 'later', count: 3 }).index).toBe(2);
  });

  it('resizes one column at a time, within the grid', () => {
    expect(stepPlacement(held, { step: 'wider', count: 3 }).span).toBe(7);
    expect(stepPlacement(held, { step: 'narrower', count: 3 }).span).toBe(5);
    expect(stepPlacement({ index: 0, span: 12 }, { step: 'wider', count: 1 }).span).toBe(12);
    expect(stepPlacement({ index: 0, span: 1 }, { step: 'narrower', count: 1 }).span).toBe(1);
  });
});

describe('spanAfterDrag', () => {
  it('snaps to the nearest column boundary', () => {
    expect(spanAfterDrag({ span: 8, deltaX: -190, column: 100 })).toBe(6);
    expect(spanAfterDrag({ span: 8, deltaX: -140, column: 100 })).toBe(7);
    expect(spanAfterDrag({ span: 8, deltaX: 40, column: 100 })).toBe(8);
  });

  it('stays within the grid', () => {
    expect(spanAfterDrag({ span: 8, deltaX: 5000, column: 100 })).toBe(12);
    expect(spanAfterDrag({ span: 8, deltaX: -5000, column: 100 })).toBe(1);
  });

  it('does not move without a column to measure by', () => {
    expect(spanAfterDrag({ span: 8, deltaX: 300, column: 0 })).toBe(8);
  });
});
