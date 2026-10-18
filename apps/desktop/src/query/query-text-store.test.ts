import { describe, expect, it, vi } from 'vitest';
import { createQueryTextStore, queryTextNow, setQueryText } from './query-text-store.ts';

describe('the query text store', () => {
  it('holds nothing until a query page says what is being written, and nothing again once it goes', () => {
    const store = createQueryTextStore();
    expect(queryTextNow(store)).toBeNull();
    setQueryText(store, 'FROM task');
    expect(queryTextNow(store)).toBe('FROM task');
    setQueryText(store, null);
    expect(queryTextNow(store)).toBeNull();
  });

  it('tells a subscriber of a change, and not of the same text said again', () => {
    const store = createQueryTextStore();
    const told = vi.fn();
    store.subscribe(told);
    setQueryText(store, 'FROM task');
    setQueryText(store, 'FROM task');
    expect(told).toHaveBeenCalledTimes(1);
    setQueryText(store, 'FROM task WHERE status = "next"');
    expect(told).toHaveBeenCalledTimes(2);
  });
});
