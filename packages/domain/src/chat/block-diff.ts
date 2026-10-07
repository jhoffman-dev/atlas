/**
 * Which blocks a change keeps, drops and adds — the longest run of blocks the
 * two versions share, in order, is kept, and everything else is a change.
 */

export type BlockChange<T> =
  | { readonly kind: 'same'; readonly before: T; readonly after: T }
  | { readonly kind: 'removed'; readonly before: T }
  | { readonly kind: 'added'; readonly after: T };

/**
 * The changes that turn `before` into `after`, in reading order, with a
 * removed block listed before the block that replaced it. Two blocks are the
 * same when their keys are.
 */
export function diffBlocks<T>({
  before,
  after,
  keyOf,
}: {
  before: readonly T[];
  after: readonly T[];
  keyOf: (block: T) => string;
}): BlockChange<T>[] {
  const table = commonLengths(before.map(keyOf), after.map(keyOf));
  const changes: BlockChange<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const b = before[i];
    const a = after[j];
    if (b !== undefined && a !== undefined && keyOf(b) === keyOf(a)) {
      changes.push({ kind: 'same', before: b, after: a });
      i += 1;
      j += 1;
    } else if (
      b !== undefined &&
      (a === undefined || cell(table, i + 1, j) >= cell(table, i, j + 1))
    ) {
      changes.push({ kind: 'removed', before: b });
      i += 1;
    } else if (a !== undefined) {
      changes.push({ kind: 'added', after: a });
      j += 1;
    }
  }
  return changes;
}

/** `table[i][j]`: how many blocks `before[i..]` and `after[j..]` share, in order. */
function commonLengths(before: readonly string[], after: readonly string[]): number[][] {
  const table = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const row = table[i] as number[];
      row[j] =
        before[i] === after[j]
          ? cell(table, i + 1, j + 1) + 1
          : Math.max(cell(table, i + 1, j), cell(table, i, j + 1));
    }
  }
  return table;
}

function cell(table: number[][], i: number, j: number): number {
  return table[i]?.[j] ?? 0;
}

/** A run of unchanged blocks too long to show, standing in for them. */
export interface FoldedBlocks {
  readonly kind: 'folded';
  readonly count: number;
}

/**
 * The changes with long unchanged runs folded away, keeping `context` blocks
 * of each run next to a change so the reader can see where it is.
 */
export function foldUnchanged<T>(
  changes: readonly BlockChange<T>[],
  context = 1,
): (BlockChange<T> | FoldedBlocks)[] {
  const near = (at: number) =>
    changes
      .slice(Math.max(0, at - context), at + context + 1)
      .some((change) => change.kind !== 'same');
  const shown: (BlockChange<T> | FoldedBlocks)[] = [];
  changes.forEach((change, at) => {
    if (change.kind !== 'same' || near(at)) {
      shown.push(change);
      return;
    }
    const last = shown.at(-1);
    if (last?.kind === 'folded')
      shown[shown.length - 1] = { kind: 'folded', count: last.count + 1 };
    else shown.push({ kind: 'folded', count: 1 });
  });
  return shown;
}
