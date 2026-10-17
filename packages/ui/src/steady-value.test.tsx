// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { sameEntries, sameItems, useSteadyValue } from './steady-value.ts';

describe('sameItems', () => {
  it('holds lists equal item for item, in order', () => {
    expect(sameItems(['title', 'status'], ['title', 'status'])).toBe(true);
    expect(sameItems(['title', 'status'], ['status', 'title'])).toBe(false);
    expect(sameItems(['title'], ['title', 'status'])).toBe(false);
  });
});

describe('sameEntries', () => {
  it('holds records equal key for key, lists item for item', () => {
    expect(
      sameEntries({ status: 'doing', tags: ['a', 'b'] }, { tags: ['a', 'b'], status: 'doing' }),
    ).toBe(true);
    expect(sameEntries({ tags: ['a', 'b'] }, { tags: ['a', 'c'] })).toBe(false);
    expect(sameEntries({ tags: ['a'] }, { tags: 'a' })).toBe(false);
  });

  it('tells a missing key from one that holds undefined, and a changed count of keys', () => {
    expect(sameEntries({ due: undefined }, { other: undefined })).toBe(false);
    expect(sameEntries({ status: 'doing' }, { status: 'doing', due: null })).toBe(false);
  });

  it('compares anything that is not a list by identity', () => {
    expect(sameEntries({ at: { day: 1 } }, { at: { day: 1 } })).toBe(false);
    expect(sameEntries({ count: Number.NaN }, { count: Number.NaN })).toBe(true);
  });
});

describe('useSteadyValue', () => {
  it('keeps the first of equal values, and takes a different one', () => {
    const first = { status: 'select' };
    const { result, rerender } = renderHook(({ value }) => useSteadyValue(value, sameEntries), {
      initialProps: { value: first },
    });
    rerender({ value: { status: 'select' } });
    expect(result.current).toBe(first);

    const changed = { status: 'text' };
    rerender({ value: changed });
    expect(result.current).toBe(changed);
    rerender({ value: { status: 'text' } });
    expect(result.current).toBe(changed);
  });
});
