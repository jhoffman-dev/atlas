import { describe, expect, it } from 'vitest';
import { HIDDEN_EDITOR_LIMIT, keepMounted } from './mounted-tabs.ts';

describe('keepMounted', () => {
  it('puts the shown tab first and keeps the ones shown before it, most recent first', () => {
    expect(keepMounted({ kept: ['t1', 't2'], shown: 't3', present: ['t1', 't2', 't3'] })).toEqual([
      't3',
      't1',
      't2',
    ]);
  });

  it('moves a tab shown again to the front rather than listing it twice', () => {
    expect(
      keepMounted({ kept: ['t3', 't1', 't2'], shown: 't2', present: ['t1', 't2', 't3'] }),
    ).toEqual(['t2', 't3', 't1']);
  });

  it('hands back the same list when the shown tab is already in front', () => {
    const kept = ['t2', 't1'];
    expect(keepMounted({ kept, shown: 't2', present: ['t1', 't2'] })).toBe(kept);
  });

  it(`keeps at most ${HIDDEN_EDITOR_LIMIT} hidden tabs, letting the least recently shown go`, () => {
    const present = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
    let kept: readonly string[] = [];
    for (const shown of present) kept = keepMounted({ kept, shown, present });
    expect(kept).toEqual(['t7', 't6', 't5', 't4', 't3']);
    expect(kept.length - 1).toBe(HIDDEN_EDITOR_LIMIT);
  });

  it('drops a tab that has closed, since there is nothing left to keep mounted', () => {
    expect(keepMounted({ kept: ['t2', 't1', 't9'], shown: 't2', present: ['t1', 't2'] })).toEqual([
      't2',
      't1',
    ]);
  });

  it('takes a lower limit', () => {
    expect(
      keepMounted({
        kept: ['t3', 't2', 't1'],
        shown: 't4',
        present: ['t1', 't2', 't3', 't4'],
        limit: 1,
      }),
    ).toEqual(['t4', 't3']);
  });
});
