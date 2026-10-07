import { describe, expect, it } from 'vitest';
import { diffBlocks, foldUnchanged, type BlockChange } from './block-diff.ts';

const diff = (before: string[], after: string[]) =>
  diffBlocks({ before, after, keyOf: (block) => block });

const shape = (changes: readonly BlockChange<string>[]) =>
  changes.map((change) =>
    change.kind === 'added'
      ? `+${change.after}`
      : change.kind === 'removed'
        ? `-${change.before}`
        : ` ${change.before}`,
  );

describe('diffBlocks', () => {
  it('keeps every block when nothing changed', () => {
    expect(shape(diff(['a', 'b'], ['a', 'b']))).toEqual([' a', ' b']);
  });

  it('shows a replaced block as removed, then added, in place', () => {
    expect(shape(diff(['a', 'b', 'c'], ['a', 'B', 'c']))).toEqual([' a', '-b', '+B', ' c']);
  });

  it('finds the longest run kept, not just a prefix', () => {
    expect(shape(diff(['x', 'a', 'b', 'c'], ['a', 'b', 'c', 'y']))).toEqual([
      '-x',
      ' a',
      ' b',
      ' c',
      '+y',
    ]);
  });

  it('handles an empty side', () => {
    expect(shape(diff([], ['a']))).toEqual(['+a']);
    expect(shape(diff(['a'], []))).toEqual(['-a']);
  });

  it('pairs the kept blocks so each side can be reached', () => {
    const [first] = diffBlocks({
      before: [{ id: 1, text: 'a' }],
      after: [{ id: 2, text: 'a' }],
      keyOf: (block) => block.text,
    });
    expect(first).toEqual({
      kind: 'same',
      before: { id: 1, text: 'a' },
      after: { id: 2, text: 'a' },
    });
  });
});

describe('foldUnchanged', () => {
  it('folds long unchanged runs, keeping one block of context beside a change', () => {
    const changes = diff(['1', '2', '3', '4', '5', '6'], ['1', '2', '3', '4', 'five', '6']);
    const folded = foldUnchanged(changes).map((item) =>
      item.kind === 'folded' ? `…${item.count}` : shape([item])[0],
    );
    expect(folded).toEqual(['…3', ' 4', '-5', '+five', ' 6']);
  });

  it('keeps everything when every block is near a change', () => {
    expect(foldUnchanged(diff(['a'], ['b']))).toHaveLength(2);
  });
});
